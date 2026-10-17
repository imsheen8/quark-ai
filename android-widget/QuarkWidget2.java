package __APP_ID__;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.widget.RemoteViews;

/** ودجت صغير 2×2 (شبيه بودجت Gemini): زر QUARK AI العلوي + ميكروفون + كاميرا. يتبع ثيم التطبيق. */
public class QuarkWidget2 extends AppWidgetProvider {

    static void update(Context ctx, AppWidgetManager mgr, int id) {
        SharedPreferences p = ctx.getSharedPreferences(QuarkWidget.PREFS, Context.MODE_PRIVATE);
        int bg = QuarkWidget.color(p, "bg", "#1C1C1C"), pill = QuarkWidget.color(p, "pill", "#2A2A2A"), btn = QuarkWidget.color(p, "btn", "#2A2A2A");
        int fg = QuarkWidget.color(p, "fg", "#ECECEC");

        float d = ctx.getResources().getDisplayMetrics().density;
        Bundle o = mgr.getAppWidgetOptions(id);
        int wDp = o != null ? o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 110) : 110;
        int hDp = o != null ? o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110) : 110;
        if (wDp < 60) wDp = 110;
        if (hDp < 60) hDp = 110;
        int pad = Math.round(8 * d), gap = Math.round(8 * d);
        int W = Math.round(wDp * d), H = Math.round(hDp * d);
        int rowH = Math.max(8, (H - 2 * pad - gap) / 2);
        int btnW = Math.max(8, (W - 2 * pad - gap) / 2);

        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_quark_small);
        v.setImageViewBitmap(R.id.qw2_bg, QuarkWidget.round(W, H, 26 * d, bg));
        v.setImageViewBitmap(R.id.qw2_pill_bg, QuarkWidget.round(W - 2 * pad, rowH, 22 * d, pill));
        Bitmap b = QuarkWidget.round(btnW, rowH, 22 * d, btn);
        v.setImageViewBitmap(R.id.qw2_mic_bg, b);
        v.setImageViewBitmap(R.id.qw2_cam_bg, b);
        v.setTextColor(R.id.qw2_title, fg);
        v.setInt(R.id.qw2_mic_ic, "setColorFilter", fg);
        v.setInt(R.id.qw2_cam_ic, "setColorFilter", fg);
        v.setOnClickPendingIntent(R.id.qw2_pill, QuarkWidget.act(ctx, "chat", 1));
        v.setOnClickPendingIntent(R.id.qw2_cam, QuarkWidget.act(ctx, "camera", 2));
        v.setOnClickPendingIntent(R.id.qw2_mic, QuarkWidget.act(ctx, "mic", 4));
        mgr.updateAppWidget(id, v);
    }

    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : mgr.getAppWidgetIds(new ComponentName(ctx, QuarkWidget2.class))) update(ctx, mgr, id);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) update(context, mgr, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager mgr, int id, Bundle newOptions) {
        update(context, mgr, id);
    }
}
