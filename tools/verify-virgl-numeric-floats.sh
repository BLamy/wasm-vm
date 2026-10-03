#!/usr/bin/env bash
# Bounded ordinary numeric shader values beside their captured raw words.
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_NUMERIC_FLOATS_EVIDENCE_DIR:-target/evidence/virgl-numeric-floats}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
python3 -m py_compile tools/virgl-numeric-floats/*.py
node --check renderer/virgl-shader/tests/numeric-floats.mjs
node --check tools/verify-virgl-numeric-floats.mjs
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh numeric-float-sanitize
python3 tools/virgl-numeric-floats/native.py --binary renderer/virgl-shader/build/numeric-float-sanitize/numeric-float-test --output "$evidence_dir/native"
VIRGL_FLOAT_MASKS_EVIDENCE_DIR="$evidence_dir/float-regression" bash tools/verify-virgl-float-masks.sh
node tools/verify-virgl-numeric-floats.mjs --output "$evidence_dir/hardware"
for sabotage in stale-shadow numeric-decode sampler-index; do
  if node tools/verify-virgl-numeric-floats.mjs --output "$evidence_dir/sabotage-$sabotage" --sabotage "$sabotage"; then
    echo "ERROR: corrupted numeric shader escaped the actual GPU oracle: $sabotage" >&2
    exit 1
  fi
done
python3 tools/virgl-numeric-floats/receipt.py "$evidence_dir"
