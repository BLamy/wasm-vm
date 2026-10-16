#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
evidence=${VIRGL_RESOURCE_CAPACITY_CRITIC_DIR:-target/evidence/virgl-resource-capacity-critic}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
exec > >(tee "$evidence/critic.log") 2>&1
git diff --check
python3 tools/check_task_policy.py
node --check tools/virgl-resource-capacity/critic-native.mjs
bash -n tools/virgl-resource-capacity/critic.sh
python3 -m py_compile tools/virgl-resource-capacity/critic.py
for mode in replay limits historical; do
 node tools/verify-virgl-resource-capacity.mjs --output "$evidence/fresh/$mode" --mode "$mode"
done
for seed in 0x73a9e20d 0xb48f1637 0x0c62d5ab; do
 node tools/verify-virgl-resource-capacity.mjs --output "$evidence/fresh/lifetime-$seed" --mode lifetime --seed "$seed"
done
for fault in count bytes; do
 if node tools/verify-virgl-resource-capacity.mjs --output "$evidence/fresh/fault-$fault" --mode "fault-$fault"; then
  echo "ERROR: $fault sabotage escaped the independent oracle" >&2
  exit 1
 fi
done
node tools/virgl-resource-capacity/critic-native.mjs --output "$evidence/fresh/novel"
VIRGL_RESOURCE_EVIDENCE_DIR="$evidence/inherited-resources" make verify-E6-T12b
python3 tools/virgl-resource-capacity/critic.py --output "$evidence/worker-audit.json" --fresh "$evidence/fresh"
