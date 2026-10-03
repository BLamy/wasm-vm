#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_STATE_EVIDENCE_DIR:-target/evidence/virgl-state}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
node --check renderer/virgl-command/state.mjs
node --check renderer/virgl-command/resources.mjs
node --check renderer/virgl-command/tests/state-acceptance.mjs
node --check tools/virgl-command/state-fixtures.mjs
node --check tools/verify-virgl-object-state.mjs
python3 -m py_compile tools/virgl-command/state-receipt.py tools/virgl-command/state-cold.py
# Unchanged shader semantics carry forward; rebuild the pinned compiler for actual linkage.
bash renderer/virgl-shader/build.sh wasm
node tools/verify-virgl-command-decoder.mjs --output "$evidence_dir/decoder" --node-only true
node tools/verify-virgl-resource-transfers.mjs --output "$evidence_dir/resources" --node-only true
node tools/verify-virgl-object-state.mjs --output "$evidence_dir/hardware"
for attack in constant-bits color-mask; do
  if node tools/verify-virgl-object-state.mjs --output "$evidence_dir/sabotage-$attack" --sabotage "$attack"; then
    echo "ERROR: $attack corruption escaped the independent GL state oracle" >&2
    exit 1
  fi
done
python3 tools/virgl-command/state-receipt.py "$evidence_dir"
