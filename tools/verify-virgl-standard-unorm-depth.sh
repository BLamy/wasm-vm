#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_UNORM_DEPTH_EVIDENCE_DIR:-target/evidence/virgl-standard-unorm-depth}
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
for file in renderer/virgl-command/{decoder,state,resources,unorm-depth-images}.mjs renderer/virgl-command/tests/standard-unorm-depth{,-rig,-transfers}.mjs tools/virgl-unorm-depth/fixtures.mjs tools/verify-virgl-standard-unorm-depth.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-unorm-depth/{predecessor,values,transfers,lifetimes,coverage,receipt,cold,seal}.py
bash -n tools/verify-virgl-standard-unorm-depth.sh
bash renderer/virgl-shader/build.sh wasm
python3 tools/virgl-unorm-depth/predecessor.py "$evidence"
mkdir -p "$evidence/node-coverage"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-unorm-depth.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-unorm-depth.mjs --output "$evidence/hardware-samples"
node tools/verify-virgl-standard-unorm-depth.mjs --output "$evidence/hardware-surfaces" --mode surfaces
node tools/verify-virgl-standard-unorm-depth.mjs --output "$evidence/hardware-domain" --mode domain
node tools/verify-virgl-standard-unorm-depth.mjs --output "$evidence/hardware-transfers" --mode transfers
for seed in 0xa5471e03 0x13579bdf 0x9e3779b9; do node tools/verify-virgl-standard-unorm-depth.mjs --output "$evidence/hardware-boundaries-$seed" --mode boundaries --seed "$seed"; done
for fault in sample-plane completed-output depth-attachment completed-depth; do
 mode=samples
 if [[ "$fault" == depth-attachment || "$fault" == completed-depth ]]; then mode=surfaces; fi
 if node tools/verify-virgl-standard-unorm-depth.mjs --output "$evidence/fault-$fault" --mode "$mode" --fault "$fault" --smoke true; then echo 'ERROR: actual native depth consumer corruption escaped the original inverse' >&2; exit 1; fi
done
python3 tools/virgl-unorm-depth/values.py "$evidence"
for mode in historical historical-integer historical-float historical-normalized; do node tools/verify-virgl-standard-unorm-depth.mjs --output "$evidence/$mode" --mode "$mode"; done
python3 tools/virgl-multiple-color/pixels.py "$evidence/historical"
python3 tools/virgl-packed-unsigned-consumer/historical.py "$evidence/historical-integer"
python3 tools/virgl-packed-unsigned-consumer/historical.py "$evidence/historical-float"
python3 tools/virgl-packed-normalized-consumer/pixels.py "$evidence/historical-normalized"
node tools/verify-virgl-standard-packed-unsigned-consumer.mjs --output "$evidence/retained-unsigned-consumer" --mode samples --smoke true
python3 tools/virgl-packed-unsigned-consumer/samples.py "$evidence/retained-unsigned-consumer"
node tools/verify-virgl-standard-packed-unsigned-consumer.mjs --output "$evidence/retained-unsigned-boundary" --mode boundaries
python3 tools/virgl-packed-unsigned-consumer/boundaries.py "$evidence/retained-unsigned-boundary"
node tools/verify-virgl-standard-unorm-depth.mjs --output "$evidence/retained-z16-consumer" --mode retained-z16-consumer
for mode in samples surfaces boundaries; do
 node tools/verify-virgl-standard-unorm-depth.mjs --output "$evidence/retained-floating-$mode" --mode "retained-floating-$mode" --smoke true
 python3 tools/virgl-floating-depth-consumer/values.py "$evidence/retained-floating-$mode"
done
python3 tools/virgl-unorm-depth/coverage.py "$evidence"
set +x
printf 'UNORM_DEPTH_RECORDING_COMPLETE\n'
python3 tools/virgl-unorm-depth/receipt.py "$evidence"
