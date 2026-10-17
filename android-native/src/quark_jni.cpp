// غلاف JNI رفيع فوق quark_llama.cpp — الصنف: ai.quark.engine.QuarkLlama (اسم ثابت لا يعتمد على معرّف التطبيق)
#include <jni.h>
#include <string>
#include <vector>
#include "quark_llama.h"

#ifdef __ANDROID__
#include <android/log.h>
#endif

static std::string jstr(JNIEnv * env, jstring s) {
    // GetStringUTFChars يعيد «modified UTF-8» (الرموز التعبيرية تأتي كزوج بديل) — نأخذ UTF-8 القياسي عبر getBytes
    if (!s) return "";
    jclass sc = env->FindClass("java/lang/String");
    jmethodID gb = env->GetMethodID(sc, "getBytes", "(Ljava/lang/String;)[B");
    jstring enc = env->NewStringUTF("UTF-8");
    jbyteArray a = (jbyteArray) env->CallObjectMethod(s, gb, enc);
    std::string r;
    if (a) {
        jsize n = env->GetArrayLength(a);
        r.resize((size_t) n);
        if (n) env->GetByteArrayRegion(a, 0, n, (jbyte *) &r[0]);
        env->DeleteLocalRef(a);
    }
    env->DeleteLocalRef(enc); env->DeleteLocalRef(sc);
    return r;
}
static jstring mk(JNIEnv * env, const std::string & s) {
    // JSON من النواة ASCII/UTF-8 صالح؛ نمرّره عبر بايتات لتفادي قيود modified-UTF8 مع الرموز التعبيرية
    jbyteArray a = env->NewByteArray((jsize) s.size());
    env->SetByteArrayRegion(a, 0, (jsize) s.size(), (const jbyte *) s.data());
    jclass sc = env->FindClass("java/lang/String");
    jmethodID ctor = env->GetMethodID(sc, "<init>", "([BLjava/lang/String;)V");
    jstring enc = env->NewStringUTF("UTF-8");
    jstring r = (jstring) env->NewObject(sc, ctor, a, enc);
    env->DeleteLocalRef(a); env->DeleteLocalRef(enc); env->DeleteLocalRef(sc);
    return r;
}

extern "C" {

JNIEXPORT jstring JNICALL Java_ai_quark_engine_QuarkLlama_nInit(JNIEnv * env, jclass, jstring dir) {
    return mk(env, ql::init(jstr(env, dir)));
}
JNIEXPORT jstring JNICALL Java_ai_quark_engine_QuarkLlama_nSysInfo(JNIEnv * env, jclass) { return mk(env, ql::sys_info()); }
JNIEXPORT jstring JNICALL Java_ai_quark_engine_QuarkLlama_nLoad(JNIEnv * env, jclass, jstring js) { return mk(env, ql::load(jstr(env, js))); }
JNIEXPORT void JNICALL Java_ai_quark_engine_QuarkLlama_nAbort(JNIEnv *, jclass) { ql::abort(); }
JNIEXPORT void JNICALL Java_ai_quark_engine_QuarkLlama_nUnload(JNIEnv *, jclass) { ql::unload(); }
JNIEXPORT jboolean JNICALL Java_ai_quark_engine_QuarkLlama_nLoaded(JNIEnv *, jclass) { return ql::loaded() ? JNI_TRUE : JNI_FALSE; }

// sink: interface Sink { boolean piece(byte[] b); void progress(int done, int total); }
JNIEXPORT jstring JNICALL Java_ai_quark_engine_QuarkLlama_nChat(JNIEnv * env, jclass, jstring js, jobjectArray imgs, jobject sink) {
    std::vector<std::string> images;
    if (imgs) {
        jsize n = env->GetArrayLength(imgs);
        for (jsize i = 0; i < n; i++) {
            jbyteArray a = (jbyteArray) env->GetObjectArrayElement(imgs, i);
            jsize len = env->GetArrayLength(a);
            std::string b((size_t) len, '\0');
            env->GetByteArrayRegion(a, 0, len, (jbyte *) &b[0]);
            images.push_back(std::move(b));
            env->DeleteLocalRef(a);
        }
    }
    jclass sc = env->GetObjectClass(sink);
    jmethodID mPiece = env->GetMethodID(sc, "piece", "([B)Z");
    jmethodID mProg = env->GetMethodID(sc, "progress", "(II)V");
    auto on_piece = [&](const std::string & s) -> bool {
        jbyteArray a = env->NewByteArray((jsize) s.size());
        env->SetByteArrayRegion(a, 0, (jsize) s.size(), (const jbyte *) s.data());
        jboolean r = env->CallBooleanMethod(sink, mPiece, a);
        env->DeleteLocalRef(a);
        if (env->ExceptionCheck()) { env->ExceptionClear(); return false; }
        return r == JNI_TRUE;
    };
    auto on_prog = [&](int d, int t) {
        env->CallVoidMethod(sink, mProg, (jint) d, (jint) t);
        if (env->ExceptionCheck()) env->ExceptionClear();
    };
    std::string r = ql::chat(jstr(env, js), images, on_piece, on_prog);
    return mk(env, r);
}

} // extern "C"
