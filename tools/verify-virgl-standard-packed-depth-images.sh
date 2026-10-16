#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_PACKED_DEPTH_EVIDENCE_DIR:-target/evidence/virgl-standard-packed-depth-images}
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
for file in renderer/virgl-command/{resources,unorm-depth-images,floating-depth-gpu}.mjs renderer/virgl-command/tests/standard-packed-depth-{images,rig,wire,boundaries,domain}.mjs tools/virgl-packed-depth/fixtures.mjs tools/verify-virgl-standard-packed-depth-images.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-packed-depth/{predecessor,values,events,coverage,receipt,cold,seal}.py
bash -n tools/verify-virgl-standard-packed-depth-images.sh
bash renderer/virgl-shader/build.sh wasm
python3 tools/virgl-packed-depth/predecessor.py "$evidence"
mkdir -p "$evidence/node-coverage"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-packed-depth-images.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-packed-depth-images.mjs --output "$evidence/hardware-matrix"
node tools/verify-virgl-standard-packed-depth-images.mjs --output "$evidence/hardware-domain" --mode domain
for seed in 0xa5471e03 0x13579bdf 0x9e3779b9; do node tools/verify-virgl-standard-packed-depth-images.mjs --output "$evidence/hardware-boundaries-$seed" --mode boundaries --seed "$seed"; done
for fault in depth-precision stencil-selection completed-depth completed-stencil; do
 if node tools/verify-virgl-standard-packed-depth-images.mjs --output "$evidence/fault-$fault" --fault "$fault" --smoke true; then echo 'ERROR: actual native packed depth/stencil corruption escaped the original inverse' >&2; exit 1; fi
done
python3 tools/virgl-packed-depth/values.py "$evidence"
python3 tools/virgl-packed-depth/events.py "$evidence"
for mode in samples surfaces transfers; do node tools/verify-virgl-standard-unorm-depth.mjs --output "$evidence/retained-un16-$mode" --mode "$mode"; python3 tools/virgl-unorm-depth/values.py "$evidence/retained-un16-$mode"; done
node tools/verify-virgl-standard-floating-depth-images.mjs --output "$evidence/retained-floating-storage"
for mode in samples surfaces; do node tools/verify-virgl-standard-unorm-depth.mjs --output "$evidence/retained-floating-$mode" --mode "retained-floating-$mode" --smoke true; python3 tools/virgl-floating-depth-consumer/values.py "$evidence/retained-floating-$mode"; done
node tools/verify-virgl-depth-formats.mjs --output "$evidence/retained-z16-consumer"
python3 tools/virgl-packed-depth/coverage.py "$evidence"
set +x
printf 'PACKED_DEPTH_RECORDING_COMPLETE\n'
python3 tools/virgl-packed-depth/receipt.py "$evidence"
