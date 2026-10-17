package ai.quark.engine;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

/**
 * تنزيل ملف واحد بصورة قابلة للاستئناف (HTTP Range) مع إعادة محاولة وتحقق من الحجم وصيغة GGUF.
 * يكتب إلى «dest.part» ثم يعيد التسمية عند الاكتمال فلا يظهر ملف ناقص أبدًا باسمه النهائي.
 * بلا اعتماد على أندرويد (يُختبر على الجهاز المضيف).
 */
public final class FileDownloader {
    public interface Listener {
        void onProgress(long done, long total, double bps);
        void onRetry(int attempt, String msg);
    }

    public static final class Result {
        public final String status;   // done | stopped | error
        public final String code;     // auth | notfound | http | net | size | badfile | io
        public final String msg;
        public final long size;
        public final boolean retry;
        Result(String status, String code, String msg, long size, boolean retry) { this.status = status; this.code = code; this.msg = msg; this.size = size; this.retry = retry; }
    }

    private static final class Fail extends Exception {
        final String code; final boolean retry;
        Fail(String code, String msg, boolean retry) { super(msg); this.code = code; this.retry = retry; }
    }

    private final String url;
    private final Map<String, String> headers;
    private final File dest, part;
    private final long expected;
    private volatile boolean stopped = false;
    private volatile HttpURLConnection conn = null;

    public FileDownloader(String url, Map<String, String> headers, File dest, long expectedSize) {
        this.url = url; this.headers = headers; this.dest = dest; this.part = new File(dest.getPath() + ".part"); this.expected = expectedSize;
    }

    public void stop() {
        stopped = true;
        HttpURLConnection c = conn;
        if (c != null) { try { c.disconnect(); } catch (Exception ignored) {} }
    }

    private void sleep(long ms) {
        long end = System.currentTimeMillis() + ms;
        while (!stopped && System.currentTimeMillis() < end) { try { Thread.sleep(100); } catch (InterruptedException e) { return; } }
    }

    public Result run(Listener l) {
        try {
            File dir = dest.getParentFile();
            if (dir != null && !dir.exists() && !dir.mkdirs()) return new Result("error", "io", "تعذّر إنشاء مجلد التنزيل", 0, false);
            if (dest.exists() && expected > 0 && dest.length() == expected) return new Result("done", "", "", dest.length(), false);
            return download(l);
        } catch (Fail f) {
            return new Result("error", f.code, f.getMessage(), 0, f.retry);
        } catch (IOException e) {
            if (stopped) return new Result("stopped", "", "", part.length(), false);
            return new Result("error", "io", "خطأ في الكتابة على التخزين: " + e.getMessage(), 0, false);
        }
    }

    private Result download(Listener l) throws Fail, IOException {
        long have = part.exists() ? part.length() : 0;
        if (expected > 0 && have > expected) { part.delete(); have = 0; }
        long total = expected, wBytes = have, wT = System.currentTimeMillis(), lastPost = 0;
        double bps = 0;
        int attempt = 0, r416 = 0;
        boolean finished = total > 0 && have >= total;
        if (l != null) l.onProgress(have, total, 0);
        while (!finished) {
            if (stopped) return new Result("stopped", "", "", have, false);
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                conn = c;
                c.setConnectTimeout(20000); c.setReadTimeout(30000); c.setInstanceFollowRedirects(true);
                c.setRequestProperty("User-Agent", "QuarkAI/1.0");
                c.setRequestProperty("Accept-Encoding", "identity");
                if (headers != null) for (Map.Entry<String, String> e : headers.entrySet()) c.setRequestProperty(e.getKey(), e.getValue());
                if (have > 0) c.setRequestProperty("Range", "bytes=" + have + "-");
                int code = c.getResponseCode();
                if (code == 416) {
                    if (total > 0 && have >= total) { finished = true; break; }
                    part.delete(); have = 0; wBytes = 0;
                    if (++r416 > 3) throw new Fail("http", "رفض الخادم الاستئناف (416).", false);
                    continue;
                }
                if (code == 401 || code == 403) throw new Fail("auth", "هذا الملف يتطلب تسجيل دخول Hugging Face أو قبول شروط النموذج (أضف الرمز من إعدادات التنزيل).", false);
                if (code == 404) throw new Fail("notfound", "الملف غير موجود على الخادم.", false);
                if (code < 200 || code >= 300) throw new Fail("http", "رد غير متوقع من الخادم (" + code + ").", code >= 500 || code == 429);
                if (code == 200 && have > 0) { part.delete(); have = 0; wBytes = 0; }   // تجاهل الخادم Range: نبدأ من الصفر
                long cl = c.getContentLengthLong();
                String cr = c.getHeaderField("Content-Range");
                long t = 0;
                if (cr != null && cr.lastIndexOf('/') > 0) { try { t = Long.parseLong(cr.substring(cr.lastIndexOf('/') + 1).trim()); } catch (NumberFormatException ignored) {} }
                else if (cl > 0) t = have + cl;
                if (t > 0) total = t;
                try (InputStream in = c.getInputStream(); RandomAccessFile out = new RandomAccessFile(part, "rw")) {
                    out.seek(have);
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n); have += n;
                        long now = System.currentTimeMillis();
                        if (now - wT >= 1500) { bps = Math.max(0, (have - wBytes) * 1000.0 / (now - wT)); wBytes = have; wT = now; }
                        if (l != null && now - lastPost >= 400) { lastPost = now; l.onProgress(have, total, bps); }
                        if (stopped) break;
                    }
                }
                if (stopped) return new Result("stopped", "", "", have, false);
                if (total <= 0 || have >= total) { finished = true; break; }
                if (++attempt > 8) throw new Fail("net", "انقطع الاتصال قبل اكتمال الملف.", true);
                if (l != null) l.onRetry(attempt, "انقطع الاتصال");
                sleep(Math.min(15000, 600L << attempt));
            } catch (Fail f) {
                throw f;
            } catch (IOException e) {
                if (stopped) return new Result("stopped", "", "", part.exists() ? part.length() : have, false);
                have = part.exists() ? part.length() : 0;
                if (++attempt > 8) throw new Fail("net", "تعذّر إكمال التنزيل: " + e.getMessage(), true);
                if (l != null) l.onRetry(attempt, String.valueOf(e.getMessage()));
                sleep(Math.min(15000, 600L << attempt));
            } finally {
                conn = null;
                if (c != null) { try { c.disconnect(); } catch (Exception ignored) {} }
            }
        }
        if (l != null) l.onProgress(have, total, bps);
        if (expected > 0 && have != expected) { part.delete(); throw new Fail("size", "حجم الملف المُنزَّل (" + have + ") لا يطابق المتوقع (" + expected + ").", true); }
        try (RandomAccessFile f = new RandomAccessFile(part, "r")) {
            byte[] h = new byte[4];
            if (f.length() < 4 || f.read(h) != 4 || h[0] != 'G' || h[1] != 'G' || h[2] != 'U' || h[3] != 'F') { part.delete(); throw new Fail("badfile", "الملف المُنزَّل ليس نموذج GGUF صالحًا (قد يكون صفحة خطأ).", false); }
        }
        if (dest.exists() && !dest.delete()) throw new Fail("io", "تعذّر استبدال الملف القديم.", false);
        if (!part.renameTo(dest)) throw new Fail("io", "تعذّر إنهاء الملف.", false);
        return new Result("done", "", "", dest.length(), false);
    }
}
