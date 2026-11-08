import fs from 'node:fs';
import path from 'node:path';
const sdk=path.resolve(process.argv[2]||'../emsdk');
const gl=path.join(sdk,'upstream/emscripten/src/lib/libwebgl.js');
let text=fs.readFileSync(gl,'utf8');
const start=text.indexOf('    if ((access & (0x1/*GL_MAP_READ_BIT*/ | 0x20/*GL_MAP_UNSYNCHRONIZED_BIT*/))');
if(start>=0){const end=text.indexOf('    if (!emscriptenWebGLValidateMapBufferTarget',start);if(end<0)throw new Error('Unknown WebGL implementation');
text=text.slice(0,start)+`    if (access & 0x1/*GL_MAP_READ_BIT*/) {
      GL.recordError(0x501);
      return 0;
    }
\n`+text.slice(end);fs.writeFileSync(gl,text);}
const audio=path.join(sdk,'upstream/emscripten/cache/ports/sdl2/SDL-release-2.32.0/src/audio/emscripten/SDL_emscriptenaudio.c');
if(!fs.existsSync(audio))throw new Error('Build the SDK sdl2 port once before preparing it');
const original=fs.readFileSync(audio,'utf8');
fs.writeFileSync(audio,original.replace('this->spec.freq = EM_ASM_INT({','this->spec.freq = MAIN_THREAD_EM_ASM_INT({').replace(
  "SDL2.audio.scriptProcessorNode['connect'](SDL2.audioContext['destination']);",
  `SDL2.audio.gainNode = SDL2.audioContext.createGain();
            SDL2.audio.gainNode.gain.value = Module['audioMuted'] ? 0 : (Module['audioMasterVolume'] ?? 0.25);
            SDL2.audio.scriptProcessorNode.connect(SDL2.audio.gainNode);
            SDL2.audio.gainNode.connect(SDL2.audioContext.destination);`));
console.log('Applied upstream Source web-port SDK compatibility patches. Rebuild PIC sdl2 and sdl2-mt ports.');
