import ai.quark.engine.QuarkLlama;
import java.nio.charset.StandardCharsets;

public class JniTest {
    public static void main(String[] a) {
        System.out.println("available=" + QuarkLlama.available() + " " + QuarkLlama.loadError());
        System.out.println("init='" + QuarkLlama.init("") + "'");
        String r = QuarkLlama.load("{\"model\":\"" + a[0] + "\",\"n_ctx\":256,\"n_threads\":2}");
        System.out.println("load " + r.substring(0, Math.min(90, r.length())));
        final StringBuilder sb = new StringBuilder(); final int[] pp = {0};
        String res = QuarkLlama.chat("{\"messages\":[{\"role\":\"user\",\"content\":\"مرحبا 😀 hello\"}],\"n_predict\":12,\"seed\":2}", null, new QuarkLlama.Sink() {
            public boolean piece(byte[] b) { sb.append(new String(b, StandardCharsets.UTF_8)); return true; }
            public void progress(int d, int t) { pp[0] = t; }
        });
        System.out.println("chat " + res);
        System.out.println("text.len=" + sb.length() + " prompt=" + pp[0] + " loaded=" + QuarkLlama.loaded());
        QuarkLlama.unload();
        System.out.println("after unload loaded=" + QuarkLlama.loaded());
        boolean ok = res.contains("\"ok\":true") && sb.length() > 0 && pp[0] > 0 && !QuarkLlama.loaded();
        System.out.println(ok ? "JNI PASS" : "JNI FAIL");
        System.exit(ok ? 0 : 1);
    }
}
