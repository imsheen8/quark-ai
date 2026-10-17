package __APP_ID__;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;

/** يستدعيها مجدول بايثون (server/gateway/tasks.py) عند انتهاء مهمة في الخلفية. */
public class TaskNotifier {
    public static final String CH = "quark_tasks_done";
    private final Context ctx;

    public TaskNotifier(Context c) { ctx = c.getApplicationContext(); }

    public void onTaskDone(String title, String body) {
        try {
            if (MainActivity.isVisible()) return;                 // التطبيق على الشاشة: الواجهة تعرض النتيجة بنفسها
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= 26)
                nm.createNotificationChannel(new NotificationChannel(CH, "نتائج المهام", NotificationManager.IMPORTANCE_DEFAULT));
            Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification n = new NotificationCompat.Builder(ctx, CH)
                .setSmallIcon(R.drawable.ic_stat_quark)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build();
            nm.notify(1000 + (int) (System.currentTimeMillis() % 100000), n);
        } catch (Throwable ignored) {}
    }
}
