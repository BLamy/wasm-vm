#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_FLOAT_VERTEX_EVIDENCE_DIR:-target/evidence/virgl-float-vertex}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
git diff --check
for file in renderer/virgl-command/{decoder,state}.mjs renderer/virgl-command/tests/float-vertex-fetch.mjs tools/verify-virgl-float-vertex-fetch.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/float-vertex-{receipt,cold,seal}.py
bash -n tools/verify-virgl-float-vertex-fetch.sh
mkdir -p "$evidence_dir/abi"
for mode in native sanitize; do
  flags=(-g)
  if [[ $mode == sanitize ]]; then flags+=(-fsanitize=address,undefined -fno-omit-frame-pointer); fi
  clang -std=gnu11 -Wall -Wextra -Werror "${flags[@]}" -Irenderer/virgl-shader/vendor/src \
    tools/virgl-command/float-vertex-enums.c -o "$evidence_dir/abi/float-vertex-$mode"
  "$evidence_dir/abi/float-vertex-$mode" > "$evidence_dir/abi/$mode.json"
done
# Compiler semantics are unchanged. Build the real fixed-memory module; prior
# D1/D2 compiler/runtime results remain evidence for unchanged source boundaries.
bash renderer/virgl-shader/build.sh wasm
node tools/verify-virgl-float-vertex-fetch.mjs --output "$evidence_dir/wire" --node-only true
node tools/verify-virgl-float-vertex-fetch.mjs --output "$evidence_dir/hardware"
for fault in scalar rgba perspective; do
  if node tools/verify-virgl-float-vertex-fetch.mjs --output "$evidence_dir/fault-$fault" --mutation "$fault"; then
    echo "ERROR: $fault escaped the independent physical vertex oracle" >&2
    exit 1
  fi
done
# Affected retained original draws, raster, resource, index and async paths.
VIRGL_RASTER_EVIDENCE_DIR="$evidence_dir/regression" make verify-E6-T12h
node renderer/virgl-command/tests/blend-boundaries.mjs --output "$evidence_dir/promoted-blend"
python3 tools/virgl-command/float-vertex-receipt.py "$evidence_dir"
