#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_CACHE_EVIDENCE_DIR:-target/evidence/virgl-render-cache}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
set -x
git rev-parse HEAD
git diff --check
for file in renderer/virgl-command/{cache,state}.mjs renderer/virgl-command/tests/{render-cache,flat-pairs,texture-views,depth-formats,raster-depth-boundaries}.mjs tools/verify-virgl-*.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/cache-{receipt,cold,seal}.py
bash -n tools/verify-virgl-render-cache.sh
# Current original draw/state and affected resource/indexed/async/format/view/compiler gates.
VIRGL_RASTER_EVIDENCE_DIR="$evidence_dir/regression" make verify-E6-T12h
node renderer/virgl-command/tests/raster-depth-boundaries.mjs --output "$evidence_dir/promoted-rgb"
node tools/verify-virgl-render-cache.mjs --output "$evidence_dir/hardware"
for fault in blend-key translation-text; do
  if node tools/verify-virgl-render-cache.mjs --output "$evidence_dir/fault-$fault" --mutation "$fault"; then
    echo "ERROR: $fault escaped the independent physical cache oracle" >&2
    exit 1
  fi
done
node tools/verify-virgl-render-cache.mjs --output "$evidence_dir/hash-collision" --mutation hash-collision
python3 tools/virgl-command/cache-receipt.py "$evidence_dir"
