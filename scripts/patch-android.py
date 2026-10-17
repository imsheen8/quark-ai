#!/usr/bin/env python3
"""يُشغَّل بعد `npx cap add android`: يضبط أشرطة النظام والصلاحيات والودجت ورقم الإصدار والتوقيع."""
import json, os, pathlib, re

cfg = json.load(open('capacitor.config.json', encoding='utf-8'))
app_id = cfg['appId']
app = pathlib.Path('android/app')
main = app / 'src/main'

# 1) MainActivity: جسر JavaScript لتغيير لون شريط التنقل
java_dir = main / 'java' / pathlib.Path(*app_id.split('.'))
java_dir.mkdir(parents=True, exist_ok=True)
(java_dir / 'MainActivity.java').write_text('''package %s;

import android.Manifest;
import android.app.ActivityManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import org.json.JSONArray;
import org.json.JSONObject;
import android.graphics.Color;
import android.os.Build;
import android.os.StatFs;
import android.os.Bundle;
import android.view.Window;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private String pendingAction = null;
    private String pendingShare = null;
    private static volatile boolean visible = false;
    /* البوابة المدمجة (Chaquopy): 0 = لم تبدأ، -1 = فشلت، غير ذلك = المنفذ */
    private static volatile int gwPort = 0;
    private static volatile String gwToken = "";
    private static boolean gwStarting = false;

    private void startGateway() {
        synchronized (MainActivity.class) {
            if (gwStarting) return;
            gwStarting = true;
        }
        final Context appCtx = getApplicationContext();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    QuarkPy.start(appCtx);
                    gwToken = QuarkPy.token;
                    gwPort = QuarkPy.port;
                } catch (Throwable t) {
                    gwPort = -1;
                }
            }
        }, "quark-gateway").start();
    }

    /** هل الواجهة على الشاشة الآن؟ (يستخدمها TaskNotifier لتفادي إشعار لا حاجة له) */
    public static boolean isVisible() { return visible; }

    @Override
    public void onResume() {
        super.onResume();
        visible = true;
        try { ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).cancel(2); } catch (Exception ignored) {}
    }

    @Override
    public void onPause() {
        super.onPause();
        visible = false;
        /* أثناء كتابة الرد نُبقي الصفحة تعمل في الخلفية (الخدمة الأمامية تحمي العملية) */
        if (GenService.running) {
            try { WebView w = getBridge().getWebView(); w.onResume(); w.resumeTimers(); } catch (Exception ignored) {}
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState == null) pendingAction = actionOf(getIntent());
        getBridge().getWebView().addJavascriptInterface(new NavBridge(), "QuarkNative");
        QuarkOd.attach(getBridge().getWebView());
        startGateway();
        try {
            if (getSharedPreferences(TaskService.PREFS, MODE_PRIVATE).getBoolean("on", false) && !TaskService.running) {
                Intent ts = new Intent(this, TaskService.class);
                if (Build.VERSION.SDK_INT >= 26) startForegroundService(ts); else startService(ts);
            }
        } catch (Exception ignored) {}
    }

    /** ضغطة على الودجت أثناء تشغيل التطبيق: نمرّر الإجراء للصفحة مباشرة. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String a = actionOf(intent);
        if (a == null) return;
        pendingAction = a;
        final WebView w = getBridge().getWebView();
        w.post(new Runnable() {
            @Override
            public void run() { w.evaluateJavascript("window.__widgetPoll && window.__widgetPoll()", null); }
        });
    }

    /** إجراء الودجت/الاختصار (extra) أو «share» عند المشاركة من تطبيق آخر. */
    private String actionOf(Intent i) {
        if (i == null) return null;
        String a = i.getAction();
        if (Intent.ACTION_SEND.equals(a) || Intent.ACTION_SEND_MULTIPLE.equals(a)) {
            pendingShare = buildShare(i);
            return pendingShare == null ? null : "share";
        }
        if (Intent.ACTION_PROCESS_TEXT.equals(a)) {
            CharSequence t = i.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
            if (t == null || t.length() == 0) return null;
            try { JSONObject o = new JSONObject(); o.put("text", t.toString()); pendingShare = o.toString(); } catch (Exception e) { return null; }
            return "share";
        }
        return i.getStringExtra(QuarkWidget.EXTRA);
    }

    private String displayName(Uri u) {
        String n = null;
        try {
            Cursor c = getContentResolver().query(u, new String[]{ OpenableColumns.DISPLAY_NAME }, null, null, null);
            if (c != null) { if (c.moveToFirst()) n = c.getString(0); c.close(); }
        } catch (Exception ignored) {}
        if (n == null || n.length() == 0) n = u.getLastPathSegment();
        return n == null ? "file" : n;
    }

    /** ينسخ المحتوى المشارَك (نص + ملفات حتى 8 × 25MB) إلى مجلد cache/share ويعيده JSON للصفحة. */
    private String buildShare(Intent i) {
        try {
            JSONObject o = new JSONObject();
            CharSequence t = i.getCharSequenceExtra(Intent.EXTRA_TEXT), sub = i.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
            if (t != null) o.put("text", t.toString());
            if (sub != null) o.put("subject", sub.toString());
            ArrayList<Uri> uris = new ArrayList<Uri>();
            if (Intent.ACTION_SEND_MULTIPLE.equals(i.getAction())) {
                ArrayList<Uri> l = i.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (l != null) uris.addAll(l);
            } else {
                Uri u = i.getParcelableExtra(Intent.EXTRA_STREAM);
                if (u != null) uris.add(u);
            }
            File dir = new File(getCacheDir(), "share");
            dir.mkdirs();
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) f.delete();
            JSONArray files = new JSONArray();
            for (int k = 0; k < uris.size() && k < 8; k++) {
                Uri u = uris.get(k);
                String name = displayName(u), mime = getContentResolver().getType(u);
                File f = new File(dir, k + "_" + name.replaceAll("[^A-Za-z0-9._-]", "_"));
                boolean ok = true;
                try {
                    InputStream in = getContentResolver().openInputStream(u);
                    FileOutputStream out = new FileOutputStream(f);
                    byte[] b = new byte[65536];
                    long total = 0;
                    int n;
                    while ((n = in.read(b)) > 0) {
                        total += n;
                        if (total > 25L * 1024 * 1024) { ok = false; break; }
                        out.write(b, 0, n);
                    }
                    out.close();
                    in.close();
                } catch (Exception e) { ok = false; }
                if (!ok) { f.delete(); continue; }
                JSONObject jo = new JSONObject();
                jo.put("name", name);
                jo.put("mime", mime == null ? "" : mime);
                jo.put("path", "share/" + f.getName());
                files.put(jo);
            }
            if (files.length() > 0) o.put("files", files);
            if (!o.has("text") && !o.has("files")) return null;
            return o.toString();
        } catch (Exception e) { return null; }
    }

    public class NavBridge {
        /** منفذ البوابة المدمجة: 0 = تجهز بعد، -1 = فشلت، غير ذلك = جاهزة على 127.0.0.1. */
        @JavascriptInterface
        public int gwPort() { return gwPort; }

        /** رمز الوصول العشوائي للبوابة (يتجدد عند كل تشغيل للتطبيق). */
        @JavascriptInterface
        public String gwToken() { return gwToken; }

        @JavascriptInterface
        public void setNavColor(final String hex, final boolean lightIcons) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Window w = getWindow();
                        w.setNavigationBarColor(Color.parseColor(hex));
                        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
                        c.setAppearanceLightNavigationBars(!lightIcons);
                    } catch (Exception ignored) {}
                }
            });
        }

        /** يعيد إجراء الودجت المعلّق (chat/camera/photo/mic/new) مرة واحدة فقط. */
        @JavascriptInterface
        public String getPendingAction() {
            String a = pendingAction;
            pendingAction = null;
            try { setIntent(new Intent(Intent.ACTION_MAIN)); } catch (Exception ignored) {}
            return a == null ? "" : a;
        }

        /** المحتوى المشارَك (JSON) مرة واحدة فقط. */
        @JavascriptInterface
        public String getPendingShare() {
            String a = pendingShare;
            pendingShare = null;
            return a == null ? "" : a;
        }

        @JavascriptInterface
        public void showKeyboard() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        WebView w = getBridge().getWebView();
                        w.requestFocus();
                        InputMethodManager m = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                        if (m != null) m.showSoftInput(w, InputMethodManager.SHOW_IMPLICIT);
                    } catch (Exception ignored) {}
                }
            });
        }

        /** بدء/إيقاف الخدمة الأمامية أثناء توليد الرد. */
        @JavascriptInterface
        public void startGen() {
            try {
                Intent i = new Intent(MainActivity.this, GenService.class);
                if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
            } catch (Exception ignored) {}
        }

        /** نفس startGen لكن بنص إشعار مخصص (يُستخدم أثناء تنزيل النماذج). */
        @JavascriptInterface
        public void startGenText(String text) {
            try {
                Intent i = new Intent(MainActivity.this, GenService.class);
                i.putExtra("text", text == null ? "" : text);
                if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
            } catch (Exception ignored) {}
        }

        /** معلومات الجهاز لاقتراح النماذج: الذاكرة والتخزين والمعالج (JSON). */
        @JavascriptInterface
        public String deviceInfo() {
            try {
                JSONObject o = new JSONObject();
                ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
                if (am != null) {
                    ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
                    am.getMemoryInfo(mi);
                    o.put("totalMem", mi.totalMem);
                    o.put("availMem", mi.availMem);
                    o.put("lowMem", mi.lowMemory);
                }
                StatFs st = new StatFs(getFilesDir().getAbsolutePath());
                o.put("freeBytes", st.getAvailableBytes());
                o.put("totalBytes", st.getTotalBytes());
                o.put("cores", Runtime.getRuntime().availableProcessors());
                o.put("sdk", Build.VERSION.SDK_INT);
                o.put("release", Build.VERSION.RELEASE);
                o.put("brand", Build.BRAND);
                o.put("model", Build.MODEL);
                o.put("soc", Build.VERSION.SDK_INT >= 31 ? Build.SOC_MODEL : "");
                o.put("abi", Build.SUPPORTED_ABIS != null && Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "");
                return o.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        /** المحرك الأصلي للنماذج على الجهاز (llama.cpp): حالة المكتبة (JSON). */
        @JavascriptInterface
        public String odInfo() { return QuarkOd.info(MainActivity.this); }

        /** تنزيل النماذج في الخلفية (خدمة أمامية بإشعار): إضافة/إيقاف/استئناف/إلغاء/حالة. */
        @JavascriptInterface
        public String dlEnqueue(String spec) { return ModelDlService.enqueue(MainActivity.this, spec); }
        @JavascriptInterface
        public void dlPause(String id) { ModelDlService.pause(MainActivity.this, id); }
        @JavascriptInterface
        public void dlResume(String id, boolean force) { ModelDlService.resume(MainActivity.this, id, force); }
        @JavascriptInterface
        public void dlCancel(String id) { ModelDlService.cancel(MainActivity.this, id); }
        @JavascriptInterface
        public String dlState() { return ModelDlService.snapshot(MainActivity.this); }

        /** تحميل نموذج وتوليد الردود بالبث (الأحداث تصل إلى window.__odn.ev). */
        @JavascriptInterface
        public void llamaLoad(String reqId, String json) { QuarkOd.load(MainActivity.this, reqId, json); }
        @JavascriptInterface
        public void llamaChat(String reqId, String json, String imagesJson) { QuarkOd.chat(reqId, json, imagesJson); }
        @JavascriptInterface
        public void llamaAbort() { QuarkOd.abort(); }
        @JavascriptInterface
        public void llamaFree() { QuarkOd.free(); }

        @JavascriptInterface
        public void stopGen() {
            try { stopService(new Intent(MainActivity.this, GenService.class)); } catch (Exception ignored) {}
        }

        /** تشغيل/إيقاف خدمة «المهام في الخلفية» (تُبقي مجدول بايثون حيًّا بعد إغلاق التطبيق). */
        @JavascriptInterface
        public boolean setTaskService(boolean on) {
            try {
                getSharedPreferences(TaskService.PREFS, MODE_PRIVATE).edit().putBoolean("on", on).apply();
                Intent i = new Intent(MainActivity.this, TaskService.class);
                if (on) {
                    if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
                } else {
                    stopService(i);
                }
                return true;
            } catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public boolean isTaskServiceOn() {
            return getSharedPreferences(TaskService.PREFS, MODE_PRIVATE).getBoolean("on", false);
        }

        /** هل التطبيق مستثنى من توفير البطارية؟ (بدون الاستثناء قد يوقف النظام الخدمة في الخلفية) */
        @JavascriptInterface
        public boolean isIgnoringBattery() {
            try {
                android.os.PowerManager pm = (android.os.PowerManager) getSystemService(Context.POWER_SERVICE);
                return pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
            } catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public void requestIgnoreBattery() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
                    } catch (Exception e) {
                        try { startActivity(new Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); } catch (Exception ignored) {}
                    }
                }
            });
        }

        /** إذن الإشعارات (أندرويد 13+). */
        @JavascriptInterface
        public void requestNotifPermission() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                            ActivityCompat.requestPermissions(MainActivity.this, new String[]{ Manifest.permission.POST_NOTIFICATIONS }, 77);
                    } catch (Exception ignored) {}
                }
            });
        }

        /** إشعار اكتمال الرد (رد/نسخ/مشاركة) — يُعرض فقط إذا كان التطبيق ليس على الشاشة.
         *  ctx = سياق المحادثة (JSON) لكي يعمل «الرد السريع» من الإشعار بدون فتح التطبيق. */
        @JavascriptInterface
        public void notifyDone(String title, String body, String full, String ctx) {
            try {
                if (ctx != null && ctx.length() > 2)
                    getSharedPreferences("quark_reply", MODE_PRIVATE).edit().putString("ctx", ctx).apply();
                if (visible) return;
                NotifReceiver.postDone(MainActivity.this, title, body, full);
            } catch (Exception ignored) {}
        }

        /** ردود أُرسلت من الإشعار أثناء غياب التطبيق (JSON array) — تُضاف للمحادثات ثم تُمسح. */
        @JavascriptInterface
        public String takePendingReplies() {
            android.content.SharedPreferences sp = getSharedPreferences("quark_reply", MODE_PRIVATE);
            String r = sp.getString("pending", "[]");
            sp.edit().putString("pending", "[]").apply();
            return r;
        }

        /** إعدادات الإيماءات والأزرار: إجراء المساعد الافتراضي وإجراء ضغطتي زر رفع الصوت ('' = معطّل). */
        @JavascriptInterface
        public void setKeyConfig(String assistAction, String volAction) {
            getSharedPreferences("quark_keys", MODE_PRIVATE).edit()
                .putString("assist_action", assistAction == null || assistAction.length() == 0 ? "chat" : assistAction)
                .putString("vol_action", volAction == null ? "" : volAction).apply();
        }

        @JavascriptInterface
        public void openAssistSettings() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    String[] acts = { android.provider.Settings.ACTION_VOICE_INPUT_SETTINGS, android.provider.Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS, android.provider.Settings.ACTION_SETTINGS };
                    for (String a : acts) {
                        try { startActivity(new Intent(a)); return; } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public void openAccessibilitySettings() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try { startActivity(new Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS)); } catch (Exception ignored) {}
                }
            });
        }

        /** هل خدمة اختصار زر الصوت مفعّلة في إمكانية الوصول؟ */
        @JavascriptInterface
        public boolean isKeyServiceOn() {
            try {
                String s = android.provider.Settings.Secure.getString(getContentResolver(), android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
                return s != null && s.contains(getPackageName() + "/");
            } catch (Exception e) { return false; }
        }

        /** أرقام ودجت الإحصائيات. */
        @JavascriptInterface
        public void setWidgetStats(int chats, int msgs, int rep, int tok) {
            try { QuarkStatsWidget.setStats(getApplicationContext(), chats, msgs, rep, tok); } catch (Exception ignored) {}
        }

        /** ألوان الودجت من ثيم التطبيق (#RRGGBB). */
        @JavascriptInterface
        public void setWidgetTheme(String bg, String pill, String btn, String fg, String hint) {
            try { QuarkWidget.applyTheme(getApplicationContext(), bg, pill, btn, fg, hint); } catch (Exception ignored) {}
        }

        /** يطلب إضافة زر QUARK AI إلى الإعدادات السريعة (أندرويد 13+). false = يضيفه المستخدم يدويًا. */
        @JavascriptInterface
        public boolean addTile() {
            try {
                if (Build.VERSION.SDK_INT < 33) return false;
                android.app.StatusBarManager sb = getSystemService(android.app.StatusBarManager.class);
                if (sb == null) return false;
                sb.requestAddTileService(new ComponentName(MainActivity.this, QuarkTileService.class), "QUARK AI",
                    android.graphics.drawable.Icon.createWithResource(MainActivity.this, R.drawable.ic_stat_quark),
                    getMainExecutor(), new java.util.function.Consumer<Integer>() {
                        @Override
                        public void accept(Integer r) {}
                    });
                return true;
            } catch (Exception e) { return false; }
        }

        /** يطلب من النظام تثبيت الودجت على الشاشة الرئيسية (أندرويد 8+). */
        @JavascriptInterface
        public boolean pinWidget() {
            try {
                if (Build.VERSION.SDK_INT < 26) return false;
                AppWidgetManager m = getSystemService(AppWidgetManager.class);
                if (m == null || !m.isRequestPinAppWidgetSupported()) return false;
                return m.requestPinAppWidget(new ComponentName(MainActivity.this, QuarkWidget.class), null, null);
            } catch (Exception e) { return false; }
        }
    }
}
''' % app_id, encoding='utf-8')

