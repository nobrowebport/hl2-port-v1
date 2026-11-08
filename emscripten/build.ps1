param([string]$Sdk = "$(Join-Path $PSScriptRoot '../../emsdk')", [int]$Jobs = 6, [switch]$Resume, [switch]$SkipFinalize, [switch]$LinkOnly)
$ErrorActionPreference = 'Stop'
$Sdk = (Resolve-Path $Sdk).Path
$env:EMSDK_PYTHON = Join-Path $Sdk 'python/3.13.3_64bit/python.exe'
$env:PATH = "$Sdk/upstream/emscripten;$Sdk/upstream/bin;$Sdk/node/24.19.0_64bit/bin;$env:PATH"
$env:CC = Join-Path $Sdk 'upstream/emscripten/emcc.bat'
$env:CXX = Join-Path $Sdk 'upstream/emscripten/em++.bat'
$env:AR = Join-Path $Sdk 'upstream/emscripten/emar.bat'
$env:STRIP = Join-Path $Sdk 'upstream/bin/llvm-strip.exe'
$env:OBJCOPY = Join-Path $Sdk 'upstream/bin/llvm-objcopy.exe'
Set-Location (Join-Path $PSScriptRoot '..')
if (!$Resume -and !$LinkOnly) {
  & $env:EMSDK_PYTHON waf configure -T release --notests --togles --emscripten --use-sdl=1 --use-togl=1 --disable-warns --build-games=hl2 --prefix=build/install
  if ($LASTEXITCODE) { throw 'Engine configuration failed' }
}
if (!$LinkOnly) {
  & $env:EMSDK_PYTHON waf install "-j$Jobs"
  if ($LASTEXITCODE) { throw 'Engine compilation failed' }
}
$libraries = Get-ChildItem build/install/lib*.so | ForEach-Object { "-l$($_.BaseName.Substring(3))" }
$linkArgs = @('-O2', '-sASSERTIONS=2', '-sUSE_BZIP2=1', '-sUSE_SDL=2', '-sUSE_FREETYPE=1', '-sUSE_LIBJPEG=1', '-sUSE_LIBPNG=1', '-sMALLOC=mimalloc',
 '-sMAIN_MODULE=1', '-sINITIAL_MEMORY=2047mb', '-sSHARED_MEMORY=1', '-pthread', '-sPTHREAD_POOL_SIZE=8', '-sPTHREAD_POOL_SIZE_STRICT=2',
 '-sFULL_ES3=1', '-sSTACK_SIZE=32mb', '--shell-file=emscripten/shell.html', '-sPROXY_TO_PTHREAD=1',
 '-sOFFSCREENCANVASES_TO_PTHREAD=#canvas', '-sOFFSCREENCANVAS_SUPPORT=1',
 '--pre-js', 'emscripten/pre.js', '--post-js', 'emscripten/post.js', '-Lbuild/install', 'build/launcher_main/libhl2_launcher.a')
& $env:CC @linkArgs @libraries -o build/install/index.html
if ($LASTEXITCODE) { throw 'Engine link failed' }
Copy-Item -LiteralPath emscripten/assets -Destination build/install -Recurse -Force
if (!$SkipFinalize) {
  node emscripten/finalize.mjs
  if ($LASTEXITCODE) { throw 'Packaging failed' }
}
