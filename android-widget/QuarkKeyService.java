package __APP_ID__;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

/** اختصار الأزرار: ضغطتان سريعتان على زر رفع الصوت تفتحان QUARK AI (محادثة/ميكروفون/كاميرا) من أي مكان.
 *  خدمة إمكانية وصول لا تقرأ الشاشة ولا تطلب محتوى النوافذ — تستقبل أحداث الأزرار فقط. */
public class QuarkKeyService extends AccessibilityService {
    private long last = 0;
    private boolean swallowUp = false;

    @Override
    protected boolean onKeyEvent(KeyEvent e) {
        if (e.getKeyCode() != KeyEvent.KEYCODE_VOLUME_UP) return false;
        SharedPreferences p = getSharedPreferences("quark_keys", Context.MODE_PRIVATE);
        String act = p.getString("vol_action", "");
        if (act.length() == 0) return false;
        if (e.getAction() == KeyEvent.ACTION_UP) {
            if (swallowUp) { swallowUp = false; return true; }
            return false;
        }
        if (e.getAction() != KeyEvent.ACTION_DOWN || e.getRepeatCount() > 0) return false;
        long now = SystemClock.uptimeMillis();
        if (now - last < 450) {
            last = 0;
            swallowUp = true;
            QuarkWidget.launch(this, act);
            return true;
        }
        last = now;
        return false;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {}

    @Override
    public void onInterrupt() {}
}
