#!/usr/bin/env bash
# يجلب مصدر llama.cpp (الإصدار المثبّت الذي اختُبرت الواجهة عليه) إلى android-native/llama.cpp لبناء المحرك الأصلي.
# تغيير الإصدار: LLAMA_CPP_TAG=bXXXXX scripts/fetch-llama.sh  (قد تتغير واجهات llama.cpp بين الإصدارات — راجع android-native/src).
set -euo pipefail
TAG="${LLAMA_CPP_TAG:-b11695}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/android-native/llama.cpp"
if [ -f "$DIR/CMakeLists.txt" ]; then echo "llama.cpp موجود: $DIR"; exit 0; fi
git clone --depth 1 --branch "$TAG" https://github.com/ggml-org/llama.cpp "$DIR"
echo "تم جلب llama.cpp $TAG"
