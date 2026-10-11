#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_STENCIL_EVIDENCE_DIR:-target/evidence/virgl-standard-stencil}
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
for file in renderer/virgl-command/{decoder,state}.mjs renderer/virgl-command/tests/standard-stencil{,-rig,-wire}.mjs tools/virgl-stencil/fixtures.mjs tools/verify-virgl-standard-stencil.mjs evidence/virgl-production-readiness/standard-stencil-wide-clear-gap.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-stencil/{predecessor,values,coverage,receipt,cold,seal}.py
bash -n tools/verify-virgl-standard-stencil.sh
bash renderer/virgl-shader/build.sh wasm
python3 tools/virgl-stencil/predecessor.py "$evidence"
node evidence/virgl-production-readiness/standard-stencil-wide-clear-gap.mjs "$evidence/wide-clear-original-refusals.json"
mkdir -p "$evidence/node-coverage"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-stencil.mjs --output "$evidence/wire" --node-only true
for mode in operations compares masks inactive clears absent failures; do
 node tools/verify-virgl-standard-stencil.mjs --output "$evidence/hardware-$mode" --mode "$mode"
 python3 tools/virgl-stencil/values.py "$evidence/hardware-$mode"
done
for seed in 0xd9443211 0x13579bdf 0x9e3779b9; do
 node tools/verify-virgl-standard-stencil.mjs --output "$evidence/hardware-boundaries-$seed" --mode boundaries --seed "$seed"
 python3 tools/virgl-stencil/values.py "$evidence/hardware-boundaries-$seed"
done
for fault in operation value-mask completed-output completed-stencil; do
 if node tools/verify-virgl-standard-stencil.mjs --output "$evidence/fault-$fault" --mode operations --fault "$fault" --smoke true; then echo 'ERROR: actual native stencil corruption escaped the independent inverse' >&2; exit 1; fi
 python3 tools/virgl-stencil/values.py --control "$evidence/fault-$fault"
done
node tools/verify-virgl-standard-stencil.mjs --output "$evidence/retained-packed-surfaces" --mode retained-packed-surfaces
python3 tools/virgl-packed-depth-consumer/values.py "$evidence/retained-packed-surfaces"
for mode in samples surfaces; do
 node tools/verify-virgl-standard-stencil.mjs --output "$evidence/retained-floating-$mode" --mode "retained-floating-$mode"
 python3 tools/virgl-floating-depth-consumer/values.py "$evidence/retained-floating-$mode"
done
python3 tools/virgl-stencil/coverage.py "$evidence"
set +x
printf 'STENCIL_RECORDING_COMPLETE\n'
python3 tools/virgl-stencil/receipt.py "$evidence"
