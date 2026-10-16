#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_PRECISE_FRACTION_EVIDENCE_DIR:-target/evidence/virgl-precise-fraction}
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
for file in renderer/virgl-shader/tests/precise-fraction.mjs tools/virgl-precise-fraction/*.mjs; do node --check "$file"; done
node --check renderer/virgl-shader/tests/fraction-banks.mjs
python3 -m py_compile tools/virgl-precise-fraction/*.py
bash -n tools/verify-virgl-precise-fraction.sh
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh precise-fraction-sanitize
bash renderer/virgl-shader/build.sh native
node tools/virgl-precise-fraction/native.mjs "$evidence_dir/native"
bash renderer/virgl-shader/build.sh wasm
node tools/virgl-precise-fraction/wasm.mjs "$evidence_dir/native/report.json" "$evidence_dir/wasm"
node tools/virgl-compiler-bounds/retained.mjs "$evidence_dir/retained"
node renderer/virgl-shader/tests/compiler-bounds-joins.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-joins.json"
node renderer/virgl-shader/tests/hex-literal-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-hex-guards.json"
node renderer/virgl-shader/tests/signed-integer-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-signed-guards.json"
node renderer/virgl-shader/tests/signed-conversion-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-conversion-guards.json"
node renderer/virgl-shader/tests/scalar-operation-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-scalar-guards.json"
node renderer/virgl-shader/tests/minimum-selection-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-minimum-guards.json"
node tools/virgl-precise-fraction/legacy.mjs "$evidence_dir/legacy.json"
node tools/virgl-precise-fraction/consumer.mjs "$evidence_dir/native/report.json" "$evidence_dir/consumer.json"
for seed in 1369979863 2804203833 3781791491; do
  node tools/virgl-precise-fraction/browser.mjs --output "$evidence_dir/gpu-$seed" --seed "$seed"
done
for fault in negative rounding special; do
  if node tools/virgl-precise-fraction/browser.mjs --output "$evidence_dir/fault-$fault" --fault "$fault"; then
    echo "ERROR: $fault corruption escaped independent hardware oracle" >&2
    exit 1
  fi
done
python3 tools/virgl-precise-fraction/receipt.py "$evidence_dir"
