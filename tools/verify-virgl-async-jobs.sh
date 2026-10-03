#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_ASYNC_EVIDENCE_DIR:-target/evidence/virgl-async}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
node --check renderer/virgl-command/resources.mjs
node --check renderer/virgl-command/state.mjs
node --check renderer/virgl-command/tests/async-acceptance.mjs
node --check tools/verify-virgl-async-jobs.mjs
python3 -m py_compile tools/virgl-command/async-receipt.py tools/virgl-command/async-cold.py
# Shader/decoder semantics are unchanged. Build the pinned compiler once, then
# exercise each affected synchronous resource/state/draw path directly.
bash renderer/virgl-shader/build.sh wasm
node tools/verify-virgl-command-decoder.mjs --output "$evidence_dir/regression/decoder" --node-only true
node tools/verify-virgl-resource-transfers.mjs --output "$evidence_dir/regression/resources"
node tools/verify-virgl-object-state.mjs --output "$evidence_dir/regression/state"
node tools/verify-virgl-draw-replay.mjs --output "$evidence_dir/regression/draw"
node tools/verify-virgl-async-jobs.mjs --output "$evidence_dir/hardware"
for attack in early-collect index-class; do
  if node tools/verify-virgl-async-jobs.mjs --output "$evidence_dir/sabotage-$attack" --sabotage "$attack"; then
    echo "ERROR: $attack escaped the asynchronous GPU sequencing oracle" >&2
    exit 1
  fi
done
python3 tools/virgl-command/async-receipt.py "$evidence_dir"
