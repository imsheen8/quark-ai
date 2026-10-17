package __APP_ID__;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.widget.RemoteViews;

/** ودجت الإحصائيات 4×2: محادثات · رسائل · ردود اليوم · توكن اليوم. الأرقام تدفعها الصفحة، والألوان من ثيم التطبيق. */
public class QuarkStatsWidget extends AppWidgetProvider {

    private static String fmt(long n) {
        if (n >= 1000000) return String.format(java.util.Locale.US, "%.1fM", n / 1000000.0);
        if (n >= 10000) return (n / 1000) + "K";
        if (n >= 1000) return String.format(java.util.Locale.US, "%.1fK", n / 1000.0);
        return String.valueOf(n);
    }

    static void update(Context ctx, AppWidgetManager mgr, int id) {
        SharedPreferences p = ctx.getSharedPreferences(QuarkWidget.PREFS, Context.MODE_PRIVATE);
        int bg = QuarkWidget.color(p, "bg", "#1C1C1C"), pill = QuarkWidget.color(p, "pill", "#2A2A2A"), btn = QuarkWidget.color(p, "btn", "#2A2A2A");
        int fg = QuarkWidget.color(p, "fg", "#ECECEC"), hint = QuarkWidget.color(p, "hint", "#8B8B8B");

        float d = ctx.getResources().getDisplayMetrics().density;
        Bundle o = mgr.getAppWidgetOptions(id);
        int wDp = o != null ? o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250) : 250;
        int hDp = o != null ? o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110) : 110;
        if (wDp < 100) wDp = 250;
        if (hDp < 60) hDp = 110;
        int pad = Math.round(10 * d), gap = Math.round(8 * d);
        int W = Math.round(wDp * d), H = Math.round(hDp * d);
        int inner = Math.max(16, H - 2 * pad - gap);
        int topH = inner * 4 / 10, botH = inner - topH;
        int cellW = Math.max(8, (W - 2 * pad - 3 * gap) / 4);

        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_quark_stats);
        v.setImageViewBitmap(R.id.qws_bg, QuarkWidget.round(W, H, 28 * d, bg));
        v.setImageViewBitmap(R.id.qws_top_bg, QuarkWidget.round(W - 2 * pad, topH, 20 * d, pill));
        Bitmap cell = QuarkWidget.round(cellW, botH, 18 * d, btn);
        int[] bgs = { R.id.qws_c1_bg, R.id.qws_c2_bg, R.id.qws_c3_bg, R.id.qws_c4_bg };
        int[] nums = { R.id.qws_c1_n, R.id.qws_c2_n, R.id.qws_c3_n, R.id.qws_c4_n };
        int[] lbls = { R.id.qws_c1_l, R.id.qws_c2_l, R.id.qws_c3_l, R.id.qws_c4_l };
        String[] keys = { "s_chats", "s_msgs", "s_rep", "s_tok" };
        for (int i = 0; i < 4; i++) {
            v.setImageViewBitmap(bgs[i], cell);
            v.setTextViewText(nums[i], fmt(p.getLong(keys[i], 0)));
            v.setTextColor(nums[i], fg);
            v.setTextColor(lbls[i], hint);
        }
        v.setTextColor(R.id.qws_title, fg);
        v.setOnClickPendingIntent(R.id.qws_root, QuarkWidget.act(ctx, "stats", 7));
        mgr.updateAppWidget(id, v);
    }

    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : mgr.getAppWidgetIds(new ComponentName(ctx, QuarkStatsWidget.class))) update(ctx, mgr, id);
    }

    /** أرقام الإحصائيات القادمة من الصفحة. */
    public static void setStats(Context ctx, long chats, long msgs, long rep, long tok) {
        ctx.getSharedPreferences(QuarkWidget.PREFS, Context.MODE_PRIVATE).edit()
            .putLong("s_chats", chats).putLong("s_msgs", msgs).putLong("s_rep", rep).putLong("s_tok", tok).apply();
        updateAll(ctx);
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
