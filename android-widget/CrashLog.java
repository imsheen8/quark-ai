package __APP_ID__;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.Charset;
import java.util.List;

/**
 * سجل انهيارات أندرويد لصفحة «سجل الأخطاء»:
 *  - استثناءات Java غير الممسوكة تُكتب في ملف قبل أن تُغلق العملية.
 *  - أسباب إغلاق العملية السابقة (Android 11+): انهيار أصلي (SIGSEGV) أو نقص ذاكرة أو ANR… — تكشف انهيار المحرك/GPU.
 * collect() تُرجع JSON وتمسح ما أُرسل فلا يتكرر.
 */
public class CrashLog {
    private static final String FILE = "quark_crash.log", SEEN = "quark_exit_seen";
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final int MAX_BYTES = 48000;

    public static void install(final Context c) {
        try {
            final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
            Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
                public void uncaughtException(Thread t, Throwable e) {
                    try {
                        StringWriter sw = new StringWriter();
                        e.printStackTrace(new PrintWriter(sw));
                        JSONObject o = new JSONObject();
                        o.put("kind", "JAVA");
                        o.put("ts", System.currentTimeMillis());
                        o.put("thread", t == null ? "" : t.getName());
                        o.put("text", sw.toString());
                        append(c, o.toString());
                    } catch (Throwable ignored) {}
                    if (prev != null) prev.uncaughtException(t, e);
                }
            });
        } catch (Throwable ignored) {}
    }

    private static synchronized void append(Context c, String line) {
        try {
            File f = new File(c.getFilesDir(), FILE);
            if (f.exists() && f.length() > MAX_BYTES) f.delete();
            FileOutputStream out = new FileOutputStream(f, true);
            out.write((line + "\n").getBytes(UTF8));
            out.close();
        } catch (Throwable ignored) {}
    }

    private static String reason(int r) {
        switch (r) {
            case 2: return "SIGNALED (إنهاء بإشارة من النظام)";
            case 3: return "LOW_MEMORY (قتل لنقص الذاكرة)";
            case 4: return "CRASH (انهيار Java)";
            case 5: return "CRASH_NATIVE (انهيار أصلي — المحرك/المكتبات)";
            case 6: return "ANR (التطبيق لا يستجيب)";
            case 7: return "INITIALIZATION_FAILURE";
            case 9: return "EXCESSIVE_RESOURCE_USAGE";
            case 12: return "DEPENDENCY_DIED";
            default: return "OTHER(" + r + ")";
        }
    }

    public static synchronized String collect(Context c) {
        JSONArray arr = new JSONArray();
        try {
            File f = new File(c.getFilesDir(), FILE);
            if (f.exists()) {
                byte[] b = new byte[(int) Math.min(f.length(), MAX_BYTES)];
                FileInputStream in = new FileInputStream(f);
                int n = in.read(b);
                in.close();
                String s = new String(b, 0, Math.max(0, n), UTF8);
                for (String line : s.split("\n")) {
                    if (line.trim().length() == 0) continue;
                    try { arr.put(new JSONObject(line)); } catch (Throwable ignored) {}
                }
                f.delete();
            }
        } catch (Throwable ignored) {}
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
                File seenF = new File(c.getFilesDir(), SEEN);
                long seen = 0;
                try {
                    if (seenF.exists()) {
                        byte[] b = new byte[32];
                        FileInputStream in = new FileInputStream(seenF);
                        int n = in.read(b);
                        in.close();
                        seen = Long.parseLong(new String(b, 0, Math.max(0, n), UTF8).trim());
                    }
                } catch (Throwable ignored) {}
                long maxTs = seen;
                List<ApplicationExitInfo> list = am.getHistoricalProcessExitReasons(c.getPackageName(), 0, 8);
                if (list != null) {
                    for (ApplicationExitInfo i : list) {
                        long ts = i.getTimestamp();
                        if (ts <= seen) continue;
                        if (ts > maxTs) maxTs = ts;
                        int r = i.getReason();
                        if (r != 2 && r != 3 && r != 4 && r != 5 && r != 6 && r != 7 && r != 9 && r != 12) continue;   /* نتجاهل الإغلاق العادي */
                        JSONObject o = new JSONObject();
                        o.put("kind", "EXIT");
                        o.put("ts", ts);
                        o.put("reason", reason(r));
                        o.put("desc", i.getDescription() == null ? "" : i.getDescription());
                        o.put("importance", i.getImportance());
                        o.put("pss", i.getPss());
                        o.put("rss", i.getRss());
                        o.put("pid", i.getPid());
                        arr.put(o);
                    }
                }
                if (maxTs > seen) {
                    FileOutputStream out = new FileOutputStream(seenF, false);
                    out.write(String.valueOf(maxTs).getBytes(UTF8));
                    out.close();
                }
            }
        } catch (Throwable ignored) {}
        return arr.toString();
    }
}
