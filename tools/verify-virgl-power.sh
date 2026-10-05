#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_POWER_EVIDENCE_DIR:-target/evidence/virgl-power}
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
for file in renderer/virgl-shader/tests/power.mjs tools/virgl-power/*.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-power/*.py
bash -n tools/verify-virgl-power.sh
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh power-sanitize
bash renderer/virgl-shader/build.sh native
node tools/virgl-power/native.mjs "$evidence_dir/native"
python3 tools/virgl-power/reference.py renderer/virgl-shader/build/power-primary.json renderer/virgl-shader/build/power-reference.json
bash renderer/virgl-shader/build.sh wasm
node tools/virgl-power/wasm.mjs "$evidence_dir/native/report.json" "$evidence_dir/wasm"
node tools/virgl-compiler-bounds/retained.mjs "$evidence_dir/retained"
node renderer/virgl-shader/tests/compiler-bounds-joins.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-joins-guards.json"
node renderer/virgl-shader/tests/hex-literal-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-hex-guards.json"
node renderer/virgl-shader/tests/signed-integer-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-signed-guards.json"
node renderer/virgl-shader/tests/signed-conversion-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-conversion-guards.json"
node renderer/virgl-shader/tests/scalar-operation-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-scalar-guards.json"
node renderer/virgl-shader/tests/minimum-selection-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-minimum-guards.json"
node renderer/virgl-shader/tests/precise-fraction-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-fraction-guards.json"
node renderer/virgl-shader/tests/saturation-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-saturation-guards.json"
node renderer/virgl-shader/tests/exponent-logarithm-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-exponent-guards.json"
python3 tools/virgl-power/held-saturation.py "$evidence_dir/held-saturation"
python3 tools/virgl-power/held-exponent.py "$evidence_dir/held-exponent"
python3 tools/virgl-power/held-sine.py "$evidence_dir/held-sine"
node tools/virgl-power/legacy.mjs "$evidence_dir/legacy.json"
node renderer/virgl-shader/tests/sine-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-sine-guards.json"
node tools/virgl-power/consumer.mjs "$evidence_dir/native/report.json" "$evidence_dir/consumer.json"
for seed in 608135816 2242054355 320440878; do
  node tools/virgl-power/browser.mjs --output "$evidence_dir/gpu-$seed" --seed "$seed"
done
for fault in base exponent broadcast; do
  if node tools/virgl-power/browser.mjs --output "$evidence_dir/fault-$fault" --fault "$fault"; then
    echo "ERROR: $fault corruption escaped independent hardware oracle" >&2
    exit 1
  fi
done
python3 tools/virgl-power/receipt.py "$evidence_dir"
