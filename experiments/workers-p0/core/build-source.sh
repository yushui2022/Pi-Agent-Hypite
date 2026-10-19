#!/usr/bin/env bash
# Build host: Linux / existing WSL. Deployment does not use WSL or containers.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BUILD_ROOT="${P0_BUILD_ROOT:-/mnt/g/DevCache/Temp/pi-agent-hypite/workers-p0/source-build}"
JOBS="${P0_BUILD_JOBS:-4}"
mkdir -p "$BUILD_ROOT" "$BUILD_ROOT/tmp" "$BUILD_ROOT/logs" "$BUILD_ROOT/install" "$BUILD_ROOT/release"
export TMPDIR="$BUILD_ROOT/tmp" EM_CACHE="$BUILD_ROOT/em-cache" PIP_CACHE_DIR="$BUILD_ROOT/pip-cache"
export EM_CONFIG="$BUILD_ROOT/emsdk/.emscripten"
export INSTALL_DIR="$BUILD_ROOT/install"
exec > >(tee "$BUILD_ROOT/logs/build.log") 2>&1
python3 - "$SCRIPT_DIR/sources.lock.json" "$BUILD_ROOT" <<'PY'
import json, pathlib, subprocess, sys, shutil, os
git = 'git' if os.environ.get('P0_NATIVE_GIT') == '1' else (shutil.which('git.exe') or 'git')
def gitpath(p):
    return subprocess.check_output(['wslpath', '-w', str(p)], text=True).strip() if git.endswith('.exe') else str(p)
