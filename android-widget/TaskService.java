package __APP_ID__;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

/**
 * خدمة أمامية تُبقي عملية التطبيق (وبوابة بايثون ومجدول المهام داخلها) حيّة بعد إغلاق الواجهة،
 * فتُنفَّذ المهام المجدولة في مواعيدها. تعمل فقط إن فعّلها المستخدم (الإعدادات ← عام ← «تشغيل المهام في الخلفية»)،
 * وتُستأنف بعد إعادة تشغيل الهاتف (TaskBootReceiver).
 */
public class TaskService extends Service {
    public static final String CH = "quark_tasks_bg";
    public static final String PREFS = "quark_tasks_bg";
    public static final String ACTION_STOP = "__APP_ID__.TASKS_STOP";
    public static volatile boolean running = false;
    private PowerManager.WakeLock wl;

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("on", false).apply();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) {
            NotificationChannel c = new NotificationChannel(CH, "المهام في الخلفية", NotificationManager.IMPORTANCE_LOW);
            c.setShowBadge(false);
            nm.createNotificationChannel(c);
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent stop = new Intent(this, TaskService.class).setAction(ACTION_STOP);
        PendingIntent ps = PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(this, CH)
            .setSmallIcon(R.drawable.ic_stat_quark)
            .setContentTitle("QUARK AI")
            .setContentText("المهام المجدولة جاهزة للتنفيذ في الخلفية")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(pi)
            .addAction(0, "إيقاف", ps)
            .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(31, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(31, n);

        try {
            if (wl == null) {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "quark:tasks");
                wl.setReferenceCounted(false);
            }
            if (!wl.isHeld()) wl.acquire();
        } catch (Exception ignored) {}

        final android.content.Context ctx = getApplicationContext();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    QuarkPy.start(ctx);
                    com.chaquo.python.Python.getInstance().getModule("server.gateway.tasks").callAttr("set_notifier", new TaskNotifier(ctx));
                } catch (Throwable ignored) {}
            }
        }, "quark-tasks-start").start();
        return START_STICKY;
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
