package ai.quark.engine;

/** واجهة JNI لمكتبة libquark_llama.so (llama.cpp + الرؤية). الصنف في حزمة ثابتة فلا تتأثر أسماء JNI بمعرّف التطبيق. */
public final class QuarkLlama {
    /** يستقبل النص المُولَّد (بايتات UTF-8 كاملة) وتقدّم معالجة المحادثة. يعيد false لإيقاف التوليد. */
    public interface Sink {
        boolean piece(byte[] utf8);
        void progress(int done, int total);
    }

    private static boolean ok = false;
    private static String err = "";
    private static boolean inited = false;

    static {
        try {
            System.loadLibrary("quark_llama");
            ok = true;
        } catch (Throwable t) {
            err = String.valueOf(t.getMessage());
        }
    }

    private QuarkLlama() {}

    public static boolean available() { return ok; }
    public static String loadError() { return err; }

    private static native String nInit(String backendDir);
    private static native String nSysInfo();
    private static native String nLoad(String json);
    private static native String nChat(String json, byte[][] images, Sink sink);
    private static native void nAbort();
    private static native void nUnload();
    private static native boolean nLoaded();

    /** يهيّئ المحرك مرة واحدة؛ يعيد "" عند النجاح. */
    public static synchronized String init(String backendDir) {
        if (!ok) return "المكتبة الأصلية غير متاحة: " + err;
        if (inited) return "";
        String r = nInit(backendDir == null ? "" : backendDir);
        if (r == null || r.length() == 0) inited = true;
        return r == null ? "" : r;
    }
    public static String sysInfo() { return ok ? nSysInfo() : ""; }
    public static String load(String json) { return nLoad(json); }
    public static String chat(String json, byte[][] images, Sink sink) { return nChat(json, images, sink); }
    public static void abort() { if (ok) nAbort(); }
    public static void unload() { if (ok) nUnload(); }
    public static boolean loaded() { return ok && nLoaded(); }
}
