package __APP_ID__;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.widget.Toast;
import androidx.core.app.NotificationCompat;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;

/** إشعار اكتمال الرد وأزراره: «رد» (Direct Reply) و«نسخ» و«مشاركة». */
public class NotifReceiver extends BroadcastReceiver {
    public static final String COPY = "__APP_ID__.NOTIF_COPY";
    public static final String REPLY = "__APP_ID__.NOTIF_REPLY";
    public static final String CH_DONE = "quark_done";
    public static final String CH_GEN = "quark_gen";

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        nm.createNotificationChannel(new NotificationChannel(CH_DONE, "اكتمال الرد", NotificationManager.IMPORTANCE_HIGH));
        NotificationChannel g = new NotificationChannel(CH_GEN, "جارٍ كتابة الرد", NotificationManager.IMPORTANCE_LOW);
        g.setShowBadge(false);
        nm.createNotificationChannel(g);
    }

    static boolean canNotify(Context c) {
        return Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    /** إشعار «اكتمل الرد» مع أزرار رد/نسخ/مشاركة. */
    static void postDone(Context c, String title, String body, String full) {
        try {
            channels(c);
            if (!canNotify(c)) return;
            String f = (full == null || full.length() == 0) ? body : full;
            if (f.length() > 20000) f = f.substring(0, 20000);

            Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            Intent copy = new Intent(c, NotifReceiver.class).setAction(COPY).putExtra("text", f);
            PendingIntent pc = PendingIntent.getBroadcast(c, 22, copy, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, f);
            Intent chooser = Intent.createChooser(send, "مشاركة الرد").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent ps = PendingIntent.getActivity(c, 23, chooser, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            Intent rep = new Intent(c, NotifReceiver.class).setAction(REPLY);
            int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent pr = PendingIntent.getBroadcast(c, 24, rep, fl);
            RemoteInput ri = new RemoteInput.Builder("reply").setLabel("اكتب ردك…").build();
            NotificationCompat.Action reply = new NotificationCompat.Action.Builder(R.drawable.ic_stat_quark, "رد", pr).addRemoteInput(ri).build();

            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            nm.notify(2, new NotificationCompat.Builder(c, CH_DONE)
                .setSmallIcon(R.drawable.ic_stat_quark)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pi)
                .addAction(reply)
                .addAction(R.drawable.ic_stat_quark, "نسخ", pc)
                .addAction(R.drawable.ic_stat_quark, "مشاركة", ps)
                .build());
        } catch (Exception ignored) {}
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent.getAction();
        if (COPY.equals(a)) {
            try {
                String t = intent.getStringExtra("text");
                ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null && t != null) {
                    cm.setPrimaryClip(ClipData.newPlainText("QUARK AI", t));
                    Toast.makeText(ctx, "تم نسخ الرد", Toast.LENGTH_SHORT).show();
                }
            } catch (Exception ignored) {}
        } else if (REPLY.equals(a)) {
            Bundle r = RemoteInput.getResultsFromIntent(intent);
            CharSequence t = r == null ? null : r.getCharSequence("reply");
            if (t == null || t.toString().trim().length() == 0) return;
            Intent s = new Intent(ctx, ReplyService.class).putExtra("text", t.toString().trim());
            try {
                if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(s); else ctx.startService(s);
            } catch (Exception e) {
                postDone(ctx, "QUARK AI", "تعذّر إرسال الرد من الإشعار، افتح التطبيق وأعد المحاولة.", null);
            }
        }
    }
}
