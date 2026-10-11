#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_PACKED_DEPTH_CONSUMER_EVIDENCE_DIR:-target/evidence/virgl-standard-packed-depth-consumer}
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
for file in renderer/virgl-command/{decoder,state}.mjs renderer/virgl-command/tests/standard-packed-depth-consumer{,-rig}.mjs tools/virgl-packed-depth-consumer/fixtures.mjs tools/verify-virgl-standard-packed-depth-consumer.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-packed-depth-consumer/{predecessor,values,coverage,receipt,cold,seal}.py
bash -n tools/verify-virgl-standard-packed-depth-consumer.sh
bash renderer/virgl-shader/build.sh wasm
python3 tools/virgl-packed-depth-consumer/predecessor.py "$evidence"
mkdir -p "$evidence/node-coverage"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-packed-depth-consumer.mjs --output "$evidence/wire" --node-only true
for mode in samples surfaces domain failures; do node tools/verify-virgl-standard-packed-depth-consumer.mjs --output "$evidence/hardware-$mode" --mode "$mode"; done
for seed in 0xa5471e03 0x13579bdf 0x9e3779b9; do node tools/verify-virgl-standard-packed-depth-consumer.mjs --output "$evidence/hardware-boundaries-$seed" --mode boundaries --seed "$seed"; done
for fault in sample-plane completed-output depth-attachment completed-depth completed-stencil; do
 mode=samples
 if [[ "$fault" == depth-attachment || "$fault" == completed-depth || "$fault" == completed-stencil ]]; then mode=surfaces; fi
 if node tools/verify-virgl-standard-packed-depth-consumer.mjs --output "$evidence/fault-$fault" --mode "$mode" --fault "$fault" --smoke true; then echo 'ERROR: actual native packed depth consumer corruption escaped the independent inverse' >&2; exit 1; fi
done
python3 tools/virgl-packed-depth-consumer/values.py "$evidence"
for mode in samples surfaces; do
 node tools/verify-virgl-standard-unorm-depth.mjs --output "$evidence/retained-un16-$mode" --mode "$mode" --smoke true
 python3 tools/virgl-unorm-depth/values.py "$evidence/retained-un16-$mode"
 node tools/verify-virgl-standard-floating-depth-consumer.mjs --output "$evidence/retained-floating-$mode" --mode "$mode" --smoke true
 python3 tools/virgl-floating-depth-consumer/values.py "$evidence/retained-floating-$mode"
done
node tools/verify-virgl-standard-packed-depth-images.mjs --output "$evidence/retained-packed-storage" --smoke true
python3 tools/virgl-packed-depth/values.py "$evidence/retained-packed-storage"
python3 tools/virgl-packed-depth-consumer/coverage.py "$evidence"
set +x
printf 'PACKED_DEPTH_CONSUMER_RECORDING_COMPLETE\n'
python3 tools/virgl-packed-depth-consumer/receipt.py "$evidence"
