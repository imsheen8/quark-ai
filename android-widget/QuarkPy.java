package __APP_ID__;

import android.content.Context;
import java.io.File;

/** تشغيل بوابة بايثون مرة واحدة لكل عملية — تستخدمها الواجهة (MainActivity) وخدمة المهام (TaskService) معًا. */
final class QuarkPy {
    static volatile int port = 0;
    static volatile String token = "";

    private QuarkPy() {}

    static synchronized void start(Context c) throws Exception {
        if (port > 0) return;
        Context app = c.getApplicationContext();
        if (!com.chaquo.python.Python.isStarted())
            com.chaquo.python.Python.start(new com.chaquo.python.android.AndroidPlatform(app));
        com.chaquo.python.PyObject m = com.chaquo.python.Python.getInstance().getModule("server.android_entry");
        token = m.callAttr("token").toString();
        port = m.callAttr("start", new File(app.getFilesDir(), "quark-data").getAbsolutePath()).toInt();
    }
}
