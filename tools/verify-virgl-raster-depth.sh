#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_RASTER_EVIDENCE_DIR:-target/evidence/virgl-raster-depth}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
set -x
git rev-parse HEAD
git diff --check
for file in renderer/virgl-command/{decoder,state}.mjs renderer/virgl-command/tests/raster-depth.mjs tools/virgl-command/raster-fixtures.mjs tools/verify-virgl-raster-depth.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/raster-{receipt,cold,seal}.py
bash -n tools/verify-virgl-raster-depth.sh
# All affected resource/state/indexed/async/format/view/upload paths on this source.
VIRGL_INLINE_EVIDENCE_DIR="$evidence_dir/regression" make verify-E6-T12g5
node renderer/virgl-command/tests/required-format-roles.mjs > "$evidence_dir/required-format-roles.json"
node tools/verify-virgl-raster-depth.mjs --output "$evidence_dir/hardware"
for fault in depth-direction winding negative-y scissor fetch-size; do
  if node tools/verify-virgl-raster-depth.mjs --output "$evidence_dir/fault-$fault" --sabotage "$fault"; then
    echo "ERROR: $fault escaped the independent physical raster oracle" >&2
    exit 1
  fi
done
python3 tools/virgl-command/raster-receipt.py "$evidence_dir"
