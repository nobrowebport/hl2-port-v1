set -ex

sudo apt update
sudo apt install git curl wget python3 xz-utils llvm binutils -y

# activate emsdk
git clone https://github.com/emscripten-core/emsdk.git
pushd emsdk
git checkout 2d480a1b7c7a34a354188d93f3e89190a44a1d21
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
popd

# patch and rebuild sdl2
embuilder --pic build sdl2 sdl2-mt
sed -Ei 's/freq = EM_ASM_INT/freq = MAIN_THREAD_EM_ASM_INT/' emsdk/upstream/emscripten/cache/ports/sdl2/SDL-release-2.32.0/src/audio/emscripten/SDL_emscriptenaudio.c
embuilder --force --pic build sdl2 sdl2-mt

# patch glMapBufferRange to allow some "unsupported" parameters
patch emsdk/upstream/emscripten/src/lib/libwebgl.js emscripten/libwebgl.patch