# 1b) الودجت: الكلاس + الموارد
wsrc = pathlib.Path(__file__).resolve().parent.parent / 'android-widget'
for jf in wsrc.glob('*.java'):
    (java_dir / jf.name).write_text(jf.read_text(encoding='utf-8').replace('__APP_ID__', app_id), encoding='utf-8')
# جافا المحرك الأصلي والمنزّل (حزمة ثابتة ai.quark.engine فلا تعتمد أسماء JNI على معرّف التطبيق)
nsrc = pathlib.Path(__file__).resolve().parent.parent / 'android-native'
eng_dir = main / 'java' / 'ai' / 'quark' / 'engine'
eng_dir.mkdir(parents=True, exist_ok=True)
for jf in (nsrc / 'java' / 'ai' / 'quark' / 'engine').glob('*.java'):
    (eng_dir / jf.name).write_text(jf.read_text(encoding='utf-8'), encoding='utf-8')
for f in (wsrc / 'res').rglob('*'):
    if f.is_file():
        dst = main / 'res' / f.relative_to(wsrc / 'res')
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(f.read_text(encoding='utf-8').replace('__APP_ID__', app_id), encoding='utf-8')

# 1c) البوابة: نسخ حزمة بايثون إلى مصدر Chaquopy (app/src/main/python/server)
import shutil
py_src = pathlib.Path(__file__).resolve().parent.parent / 'server'
py_dst = main / 'python' / 'server'
if py_dst.exists():
    shutil.rmtree(py_dst)
