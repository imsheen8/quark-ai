package __APP_ID__;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONArray;
import org.json.JSONObject;

/** يرسل الرد السريع من الإشعار إلى النموذج (بدون فتح التطبيق) ثم يعرض الجواب في إشعار جديد.
 *  السياق (النقطة والنموذج والمفتاح وآخر الرسائل) تحفظه الصفحة في SharedPreferences «quark_reply». */
public class ReplyService extends Service {

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        final String text = intent == null ? null : intent.getStringExtra("text");
        NotifReceiver.channels(this);
        Notification n = new NotificationCompat.Builder(this, NotifReceiver.CH_GEN)
            .setSmallIcon(R.drawable.ic_stat_quark).setContentTitle("QUARK AI").setContentText("جارٍ الرد…")
            .setOngoing(true).setProgress(0, 0, true).build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(3, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(3, n);
        /* يوقف دوّامة «جارٍ الإرسال» في إشعار الرد القديم */
        try {
            if (NotifReceiver.canNotify(this))
                ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(2, new NotificationCompat.Builder(this, NotifReceiver.CH_DONE)
                    .setSmallIcon(R.drawable.ic_stat_quark).setContentTitle("QUARK AI").setContentText("جارٍ الرد…").setOnlyAlertOnce(true).setProgress(0, 0, true).build());
        } catch (Exception ignored) {}
        if (text == null) { stopSelf(); return START_NOT_STICKY; }
        new Thread(new Runnable() {
            @Override
            public void run() { work(text); }
        }).start();
        return START_NOT_STICKY;
    }

    private void work(String text) {
        SharedPreferences sp = getSharedPreferences("quark_reply", MODE_PRIVATE);
        String title = "QUARK AI";
        try {
            JSONObject ctx = new JSONObject(sp.getString("ctx", "{}"));
            title = ctx.optString("title", "QUARK AI");
            if (title.length() == 0) title = "QUARK AI";
            String ans = ask(ctx, text);
            /* حدّث السياق ليكمل الحوار، واحفظ التبادل ليُضاف إلى المحادثة عند فتح التطبيق */
            JSONArray hist = ctx.optJSONArray("messages");
            if (hist == null) hist = new JSONArray();
            hist.put(new JSONObject().put("role", "user").put("content", text));
            hist.put(new JSONObject().put("role", "assistant").put("content", ans.length() > 6000 ? ans.substring(0, 6000) : ans));
            JSONArray cut = new JSONArray();
            for (int i = Math.max(0, hist.length() - 24); i < hist.length(); i++) cut.put(hist.get(i));
            ctx.put("messages", cut);
            JSONArray pend = new JSONArray(sp.getString("pending", "[]"));
            pend.put(new JSONObject().put("chatId", ctx.optString("chatId", "")).put("user", text).put("assistant", ans)
                .put("model", ctx.optString("model", "")).put("ts", System.currentTimeMillis()));
            sp.edit().putString("ctx", ctx.toString()).putString("pending", pend.toString()).apply();
            String prev = ans.replaceAll("[#*`>_~|]", "").replaceAll("\\s+", " ").trim();
            if (prev.length() > 180) prev = prev.substring(0, 180);
            finish(title, prev.length() == 0 ? "اكتمل الرد" : prev, ans);
        } catch (Exception e) {
            finish(title, "تعذّر الرد: " + (e.getMessage() == null ? "خطأ" : e.getMessage()), null);
        }
    }

    private void finish(String title, String body, String full) {
        try { stopForeground(true); } catch (Exception ignored) {}
        NotifReceiver.postDone(this, title, body, full);
        stopSelf();
    }

