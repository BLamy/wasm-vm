#!/usr/bin/env bash
# Production-only browser assets. No native fixtures, guest RAM helpers or proof VM exports.
set -euo pipefail
cd "$(dirname "$0")/.."
virgl_emcc=$(bash tools/setup-virgl-emsdk.sh)
EMCC="$virgl_emcc" bash renderer/virgl-shader/build.sh wasm
mkdir -p web/renderer/virgl-command web/renderer/virgl-shader/build/wasm
cp renderer/virgl-command/*.mjs web/renderer/virgl-command/
cp renderer/virgl-shader/*.mjs web/renderer/virgl-shader/
cp renderer/virgl-shader/build/wasm/virgl-shader.mjs renderer/virgl-shader/build/wasm/virgl-shader.wasm web/renderer/virgl-shader/build/wasm/
