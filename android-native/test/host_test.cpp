// اختبار النواة على الجهاز المضيف: host_test model.gguf [mmproj]
#include "../src/quark_llama.h"
#include <cstdio>
#include <cstdlib>
#include <string>
int main(int argc, char ** argv) {
    if (argc < 2) return 2;
    ql::init("");
    std::string lj = std::string("{\"model\":\"") + argv[1] + "\",\"n_ctx\":256,\"n_threads\":2,\"n_batch\":64}";
    std::string r = ql::load(lj);
    printf("LOAD %s\n", r.c_str());
    if (r.find("\"ok\":true") == std::string::npos) return 1;
    auto run = [&](const char * body, int abort_after, std::vector<std::string> imgs = {}) {
        std::string text; int n = 0, prog = 0;
        std::string res = ql::chat(body, imgs, [&](const std::string & s) { text += s; n++; if (abort_after && n >= abort_after) return false; return true; },
                                   [&](int d, int t) { prog = d * 100 / (t ? t : 1); });
        printf("CHAT %s | pieces=%d prog=%d%% text.len=%zu\n", res.c_str(), n, prog, text.size());
        return res;
    };
    std::string a = run("{\"messages\":[{\"role\":\"user\",\"content\":\"hello there\"}],\"n_predict\":20,\"seed\":1}", 0);
    std::string b = run("{\"messages\":[{\"role\":\"user\",\"content\":\"hello there\"},{\"role\":\"assistant\",\"content\":\"hi\"},{\"role\":\"user\",\"content\":\"and you?\"}],\"n_predict\":10,\"seed\":1}", 0);
    std::string c = run("{\"messages\":[{\"role\":\"user\",\"content\":\"hello there\"}],\"n_predict\":50,\"seed\":1}", 3);
    std::string big(4000, 'x');
    std::string d = run((std::string("{\"messages\":[{\"role\":\"user\",\"content\":\"") + big + "\"}],\"n_predict\":8}").c_str(), 0);
    std::string e = run("{\"messages\":[{\"role\":\"user\",\"content\":\"a\",\"nimg\":1}],\"n_predict\":8}", 0, {"notanimage"});
    ql::unload();
    // طلب GPU دون وحدة Vulkan: يجب أن يعمل على المعالج مع ملاحظة السبب
    std::string lg = std::string("{\"model\":\"") + argv[1] + "\",\"n_ctx\":256,\"n_threads\":2,\"gpu\":true,\"gpu_lib\":\"/nonexistent/libqvk.so\"}";
    std::string rg = ql::load(lg);
    printf("LOAD-GPU %s\n", rg.c_str());
    std::string f = run("{\"messages\":[{\"role\":\"user\",\"content\":\"hello\"}],\"n_predict\":6,\"seed\":1}", 0);
    ql::unload();
    bool gpu_ok = rg.find("\"ok\":true") != std::string::npos && rg.find("\"gpu\":false") != std::string::npos
                  && rg.find("\"gpu_note\":\"no_lib\"") != std::string::npos && f.find("\"ok\":true") != std::string::npos;
    // اختياري: QUARK_TEST_GPU_LIB=/path/libggml-vulkan.so يجرّب وحدة Vulkan حقيقية (إن وُجد جهاز Vulkan على المضيف)
    if (const char * gl = getenv("QUARK_TEST_GPU_LIB")) {
        std::string lv = std::string("{\"model\":\"") + argv[1] + "\",\"n_ctx\":256,\"n_threads\":2,\"gpu\":true,\"gpu_lib\":\"" + gl + "\"}";
        std::string rv = ql::load(lv);
        printf("LOAD-VK %s\n", rv.c_str());
        if (rv.find("\"ok\":true") != std::string::npos) run("{\"messages\":[{\"role\":\"user\",\"content\":\"hello\"}],\"n_predict\":6,\"seed\":1}", 0);
        ql::unload();
    }
    printf("DONE\n");
    bool ok = a.find("\"ok\":true") != std::string::npos && b.find("\"n_cached\":") != std::string::npos && c.find("abort") != std::string::npos
              && d.find("\"code\":\"ctx\"") != std::string::npos && e.find("\"code\":\"image\"") != std::string::npos && gpu_ok;
    return ok ? 0 : 3;
}
