import ai.quark.engine.FileDownloader;
import java.io.File;
import java.util.*;

public class DlTest {
    static int fails = 0;
    static void check(String n, boolean ok) { System.out.println((ok ? "PASS " : "FAIL ") + n); if (!ok) fails++; }
    public static void main(String[] a) throws Exception {
        String base = a[0]; File dir = new File(a[1]); dir.mkdirs();
        // 1) تنزيل كامل
        File f1 = new File(dir, "a.gguf");
        FileDownloader d1 = new FileDownloader(base + "/o/Tiny-GGUF/resolve/main/Tiny-Q3_K_M.gguf", new HashMap<>(), f1, 2_200_000);
        FileDownloader.Result r = d1.run(null);
        check("full download", r.status.equals("done") && f1.length() == 2_200_000 && !new File(dir, "a.gguf.part").exists());
        // 2) إيقاف ثم استئناف
        File f2 = new File(dir, "b.gguf");
        final FileDownloader d2 = new FileDownloader(base + "/o/slow-GGUF/resolve/main/slow-Q4_K_M.gguf", new HashMap<>(), f2, 3_000_000);
        final long[] seen = {0};
        // واجهة Listener ذات دالتين
        Thread t2 = new Thread(() -> d2.run(new FileDownloader.Listener() {
            public void onProgress(long dn, long tt, double bps) { seen[0] = dn; if (dn > 600000) d2.stop(); }
            public void onRetry(int n, String m) {}
        }));
        t2.start(); t2.join();
        File part = new File(dir, "b.gguf.part");
        check("stopped leaves .part", part.exists() && part.length() > 0 && part.length() < 3_000_000 && !f2.exists());
        long mid = part.length();
        FileDownloader d3 = new FileDownloader(base + "/o/slow-GGUF/resolve/main/slow-Q4_K_M.gguf", new HashMap<>(), f2, 3_000_000);
        r = d3.run(null);
        check("resume completes (from " + mid + ")", r.status.equals("done") && f2.length() == 3_000_000);
        // المحتوى مطابق لما يولّده الخادم: بايت i = (i*seed)%251 (seed=3 لأول صيغة Q4_K_M)
        byte[] all = java.nio.file.Files.readAllBytes(f2.toPath()); boolean same = all[0] == 'G';
        for (int i = 4; i < all.length && same; i++) if ((all[i] & 0xff) != (i * 3) % 251) { same = false; System.out.println("mismatch at " + i); }
        check("content byte-exact after resume", same);
        // 3) أخطاء
        r = new FileDownloader(base + "/o/x/resolve/main/nothing-Q1.gguf", new HashMap<>(), new File(dir, "c.gguf"), 0).run(null);
        check("404 -> notfound", r.status.equals("error") && r.code.equals("notfound"));
        r = new FileDownloader(base + "/o/Tiny-GGUF/resolve/main/Tiny-Q3_K_M.gguf", new HashMap<>(), new File(dir, "d.gguf"), 999).run(null);
        check("wrong size -> size error", r.status.equals("error") && r.code.equals("size"));
        System.exit(fails == 0 ? 0 : 1);
    }
}
