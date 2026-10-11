#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_FLOATING_DEPTH_CONSUMER_EVIDENCE_DIR:-target/evidence/virgl-standard-floating-depth-consumer}
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
python3 tools/check_task_policy.py
for file in renderer/virgl-command/{decoder,state}.mjs renderer/virgl-command/tests/standard-floating-depth-consumer{,-rig}.mjs tools/virgl-floating-depth-consumer/fixtures.mjs tools/verify-virgl-standard-floating-depth-consumer.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-floating-depth-consumer/{predecessor,values,coverage,receipt,cold,seal}.py
bash -n tools/verify-virgl-standard-floating-depth-consumer.sh
bash renderer/virgl-shader/build.sh wasm
python3 tools/virgl-floating-depth-consumer/predecessor.py "$evidence"
mkdir -p "$evidence/node-coverage"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-floating-depth-consumer.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-floating-depth-consumer.mjs --output "$evidence/hardware-samples"
node tools/verify-virgl-standard-floating-depth-consumer.mjs --output "$evidence/hardware-surfaces" --mode surfaces
for seed in 0xa5471e03 0x13579bdf 0x9e3779b9; do node tools/verify-virgl-standard-floating-depth-consumer.mjs --output "$evidence/hardware-boundaries-$seed" --mode boundaries --seed "$seed"; done
for fault in sample-plane completed-output depth-attachment completed-depth; do
 mode=samples
 if [[ "$fault" == depth-attachment || "$fault" == completed-depth ]]; then mode=surfaces; fi
 if node tools/verify-virgl-standard-floating-depth-consumer.mjs --output "$evidence/fault-$fault" --mode "$mode" --fault "$fault" --smoke true; then echo 'ERROR: actual native depth consumer corruption escaped the original inverse' >&2; exit 1; fi
done
python3 tools/virgl-floating-depth-consumer/values.py "$evidence"
for mode in historical historical-integer historical-float historical-normalized; do node tools/verify-virgl-standard-floating-depth-consumer.mjs --output "$evidence/$mode" --mode "$mode"; done
python3 tools/virgl-multiple-color/pixels.py "$evidence/historical"
python3 tools/virgl-packed-unsigned-consumer/historical.py "$evidence/historical-integer"
python3 tools/virgl-packed-unsigned-consumer/historical.py "$evidence/historical-float"
python3 tools/virgl-packed-normalized-consumer/pixels.py "$evidence/historical-normalized"
node tools/verify-virgl-standard-packed-unsigned-consumer.mjs --output "$evidence/retained-unsigned-consumer" --mode samples --smoke true
python3 tools/virgl-packed-unsigned-consumer/samples.py "$evidence/retained-unsigned-consumer"
node tools/verify-virgl-standard-packed-unsigned-consumer.mjs --output "$evidence/retained-unsigned-boundary" --mode boundaries
python3 tools/virgl-packed-unsigned-consumer/boundaries.py "$evidence/retained-unsigned-boundary"
node tools/verify-virgl-depth-formats.mjs --output "$evidence/retained-z16-consumer"
python3 tools/virgl-floating-depth-consumer/coverage.py "$evidence"
set +x
printf 'FLOATING_DEPTH_CONSUMER_RECORDING_COMPLETE\n'
python3 tools/virgl-floating-depth-consumer/receipt.py "$evidence"
