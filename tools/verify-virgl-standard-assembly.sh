#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_STANDARD_ASSEMBLY_EVIDENCE_DIR:-target/evidence/virgl-standard-assembly}
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
for file in renderer/virgl-command/state.mjs renderer/virgl-command/tests/standard-primitive-assembly.mjs tools/verify-virgl-standard-assembly.mjs tools/virgl-command/standard-assembly-{oracle,pixels}.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/standard-assembly-{receipt,cold,seal}.py
bash -n tools/verify-virgl-standard-assembly.sh
# Native shaders/compiler/resources/cache and historic recorded boundaries are
# unchanged. Build the actual fixed-memory compiler; run the directly affected
# historical default D9 physical boundary once, retaining its native authority.
bash renderer/virgl-shader/build.sh wasm
node tools/verify-virgl-standard-restart.mjs --output "$evidence/retained-restart/wire" --node-only true
node tools/verify-virgl-standard-restart.mjs --output "$evidence/retained-restart/hardware"
if node tools/verify-virgl-standard-restart.mjs --output "$evidence/retained-restart/fault-restart" --smoke true --mutation restart; then
  echo 'ERROR: default native marker regression escaped its original pixel oracle' >&2
  exit 1
fi
node tools/virgl-command/standard-restart-pixels.mjs "$evidence/retained-restart"
node tools/verify-virgl-standard-assembly.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-assembly.mjs --output "$evidence/hardware"
for fault in list-order provoking; do
  if node tools/verify-virgl-standard-assembly.mjs --output "$evidence/fault-$fault" --smoke true --mutation "$fault"; then
    echo 'ERROR: completed native graphics regression escaped its original pixel oracle' >&2
    exit 1
  fi
done
node tools/virgl-command/standard-assembly-pixels.mjs "$evidence"
set +x
printf 'STANDARD_ASSEMBLY_RECORDING_COMPLETE\n'
python3 tools/virgl-command/standard-assembly-receipt.py "$evidence"
