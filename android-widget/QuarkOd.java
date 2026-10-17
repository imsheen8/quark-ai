package __APP_ID__;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.WebView;

import ai.quark.engine.QuarkLlama;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.Charset;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * جسر المحرك الأصلي (llama.cpp) إلى صفحة الويب: التحميل والمحادثة بالبث.
 * الأحداث تُدفع إلى window.__odn.ev({t:'tok'|'pp'|'done'|'err'|'loaded', id, ...}).
 */
public class QuarkOd {
    private static WebView web = null;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final ExecutorService EXEC = Executors.newSingleThreadExecutor();
    private static final Charset UTF8 = Charset.forName("UTF-8");

    // حماية من انهيار GPU: ملف علامة يُنشأ قبل تجربة GPU ويُحذف بعد نجاحها؛ إن بقي عند التشغيل التالي فالتشغيل السابق انهار
    private static boolean gpuActive = false, gpuVerified = false;
    private static File sentinel(Context c) { return new File(c.getFilesDir(), "od_gpu_try"); }
    private static File gpuLib(Context c) { return new File(c.getApplicationInfo().nativeLibraryDir, "libqvk.so"); }

    public static void attach(WebView w) { web = w; }

    static void emit(final JSONObject o) {
        final WebView w = web;
        if (w == null) return;
        final String js = "window.__odn&&window.__odn.ev(" + o.toString() + ")";
        MAIN.post(new Runnable() { public void run() { try { w.evaluateJavascript(js, null); } catch (Exception ignored) {} } });
    }

    static JSONObject ev(String t, String id) {
        JSONObject o = new JSONObject();
        try { o.put("t", t); o.put("id", id); } catch (Exception ignored) {}
        return o;
    }

    /** حالة المحرك الأصلي: هل المكتبة محمّلة؟ وما معلومات المعالج؟ (JSON) */
    public static String info(Context c) {
        try {
            JSONObject o = new JSONObject();
            boolean ok = QuarkLlama.available();
            o.put("available", ok);
            if (!ok) o.put("error", QuarkLlama.loadError());
            if (ok) {
                String r = QuarkLlama.init(c.getApplicationInfo().nativeLibraryDir);
                if (r.length() > 0) { o.put("available", false); o.put("error", r); }
                else o.put("sys", QuarkLlama.sysInfo());
                o.put("gpuLib", gpuLib(c).exists());                   // هل وحدة Vulkan مضمّنة في هذا الـ APK؟
                o.put("gpuCrashed", sentinel(c).exists());             // هل انهار تشغيل GPU آخر مرة؟
            }
            return o.toString();
        } catch (Throwable t) {
            return "{\"available\":false,\"error\":" + JSONObject.quote(String.valueOf(t.getMessage())) + "}";
        }
    }

    public static void load(final Context c, final String reqId, final String json) {
        EXEC.execute(new Runnable() {
            public void run() {
                JSONObject o = ev("loaded", reqId);
                try {
                    String r = QuarkLlama.init(c.getApplicationInfo().nativeLibraryDir);
                    if (r.length() > 0) { o.put("ok", false); o.put("error", r); emit(o); return; }
                    String lj = json;
                    boolean wantGpu = false, crashed = false;
                    try {
                        JSONObject q = new JSONObject(json);
                        if (q.optBoolean("gpu", false)) {
                            File sn = sentinel(c);
                            if (sn.exists()) { crashed = true; sn.delete(); q.put("gpu", false); }     // انهيار سابق: ارجع للمعالج
                            else if (!gpuLib(c).exists()) { q.put("gpu", false); }
                            else { wantGpu = true; q.put("gpu_lib", gpuLib(c).getAbsolutePath()); try { sn.createNewFile(); } catch (Exception ignored) {} }
                        }
                        lj = q.toString();
                    } catch (Exception ignored) {}
                    JSONObject res = new JSONObject(QuarkLlama.load(lj));
                    gpuActive = res.optBoolean("gpu", false);
                    gpuVerified = false;
                    sentinel(c).delete();      // وصلنا إلى هنا: لم ينهر التحميل (والإحماء) — الحماية تُعاد مع أول محادثة
                    if (crashed) res.put("gpu_note", "crashed");
                    java.util.Iterator<String> it = res.keys();
                    while (it.hasNext()) { String k = it.next(); o.put(k, res.get(k)); }
                } catch (Throwable t) {
                    try { o.put("ok", false); o.put("error", String.valueOf(t.getMessage())); } catch (Exception ignored) {}
                }
                emit(o);
            }
        });
    }

    public static void chat(final Context c, final String reqId, final String json, final String imagesJson) {
        EXEC.execute(new Runnable() {
            public void run() {
                final boolean guard = gpuActive && !gpuVerified;
                if (guard) { try { sentinel(c).createNewFile(); } catch (Exception ignored) {} }
                final StringBuilder buf = new StringBuilder();
                final long[] last = {System.currentTimeMillis()};
                final int[] lastPp = {-1};
                try {
                    byte[][] imgs = null;
                    if (imagesJson != null && imagesJson.length() > 2) {
                        JSONArray a = new JSONArray(imagesJson);
                        imgs = new byte[a.length()][];
                        for (int i = 0; i < a.length(); i++) imgs[i] = Base64.decode(a.getString(i), Base64.DEFAULT);
                    }
                    String res = QuarkLlama.chat(json, imgs, new QuarkLlama.Sink() {
                        public boolean piece(byte[] b) {
                            buf.append(new String(b, UTF8));
                            long now = System.currentTimeMillis();
                            if (now - last[0] >= 35) { flush(reqId, buf); last[0] = now; }
                            return true;
                        }
                        public void progress(int d, int t) {
                            int pct = t > 0 ? d * 100 / t : 0;
                            if (pct == lastPp[0]) return;
                            lastPp[0] = pct;
                            try { emit(ev("pp", reqId).put("done", d).put("total", t)); } catch (Exception ignored) {}
                        }
                    });
                    flush(reqId, buf);
                    JSONObject r = new JSONObject(res);
                    if (guard) { sentinel(c).delete(); if (r.optBoolean("ok", false)) gpuVerified = true; }
                    JSONObject o = ev(r.optBoolean("ok", false) ? "done" : "err", reqId);
                    java.util.Iterator<String> it = r.keys();
                    while (it.hasNext()) { String k = it.next(); o.put(k, r.get(k)); }
                    emit(o);
                } catch (Throwable t) {
                    if (guard) sentinel(c).delete();
                    flush(reqId, buf);
                    try { emit(ev("err", reqId).put("error", String.valueOf(t.getMessage())).put("code", "decode")); } catch (Exception ignored) {}
                }
            }
        });
    }

    private static void flush(String id, StringBuilder b) {
        if (b.length() == 0) return;
        try { emit(ev("tok", id).put("s", b.toString())); } catch (Exception ignored) {}
        b.setLength(0);
    }

    public static void abort() { try { QuarkLlama.abort(); } catch (Throwable ignored) {} }

    public static void free() {
        abort();
        EXEC.execute(new Runnable() { public void run() { try { QuarkLlama.unload(); } catch (Throwable ignored) {} } });
    }
}
