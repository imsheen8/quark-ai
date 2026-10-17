// QUARK AI — نواة تشغيل llama.cpp (بلا JNI) — تُختبر على الجهاز المضيف وتُغلَّف بـ JNI للأندرويد.
#pragma once
#include <functional>
#include <string>
#include <vector>

namespace ql {

// يمرّر نصًّا (بايتات UTF-8 كاملة) ويعيد false لإيقاف التوليد
using PieceCb = std::function<bool(const std::string &)>;
// تقدّم معالجة المحادثة المُدخلة (done من total رمزًا)
using ProgressCb = std::function<void(int, int)>;

std::string init(const std::string & backend_dir);          // "" عند النجاح وإلا رسالة خطأ
std::string sys_info();
// load_json: {"model":path,"mmproj":path|"","n_ctx":4096,"n_threads":0,"n_batch":512,"mmap":true}
// يعيد JSON: {"ok":true,...} أو {"ok":false,"error":"..."}
std::string load(const std::string & load_json);
// chat_json: {"messages":[{"role","content","nimg"?}],"n_predict":256,"temp":0.7,"top_p":0.9,"top_k":40,"min_p":0.05,
//             "repeat_penalty":1.08,"seed":-1,"think":false}
// images: بايتات الصور بالترتيب (jpg/png…)
// يعيد JSON: {"ok":true,"stop":"eos|length|abort","n_prompt":..,"n_cached":..,"n_gen":..,"t_prompt_ms":..,"t_gen_ms":..}
//         أو {"ok":false,"code":"ctx|load|decode|template|image","error":"..."}
std::string chat(const std::string & chat_json, const std::vector<std::string> & images, const PieceCb & on_piece, const ProgressCb & on_prog);
void abort();
void unload();
bool loaded();

} // namespace ql