for name, source in json.load(open(sys.argv[1])).items():
    target = pathlib.Path(sys.argv[2]) / name
    if not target.exists():
        subprocess.run([git, 'init', gitpath(target)], check=True)
        subprocess.run([git, '-C', gitpath(target), 'config', 'core.autocrlf', 'false'], check=True)
        subprocess.run([git, '-C', gitpath(target), 'remote', 'add', 'origin', source['url']], check=True)
        subprocess.run([git, '-C', gitpath(target), 'fetch', '--depth', '1', 'origin', source['commit']], check=True)
        subprocess.run([git, '-C', gitpath(target), 'checkout', '--detach', 'FETCH_HEAD'], check=True)
    actual = subprocess.check_output([git, '-C', gitpath(target), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != source['commit']:
        raise SystemExit(f'{name}: expected pinned {source["commit"]}, got {actual}; use a fresh build directory')
    dirty = subprocess.check_output([git, '-C', gitpath(target), 'diff', '--name-only', 'HEAD'], text=True).strip()
    if dirty: raise SystemExit(f'{name}: tracked sources changed: {dirty}')
PY
cd "$BUILD_ROOT/emsdk"
./emsdk install 3.1.40
./emsdk activate 3.1.40
export EMSDK_QUIET=1
source ./emsdk_env.sh
export EM_CACHE="$BUILD_ROOT/em-cache" EM_CONFIG="$BUILD_ROOT/emsdk/.emscripten"
# Install only into the dedicated G-drive build tree; no apt/system installation.
if [[ ! -x "$BUILD_ROOT/python-tools/cmake/data/bin/cmake" ]]; then
  python3 -m pip install --target "$BUILD_ROOT/python-tools" --no-deps --report "$BUILD_ROOT/cmake-install.json" 'cmake==3.27.9'
fi
export PATH="$BUILD_ROOT/python-tools/cmake/data/bin:$PATH"
export CFLAGS="-O3 -I$INSTALL_DIR/include"
export CXXFLAGS="$CFLAGS"
export LDFLAGS="-O3 -L$INSTALL_DIR/lib"
export PKG_CONFIG_PATH="$INSTALL_DIR/lib/pkgconfig"
export EM_PKG_CONFIG_PATH="$PKG_CONFIG_PATH"
printf '%s\n' 'Building single-thread x264'
cd "$BUILD_ROOT/x264"
emconfigure ./configure --prefix="$INSTALL_DIR" --host=x86-gnu --enable-static --disable-cli --disable-asm --disable-thread --extra-cflags="$CFLAGS"
emmake make -j"$JOBS" install-lib-static
printf '%s\n' 'Building FreeType without optional compression/shaping dependencies'
emcmake cmake -S "$BUILD_ROOT/freetype" -B "$BUILD_ROOT/freetype-build" -DCMAKE_INSTALL_PREFIX="$INSTALL_DIR" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DCMAKE_DISABLE_FIND_PACKAGE_ZLIB=TRUE -DCMAKE_DISABLE_FIND_PACKAGE_BZip2=TRUE -DCMAKE_DISABLE_FIND_PACKAGE_PNG=TRUE -DCMAKE_DISABLE_FIND_PACKAGE_HarfBuzz=TRUE -DCMAKE_DISABLE_FIND_PACKAGE_BrotliDec=TRUE
cmake --build "$BUILD_ROOT/freetype-build" -j "$JOBS"
cmake --install "$BUILD_ROOT/freetype-build"
printf '%s\n' 'Configuring minimal FFmpeg'
cd "$BUILD_ROOT/ffmpeg"
emconfigure ./configure --target-os=none --arch=x86_32 --enable-cross-compile \
  --disable-asm --disable-stripping --disable-programs --disable-doc --disable-debug \
  --disable-runtime-cpudetect --disable-autodetect --disable-everything --disable-network \
  --disable-pthreads --disable-w32threads --disable-os2threads --disable-avdevice --disable-postproc \
  --nm=emnm --ar=emar --ranlib=emranlib --cc=emcc --cxx=em++ --objcc=emcc --dep-cc=emcc \
  --extra-cflags="$CFLAGS" --extra-cxxflags="$CXXFLAGS" --extra-ldflags="$LDFLAGS" \
  --enable-gpl --enable-libx264 --enable-libfreetype \
  --enable-decoder=h264,aac,pcm_s16le,png,mjpeg --enable-encoder=libx264,aac \
  --enable-parser=h264,aac,png,mjpeg --enable-demuxer=mov,wav,concat,image2,png_pipe,jpeg_pipe \
  --enable-muxer=mp4 --enable-protocol=file --enable-bsf=h264_mp4toannexb \
  --enable-filter=buffer,buffersink,abuffer,abuffersink,scale,crop,pad,setsar,fps,format,drawtext,aresample,aformat,volume,afade,amix,anull,null,trim,atrim,setpts,asetpts
emmake make -j"$JOBS"
# Upstream patched CLI preserves its timeout/return bindings. No browser worker shim.
mkdir -p src
cp -R "$BUILD_ROOT/bindings/src/fftools" src/
cp -R "$BUILD_ROOT/bindings/src/bind" src/
emcc -O3 -I. -Isrc/fftools -I"$INSTALL_DIR/include" -I"$INSTALL_DIR/include/freetype2" -L"$INSTALL_DIR/lib" \
  -Wno-deprecated-declarations \
  "$SCRIPT_DIR/probe.c" src/fftools/cmdutils.c src/fftools/ffmpeg.c src/fftools/ffmpeg_filter.c src/fftools/ffmpeg_hw.c src/fftools/ffmpeg_mux.c src/fftools/ffmpeg_opt.c src/fftools/opt_common.c \
  libavfilter/libavfilter.a libavformat/libavformat.a libavcodec/libavcodec.a libswresample/libswresample.a libswscale/libswscale.a libavutil/libavutil.a \
  -lx264 -lfreetype -lm \
  -sWASM_BIGINT -sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=worker \
  -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=100663296 -sALLOW_MEMORY_GROWTH \
  -sEXPORT_NAME=createFFmpegCore -sEXPORTED_FUNCTIONS=_ffmpeg,_abort,_malloc,_free,_p0_probe,_p0_caption \
  -sEXPORTED_RUNTIME_METHODS=FS,setValue,getValue,UTF8ToString,lengthBytesUTF8,stringToUTF8 \
  --pre-js src/bind/ffmpeg/bind.js -o "$BUILD_ROOT/release/ffmpeg-core.js"
cp config.h config_components.h ffbuild/config.mak "$BUILD_ROOT/release/"
python3 - "$SCRIPT_DIR" "$BUILD_ROOT" <<'PY'
import hashlib, json, pathlib, subprocess, sys, datetime, shutil
script, root = map(pathlib.Path, sys.argv[1:])
release = root / 'release'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
sources = json.load(open(script/'sources.lock.json'))
licenses = {'ffmpeg': ['COPYING.GPLv2', 'LICENSE.md'], 'x264': ['COPYING'], 'freetype': ['docs/LICENSE.TXT', 'docs/FTL.TXT', 'docs/GPLv2.TXT'], 'bindings': ['LICENSE']}
for name, files in licenses.items():
    folder = release/'licenses'/name
    folder.mkdir(parents=True, exist_ok=True)
    for filename in files:
        origin = root/name/filename
        if origin.exists(): shutil.copyfile(origin, folder/origin.name)
manifest = dict(schema='pi-studio.core-build.v1', createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), sources=sources,
    sourceRebuildVerified=True, minimalBuild=True, license='GPL-2.0-or-later', emscripten='3.1.40', cmake='3.27.9',
    heapGrowthCapBytes=100663296, initialMemoryBytes=33554432, buildScriptSha256=sha(script/'build-source.sh'), probeSourceSha256=sha(script/'probe.c'),
    wasmSha256=sha(release/'ffmpeg-core.wasm'), jsSha256=sha(release/'ffmpeg-core.js'), wasmBytes=(release/'ffmpeg-core.wasm').stat().st_size,
    configurationSha256=sha(release/'config.h'), runtimeValidated=False, cloudAccepted=False)
(release/'build-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
print(json.dumps(manifest, indent=2))
PY
