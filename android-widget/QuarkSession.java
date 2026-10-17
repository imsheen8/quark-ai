package __APP_ID__;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.service.voice.VoiceInteractionSession;

/** عند استدعاء المساعد: يفتح التطبيق بالإجراء المختار (محادثة/ميكروفون/كاميرا) ثم يغلق نافذة الجلسة. */
public class QuarkSession extends VoiceInteractionSession {
    QuarkSession(Context c) {
        super(c);
    }

    @Override
    public void onShow(Bundle args, int showFlags) {
        super.onShow(args, showFlags);
        SharedPreferences p = getContext().getSharedPreferences("quark_keys", Context.MODE_PRIVATE);
        String a = p.getString("assist_action", "chat");
        Intent i = new Intent(getContext(), MainActivity.class);
        i.setAction("__APP_ID__.WIDGET_" + a);
        i.putExtra(QuarkWidget.EXTRA, a);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        boolean done = false;
        try {
            VoiceInteractionSession.class.getMethod("startAssistantActivity", Intent.class).invoke(this, i);
            done = true;
        } catch (Throwable ignored) {}
        if (!done) {
            try { getContext().startActivity(i); } catch (Exception ignored) {}
        }
        hide();
    }
}
