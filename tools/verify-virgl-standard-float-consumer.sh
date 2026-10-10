#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_FLOAT_CONSUMER_EVIDENCE_DIR:-target/evidence/virgl-standard-float-consumer}
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
for file in renderer/virgl-command/{decoder,state}.mjs renderer/virgl-command/tests/standard-float-consumer{,-rig,-boundaries}.mjs tools/verify-virgl-standard-float-consumer.mjs tools/virgl-command/standard-float-consumer-{fixtures,pixels}.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/standard-float-consumer-{pixels,receipt,coverage,cold,seal}.py
bash -n tools/verify-virgl-standard-float-consumer.sh
bash renderer/virgl-shader/build.sh wasm
mkdir -p "$evidence/node-coverage"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-float-consumer.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-float-consumer.mjs --output "$evidence/hardware-matrix"
for seed in 0xa5471e03 0x13579bdf 0x9e3779b9; do node tools/verify-virgl-standard-float-consumer.mjs --output "$evidence/hardware-boundaries-$seed" --mode boundaries --seed "$seed"; done
for fault in storage-precision linear-filter implicit-alpha; do
 if node tools/verify-virgl-standard-float-consumer.mjs --output "$evidence/fault-$fault" --fault "$fault"; then
  echo 'ERROR: wrong native floating consumer selection escaped the original inverse' >&2
  exit 1
 fi
done
python3 tools/virgl-command/standard-float-consumer-pixels.py "$evidence"
node tools/verify-virgl-async-jobs.mjs --output "$evidence/retained-async-jobs"
node tools/verify-virgl-standard-texture-operations.mjs --output "$evidence/retained-texture-consumer" --smoke true
node tools/verify-virgl-standard-byte-color-images.mjs --output "$evidence/retained-byte-colors" --smoke true
node tools/verify-virgl-standard-float-images.mjs --output "$evidence/retained-float-storage" --smoke true
python3 tools/virgl-command/standard-float-consumer-coverage.py "$evidence"
set +x
printf 'FLOAT_CONSUMER_RECORDING_COMPLETE\n'
python3 tools/virgl-command/standard-float-consumer-receipt.py "$evidence"
