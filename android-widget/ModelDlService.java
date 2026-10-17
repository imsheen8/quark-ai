package __APP_ID__;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

import ai.quark.engine.FileDownloader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * تنزيل نماذج الذكاء الاصطناعي في الخلفية: خدمة أمامية بإشعار تقدّم وأزرار «إيقاف مؤقت / إلغاء».
 * الحالة تُحفظ في ملف فتُستأنف التنزيلات بعد إعادة تشغيل التطبيق، والملفات تُحفظ كاملة فقط (.part ثم إعادة تسمية).
 */
public class ModelDlService extends Service {
    static final String CH = "quark_dl", CH_DONE = "quark_dl_done";
    static final int NID = 7, NID_DONE = 8;
    static final String A_PAUSE = "quark.dl.PAUSE", A_CANCEL = "quark.dl.CANCEL";
    public static volatile boolean running = false;

    static final class F { String url = "", name = ""; long size = 0, done = 0; }
    static final class Job {
        String id = "", name = "", dir = "", state = "queued", err = "", code = "";
        List<F> files = new ArrayList<F>();
        Map<String, String> headers = new HashMap<String, String>();
        boolean wifiOnly = true, force = false, retryable = false;
        double bps = 0; long addedAt = 0;
        volatile String after = "";
        volatile FileDownloader cur = null;
        long total() { long n = 0; for (F f : files) n += f.size; return n; }
        long done() { long n = 0; for (F f : files) n += f.done; return n; }
    }

    static final Object LK = new Object();
    static final Map<String, Job> JOBS = new LinkedHashMap<String, Job>();
    static boolean loaded = false;
    static long lastSave = 0;

    static File root(Context c) { return new File(c.getFilesDir(), "quark-models"); }
    static File stateFile(Context c) { return new File(c.getFilesDir(), "od_dl.json"); }

    // ---------- الحالة ----------
    static void ensureLoaded(Context c) {
        synchronized (LK) {
            if (loaded) return;
            loaded = true;
            try {
                File f = stateFile(c);
                if (!f.exists()) return;
                byte[] b = new byte[(int) f.length()];
                FileInputStream in = new FileInputStream(f);
                int off = 0, n;
                while (off < b.length && (n = in.read(b, off, b.length - off)) > 0) off += n;
                in.close();
                JSONArray a = new JSONObject(new String(b, "UTF-8")).getJSONArray("jobs");
                for (int i = 0; i < a.length(); i++) {
                    Job j = fromJson(a.getJSONObject(i));
                    if ("downloading".equals(j.state)) j.state = "queued";     // قُطع بإغلاق التطبيق: يُستأنف
                    JOBS.put(j.id, j);
                }
            } catch (Exception ignored) {}
        }
    }

    static Job fromJson(JSONObject o) throws Exception {
        Job j = new Job();
        j.id = o.getString("id"); j.name = o.optString("name", j.id); j.dir = o.getString("dir");
        j.state = o.optString("state", "queued"); j.err = o.optString("err", ""); j.code = o.optString("code", "");
        j.wifiOnly = o.optBoolean("wifiOnly", true); j.addedAt = o.optLong("addedAt", System.currentTimeMillis());
        JSONObject h = o.optJSONObject("headers");
        if (h != null) { java.util.Iterator<String> it = h.keys(); while (it.hasNext()) { String k = it.next(); j.headers.put(k, h.getString(k)); } }
        JSONArray fa = o.getJSONArray("files");
        for (int i = 0; i < fa.length(); i++) {
            JSONObject fo = fa.getJSONObject(i); F f = new F();
            f.url = fo.optString("url", ""); f.name = fo.getString("name"); f.size = fo.optLong("size", 0); f.done = fo.optLong("done", 0);
            j.files.add(f);
        }
        return j;
    }