shutil.copytree(py_src, py_dst, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))

# 2) الأنماط: ألوان الأشرطة الافتراضية + خلفية شاشة البداية
styles = main / 'res/values/styles.xml'
if styles.exists():
    s = styles.read_text(encoding='utf-8')
    if 'navigationBarColor' not in s:
        s = re.sub(r'(<style name="AppTheme\.NoActionBar"[^>]*>)',
                   r'\1\n        <item name="android:navigationBarColor">#161616</item>\n        <item name="android:statusBarColor">#161616</item>', s, count=1)
    if 'windowSplashScreenBackground' not in s:
        s = re.sub(r'(<style name="AppTheme\.NoActionBarLaunch"[^>]*parent="Theme\.SplashScreen"[^>]*>)',
                   r'\1\n        <item name="windowSplashScreenBackground">#000000</item>', s, count=1)
    styles.write_text(s, encoding='utf-8')

# 3) الصلاحيات (الكاميرا والميكروفون والاهتزاز)
manifest = main / 'AndroidManifest.xml'
m = manifest.read_text(encoding='utf-8')
extra = ''
for p in ('CAMERA', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS', 'VIBRATE', 'POST_NOTIFICATIONS', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_DATA_SYNC', 'FOREGROUND_SERVICE_SPECIAL_USE', 'RECEIVE_BOOT_COMPLETED', 'WAKE_LOCK', 'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', 'ACCESS_NETWORK_STATE'):
    if 'android.permission.%s' % p not in m:
        extra += '    <uses-permission android:name="android.permission.%s" />\n' % p
