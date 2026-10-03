#!/usr/bin/env bash
# Ordinary componentwise arithmetic and typed source negation, with independent GPU oracles.
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_COMPONENT_FLOATS_EVIDENCE_DIR:-target/evidence/virgl-component-floats}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
python3 -m py_compile tools/virgl-component-floats/*.py
node --check renderer/virgl-shader/tests/component-floats.mjs
node --check tools/verify-virgl-component-floats.mjs
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh component-float-sanitize
python3 tools/virgl-component-floats/native.py --binary renderer/virgl-shader/build/component-float-sanitize/component-float-test --output "$evidence_dir/native"
VIRGL_NUMERIC_FLOATS_EVIDENCE_DIR="$evidence_dir/numeric-regression" bash tools/verify-virgl-numeric-floats.sh
node tools/verify-virgl-component-floats.mjs --output "$evidence_dir/hardware"
for sabotage in lrp-order frc-floor div-operands numeric-negate; do
  if node tools/verify-virgl-component-floats.mjs --output "$evidence_dir/sabotage-$sabotage" --sabotage "$sabotage"; then
    echo "ERROR: corrupted componentwise shader escaped the actual GPU oracle: $sabotage" >&2
    exit 1
  fi
done
python3 tools/virgl-component-floats/receipt.py "$evidence_dir"