    static JSONObject toJson(Job j, boolean withSecrets) throws Exception {
        JSONObject o = new JSONObject();
        o.put("id", j.id); o.put("name", j.name); o.put("dir", j.dir); o.put("state", j.state); o.put("err", j.err); o.put("code", j.code);
        o.put("wifiOnly", j.wifiOnly); o.put("addedAt", j.addedAt); o.put("bps", j.bps); o.put("retryable", j.retryable);
        o.put("size", j.total()); o.put("bytes", j.done());
        JSONArray fa = new JSONArray();
        for (F f : j.files) {
            JSONObject fo = new JSONObject();
            fo.put("name", f.name); fo.put("size", f.size); fo.put("done", f.done);
            if (withSecrets) fo.put("url", f.url);
            fa.put(fo);
        }
        o.put("files", fa);
        if (withSecrets) { JSONObject h = new JSONObject(); for (Map.Entry<String, String> e : j.headers.entrySet()) h.put(e.getKey(), e.getValue()); o.put("headers", h); }
        return o;
    }

    static void save(Context c, boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - lastSave < 3000) return;
        lastSave = now;
        try {
            JSONArray a = new JSONArray();
            synchronized (LK) { for (Job j : JOBS.values()) a.put(toJson(j, true)); }
            File tmp = new File(c.getFilesDir(), "od_dl.json.tmp");
            FileOutputStream out = new FileOutputStream(tmp);
            out.write(new JSONObject().put("jobs", a).toString().getBytes("UTF-8"));
            out.close();
            tmp.renameTo(stateFile(c));
        } catch (Exception ignored) {}
    }

    // ---------- واجهة الجسر (تُستدعى من MainActivity) ----------
    public static String enqueue(Context c, String specJson) {
        try {
            ensureLoaded(c);
            JSONObject o = new JSONObject(specJson);
            Job n = fromJson(o);
            n.state = "queued"; n.err = ""; n.code = ""; n.force = o.optBoolean("force", false);
            synchronized (LK) {
                Job old = JOBS.get(n.id);
                if (old != null) {
                    if ("ready".equals(old.state)) return "{\"ok\":true,\"state\":\"ready\"}";
                    if ("downloading".equals(old.state)) return "{\"ok\":true,\"state\":\"downloading\"}";
                    for (F f : n.files) for (F g : old.files) if (g.name.equals(f.name) && g.size == f.size) f.done = g.done;
                    n.addedAt = old.addedAt;
                }
                JOBS.put(n.id, n);
            }
            save(c, true);
            kick(c);
            return "{\"ok\":true,\"state\":\"queued\"}";
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}";
        }
    }

    public static void pause(Context c, String id) {
        ensureLoaded(c);
        synchronized (LK) {
            Job j = JOBS.get(id);
            if (j == null) return;
            if ("downloading".equals(j.state)) { j.after = "paused"; FileDownloader d = j.cur; if (d != null) d.stop(); }
            else if ("queued".equals(j.state)) { j.state = "paused"; j.err = ""; j.code = ""; }
        }
        save(c, true);
    }

    public static void resume(Context c, String id, boolean force) {
        ensureLoaded(c);
        synchronized (LK) {
            Job j = JOBS.get(id);
            if (j == null || "ready".equals(j.state) || "downloading".equals(j.state)) return;
            j.state = "queued"; j.err = ""; j.code = ""; j.after = ""; if (force) j.force = true;
        }
        save(c, true);
        kick(c);
    }

    /** يلغي التنزيل ويحذف ملفاته (ويُستخدم أيضًا لحذف نموذج جاهز). */
    public static void cancel(Context c, String id) {
        ensureLoaded(c);
        Job j; boolean wasRunning = false;
        synchronized (LK) {
            j = JOBS.get(id);
            if (j == null) return;
            if ("downloading".equals(j.state)) { wasRunning = true; j.after = "cancel"; FileDownloader d = j.cur; if (d != null) d.stop(); }
            else JOBS.remove(id);
        }
        if (!wasRunning) { deleteDir(new File(root(c), j.dir)); save(c, true); }
    }

    public static String snapshot(Context c) {
        ensureLoaded(c);
        try {
            JSONArray a = new JSONArray();
            synchronized (LK) { for (Job j : JOBS.values()) a.put(toJson(j, false)); }
            return new JSONObject().put("jobs", a).put("root", root(c).getAbsolutePath()).put("service", running).toString();
        } catch (Exception e) { return "{\"jobs\":[]}"; }
    }

    static boolean hasWork() {
        synchronized (LK) { for (Job j : JOBS.values()) if ("queued".equals(j.state) || "downloading".equals(j.state)) return true; }
        return false;
    }

    static void kick(Context c) {
        if (!hasWork()) return;
        try {
            Intent i = new Intent(c, ModelDlService.class);
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (Exception ignored) {}
    }

    static void deleteDir(File d) {
        if (d == null || !d.exists()) return;
        File[] fs = d.listFiles();
        if (fs != null) for (File f : fs) { if (f.isDirectory()) deleteDir(f); else f.delete(); }
        d.delete();
    }

    // ---------- الخدمة ----------
    private Thread worker = null;
    private PowerManager.WakeLock wl = null;
    private long lastNotif = 0;
    private String curName = "";

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        ensureLoaded(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) {
            NotificationChannel c = new NotificationChannel(CH, "تنزيل النماذج", NotificationManager.IMPORTANCE_LOW);
            c.setShowBadge(false);
            nm.createNotificationChannel(c);
            nm.createNotificationChannel(new NotificationChannel(CH_DONE, "اكتمال تنزيل النماذج", NotificationManager.IMPORTANCE_DEFAULT));
        }
        String act = intent != null ? intent.getAction() : null;
        String id = intent != null ? intent.getStringExtra("id") : null;
        if (A_PAUSE.equals(act) && id != null) pause(this, id);
        if (A_CANCEL.equals(act) && id != null) cancel(this, id);
        Notification n = build("جارٍ التحضير…", 0, 0, true, null);
        if (Build.VERSION.SDK_INT >= 29) startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(NID, n);
        if (worker == null || !worker.isAlive()) {
            worker = new Thread(new Runnable() { public void run() { loop(); } }, "quark-dl");
            worker.start();
        }
        return START_STICKY;
    }

    /** أندرويد 15 يحدّ الخدمات الأمامية من نوع dataSync بنحو 6 ساعات يوميًا: نوقف مؤقتًا ونُبقي التقدّم محفوظًا. */
    public void onTimeout(int startId, int fgsType) {
        synchronized (LK) {
            for (Job j : JOBS.values()) if ("downloading".equals(j.state)) { j.after = "paused"; FileDownloader d = j.cur; if (d != null) d.stop(); }
        }
    }

    private Notification build(String text, int done, int max, boolean indeterminate, Job j) {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CH)
            .setSmallIcon(R.drawable.ic_stat_quark)
            .setContentTitle(curName.length() > 0 ? curName : "QUARK AI — تنزيل نموذج")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(max, done, indeterminate)
            .setContentIntent(pi);
        if (j != null) {
            Intent p = new Intent(this, ModelDlService.class).setAction(A_PAUSE).putExtra("id", j.id);
            Intent x = new Intent(this, ModelDlService.class).setAction(A_CANCEL).putExtra("id", j.id);
            int fl = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
            b.addAction(0, "إيقاف مؤقت", PendingIntent.getService(this, 1, p, fl));
            b.addAction(0, "إلغاء", PendingIntent.getService(this, 2, x, fl));
        }
        return b.build();
    }

    private void notifyProgress(Job j, boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - lastNotif < 1000) return;
        lastNotif = now;
        long t = j.total(), d = j.done();
        int pct = t > 0 ? (int) (d * 100 / t) : 0;
        String sp = j.bps > 0 ? " · " + fmtBytes((long) j.bps) + "/ث" : "";
        String text = (t > 0 ? pct + "%  " + fmtBytes(d) + " من " + fmtBytes(t) : "جارٍ التنزيل…") + sp;
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NID, build(text, (int) (t > 0 ? d * 1000 / t : 0), 1000, t <= 0, j));
        } catch (Exception ignored) {}
    }

    static String fmtBytes(long b) {
        if (b >= 1073741824L) return String.format(java.util.Locale.US, "%.1f GB", b / 1073741824.0);
        if (b >= 1048576L) return String.format(java.util.Locale.US, "%.0f MB", b / 1048576.0);
        return (b / 1024) + " KB";
    }

    private boolean metered() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            return cm != null && cm.isActiveNetworkMetered();
        } catch (Exception e) { return false; }
    }

    private Job nextQueued() {
        synchronized (LK) { for (Job j : JOBS.values()) if ("queued".equals(j.state)) return j; }
        return null;
    }

    private void loop() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) { wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "quark:dl"); wl.acquire(6 * 60 * 60 * 1000L); }
        } catch (Exception ignored) {}
        try {
            Job j;
            while ((j = nextQueued()) != null) runJob(j);
        } catch (Throwable t) {
            // لا نترك الخدمة معلّقة
        } finally {
            try { if (wl != null && wl.isHeld()) wl.release(); } catch (Exception ignored) {}
            save(this, true);
            if (Build.VERSION.SDK_INT >= 24) stopForeground(Service.STOP_FOREGROUND_DETACH); else stopForeground(false);
            try { NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE); if (nm != null) nm.cancel(NID); } catch (Exception ignored) {}
            stopSelf();
            if (hasWork()) kick(this);       // طلب جديد وصل أثناء الإنهاء
        }
    }

    private void done(String title, String text) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm == null) return;
            Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(this, 3, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification n = new NotificationCompat.Builder(this, CH_DONE).setSmallIcon(R.drawable.ic_stat_quark)
                .setContentTitle(title).setContentText(text).setAutoCancel(true).setContentIntent(pi).build();
            nm.notify(NID_DONE, n);
        } catch (Exception ignored) {}
    }

    private void runJob(final Job j) {
        curName = j.name;
        synchronized (LK) { j.state = "downloading"; j.err = ""; j.code = ""; j.after = ""; }
        if (j.wifiOnly && !j.force && metered()) {
            synchronized (LK) { j.state = "paused"; j.code = "wifi"; j.err = "بانتظار الواي فاي (ميزة «الواي فاي فقط» مفعّلة)."; }
            save(this, true);
            return;
        }
        notifyProgress(j, true);
        try {
            for (final F f : j.files) {
                File dest = new File(root(this), j.dir + "/" + f.name);
                if (f.size > 0 && f.done >= f.size && dest.exists() && dest.length() == f.size) continue;
                FileDownloader d = new FileDownloader(f.url, j.headers, dest, f.size);
                synchronized (LK) { j.cur = d; if (j.after.length() > 0) d.stop(); }
                FileDownloader.Result r = d.run(new FileDownloader.Listener() {
                    public void onProgress(long done, long total, double bps) {
                        f.done = done; if (total > 0) f.size = total; j.bps = bps; j.retryable = false;
                        notifyProgress(j, false); save(ModelDlService.this, false);
                    }
                    public void onRetry(int attempt, String msg) { j.err = "إعادة المحاولة (" + attempt + "): " + msg; }
                });
                synchronized (LK) { j.cur = null; }
                if ("stopped".equals(r.status)) {
                    if ("cancel".equals(j.after)) {
                        synchronized (LK) { JOBS.remove(j.id); }
                        deleteDir(new File(root(this), j.dir));
                        save(this, true);
                        return;
                    }
                    synchronized (LK) { j.state = "paused"; j.err = ""; }
                    save(this, true);
                    return;
                }
                if ("error".equals(r.status)) {
                    synchronized (LK) { j.state = "error"; j.err = r.msg; j.code = r.code; j.retryable = r.retry; j.bps = 0; }
                    save(this, true);
                    done("تعذّر تنزيل " + j.name, r.msg);
                    return;
                }
                f.done = r.size; f.size = r.size;
            }
            synchronized (LK) { j.state = "ready"; j.bps = 0; j.err = ""; j.code = ""; }
            save(this, true);
            done("اكتمل تنزيل " + j.name, "النموذج جاهز للاستخدام بدون إنترنت.");
        } catch (Throwable t) {
            synchronized (LK) { j.state = "error"; j.err = String.valueOf(t.getMessage()); j.code = "io"; j.retryable = true; j.cur = null; }
            save(this, true);
        }
    }

    @Override
    public void onDestroy() {
        running = false;
        try { if (wl != null && wl.isHeld()) wl.release(); } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