    private String ask(JSONObject ctx, String text) throws Exception {
        if (!ctx.has("url") || !ctx.has("model")) throw new Exception("افتح التطبيق وأرسل رسالة أولًا");
        String proto = ctx.optString("proto", "openai"), base = ctx.getString("url").replaceAll("/+$", "");
        String key = ctx.optString("key", ""), model = ctx.getString("model"), system = ctx.optString("system", "");
        JSONObject P = ctx.optJSONObject("params");
        if (P == null) P = new JSONObject();
        JSONArray msgs = new JSONArray();
        boolean anth = "anthropic".equals(proto);
        if (!anth && system.length() > 0) msgs.put(new JSONObject().put("role", "system").put("content", system));
        JSONArray hist = ctx.optJSONArray("messages");
        if (hist != null) for (int i = 0; i < hist.length(); i++) msgs.put(hist.get(i));
        msgs.put(new JSONObject().put("role", "user").put("content", text));

        JSONObject body = new JSONObject().put("model", model).put("messages", msgs).put("stream", false);
        String url;
        HttpURLConnection c;
        if (anth) {
            body.put("max_tokens", P.has("max_tokens") ? P.getInt("max_tokens") : 4096);
            if (system.length() > 0) body.put("system", system);
            if (P.has("temperature")) body.put("temperature", Math.min(P.getDouble("temperature"), 1.0));
            else if (P.has("top_p")) body.put("top_p", P.getDouble("top_p"));
            url = base + "/messages";
        } else {
            if (P.has("temperature")) body.put("temperature", P.getDouble("temperature"));
            if (P.has("top_p")) body.put("top_p", P.getDouble("top_p"));
            if (P.has("max_tokens")) body.put(base.contains("api.openai.com") ? "max_completion_tokens" : "max_tokens", P.getInt("max_tokens"));
            url = base + "/chat/completions";
        }
        c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(20000);
        c.setReadTimeout(180000);
        c.setDoOutput(true);
        c.setRequestProperty("content-type", "application/json");
        if (anth) {
            c.setRequestProperty("x-api-key", key);
            c.setRequestProperty("anthropic-version", "2023-06-01");
        } else {
            if (key.length() > 0) c.setRequestProperty("authorization", "Bearer " + key);
            if (base.contains("openrouter.ai")) c.setRequestProperty("X-Title", "QUARK AI");
        }
        OutputStream os = c.getOutputStream();
        os.write(body.toString().getBytes("UTF-8"));
        os.close();
        int code = c.getResponseCode();
        InputStream is = code < 400 ? c.getInputStream() : c.getErrorStream();
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        if (is != null) {
            byte[] b = new byte[8192];
            int n;
            while ((n = is.read(b)) > 0) bo.write(b, 0, n);
            is.close();
        }
        String raw = bo.toString("UTF-8");
        if (code >= 400) {
            String msg = raw;
            try {
                JSONObject e = new JSONObject(raw);
                JSONObject er = e.optJSONObject("error");
                msg = er != null ? er.optString("message", raw) : e.optString("message", raw);
            } catch (Exception ignored) {}
            if (msg.length() > 200) msg = msg.substring(0, 200);
            throw new Exception("(" + code + ") " + msg);
        }
        JSONObject j = new JSONObject(raw);
        StringBuilder sb = new StringBuilder();
        if (anth) {
            JSONArray ct = j.optJSONArray("content");
            if (ct != null) for (int i = 0; i < ct.length(); i++) {
                JSONObject p = ct.getJSONObject(i);
                if ("text".equals(p.optString("type"))) sb.append(p.optString("text"));
            }
        } else {
            JSONArray ch = j.optJSONArray("choices");
            if (ch != null && ch.length() > 0) {
                Object cont = ch.getJSONObject(0).getJSONObject("message").opt("content");
                if (cont instanceof String) sb.append((String) cont);
                else if (cont instanceof JSONArray) {
                    JSONArray ca = (JSONArray) cont;
                    for (int i = 0; i < ca.length(); i++) sb.append(ca.getJSONObject(i).optString("text"));
                }
            }
        }
        String out = sb.toString().trim();
        if (out.length() == 0) throw new Exception("لم يصل أي رد من النموذج");
        return out;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
