#!/usr/bin/env bash
# Bounded two-stage interpolation and owned renderer variants on hardware WebGL2.
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_PAIR_EVIDENCE_DIR:-target/evidence/virgl-pairs}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
python3 -m py_compile tools/virgl-pairs/native.py tools/virgl-pairs/receipt.py tools/virgl-pairs/cold.py
node --check renderer/virgl-command/state.mjs
node --check renderer/virgl-shader/tests/pairs.mjs
node --check renderer/virgl-command/tests/flat-pairs.mjs
node --check tools/verify-virgl-pairs.mjs
# Preserve original/literal/component shader pixels and sanitizer boundaries.
VIRGL_COMPONENT_EVIDENCE_DIR="$evidence_dir/components" bash tools/verify-virgl-components.sh
# Preserve the shared state engine and all original captured draw oracles.
VIRGL_DRAW_EVIDENCE_DIR="$evidence_dir/draw" bash tools/verify-virgl-draw-replay.sh
bash renderer/virgl-shader/build.sh pair-sanitize
python3 tools/virgl-pairs/native.py --binary renderer/virgl-shader/build/pair-sanitize/pair-test --output "$evidence_dir/native"
node tools/verify-virgl-pairs.mjs --output "$evidence_dir/hardware"
if node tools/verify-virgl-pairs.mjs --output "$evidence_dir/sabotage" --sabotage flat-reuse; then
    echo 'ERROR: stale smooth-program reuse escaped the flat pixel oracle' >&2
    exit 1
fi
python3 tools/virgl-pairs/receipt.py "$evidence_dir"
