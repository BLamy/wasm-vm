#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_BLEND_EVIDENCE_DIR:-target/evidence/virgl-blend}
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
for file in renderer/virgl-command/{decoder,state}.mjs renderer/virgl-command/tests/blend-equations.mjs tools/verify-virgl-blend-equations.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/blend-{receipt,cold,seal}.py
bash -n tools/verify-virgl-blend-equations.sh
mkdir -p "$evidence_dir/abi"
for mode in native sanitize; do
  flags=(-g)
  if [[ $mode == sanitize ]]; then flags+=(-fsanitize=address,undefined -fno-omit-frame-pointer); fi
  clang -std=gnu11 -Wall -Wextra -Werror "${flags[@]}" \
    -DUTIL_ARCH_LITTLE_ENDIAN=1 -DUTIL_ARCH_BIG_ENDIAN=0 \
    -Irenderer/virgl-shader/vendor/src/gallium/include \
    -Irenderer/virgl-shader/vendor/src/mesa/pipe \
    -Irenderer/virgl-shader/vendor/src/mesa \
    -Irenderer/virgl-shader/vendor/src/mesa/compat \
    tools/virgl-command/blend-enums.c -o "$evidence_dir/abi/blend-$mode"
  "$evidence_dir/abi/blend-$mode" > "$evidence_dir/abi/$mode.json"
done
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh wasm
node tools/verify-virgl-blend-equations.mjs --output "$evidence_dir/wire" --node-only true
node tools/verify-virgl-blend-equations.mjs --output "$evidence_dir/hardware"
for fault in equation factor fold; do
  if node tools/verify-virgl-blend-equations.mjs --output "$evidence_dir/fault-$fault" --mutation "$fault"; then
    echo "ERROR: $fault escaped the independent rational pixel oracle" >&2
    exit 1
  fi
done
# Retained resource, indexed, async, raster, program and state cache boundaries.
VIRGL_CACHE_EVIDENCE_DIR="$evidence_dir/regression" make verify-E6-T12i
node renderer/virgl-command/tests/cache-boundaries.mjs --output "$evidence_dir/promoted-cache"
python3 tools/virgl-command/blend-receipt.py "$evidence_dir"
