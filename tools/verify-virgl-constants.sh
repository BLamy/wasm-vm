#!/usr/bin/env bash
# Bounded guest constant transport through the actual sync/async state engine.
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_CONSTANT_EVIDENCE_DIR:-target/evidence/virgl-constants}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
node --check renderer/virgl-command/decoder.mjs
node --check renderer/virgl-command/state.mjs
node --check renderer/virgl-command/tests/constants.mjs
node --check tools/verify-virgl-constants.mjs
node --check tools/virgl-constants/decoder.mjs
python3 -m py_compile tools/virgl-constants/native.py tools/virgl-constants/receipt.py tools/virgl-constants/cold.py
# The compiler and its fixed-memory frontend are unchanged from verified E3.
# Translate all exact new hardware strings and the original nineteen bodies.
bash renderer/virgl-shader/build.sh native
python3 tools/virgl-constants/native.py --binary renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/native"
node tools/virgl-constants/decoder.mjs --output "$evidence_dir/decoder"
# Exercise every shared renderer path, including original captures and fence controls.
VIRGL_ASYNC_EVIDENCE_DIR="$evidence_dir/regression" bash tools/verify-virgl-async-jobs.sh
node tools/verify-virgl-pairs.mjs --output "$evidence_dir/flat-regression"
node tools/verify-virgl-constants.mjs --output "$evidence_dir/hardware"
if node tools/verify-virgl-constants.mjs --output "$evidence_dir/sabotage" --sabotage high-upload; then
  echo 'ERROR: truncated high constant upload escaped the independent pixel oracle' >&2
  exit 1
fi
python3 tools/virgl-constants/receipt.py "$evidence_dir"
