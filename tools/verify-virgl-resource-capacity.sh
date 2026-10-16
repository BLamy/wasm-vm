#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_RESOURCE_CAPACITY_EVIDENCE_DIR:-target/evidence/virgl-resource-capacity}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
exec > >(tee "$evidence/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
set -x
git rev-parse HEAD
git diff --check
python3 tools/check_task_policy.py
node --check renderer/virgl-command/resources.mjs
node --check renderer/virgl-command/tests/standard-resource-capacity.mjs
node --check tools/verify-virgl-resource-capacity.mjs
bash -n tools/verify-virgl-resource-capacity.sh
python3 -m py_compile tools/virgl-resource-capacity/*.py
for mode in replay limits historical; do
 node tools/verify-virgl-resource-capacity.mjs --output "$evidence/hardware-$mode" --mode "$mode"
done
for seed in 0x501bc239 0x98ef03a7 0xdd31658b; do
 node tools/verify-virgl-resource-capacity.mjs --output "$evidence/hardware-lifetime-$seed" --mode lifetime --seed "$seed"
done
for fault in count bytes; do
 if node tools/verify-virgl-resource-capacity.mjs --output "$evidence/fault-$fault" --mode "fault-$fault"; then
  echo "ERROR: native $fault corruption escaped the independent oracle" >&2
  exit 1
 fi
done
VIRGL_RESOURCE_EVIDENCE_DIR="$evidence/inherited-resources" make verify-E6-T12b
python3 tools/virgl-resource-capacity/audit.py "$evidence"
python3 tools/virgl-resource-capacity/coverage.py "$evidence"
set +x
printf 'RESOURCE_CAPACITY_RECORDING_COMPLETE\n'
python3 tools/virgl-resource-capacity/receipt.py "$evidence"
