#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_STANDARD_CONSTANT_EVIDENCE_DIR:-target/evidence/virgl-standard-constant}
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
for file in renderer/virgl-command/state.mjs renderer/virgl-command/tests/{standard-constant-attributes,standard-instanced-draws}.mjs tools/verify-virgl-standard-constant.mjs tools/virgl-command/standard-constant-{oracle,pixels}.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/standard-constant-{receipt,cold,seal}.py
bash -n tools/verify-virgl-standard-constant.sh
# Native Rust/device, decoder, compiler and ownership code remain unchanged.
# Exercise the actual independently qualified fixed-memory compiler/backend.
VIRGL_STANDARD_DRAW_EVIDENCE_DIR="$evidence/retained-standard-draw" make verify-E6-T11d6
node tools/verify-virgl-standard-constant.mjs --output "$evidence/hardware"
if node tools/verify-virgl-standard-constant.mjs --output "$evidence/fault-generic" --smoke true --mutation generic; then
  echo 'ERROR: actual native generic-value corruption escaped its independent pixel oracle' >&2
  exit 1
fi
node tools/virgl-command/standard-constant-pixels.mjs "$evidence"
set +x
printf 'STANDARD_CONSTANT_RECORDING_COMPLETE\n'
python3 tools/virgl-command/standard-constant-receipt.py "$evidence"
