package __APP_ID__;

import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;
import androidx.annotation.RequiresApi;

/** زر «QUARK AI» في لوحة الإعدادات السريعة (الشريط العلوي): ضغطة واحدة تفتح محادثة جديدة مع لوحة المفاتيح. */
@RequiresApi(api = 24)
public class QuarkTileService extends TileService {

    private void launch() {
        Intent i = new Intent(this, MainActivity.class);
        i.setAction("__APP_ID__.WIDGET_chat");
        i.putExtra(QuarkWidget.EXTRA, "chat");
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 6, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        } else {
            startActivityAndCollapse(i);
        }
    }

    @Override
    public void onStartListening() {
        super.onStartListening();
        Tile t = getQsTile();
        if (t == null) return;
        t.setState(Tile.STATE_INACTIVE);
        t.setLabel(getString(R.string.tile_label));
        t.setIcon(Icon.createWithResource(this, R.drawable.ic_stat_quark));
        t.updateTile();
    }

    @Override
    public void onClick() {
        super.onClick();
        if (isLocked()) {
            unlockAndRun(new Runnable() {
                @Override
                public void run() { launch(); }
            });
        } else {
            launch();
        }
    }
}
