#!/usr/bin/env bash
# Private integer storage, masked bitwise operations and exact browser readback.
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_RAW_BITS_EVIDENCE_DIR:-target/evidence/virgl-raw-bits}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
python3 -m py_compile tools/virgl-raw-bits/native.py tools/virgl-raw-bits/receipt.py tools/virgl-raw-bits/cold.py tools/virgl-raw-bits/regressions.py
node --check renderer/virgl-shader/tests/raw-bits.mjs
node --check tools/verify-virgl-raw-bits.mjs
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh raw-bit-sanitize
python3 tools/virgl-raw-bits/native.py --binary renderer/virgl-shader/build/raw-bit-sanitize/raw-bit-test --output "$evidence_dir/native"
# Rebuild and prove the unchanged legacy path at this head, including bank,
# component, pair, original command-state/draw and shader sanitizer regressions.
VIRGL_BANK_EVIDENCE_DIR="$evidence_dir/regression" bash tools/verify-virgl-banks.sh
# Keep the separately verified finite command boundary and shared async engine.
node tools/virgl-constants/decoder.mjs --output "$evidence_dir/constant-regression/decoder"
node tools/verify-virgl-constants.mjs --output "$evidence_dir/constant-regression/hardware"
node tools/verify-virgl-async-jobs.mjs --output "$evidence_dir/async-regression"
node tools/verify-virgl-raw-bits.mjs --output "$evidence_dir/hardware"
# Change the low bit of every SHL mask in one served shader and require a real output failure.
if node tools/verify-virgl-raw-bits.mjs --output "$evidence_dir/sabotage" --sabotage shift-mask; then
  echo 'ERROR: wrong raw-bit lowering escaped the independent hardware oracle' >&2
  exit 1
fi
python3 tools/virgl-raw-bits/receipt.py "$evidence_dir"