if 'android.hardware.camera' not in m:
    extra += '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n'
    extra += '    <uses-feature android:name="android.hardware.microphone" android:required="false" />\n'
if extra:
    m = m.replace('</manifest>', extra + '</manifest>')
# البوابة المحلية تعمل على http://127.0.0.1 فنسمح بالاتصال غير المشفّر (محليًا فقط)
if 'usesCleartextTraffic' not in m:
    m = m.replace('<application', '<application android:usesCleartextTraffic="true"', 1)
if 'android.intent.action.SEND' not in m:
    inner = '''
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/*" />
                <data android:mimeType="image/*" />
                <data android:mimeType="application/json" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND_MULTIPLE" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/*" />
                <data android:mimeType="image/*" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.ASSIST" />
                <category android:name="android.intent.category.DEFAULT" />
            </intent-filter>
            <intent-filter android:label="@string/pt_label">
                <action android:name="android.intent.action.PROCESS_TEXT" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>
            <meta-data android:name="android.app.shortcuts" android:resource="@xml/quark_shortcuts" />
        '''
    k = m.find('.MainActivity')
    a0 = m.rfind('<activity', 0, k)
    a1 = m.find('>', k)
    if a0 >= 0 and a1 > 0:
        if m[a1 - 1] == '/':
            m = m[:a1 - 1] + '>' + inner + '</activity>' + m[a1 + 1:]
        else:
            e = m.find('</activity>', a1)
            m = m[:e] + inner + m[e:]
