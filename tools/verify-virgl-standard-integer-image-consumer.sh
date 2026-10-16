#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_INTEGER_IMAGE_CONSUMER_EVIDENCE_DIR:-target/evidence/virgl-standard-integer-image-consumer}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
rm -f "$evidence/receipt.json"
exec > >(tee "$evidence/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
set -x
git rev-parse HEAD
git diff --check
python3 tools/check_task_policy.py
for file in renderer/virgl-command/{constant-domain,decoder,state}.mjs renderer/virgl-command/tests/standard-integer-image-{contract,consumer,consumer-rig,consumer-boundaries}.mjs tools/virgl-integer-image-consumer/fixtures.mjs tools/verify-virgl-standard-integer-image-consumer.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-integer-image-consumer/{predecessor,pixels,coverage,receipt,cold,seal}.py
bash -n tools/verify-virgl-standard-integer-image-consumer.sh
# Actual compiler/generated ABI, fixed memory, C stack and transport are unchanged:
# authenticate/reopen the complete independent D32 seals and extract that module.
python3 tools/virgl-integer-image-consumer/predecessor.py "$evidence/predecessor"
mkdir -p "$evidence/node-coverage"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-integer-image-consumer.mjs --output "$evidence/node" --node-only true --predecessor "$evidence/predecessor"
node tools/verify-virgl-standard-integer-image-consumer.mjs --output "$evidence/contracts" --mode contracts --predecessor "$evidence/predecessor"
node tools/verify-virgl-standard-integer-image-consumer.mjs --output "$evidence/hardware" --predecessor "$evidence/predecessor"
for seed in 1030219 2882400001 1629686191; do
 node tools/verify-virgl-standard-integer-image-consumer.mjs --output "$evidence/boundary-$seed" --mode boundaries --seed "$seed" --predecessor "$evidence/predecessor"
done
for fault in original-level original-words completed-output; do
 if node tools/verify-virgl-standard-integer-image-consumer.mjs --output "$evidence/fault-$fault" --fault "$fault" --predecessor "$evidence/predecessor"; then
  echo 'ERROR: physical native sabotage escaped the unchanged original word inverse' >&2
  exit 1
 fi
done
python3 tools/virgl-integer-image-consumer/pixels.py "$evidence"
node tools/verify-virgl-standard-float-consumer.mjs --output "$evidence/historical-float" --smoke true
python3 tools/virgl-integer-image-consumer/coverage.py "$evidence"
set +x
printf 'INTEGER_IMAGE_CONSUMER_RECORDING_COMPLETE\n'
python3 tools/virgl-integer-image-consumer/receipt.py "$evidence"
