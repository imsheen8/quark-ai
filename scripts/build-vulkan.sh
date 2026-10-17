#!/usr/bin/env bash
# يبني وحدة Vulkan (libggml-vulkan.so) كمكتبة منفصلة ويضعها في android-native/prebuilt/arm64-v8a/libqvk.so
# اختياري تمامًا: إن فشل يبقى التطبيق يعمل بالمعالج. يحتاج: NDK + cmake + ninja + git + مترجم المضيف (gcc/g++) لأداة الـ shaders.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NDK="${ANDROID_NDK_HOME:-${ANDROID_NDK_LATEST_HOME:-${ANDROID_NDK_ROOT:-}}}"
[ -n "$NDK" ] && [ -f "$NDK/build/cmake/android.toolchain.cmake" ] || { echo "NDK غير موجود"; exit 1; }
[ -f "$ROOT/android-native/llama.cpp/CMakeLists.txt" ] || { echo "llama.cpp غير موجود"; exit 1; }
VKH_TAG="${VULKAN_HEADERS_TAG:-v1.4.350}"
SPV_TAG="${SPIRV_HEADERS_TAG:-vulkan-sdk-1.4.350.0}"
W="$(mktemp -d)"; PREFIX="$W/prefix"
git clone --depth 1 --branch "$VKH_TAG" https://github.com/KhronosGroup/Vulkan-Headers "$W/vkh"
cmake -S "$W/vkh" -B "$W/vkh/b" -DCMAKE_INSTALL_PREFIX="$PREFIX" >/dev/null && cmake --install "$W/vkh/b" >/dev/null
git clone --depth 1 --branch "$SPV_TAG" https://github.com/KhronosGroup/SPIRV-Headers "$W/spv"
cmake -S "$W/spv" -B "$W/spv/b" -DCMAKE_INSTALL_PREFIX="$PREFIX" >/dev/null && cmake --install "$W/spv/b" >/dev/null
# نفس إعدادات بناء Gradle (ABI/API/STL) كي تتطابق مكتبات ggml مع المحرك الأساسي
cmake -S "$ROOT/android-native" -B "$W/build" -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-28 -DANDROID_STL=c++_shared \
  -DCMAKE_BUILD_TYPE=Release -DQUARK_VULKAN=ON -DQUARK_VK_PREFIX="$PREFIX"
cmake --build "$W/build" --target ggml-vulkan -j "$(nproc)"
SO="$(find "$W/build" -name 'libggml-vulkan.so' | head -1)"
[ -n "$SO" ] || { echo "لم تُنتَج libggml-vulkan.so"; exit 1; }
mkdir -p "$ROOT/android-native/prebuilt/arm64-v8a"
# اسم مختلف كي لا يحمّلها ggml تلقائيًا عند الإقلاع: تُحمَّل صراحةً فقط حين يفعّل المستخدم GPU
cp "$SO" "$ROOT/android-native/prebuilt/arm64-v8a/libqvk.so"
ls -l "$ROOT/android-native/prebuilt/arm64-v8a/libqvk.so"
echo "Vulkan module ready"
