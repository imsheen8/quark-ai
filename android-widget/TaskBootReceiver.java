package __APP_ID__;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** بعد إعادة تشغيل الهاتف أو تحديث التطبيق: يُعيد تشغيل خدمة المهام إن كان المستخدم فعّلها. */
public class TaskBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        try {
            if (!ctx.getSharedPreferences(TaskService.PREFS, Context.MODE_PRIVATE).getBoolean("on", false)) return;
            Intent i = new Intent(ctx, TaskService.class);
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
        } catch (Exception ignored) {}
    }
}