if 'GenService' not in m:
    m = m.replace('</application>', '        <service android:name=".GenService" android:exported="false" android:foregroundServiceType="dataSync" />\n    </application>', 1)
if 'ModelDlService' not in m:
    m = m.replace('</application>', '        <service android:name=".ModelDlService" android:exported="false" android:foregroundServiceType="dataSync" />\n    </application>', 1)
if 'TaskService' not in m:
    m = m.replace('</application>', '''        <service android:name=".TaskService" android:exported="false" android:foregroundServiceType="specialUse">
            <property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" android:value="scheduled_ai_tasks" />
        </service>
        <receiver android:name=".TaskBootReceiver" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
            </intent-filter>
        </receiver>
    </application>''', 1)
if 'QuarkTileService' not in m:
    m = m.replace('</application>', '''        <service android:name=".QuarkTileService" android:exported="true" android:label="@string/tile_label" android:icon="@drawable/ic_stat_quark" android:permission="android.permission.BIND_QUICK_SETTINGS_TILE">
            <intent-filter>
                <action android:name="android.service.quicksettings.action.QS_TILE" />
            </intent-filter>
        </service>
    </application>''', 1)
if 'NotifReceiver' not in m:
    extra_components = '''        <receiver android:name=".NotifReceiver" android:exported="false" />
        <service android:name=".ReplyService" android:exported="false" android:foregroundServiceType="dataSync" />
        <service android:name=".QuarkVoiceService" android:exported="true" android:label="@string/quark_widget_name" android:permission="android.permission.BIND_VOICE_INTERACTION">
            <meta-data android:name="android.voice_interaction" android:resource="@xml/quark_voice_interaction" />
            <intent-filter>
                <action android:name="android.service.voice.VoiceInteractionService" />
            </intent-filter>
        </service>
        <service android:name=".QuarkSessionService" android:exported="true" android:permission="android.permission.BIND_VOICE_INTERACTION" />
        <service android:name=".QuarkKeyService" android:exported="true" android:label="@string/a11y_label" android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE">
            <intent-filter>
                <action android:name="android.accessibilityservice.AccessibilityService" />
            </intent-filter>
            <meta-data android:name="android.accessibilityservice" android:resource="@xml/quark_accessibility" />
        </service>
        <receiver android:name=".QuarkWidget2" android:exported="false" android:label="@string/quark_widget2_name">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/quark_widget_small_info" />
        </receiver>
        <receiver android:name=".QuarkStatsWidget" android:exported="false" android:label="@string/qws_name">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/quark_widget_stats_info" />
        </receiver>
    </application>'''
    m = m.replace('</application>', extra_components, 1)
