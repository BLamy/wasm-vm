#!/usr/bin/env bash
# Exact ordered binary32 comparisons over private raw words.
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_FLOAT_MASKS_EVIDENCE_DIR:-target/evidence/virgl-float-masks}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
python3 -m py_compile tools/virgl-float-masks/*.py
node --check renderer/virgl-shader/tests/float-masks.mjs
node --check tools/verify-virgl-float-masks.mjs
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh float-mask-sanitize
python3 tools/virgl-float-masks/native.py --binary renderer/virgl-shader/build/float-mask-sanitize/float-mask-test --output "$evidence_dir/native"
# Preserve the complete unchanged legacy renderer gate. The new native runner
# separately binds every retained raw/integer case and each explicit migration.
VIRGL_BANK_EVIDENCE_DIR="$evidence_dir/regression" bash tools/verify-virgl-banks.sh
node tools/virgl-constants/decoder.mjs --output "$evidence_dir/constant-regression/decoder"
node tools/verify-virgl-constants.mjs --output "$evidence_dir/constant-regression/hardware"
node tools/verify-virgl-async-jobs.mjs --output "$evidence_dir/async-regression"
node tools/verify-virgl-raw-bits.mjs --output "$evidence_dir/raw-regression/hardware"
if node tools/verify-virgl-raw-bits.mjs --output "$evidence_dir/raw-regression/sabotage" --sabotage shift-mask; then
  echo 'ERROR: corrupted shift mask escaped the retained hardware oracle' >&2
  exit 1
fi
node tools/verify-virgl-integer-masks.mjs --output "$evidence_dir/integer-regression/hardware"
for sabotage in signed-compare all-ones-mask ucmp-selection; do
  if node tools/verify-virgl-integer-masks.mjs --output "$evidence_dir/integer-regression/sabotage-$sabotage" --sabotage "$sabotage"; then
    echo "ERROR: corrupted integer lowering escaped the retained oracle: $sabotage" >&2
    exit 1
  fi
done
node tools/verify-virgl-float-masks.mjs --output "$evidence_dir/hardware"
for sabotage in unordered-guard signed-zero negative-order; do
  if node tools/verify-virgl-float-masks.mjs --output "$evidence_dir/sabotage-$sabotage" --sabotage "$sabotage"; then
    echo "ERROR: corrupted float ordering escaped the independent hardware oracle: $sabotage" >&2
    exit 1
  fi
done
python3 tools/virgl-float-masks/receipt.py "$evidence_dir"
