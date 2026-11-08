# Ravenholm browser build

Base: `weliveinhell/source-engine` at `63f8364fe7b22b239e72dfb5f1024665b3a91567`, a browser fork of the requested nillerusr engine. Target game is HL2, not Portal. Test map is `d1_town_01`.

## Windows build

The current workspace has Emscripten 4.0.8 in `../emsdk`. Its bundled Python and LLVM are used by the PowerShell helper; no global installation or system PATH change is needed. SDK compatibility changes are in `prepare-sdk.mjs`, derived from the browser fork's WebGL patch and SDL audio instructions. After SDL port extraction, run that helper and rebuild PIC `sdl2` and `sdl2-mt` with `embuilder.py --force --pic build sdl2 sdl2-mt`.

```powershell
git submodule update --init --depth 1
node emscripten/pack-ravenholm.mjs 'C:/Program Files (x86)/Steam/steamapps/common/Half-Life 2' 'build/install/chunks' 'C:/Program Files (x86)/Steam/steamapps/common/GarrysMod/sourceengine'
./emscripten/build.ps1
node --test emscripten/loader.test.mjs
node emscripten/serve.mjs
```

After fixing a compile error, `./emscripten/build.ps1 -Resume` skips configuration and reuses completed objects. Open the server URL only after linking succeeds. `build/install/index.html` is the linked engine entry point; the shell alone is not a playable game.

## Loading strategy

The 28 campaign maps from Point Insertion through the end of Ravenholm and background01–04 are packaged. The packer reads the installed VPK indices directly without unpacking the entire game, resolves BSP embedded material patches and model/material dependencies, adds common runtime effects and relevant NPC assets, and emits content-addressed chunks. It preserves the installed game files.

The loader fetches three chunks at a time, validates hashes and record boundaries, caches them in browser storage when available, and gives the engine a 1280 × 720 test profile with HDR and multisampling disabled. Each map has its own dependency list; earlier chapters are fetched when selected or reached. Shared models, textures, scenes, and sounds also have a deferred file index. The local server serves precompressed assets and provides the cross-origin isolation headers required by shared-memory threads. Browser cache capacity and available memory affect subsequent loads.

Audio uses SDL conversion from the fixed 16-bit stereo mixer to the browser’s native float/sample rate. The shell adds a 25% master gain and a mute control. Installed legacy HL2 materials, models, shaders, and sounds provide compatibility with the engine. Retail files are read without modification.

The native Options → Video page includes **RTX Lighting**, an optional darker gamma preset (not ray tracing). Normal lighting is the default. The setting updates the final color pass without restarting and is archived in browser storage. The renderer allocates matching depth surfaces for smaller WebGL water, camera, and postprocessing targets.

Deferred sounds use smaller banks, engine log output is batched, and next-map prefetch caches at most 64 MiB without inflating it. Initial declared Ravenholm dependencies total 216.3 MiB compressed. Cached Canals asset preparation measured approximately seven to eight seconds; engine initialization and shader compilation are additional.

The map dependency lists are explicit and missing shared files can be fetched on demand. `build/install/chunks/asset-report.json` records exact selected files and unresolved references. Ravenholm rendering and movement were verified locally after repairing path normalization and adding the engine post-processing materials. Full chapter completion and comprehensive runtime-spawned asset coverage have not been verified.

## Credits

Both the engine menu and web shell have a Credits button displaying `windows` / Discord `therealwindows` and upstream acknowledgments.
