#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_SINE_EVIDENCE_DIR:-target/evidence/virgl-sine}
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
for file in renderer/virgl-shader/tests/sine.mjs tools/virgl-sine/*.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-sine/*.py
bash -n tools/verify-virgl-sine.sh
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh sine-sanitize
bash renderer/virgl-shader/build.sh native
node tools/virgl-sine/native.mjs "$evidence_dir/native"
python3 tools/virgl-sine/reference.py renderer/virgl-shader/build/sine-primary.json renderer/virgl-shader/build/sine-reference.json
bash renderer/virgl-shader/build.sh wasm
node tools/virgl-sine/wasm.mjs "$evidence_dir/native/report.json" "$evidence_dir/wasm"
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
python3 tools/virgl-sine/held-saturation.py "$evidence_dir/held-saturation"
python3 tools/virgl-sine/held-exponent.py "$evidence_dir/held-exponent"
node tools/virgl-sine/legacy.mjs "$evidence_dir/legacy.json"
node tools/virgl-sine/consumer.mjs "$evidence_dir/native/report.json" "$evidence_dir/consumer.json"
for seed in 389793865 2135058973 3399354483; do
  node tools/virgl-sine/browser.mjs --output "$evidence_dir/gpu-$seed" --seed "$seed"
done
for fault in function argument broadcast; do
  if node tools/virgl-sine/browser.mjs --output "$evidence_dir/fault-$fault" --fault "$fault"; then
    echo "ERROR: $fault corruption escaped independent hardware oracle" >&2
    exit 1
  fi
done
python3 tools/virgl-sine/receipt.py "$evidence_dir"