if 'android:name=".QuarkWidget"' not in m:
    receiver = '''        <receiver android:name=".QuarkWidget" android:exported="false" android:label="@string/quark_widget_name">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/quark_widget_info" />
        </receiver>
'''
    m = m.replace('</application>', receiver + '    </application>', 1)
manifest.write_text(m, encoding='utf-8')

# 4) رقم الإصدار + التوقيع
gradle = app / 'build.gradle'
g = gradle.read_text(encoding='utf-8')
code = os.environ.get('VERSION_CODE', '1')
name = os.environ.get('VERSION_NAME', '1.0.0')
g = re.sub(r'versionCode\s+\d+', 'versionCode %s' % code, g, count=1)
g = re.sub(r'versionName\s+"[^"]*"', 'versionName "%s"' % name, g, count=1)
if os.environ.get('SIGNING') == '1' and 'signingConfigs' not in g:
    signing = '''    signingConfigs {
        release {
            storeFile file(System.getenv("KEYSTORE_PATH"))
            storePassword System.getenv("KEYSTORE_PASSWORD")
            keyAlias System.getenv("KEY_ALIAS")
            keyPassword System.getenv("KEY_PASSWORD")
        }
    }
    buildTypes {'''
    g = g.replace('    buildTypes {', signing, 1)
    g = re.sub(r'(buildTypes\s*\{\s*release\s*\{)', r'\1\n            signingConfig signingConfigs.release', g, count=1)
    # لا نريد أن يُفشل فحص lint بناء الإصدار (يبطئه أيضًا)
    if 'checkReleaseBuilds' not in g:
        g = re.sub(r'(\n\s*android\s*\{)', r'\1\n    lintOptions { checkReleaseBuilds false; abortOnError false }', g, count=1)
