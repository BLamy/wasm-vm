#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_MULTIPLE_COLOR_EVIDENCE_DIR:-target/evidence/virgl-standard-multiple-color}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
rm -f "$evidence/receipt.json"
exec > >(tee "$evidence/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
set -x
git rev-parse HEAD
git diff --check
python3 tools/check_task_policy.py
for file in renderer/virgl-command/{constant-domain,decoder,state}.mjs renderer/virgl-command/tests/standard-multiple-color{,-rig,-boundaries,-contract}.mjs tools/virgl-multiple-color/fixtures.mjs tools/verify-virgl-standard-multiple-color.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-multiple-color/{predecessor,pixels,boundaries,coverage,receipt,cold,seal}.py
bash -n tools/verify-virgl-standard-multiple-color.sh
# Reopen both complete D33 seals and the unchanged actual C/Wasm dependency.
python3 tools/virgl-multiple-color/predecessor.py "$evidence/predecessor"
mkdir -p "$evidence/node-coverage"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-multiple-color.mjs --output "$evidence/node" --node-only true --predecessor "$evidence/predecessor"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-integer-image-consumer.mjs --output "$evidence/historical-integer" --node-only true --predecessor "$evidence/predecessor"
node tools/verify-virgl-standard-integer-image-consumer.mjs --output "$evidence/historical-integer-native" --smoke true --predecessor "$evidence/predecessor"
node tools/verify-virgl-standard-multiple-color.mjs --output "$evidence/contracts" --mode contracts --predecessor "$evidence/predecessor"
node tools/verify-virgl-standard-multiple-color.mjs --output "$evidence/hardware" --predecessor "$evidence/predecessor"
python3 tools/virgl-multiple-color/pixels.py "$evidence/hardware"
for seed in 1030219 2882400001 1629686191; do
 node tools/verify-virgl-standard-multiple-color.mjs --output "$evidence/boundary-$seed" --mode boundaries --seed "$seed" --predecessor "$evidence/predecessor"
 python3 tools/virgl-multiple-color/boundaries.py "$evidence/boundary-$seed"
done
for fault in nonzero-attachment completed-output; do
 if node tools/verify-virgl-standard-multiple-color.mjs --output "$evidence/fault-$fault" --fault "$fault" --predecessor "$evidence/predecessor"; then
  echo 'ERROR: physical nonzero target sabotage escaped the unchanged original inverse' >&2
  exit 1
 fi
 python3 tools/virgl-multiple-color/pixels.py "$evidence/fault-$fault" --control
done
node tools/verify-virgl-standard-float-consumer.mjs --output "$evidence/historical-float" --smoke true
node tools/verify-virgl-blend-equations.mjs --output "$evidence/historical-blend"
python3 tools/virgl-multiple-color/coverage.py "$evidence"
set +x
printf 'MULTIPLE_COLOR_RECORDING_COMPLETE\n'
python3 tools/virgl-multiple-color/receipt.py "$evidence"
