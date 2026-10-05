#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_KNOWN_ARITHMETIC_EVIDENCE_DIR:-target/evidence/virgl-known-arithmetic}
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
for file in renderer/virgl-shader/tests/known-arithmetic.mjs tools/virgl-known-arithmetic/*.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-known-arithmetic/*.py
bash -n tools/verify-virgl-known-arithmetic.sh
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh known-arithmetic-sanitize
bash renderer/virgl-shader/build.sh native
node tools/virgl-known-arithmetic/native.mjs "$evidence_dir/native"
bash renderer/virgl-shader/build.sh wasm
node tools/virgl-known-arithmetic/wasm.mjs "$evidence_dir/native/report.json" "$evidence_dir/wasm"
node tools/virgl-known-arithmetic/consumer.mjs "$evidence_dir/native/report.json" "$evidence_dir/consumer.json"
node tools/virgl-known-arithmetic/legacy.mjs "$evidence_dir/legacy.json"
for seed in 1779033703 3144134277 1013904242; do
  node tools/virgl-known-arithmetic/browser.mjs --output "$evidence_dir/gpu-$seed" --seed "$seed"
  python3 tools/virgl-known-arithmetic/capture-check.py "$evidence_dir/gpu-$seed/report.json" "$evidence_dir/capture-$seed.json"
done
for fault in word shadow; do
  if node tools/virgl-known-arithmetic/browser.mjs --output "$evidence_dir/fault-$fault" --fault "$fault"; then
    echo "ERROR: $fault source corruption escaped physical predictions" >&2
    exit 1
  fi
  python3 tools/virgl-known-arithmetic/capture-check.py "$evidence_dir/fault-$fault/report.json" "$evidence_dir/capture-fault-$fault.json"
done
python3 tools/virgl-known-arithmetic/receipt.py "$evidence_dir"
