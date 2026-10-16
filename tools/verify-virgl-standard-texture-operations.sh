#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_TEXTURE_OPERATIONS_EVIDENCE_DIR:-target/evidence/virgl-standard-texture-operations}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
rm -f "$evidence/receipt.json"
exec > >(tee "$evidence/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
git diff --check
for file in renderer/virgl-command/{state,constant-domain,resources}.mjs renderer/virgl-command/tests/standard-texture-operations{,-rig,-boundaries}.mjs tools/verify-virgl-standard-texture-operations.mjs tools/virgl-command/standard-texture-operations-fixtures.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/standard-texture-operations-{pixels,receipt,coverage,cold,seal}.py
bash -n tools/verify-virgl-standard-texture-operations.sh
bash renderer/virgl-shader/build.sh wasm
mkdir -p "$evidence/node-coverage"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-texture-operations.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-texture-operations.mjs --output "$evidence/hardware-matrix"
for seed in 0xa5471e03 0x13579bdf 0x9e3779b9; do
 node tools/verify-virgl-standard-texture-operations.mjs --output "$evidence/hardware-boundaries-$seed" --mode boundaries --seed "$seed"
done
for fault in upload-channel query-levels mip-state; do
 if node tools/verify-virgl-standard-texture-operations.mjs --output "$evidence/fault-$fault" --fault "$fault"; then
  echo 'ERROR: wrong native texture/query selection escaped the completed-fence original oracle' >&2
  exit 1
 fi
done
python3 tools/virgl-command/standard-texture-operations-pixels.py "$evidence"
# Shared state/constant code is exercised by historical consumers as well.
# Unchanged C/compiler, wire/cache, storage and resource proof carry full seals.
node tools/verify-virgl-async-jobs.mjs --output "$evidence/retained-async-jobs"
node tools/verify-virgl-standard-uniform-bindings.mjs --output "$evidence/retained-uniform-bindings" --smoke true
node tools/verify-virgl-standard-byte-color-images.mjs --output "$evidence/retained-byte-colors"
python3 tools/virgl-command/standard-texture-operations-coverage.py "$evidence"
set +x
printf 'TEXTURE_OPERATIONS_RECORDING_COMPLETE\n'
python3 tools/virgl-command/standard-texture-operations-receipt.py "$evidence"
