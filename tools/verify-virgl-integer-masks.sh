#!/usr/bin/env bash
# Private wrapping integer arithmetic, signed masks and raw selection.
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_INTEGER_MASKS_EVIDENCE_DIR:-target/evidence/virgl-integer-masks}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
python3 -m py_compile tools/virgl-integer-masks/*.py
node --check renderer/virgl-shader/tests/integer-masks.mjs
node --check tools/verify-virgl-integer-masks.mjs
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh integer-mask-sanitize
python3 tools/virgl-integer-masks/native.py --binary renderer/virgl-shader/build/integer-mask-sanitize/integer-mask-test --output "$evidence_dir/native"
# Rebuild and execute all prior raw-word, legacy, constant and async proofs.
VIRGL_RAW_BITS_EVIDENCE_DIR="$evidence_dir/raw-regression" bash tools/verify-virgl-raw-bits.sh
node tools/verify-virgl-integer-masks.mjs --output "$evidence_dir/hardware"
for sabotage in signed-compare all-ones-mask ucmp-selection; do
  if node tools/verify-virgl-integer-masks.mjs --output "$evidence_dir/sabotage-$sabotage" --sabotage "$sabotage"; then
    echo "ERROR: wrong integer lowering escaped the independent hardware oracle: $sabotage" >&2
    exit 1
  fi
done
python3 tools/virgl-integer-masks/receipt.py "$evidence_dir"
