#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_STANDARD_RESTART_EVIDENCE_DIR:-target/evidence/virgl-standard-restart}
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
for file in renderer/virgl-command/{decoder,state}.mjs renderer/virgl-command/tests/standard-primitive-restart.mjs tools/verify-virgl-standard-restart.mjs tools/virgl-command/standard-restart-{oracle,pixels}.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/standard-restart-{receipt,cold,seal}.py
bash -n tools/verify-virgl-standard-restart.sh
# Run directly affected physical boundaries once. Historical receipts are carried
# under their original source closure, never relabeled after expanded admission.
VIRGL_STANDARD_DRAW_EVIDENCE_DIR="$evidence/retained-standard-draw" make verify-E6-T11d6
for pair in constant:generic topology:mode; do
  name=${pair%:*}
  fault=${pair#*:}
  node "tools/verify-virgl-standard-$name.mjs" --output "$evidence/retained-$name/hardware"
  if node "tools/verify-virgl-standard-$name.mjs" --output "$evidence/retained-$name/fault-$fault" --smoke true --mutation "$fault"; then
    echo 'ERROR: retained native fault escaped its pixel oracle' >&2
    exit 1
  fi
  node "tools/virgl-command/standard-$name-pixels.mjs" "$evidence/retained-$name"
done
node tools/verify-virgl-standard-restart.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-restart.mjs --output "$evidence/hardware"
if node tools/verify-virgl-standard-restart.mjs --output "$evidence/fault-restart" --smoke true --mutation restart; then
  echo 'ERROR: actual native restart mapping corruption escaped its pixel oracle' >&2
  exit 1
fi
node tools/virgl-command/standard-restart-pixels.mjs "$evidence"
set +x
printf 'STANDARD_RESTART_RECORDING_COMPLETE\n'
python3 tools/virgl-command/standard-restart-receipt.py "$evidence"
