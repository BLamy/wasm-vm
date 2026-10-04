#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_EXPONENT_LOGARITHM_EVIDENCE_DIR:-target/evidence/virgl-exponent-logarithm}
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
for file in renderer/virgl-shader/tests/exponent-logarithm.mjs renderer/virgl-shader/tests/exponent-logarithm-regressions.mjs tools/virgl-exponent-logarithm/*.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-exponent-logarithm/*.py
python3 -m py_compile renderer/virgl-shader/tests/exponent-logarithm-capture-regressions.py
bash -n tools/verify-virgl-exponent-logarithm.sh
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh exponent-logarithm-sanitize
bash renderer/virgl-shader/build.sh native
node tools/virgl-exponent-logarithm/native.mjs "$evidence_dir/native"
python3 tools/virgl-exponent-logarithm/reference.py renderer/virgl-shader/build/exponent-logarithm-primary.json renderer/virgl-shader/build/exponent-logarithm-reference.json
bash renderer/virgl-shader/build.sh wasm
node tools/virgl-exponent-logarithm/wasm.mjs "$evidence_dir/native/report.json" "$evidence_dir/wasm"
node renderer/virgl-shader/tests/exponent-logarithm-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-exponent-guards.json"
node tools/virgl-compiler-bounds/retained.mjs "$evidence_dir/retained"
node renderer/virgl-shader/tests/compiler-bounds-joins.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-joins-guards.json"
node renderer/virgl-shader/tests/hex-literal-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-hex-guards.json"
node renderer/virgl-shader/tests/signed-integer-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-signed-guards.json"
node renderer/virgl-shader/tests/signed-conversion-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-conversion-guards.json"
node renderer/virgl-shader/tests/scalar-operation-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-scalar-guards.json"
node renderer/virgl-shader/tests/minimum-selection-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-minimum-guards.json"
node renderer/virgl-shader/tests/precise-fraction-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-fraction-guards.json"
node renderer/virgl-shader/tests/saturation-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-saturation-guards.json"
python3 tools/virgl-exponent-logarithm/held-saturation.py "$evidence_dir/held-saturation"
node tools/virgl-exponent-logarithm/legacy.mjs "$evidence_dir/legacy.json"
node tools/virgl-exponent-logarithm/consumer.mjs "$evidence_dir/native/report.json" "$evidence_dir/consumer.json"
for seed in 674984393 1907114211 3590947451; do
  node tools/virgl-exponent-logarithm/browser.mjs --output "$evidence_dir/gpu-$seed" --seed "$seed"
  python3 renderer/virgl-shader/tests/exponent-logarithm-capture-regressions.py --report "$evidence_dir/gpu-$seed/report.json" --output "$evidence_dir/gpu-$seed/source-guards.json"
done
for fault in ex2 lg2 broadcast; do
  if node tools/virgl-exponent-logarithm/browser.mjs --output "$evidence_dir/fault-$fault" --fault "$fault"; then
    echo "ERROR: $fault corruption escaped independent hardware oracle" >&2
    exit 1
  fi
  if python3 renderer/virgl-shader/tests/exponent-logarithm-capture-regressions.py --report "$evidence_dir/fault-$fault/report.json" --output "$evidence_dir/fault-$fault/source-guards.json"; then
    echo "ERROR: $fault corruption escaped promoted source-equation guard" >&2
    exit 1
  fi
done
python3 tools/virgl-exponent-logarithm/receipt.py "$evidence_dir"
