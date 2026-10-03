#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_DRAW_EVIDENCE_DIR:-target/evidence/virgl-draw}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
node --check renderer/virgl-command/tests/draw-acceptance.mjs
node --check tools/virgl-command/draw-fixtures.mjs
node --check tools/verify-virgl-draw-replay.mjs
python3 -m py_compile tools/virgl-command/draw-receipt.py tools/virgl-command/draw-cold.py
# The shared state engine must retain the independently verified state-only path.
# This also builds the pinned shader bridge and runs decoder/resource regressions.
VIRGL_STATE_EVIDENCE_DIR="$evidence_dir/state" bash tools/verify-virgl-object-state.sh
node tools/verify-virgl-draw-replay.mjs --output "$evidence_dir/hardware"
for attack in vertex index texel constant blend readback-offset; do
  if node tools/verify-virgl-draw-replay.mjs --output "$evidence_dir/sabotage-$attack" --sabotage "$attack"; then
    echo "ERROR: $attack input corruption escaped the independent pixel/bounds oracle" >&2
    exit 1
  fi
done
python3 tools/virgl-command/draw-receipt.py "$evidence_dir"
