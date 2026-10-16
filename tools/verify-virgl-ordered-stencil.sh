#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_ORDERED_STENCIL_EVIDENCE_DIR:-target/evidence/virgl-ordered-stencil}
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
for file in renderer/virgl-command/{decoder,state}.mjs renderer/virgl-command/tests/standard-ordered-stencil{,-rig}.mjs tools/virgl-ordered-stencil/{fixtures,oracle,boundaries,values}.mjs tools/verify-virgl-ordered-stencil.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-ordered-stencil/{predecessor,physical,coverage,receipt,cold,seal}.py
bash -n tools/verify-virgl-ordered-stencil.sh
bash renderer/virgl-shader/build.sh wasm
python3 tools/virgl-ordered-stencil/predecessor.py "$evidence"
mkdir -p "$evidence/node-coverage"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-ordered-stencil.mjs --output "$evidence/wire" --node-only true
for mode in matrix functions segments failures limits absent; do
 node tools/verify-virgl-ordered-stencil.mjs --output "$evidence/hardware-$mode" --mode "$mode"
 node tools/virgl-ordered-stencil/values.mjs "$evidence/hardware-$mode"
 python3 tools/virgl-ordered-stencil/physical.py "$evidence/hardware-$mode"
done
for seed in 0xd9453211 0x13579bdf 0x9e3779b9; do
 node tools/verify-virgl-ordered-stencil.mjs --output "$evidence/hardware-boundaries-$seed" --mode boundaries --seed "$seed"
 node tools/virgl-ordered-stencil/values.mjs "$evidence/hardware-boundaries-$seed"
 python3 tools/virgl-ordered-stencil/physical.py "$evidence/hardware-boundaries-$seed"
done
for fault in order operation value-mask completed-output completed-stencil; do
 if node tools/verify-virgl-ordered-stencil.mjs --output "$evidence/fault-$fault" --mode matrix --fault "$fault" --smoke true; then echo 'ERROR: completed original native stencil corruption escaped the inverse' >&2; exit 1; fi
 node tools/virgl-ordered-stencil/values.mjs "$evidence/fault-$fault" --control
done
node tools/verify-virgl-ordered-stencil.mjs --output "$evidence/retained-common" --mode retained-common
python3 tools/virgl-stencil/values.py "$evidence/retained-common"
node tools/verify-virgl-ordered-stencil.mjs --output "$evidence/retained-assembly/hardware" --mode retained-assembly
node tools/virgl-ordered-stencil/retained-assembly-values.mjs "$evidence/retained-assembly"
python3 tools/virgl-ordered-stencil/coverage.py "$evidence"
set +x
printf 'ORDERED_STENCIL_RECORDING_COMPLETE\n'
python3 tools/virgl-ordered-stencil/receipt.py "$evidence"
