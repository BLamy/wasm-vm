#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_STANDARD_DRAW_EVIDENCE_DIR:-target/evidence/virgl-standard-draw}
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
for file in renderer/virgl-command/{decoder,state}.mjs renderer/virgl-command/tests/standard-instanced-draws.mjs tools/verify-virgl-standard-draw.mjs tools/virgl-command/standard-draw-{oracle,pixels}.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/standard-draw-{receipt,cold,seal}.py
bash -n tools/verify-virgl-standard-draw.sh
# The compiler, Rust/device, constants and ownership boundaries are unchanged.
# Build and execute the actual independently verified fixed-memory compiler.
bash renderer/virgl-shader/build.sh wasm
node tools/verify-virgl-standard-draw.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-draw.mjs --output "$evidence/hardware"
if node tools/verify-virgl-standard-draw.mjs --output "$evidence/fault-divisor" --smoke true --mutation divisor; then
  echo 'ERROR: actual native divisor corruption escaped its independent pixel oracle' >&2
  exit 1
fi
node tools/virgl-command/standard-draw-pixels.mjs "$evidence"
for gate in command-decoder draw-replay async-jobs float-vertex-fetch; do
  node "tools/verify-virgl-$gate.mjs" --output "$evidence/retained-$gate"
done
set +x
printf 'STANDARD_DRAW_RECORDING_COMPLETE\n'
python3 tools/virgl-command/standard-draw-receipt.py "$evidence"
