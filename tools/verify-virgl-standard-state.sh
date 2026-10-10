#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_STANDARD_STATE_EVIDENCE_DIR:-target/evidence/virgl-standard-state}
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
for file in renderer/virgl-command/{constant-domain,decoder,state}.mjs renderer/virgl-command/tests/standard-state-binding.mjs tools/verify-virgl-standard-state.mjs tools/virgl-command/standard-state-pixels.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/standard-state-{receipt,cold,seal}.py
bash -n tools/verify-virgl-standard-state.sh
# Compiler, native C and Rust/device boundaries are unchanged; retain their
# independently verified proofs. Build their actual fixed-memory compiler.
bash renderer/virgl-shader/build.sh wasm
python3 tools/virgl-92cb-geometry/capture.py "$evidence/geometry.bin" > "$evidence/geometry.log"
python3 tools/virgl-original-c580/capture-pairs.py "$evidence/c580.bin" > "$evidence/c580.log"
node tools/verify-virgl-standard-state.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-state.mjs --output "$evidence/hardware" --inputs "$evidence"
if node tools/verify-virgl-standard-state.mjs --output "$evidence/fault-suffix" --smoke true --mutation suffix; then
  echo 'ERROR: actual short-bank upload corruption escaped its independent pixel oracle' >&2
  exit 1
fi
node tools/virgl-command/standard-state-pixels.mjs "$evidence"
# Direct affected old paths, once each. Their unchanged numerical/cold/sabotage
# proofs carry forward; this submission does not repeat unrelated gate chains.
for gate in command-decoder resource-transfers object-state draw-replay async-jobs raster-depth render-cache blend-equations float-vertex-fetch; do
  node "tools/verify-virgl-$gate.mjs" --output "$evidence/retained-$gate"
done
node renderer/virgl-command/tests/blend-boundaries.mjs --output "$evidence/promoted-blend"
node renderer/virgl-command/tests/float-vertex-boundaries.mjs --output "$evidence/promoted-float"
set +x
# No later output may change the acceptance log's recorded digest.
printf 'STANDARD_STATE_RECORDING_COMPLETE\n'
python3 tools/virgl-command/standard-state-receipt.py "$evidence"
