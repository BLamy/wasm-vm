#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_INLINE_EVIDENCE_DIR:-target/evidence/virgl-inline-uploads}
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
for file in renderer/virgl-command/{resources,decoder,state}.mjs renderer/virgl-command/tests/inline-uploads.mjs tools/virgl-command/inline-fixtures.mjs tools/verify-virgl-inline-uploads.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/inline-receipt.py tools/virgl-command/inline-cold.py
bash -n tools/verify-virgl-inline-uploads.sh
# Inline/runtime boundary only: unchanged compiler and affected transfer/jobs.
# Retained view proof includes the original flat-renderer regression boundary.
bash renderer/virgl-shader/build.sh wasm
node tools/verify-virgl-command-decoder.mjs --output "$evidence_dir/regression/decoder" --node-only true
node tools/verify-virgl-resource-transfers.mjs --output "$evidence_dir/regression/resources"
node tools/verify-virgl-object-state.mjs --output "$evidence_dir/regression/state"
node tools/verify-virgl-draw-replay.mjs --output "$evidence_dir/regression/draw"
node tools/verify-virgl-async-jobs.mjs --output "$evidence_dir/regression/async"
node tools/verify-virgl-color-formats.mjs --output "$evidence_dir/regression/colors"
node tools/verify-virgl-depth-formats.mjs --output "$evidence_dir/regression/depth"
node tools/verify-virgl-texture-views.mjs --output "$evidence_dir/regression/views"
node tools/verify-virgl-inline-uploads.mjs --output "$evidence_dir/hardware"
for fault in inline-offset stride; do
  if node tools/verify-virgl-inline-uploads.mjs --output "$evidence_dir/sabotage-$fault" --sabotage "$fault"; then
    echo "ERROR: $fault escaped the independent physical inline oracle" >&2
    exit 1
  fi
done
python3 tools/virgl-command/inline-receipt.py "$evidence_dir"