# Chaquopy: يشغّل بايثون داخل التطبيق لتعمل البوابة بدون خادم خارجي
if 'com.chaquo.python' not in g:
    g = re.sub(r"(apply plugin: ['\"]com\.android\.application['\"])", r"\1\napply plugin: 'com.chaquo.python'", g, count=1)
    g = re.sub(r'(defaultConfig\s*\{)', r'\1\n        ndk { abiFilters "arm64-v8a", "armeabi-v7a" }\n        python { version "3.11" }', g, count=1)
# المحرك الأصلي (llama.cpp): يُبنى فقط إن وُجد مصدر llama.cpp (scripts/fetch-llama.sh) — وإلا يعمل التطبيق بمحرك WASM
native_dir = pathlib.Path('android-native')
# يجلب llama.cpp بنفسه إن غاب (فلا يعتمد النجاح على خطوة في ملف سير العمل)
if not (native_dir / 'llama.cpp' / 'CMakeLists.txt').exists() and os.environ.get('QUARK_NATIVE', '1') != '0':
    import subprocess
    tag = os.environ.get('LLAMA_CPP_TAG', 'b11695')
    repo = os.environ.get('LLAMA_CPP_REPO', 'https://github.com/ggml-org/llama.cpp')
    try:
        subprocess.run(['git', 'clone', '--depth', '1', '--branch', tag, repo, str(native_dir / 'llama.cpp')], check=True)
        print('fetched llama.cpp', tag)
    except Exception as e:
        print('تعذّر جلب llama.cpp:', e)
