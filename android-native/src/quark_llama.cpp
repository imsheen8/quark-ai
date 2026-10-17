#include "quark_llama.h"

#include <atomic>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <algorithm>
#include <fstream>
#include <unistd.h>

#include "llama.h"
#include "common.h"
#include "chat.h"
#include "sampling.h"
#include "mtmd.h"
#include "mtmd-helper.h"
#include <nlohmann/json.hpp>

using json = nlohmann::json;

namespace ql {
namespace {

struct State {
    llama_model *         model = nullptr;
    llama_context *       ctx   = nullptr;
    mtmd_context *        mtmd  = nullptr;
    common_chat_templates_ptr tmpls;
    int                   n_ctx = 0, n_batch = 512, n_threads = 4;
    std::vector<llama_token> cache;     // رموز السياق الحالي (للمحادثات النصية فقط)
    bool                  cache_ok = false;
};
State g;
std::mutex g_mu;
std::atomic<bool> g_abort{false};
bool g_backend = false;
bool g_vk_tried = false;

// آخر أسطر خطأ من المكتبات (llama/mtmd) — تُضاف لرسالة الخطأ ليسهل التشخيص
std::mutex g_logmu; std::string g_lasterr;
void log_cb(ggml_log_level lvl, const char * text, void *) {
    if (lvl == GGML_LOG_LEVEL_ERROR || lvl == GGML_LOG_LEVEL_WARN) {
        std::lock_guard<std::mutex> lk(g_logmu);
        g_lasterr += text;
        if (g_lasterr.size() > 600) g_lasterr.erase(0, g_lasterr.size() - 600);
    }
}
std::string take_lasterr() {
    std::lock_guard<std::mutex> lk(g_logmu);
    std::string r = g_lasterr; g_lasterr.clear();
    while (!r.empty() && (r.back() == '\n' || r.back() == ' ')) r.pop_back();
    return r;
}

double now_ms() {
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

// أقصى عدد من الخيوط المفيدة: نعدّ الأنوية «الكبيرة» بحسب أعلى تردد (الأنوية الصغيرة تُبطئ الجميع)
int pick_threads() {
    long n = sysconf(_SC_NPROCESSORS_CONF);
    if (n < 1) n = 4;
    std::vector<long> f;
    for (long i = 0; i < n; i++) {
        char p[96];
        snprintf(p, sizeof p, "/sys/devices/system/cpu/cpu%ld/cpufreq/cpuinfo_max_freq", i);
        std::ifstream in(p);
        long v = 0;
        if (in >> v) f.push_back(v);
    }
    int t;
    if (f.size() == (size_t) n && n > 0) {
        long mx = *std::max_element(f.begin(), f.end());
        int big = 0;
        for (long v : f) if (v >= mx * 0.7) big++;
        t = big;
    } else {
        t = (int) n - 2;
    }
    return std::max(2, std::min(6, t));
}

// أطول بادئة صالحة UTF-8 (لا نقطع حرفًا متعدد البايتات بين رمزين)
size_t utf8_complete_prefix(const std::string & s) {
    size_t n = s.size();
    if (!n) return 0;
    for (size_t back = 1; back <= 3 && back <= n; back++) {
        unsigned char c = (unsigned char) s[n - back];
        if ((c & 0xC0) == 0x80) continue;              // بايت متابعة
        size_t need = c >= 0xF0 ? 4 : c >= 0xE0 ? 3 : c >= 0xC0 ? 2 : 1;
        return need > back ? n - back : n;
    }
    return n;
}

void free_all() {
    if (g.mtmd) { mtmd_free(g.mtmd); g.mtmd = nullptr; }
    g.tmpls.reset();
    if (g.ctx) { llama_free(g.ctx); g.ctx = nullptr; }
    if (g.model) { llama_model_free(g.model); g.model = nullptr; }
    g.cache.clear(); g.cache_ok = false; g.n_ctx = 0;
}

json err(const char * code, const std::string & msg) { return json{{"ok", false}, {"code", code}, {"error", msg}}; }

bool abort_cb(void *) { return g_abort.load(); }

} // namespace

std::string init(const std::string & dir) {
    std::lock_guard<std::mutex> lk(g_mu);
    if (g_backend) return "";
    try {
        if (!dir.empty()) ggml_backend_load_all_from_path(dir.c_str());
        llama_backend_init();
        g_backend = true;
    } catch (const std::exception & e) { return e.what(); }
    return "";
}

std::string sys_info() { return llama_print_system_info(); }
bool loaded() { return g.model != nullptr && g.ctx != nullptr; }
void abort() { g_abort = true; }

void unload() {
    g_abort = true;
    std::lock_guard<std::mutex> lk(g_mu);
    free_all();
}

std::string load(const std::string & load_json) {
    g_abort = true;                       // أي توليد جارٍ يتوقف أولًا
    std::lock_guard<std::mutex> lk(g_mu);
    g_abort = false;
    json o;
    try { o = json::parse(load_json); } catch (...) { return err("load", "bad json").dump(); }
    free_all();
    std::string path = o.value("model", ""), mm = o.value("mmproj", "");
    int n_ctx = o.value("n_ctx", 2048), n_thr = o.value("n_threads", 0), n_batch = o.value("n_batch", 512);
    bool mmap = o.value("mmap", true);
    if (!g_backend) { llama_backend_init(); g_backend = true; }
    llama_log_set(log_cb, nullptr); mtmd_log_set(log_cb, nullptr);
    double t0 = now_ms();

    // ---- GPU (Vulkan) اختياري: الوحدة تُحمَّل عند الطلب فقط، وأي فشل يرجع للمعالج تلقائيًا ----
    std::string gpu_lib = o.value("gpu_lib", ""), gpu_name, gpu_note;
    ggml_backend_dev_t gdev = nullptr;
    if (o.value("gpu", false)) {
        if (!g_vk_tried) {
            g_vk_tried = true;
            if (!gpu_lib.empty() && access(gpu_lib.c_str(), R_OK) == 0) ggml_backend_load(gpu_lib.c_str());
            else gpu_note = "no_lib";
        }
        for (size_t i = 0; i < ggml_backend_dev_count(); i++) {
            auto d = ggml_backend_dev_get(i);
            auto t = ggml_backend_dev_type(d);
            if (t == GGML_BACKEND_DEVICE_TYPE_GPU || t == GGML_BACKEND_DEVICE_TYPE_IGPU) { gdev = d; break; }
        }
        if (gdev) gpu_name = ggml_backend_dev_description(gdev);
        else if (gpu_note.empty()) gpu_note = "no_device";
    }
    bool use_gpu = gdev != nullptr;
    ggml_backend_dev_t gpu_list[2] = { gdev, nullptr };
    ggml_backend_dev_t cpu_list[1] = { nullptr };      // قائمة فارغة: لا أجهزة تسريع (فلا يُحمَّل شيء على GPU عن طريق الخطأ)

    int n_train = 0;
    llama_context_params cp = llama_context_default_params();
    for (int pass = 0; pass < 2; pass++) {
        llama_model_params mp = llama_model_default_params();
        mp.load_mode = mmap ? LLAMA_LOAD_MODE_MMAP : LLAMA_LOAD_MODE_NONE;
        mp.devices = use_gpu ? gpu_list : cpu_list;
        mp.n_gpu_layers = use_gpu ? 999 : 0;
        g.model = llama_model_load_from_file(path.c_str(), mp);
        if (!g.model) {
            if (use_gpu) { use_gpu = false; gpu_note = "gpu_load_failed"; continue; }
            return err("load", "تعذّر قراءة النموذج (ملف غير صالح أو بنية غير مدعومة): " + path).dump();
        }
        n_train = llama_model_n_ctx_train(g.model);
        if (n_train > 0 && n_ctx > n_train) n_ctx = n_train;
        g.n_threads = n_thr > 0 ? n_thr : pick_threads();
        g.n_batch = std::max(32, std::min(2048, n_batch));
        g.n_ctx = n_ctx;

        cp = llama_context_default_params();
        cp.n_ctx = n_ctx; cp.n_batch = g.n_batch; cp.n_ubatch = std::min(g.n_batch, 512);
        cp.n_threads = g.n_threads; cp.n_threads_batch = g.n_threads;
        cp.no_perf = true;
        cp.op_offload = use_gpu;
        g.ctx = llama_init_from_model(g.model, cp);
        if (!g.ctx) {
            if (use_gpu) { llama_model_free(g.model); g.model = nullptr; use_gpu = false; gpu_note = "gpu_ctx_failed"; continue; }
            free_all(); return err("load", "الذاكرة لا تكفي لإنشاء سياق بحجم " + std::to_string(n_ctx)).dump();
        }
        if (use_gpu) {
            // إحماء: دفعة صغيرة ثم رمز واحد على GPU للتأكد أن المشغّل (driver) يعمل فعلًا قبل الاعتماد عليه
            const llama_vocab * v = llama_model_get_vocab(g.model);
            llama_token b = llama_vocab_bos(v); if (b < 0) b = 0;
            std::vector<llama_token> toks(32, b);
            bool ok = llama_decode(g.ctx, llama_batch_get_one(toks.data(), (int32_t) toks.size())) == 0;
            if (ok) { llama_token t1 = b; ok = llama_decode(g.ctx, llama_batch_get_one(&t1, 1)) == 0; }
            llama_memory_clear(llama_get_memory(g.ctx), true);
            if (!ok) {
                llama_free(g.ctx); g.ctx = nullptr; llama_model_free(g.model); g.model = nullptr;
                use_gpu = false; gpu_note = "gpu_warmup_failed"; continue;
            }
        }
        break;
    }
    if (!use_gpu) gpu_name.clear();
    llama_set_abort_callback(g.ctx, abort_cb, nullptr);

    g.tmpls = common_chat_templates_init(g.model, "");

    bool vision = false;
    if (!mm.empty()) {
        mtmd_context_params mpar = mtmd_context_params_default();
        mpar.use_gpu = false; mpar.n_threads = g.n_threads; mpar.print_timings = false; mpar.warmup = false;
        // (لا نضبط image_max_tokens: النماذج ذات الحجم الثابت مثل Gemma 3 لا تحتاجه)
        g.mtmd = mtmd_init_from_file(mm.c_str(), g.model, mpar);
        if (!g.mtmd) { free_all(); return err("load", "تعذّر تحميل ملف الرؤية (mmproj): " + mm).dump(); }
        vision = mtmd_support_vision(g.mtmd);
    }
    char desc[256] = {0};
    llama_model_desc(g.model, desc, sizeof desc);
    return json{{"ok", true}, {"vision", vision}, {"n_ctx", n_ctx}, {"n_ctx_train", n_train}, {"n_threads", g.n_threads},
                {"params", (double) llama_model_n_params(g.model)}, {"size", (double) llama_model_size(g.model)},
                {"desc", desc}, {"has_template", g.tmpls != nullptr}, {"load_ms", now_ms() - t0},
                {"gpu", use_gpu}, {"gpu_name", gpu_name}, {"gpu_note", gpu_note}}.dump();
}

std::string chat(const std::string & chat_json, const std::vector<std::string> & images, const PieceCb & on_piece, const ProgressCb & on_prog) {
    std::lock_guard<std::mutex> lk(g_mu);
    g_abort = false;
    if (!loaded()) return err("load", "النموذج غير محمّل").dump();
    json o;
    try { o = json::parse(chat_json); } catch (...) { return err("decode", "bad json").dump(); }

    // ---- بناء الرسائل ----
    const std::string marker = g.mtmd ? mtmd_default_marker() : "";
    common_chat_templates_inputs in;
    size_t img_used = 0;
    std::string last_img_text;            // نص آخر رسالة فيها صور (لإعادة وضع العلامة إن أسقطها القالب)
    for (auto & m : o["messages"]) {
        common_chat_msg cm;
        cm.role = m.value("role", "user");
        cm.content = m.value("content", "");
        int nimg = m.value("nimg", 0);
        if (nimg > 0 && g.mtmd) {
            std::string pre;
            last_img_text = cm.content;
            for (int i = 0; i < nimg; i++) pre += marker + "\n";
            cm.content = pre + cm.content;
            img_used += nimg;
        }
        in.messages.push_back(cm);
    }
    if (img_used != images.size()) return err("image", "عدد الصور لا يطابق الرسائل").dump();
    if (!images.empty() && !g.mtmd) return err("image", "هذا النموذج لا يدعم الصور (لم يُنزَّل معه ملف الرؤية).").dump();
    in.add_generation_prompt = true;
    in.enable_thinking = o.value("think", false);

    std::string prompt;
    try {
        prompt = common_chat_templates_apply(g.tmpls.get(), in).prompt.str();
    } catch (const std::exception & e) {
        try { in.use_jinja = false; prompt = common_chat_templates_apply(g.tmpls.get(), in).prompt.str(); }
        catch (const std::exception & e2) { return err("template", std::string("قالب المحادثة: ") + e2.what()).dump(); }
    }

    // بعض القوالب تُسقط علامة الصورة من نص الرسالة؛ نعيدها يدويًا حتى يتطابق عددها مع الصور
    if (g.mtmd && img_used > 0) {
        size_t have = 0;
        for (size_t pos = prompt.find(marker); pos != std::string::npos; pos = prompt.find(marker, pos + marker.size())) have++;
        if (have < img_used) {
            std::string ins;
            for (size_t i = have; i < img_used; i++) ins += marker + "\n";
            size_t at = std::string::npos;
            while (!last_img_text.empty() && isspace((unsigned char) last_img_text.back())) last_img_text.pop_back();
            size_t b0 = 0; while (b0 < last_img_text.size() && isspace((unsigned char) last_img_text[b0])) b0++;
            last_img_text.erase(0, b0);
            if (!last_img_text.empty()) at = prompt.rfind(last_img_text);
            if (at == std::string::npos) {
                at = prompt.rfind("user\n");            // قوالب Gemma/Llama: بداية دور المستخدم
                if (at != std::string::npos) at += 5;
            }
            if (at == std::string::npos) at = 0;
            prompt.insert(at, ins);
        }
    }

    const llama_vocab * vocab = llama_model_get_vocab(g.model);
    llama_memory_t mem = llama_get_memory(g.ctx);
    int n_predict = o.value("n_predict", 512);
    double t_p0 = now_ms();
    int n_prompt = 0, n_cached = 0;
    llama_pos n_past = 0;

    if (!images.empty()) {
        // ---- مسار الصور: لا نعيد استخدام الذاكرة المؤقتة ----
        llama_memory_clear(mem, true); g.cache.clear(); g.cache_ok = false;
        std::vector<mtmd_bitmap *> bms;
        auto free_bms = [&] { for (auto * b : bms) mtmd_bitmap_free(b); bms.clear(); };
        for (auto & im : images) {
            auto w = mtmd_helper_bitmap_init_from_buf(g.mtmd, (const unsigned char *) im.data(), im.size(), false, mtmd_helper_init_opt{});
            if (!w.bitmap) { free_bms(); return err("image", "تعذّر قراءة الصورة المرفقة.").dump(); }
            bms.push_back(w.bitmap);
        }
        mtmd_input_text it; it.text = prompt.c_str(); it.add_special = llama_vocab_get_add_bos(vocab); it.parse_special = true;
        mtmd_input_chunks * chunks = mtmd_input_chunks_init();
        std::vector<const mtmd_bitmap *> cb(bms.begin(), bms.end());
        int32_t r = mtmd_tokenize(g.mtmd, chunks, &it, cb.data(), cb.size());
        if (r != 0) {
            mtmd_input_chunks_free(chunks); free_bms();
            std::string why = take_lasterr();
            return err("image", "تعذّر تجهيز الصورة (" + std::to_string(r) + ")" + (why.empty() ? "" : ": " + why)).dump();
        }
        n_prompt = (int) mtmd_helper_get_n_tokens(chunks);
        if (n_prompt >= g.n_ctx - 8) { mtmd_input_chunks_free(chunks); free_bms(); return json{{"ok", false}, {"code", "ctx"}, {"error", "المحادثة مع الصور أطول من السياق"}, {"need", n_prompt}, {"ctx", g.n_ctx}}.dump(); }
        if (on_prog) on_prog(0, n_prompt);
        r = mtmd_helper_eval_chunks(g.mtmd, g.ctx, chunks, 0, 0, g.n_batch, true, &n_past);
        mtmd_input_chunks_free(chunks); free_bms();
        if (g_abort) return json{{"ok", true}, {"stop", "abort"}, {"n_prompt", n_prompt}, {"n_cached", 0}, {"n_gen", 0}, {"t_prompt_ms", now_ms() - t_p0}, {"t_gen_ms", 0}}.dump();
        if (r != 0) return err("decode", "فشل معالجة الصورة (" + std::to_string(r) + ")").dump();
        if (on_prog) on_prog(n_prompt, n_prompt);
    } else {
        // ---- مسار النص: نعيد استخدام أطول بادئة مشتركة مع الطلب السابق ----
        bool add_special = llama_vocab_get_add_bos(vocab);
        if (add_special) {
            llama_token bos = llama_vocab_bos(vocab);
            if (bos != LLAMA_TOKEN_NULL) {
                std::string bp = common_token_to_piece(vocab, bos, true);
                if (!bp.empty() && prompt.compare(0, bp.size(), bp) == 0) add_special = false;
            }
        }
        std::vector<llama_token> toks = common_tokenize(vocab, prompt, add_special, true);
        n_prompt = (int) toks.size();
        if (n_prompt >= g.n_ctx - 8) return json{{"ok", false}, {"code", "ctx"}, {"error", "المحادثة أطول من السياق"}, {"need", n_prompt}, {"ctx", g.n_ctx}}.dump();
        size_t keep = 0;
        if (g.cache_ok) { size_t lim = std::min(g.cache.size(), toks.size() - 1); while (keep < lim && g.cache[keep] == toks[keep]) keep++; }
        if (!llama_memory_seq_rm(mem, 0, (llama_pos) keep, -1)) { llama_memory_clear(mem, true); keep = 0; }
        n_cached = (int) keep;
        g.cache.assign(toks.begin(), toks.begin() + keep); g.cache_ok = true;
        if (on_prog) on_prog((int) keep, n_prompt);
        for (size_t i = keep; i < toks.size();) {
            int n = (int) std::min<size_t>(g.n_batch, toks.size() - i);
            llama_batch b = llama_batch_get_one(toks.data() + i, n);
            int rc = llama_decode(g.ctx, b);
            if (g_abort) { g.cache_ok = false; return json{{"ok", true}, {"stop", "abort"}, {"n_prompt", n_prompt}, {"n_cached", n_cached}, {"n_gen", 0}, {"t_prompt_ms", now_ms() - t_p0}, {"t_gen_ms", 0}}.dump(); }
            if (rc != 0) { g.cache_ok = false; llama_memory_clear(mem, true); return err("decode", "فشل معالجة المحادثة (" + std::to_string(rc) + ")").dump(); }
            g.cache.insert(g.cache.end(), toks.begin() + i, toks.begin() + i + n);
            i += n;
            if (on_prog) on_prog((int) i, n_prompt);
        }
        n_past = (llama_pos) toks.size();
    }
    double t_p1 = now_ms();

    // ---- العيّنات والتوليد ----
    common_params_sampling sp;
    sp.temp = o.value("temp", 0.7f); sp.top_p = o.value("top_p", 0.9f); sp.top_k = o.value("top_k", 40); sp.min_p = o.value("min_p", 0.05f);
    sp.penalty_repeat = o.value("repeat_penalty", 1.08f);
    long seed = o.value("seed", -1L); sp.seed = seed < 0 ? LLAMA_DEFAULT_SEED : (uint32_t) seed;
    common_sampler * smpl = common_sampler_init(g.model, sp);
    if (!smpl) return err("decode", "تعذّر إنشاء أداة العيّنات").dump();

    n_predict = std::max(1, std::min(n_predict, g.n_ctx - (int) n_past - 1));
    std::string pending, stop = "length";
    int n_gen = 0;
    double t_g0 = now_ms();
    llama_batch one = llama_batch_init(1, 0, 1);
    bool failed = false; std::string fail_msg;
    for (; n_gen < n_predict; n_gen++) {
        if (g_abort) { stop = "abort"; break; }
        llama_token t = common_sampler_sample(smpl, g.ctx, -1);
        common_sampler_accept(smpl, t, true);
        if (llama_vocab_is_eog(vocab, t)) { stop = "eos"; break; }
        pending += common_token_to_piece(vocab, t, true);
        size_t k = utf8_complete_prefix(pending);
        if (k) {
            std::string out = pending.substr(0, k); pending.erase(0, k);
            if (on_piece && !on_piece(out)) { stop = "abort"; g_abort = true; n_gen++; // الرمز حُسب لكنه لم يُحلَّل
                // نُبقي الذاكرة متسقة: لا نُضيف الرمز للسياق
                break; }
        }
        one.n_tokens = 1; one.token[0] = t; one.pos[0] = n_past; one.n_seq_id[0] = 1; one.seq_id[0][0] = 0; one.logits[0] = 1;
        int rc = llama_decode(g.ctx, one);
        if (rc != 0) { if (g_abort) { stop = "abort"; n_gen++; g.cache_ok = false; break; } failed = true; fail_msg = "فشل التوليد (" + std::to_string(rc) + ")"; break; }
        n_past++;
        if (g.cache_ok && images.empty()) g.cache.push_back(t);
    }
    if (!pending.empty() && stop != "abort" && on_piece) on_piece(pending);
    double t_g1 = now_ms();
    llama_batch_free(one);
    common_sampler_free(smpl);
    if (!images.empty()) { g.cache.clear(); g.cache_ok = false; }
    if (failed) { g.cache_ok = false; llama_memory_clear(mem, true); return err("decode", fail_msg).dump(); }
    return json{{"ok", true}, {"stop", stop}, {"n_prompt", n_prompt}, {"n_cached", n_cached}, {"n_gen", n_gen},
                {"t_prompt_ms", t_p1 - t_p0}, {"t_gen_ms", t_g1 - t_g0}}.dump();
}

} // namespace ql
