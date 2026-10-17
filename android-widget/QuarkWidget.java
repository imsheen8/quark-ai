package __APP_ID__;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.Bundle;
import android.widget.RemoteViews;

/** ودجت الشاشة الرئيسية (4×2) يتبع ثيم التطبيق: ألوانه تُرسَل من الواجهة وتُحفظ في SharedPreferences. */
public class QuarkWidget extends AppWidgetProvider {
    public static final String EXTRA = "quark_action";
    public static final String PREFS = "quark_widget";

    static PendingIntent act(Context c, String action, int code) {
        Intent i = new Intent(c, MainActivity.class);
        i.setAction("__APP_ID__.WIDGET_" + action);
        i.putExtra(EXTRA, action);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** يفتح التطبيق وينفّذ إجراء (chat/mic/camera/new...) — يستعمله المساعد وخدمة الأزرار. */
    static void launch(Context c, String action) {
        try {
            Intent i = new Intent(c, MainActivity.class);
            i.setAction("__APP_ID__.WIDGET_" + action);
            i.putExtra(EXTRA, action);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            c.startActivity(i);
        } catch (Exception ignored) {}
    }

    static int color(SharedPreferences p, String k, String def) {
        try { return Color.parseColor(p.getString(k, def)); } catch (Exception e) { return Color.parseColor(def); }
    }

    static Bitmap round(int w, int h, float r, int color) {
        w = Math.max(8, w); h = Math.max(8, h);
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(color);
        new Canvas(b).drawRoundRect(new RectF(0, 0, w, h), r, r, p);
        return b;
    }

    static void update(Context ctx, AppWidgetManager mgr, int id) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        int bg = color(p, "bg", "#1C1C1C"), pill = color(p, "pill", "#2A2A2A"), btn = color(p, "btn", "#2A2A2A");
        int fg = color(p, "fg", "#ECECEC"), hint = color(p, "hint", "#8B8B8B");

        float d = ctx.getResources().getDisplayMetrics().density;
        Bundle o = mgr.getAppWidgetOptions(id);
        int wDp = o != null ? o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250) : 250;
        int hDp = o != null ? o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110) : 110;
        if (wDp < 100) wDp = 250;
        if (hDp < 60) hDp = 110;
        int pad = Math.round(10 * d), gap = Math.round(8 * d);
        int W = Math.round(wDp * d), H = Math.round(hDp * d);
        int rowH = Math.max(8, (H - 2 * pad - gap) / 2);
        int btnW = Math.max(8, (W - 2 * pad - 3 * gap) / 4);

        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_quark);
        v.setImageViewBitmap(R.id.qw_bg, round(W, H, 28 * d, bg));
        v.setImageViewBitmap(R.id.qw_pill_bg, round(W - 2 * pad, rowH, 26 * d, pill));
        Bitmap b = round(btnW, rowH, 20 * d, btn);
        v.setImageViewBitmap(R.id.qw_cam_bg, b);
        v.setImageViewBitmap(R.id.qw_photo_bg, b);
        v.setImageViewBitmap(R.id.qw_mic_bg, b);
        v.setImageViewBitmap(R.id.qw_new_bg, b);
        v.setTextColor(R.id.qw_hint, hint);
        v.setInt(R.id.qw_cam_ic, "setColorFilter", fg);
        v.setInt(R.id.qw_photo_ic, "setColorFilter", fg);
        v.setInt(R.id.qw_mic_ic, "setColorFilter", fg);
        v.setInt(R.id.qw_new_ic, "setColorFilter", fg);

        v.setOnClickPendingIntent(R.id.qw_pill, act(ctx, "chat", 1));
        v.setOnClickPendingIntent(R.id.qw_cam, act(ctx, "camera", 2));
        v.setOnClickPendingIntent(R.id.qw_photo, act(ctx, "photo", 3));
        v.setOnClickPendingIntent(R.id.qw_mic, act(ctx, "mic", 4));
        v.setOnClickPendingIntent(R.id.qw_new, act(ctx, "new", 5));
        mgr.updateAppWidget(id, v);
    }

    /** يُستدعى عند تغيّر ثيم التطبيق: يحفظ الألوان ويحدّث كل الودجتات الموجودة. */
    public static void applyTheme(Context ctx, String bg, String pill, String btn, String fg, String hint) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("bg", bg).putString("pill", pill).putString("btn", btn)
            .putString("fg", fg).putString("hint", hint).apply();
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : mgr.getAppWidgetIds(new ComponentName(ctx, QuarkWidget.class))) update(ctx, mgr, id);
        QuarkWidget2.updateAll(ctx);
        QuarkStatsWidget.updateAll(ctx);
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