if (native_dir / 'llama.cpp' / 'CMakeLists.txt').exists() and 'quark_llama' not in g and os.environ.get('QUARK_NATIVE', '1') != '0':
    abis = os.environ.get('QUARK_NATIVE_ABIS', 'arm64-v8a').split(',')
    ndk_ver = ''
    ndk_home = os.environ.get('ANDROID_NDK_HOME') or os.environ.get('ANDROID_NDK_ROOT') or ''
    try:
        for line in open(os.path.join(ndk_home, 'source.properties'), encoding='utf-8'):
            if line.startswith('Pkg.Revision'):
                ndk_ver = line.split('=')[1].strip()
    except Exception:
        pass
    abi_list = ', '.join('"' + a + '"' for a in abis)
    cmake_args = (
        '\n        externalNativeBuild {\n            cmake {\n'
        '                arguments "-DCMAKE_BUILD_TYPE=Release", "-DANDROID_STL=c++_shared", "-DANDROID_PLATFORM=android-28"\n'
        '                abiFilters ' + abi_list + '\n            }\n        }')
    g = re.sub(r'(defaultConfig\s*\{)', lambda mo: mo.group(1) + cmake_args, g, count=1)
    ext = ('\n    externalNativeBuild {\n        cmake {\n            path "../../android-native/CMakeLists.txt"\n        }\n    }\n'
           '    packagingOptions {\n        jniLibs { useLegacyPackaging true }\n    }\n')
    if ndk_ver:
        ext = '\n    ndkVersion "' + ndk_ver + '"' + ext
    g = re.sub(r'(\n\s*buildTypes\s*\{)', lambda mo: ext + mo.group(1), g, count=1)
    print('native engine enabled: abis', abis, 'ndk', ndk_ver or '(default)')
else:
    print('native engine skipped (android-native/llama.cpp missing or QUARK_NATIVE=0)')
gradle.write_text(g, encoding='utf-8')

root_gradle = pathlib.Path('android/build.gradle')
rg = root_gradle.read_text(encoding='utf-8')
if 'com.chaquo.python' not in rg:
    rg = re.sub(r'(buildscript\s*\{\s*repositories\s*\{)', r'\1\n        maven { url "https://chaquo.com/maven" }', rg, count=1)
    rg = re.sub(r"(dependencies\s*\{\s*classpath ['\"]com\.android\.tools\.build:gradle:[^'\"]+['\"])", r"\1\n        classpath 'com.chaquo.python:gradle:15.0.1'", rg, count=1)
    root_gradle.write_text(rg, encoding='utf-8')
    if 'com.chaquo.python:gradle' not in rg or 'chaquo.com/maven' not in rg:
        raise SystemExit('تعذّر تعديل android/build.gradle لإضافة Chaquopy')
print('patched android project:', app_id, 'versionCode', code, 'versionName', name, 'signing', os.environ.get('SIGNING') == '1')
