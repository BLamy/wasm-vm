#!/usr/bin/env bash
# Scalar source consumption, one evaluation/replication and independent GPU bounds.
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_DOT_RECIPROCALS_EVIDENCE_DIR:-target/evidence/virgl-dot-reciprocals}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
python3 -m py_compile tools/virgl-dot-reciprocals/*.py
node --check renderer/virgl-shader/tests/dot-reciprocals.mjs
node --check tools/verify-virgl-dot-reciprocals.mjs
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh dot-reciprocal-sanitize
python3 tools/virgl-dot-reciprocals/native.py --binary renderer/virgl-shader/build/dot-reciprocal-sanitize/dot-reciprocal-test --output "$evidence_dir/native"
bash renderer/virgl-shader/build.sh component-float-sanitize
python3 tools/virgl-dot-reciprocals/component_compat.py --binary renderer/virgl-shader/build/component-float-sanitize/component-float-test --output "$evidence_dir/component-regression/native"
VIRGL_NUMERIC_FLOATS_EVIDENCE_DIR="$evidence_dir/component-regression/numeric-regression" bash tools/verify-virgl-numeric-floats.sh
node tools/verify-virgl-component-floats.mjs --output "$evidence_dir/component-regression/hardware"
for sabotage in lrp-order frc-floor div-operands numeric-negate; do
  if node tools/verify-virgl-component-floats.mjs --output "$evidence_dir/component-regression/sabotage-$sabotage" --sabotage "$sabotage"; then
    echo "ERROR: predecessor component fault escaped actual GPU oracle: $sabotage" >&2
    exit 1
  fi
done
node tools/verify-virgl-dot-reciprocals.mjs --output "$evidence_dir/hardware"
for sabotage in dp3-lane rcp-source rsq-operation numeric-negate; do
  if node tools/verify-virgl-dot-reciprocals.mjs --output "$evidence_dir/sabotage-$sabotage" --sabotage "$sabotage"; then
    echo "ERROR: corrupted scalar shader escaped actual GPU oracle: $sabotage" >&2
    exit 1
  fi
done
python3 tools/virgl-dot-reciprocals/receipt.py "$evidence_dir"
