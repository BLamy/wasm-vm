#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_REQUIRED_FORMAT_EVIDENCE_DIR:-target/evidence/virgl-required-formats}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
rm -f "$evidence/receipt.json"
exec > >(tee "$evidence/acceptance.log") 2>&1
git diff --check
node --check tools/virgl-required-formats/closure.mjs
python3 -m py_compile tools/virgl-required-formats/*.py
bash -n tools/verify-virgl-required-formats.sh
node tools/virgl-required-formats/closure.mjs "$evidence/closure.json"
# This retained gate executes all current resource/state/draw/job/color/depth/
# view/inline boundaries. Its receipt authenticates exact-head served sources.
VIRGL_INLINE_EVIDENCE_DIR="$evidence/runtime" make verify-E6-T12g5
for fault in channel-order destination-alpha; do
  if node tools/verify-virgl-color-formats.mjs --output "$evidence/fault-$fault" --sabotage "$fault"; then
    echo "Required color $fault mutation unexpectedly passed." >&2
    exit 1
  fi
done
if node tools/verify-virgl-depth-formats.mjs --output "$evidence/fault-byte-order" --sabotage byte-order; then
  echo 'Required depth byte-order mutation unexpectedly passed.' >&2
  exit 1
fi
if node tools/verify-virgl-texture-views.mjs --output "$evidence/fault-swizzle" --sabotage swizzle; then
  echo 'Required swizzle mutation unexpectedly passed.' >&2
  exit 1
fi
mkdir -p target/evidence/virgl-92cb-raster
python3 tools/virgl-92cb-geometry/capture.py target/evidence/virgl-92cb-raster/geometry.bin > "$evidence/capture.log"
node renderer/virgl-shader/tests/original-programs-custody.mjs > "$evidence/custody.log"
python3 tools/virgl-required-formats/receipt.py "$evidence"
