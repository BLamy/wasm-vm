#!/usr/bin/env bash
# Conditional metadata and immutable finite raw banks at actual renderer draws.
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_CONSTANT_DOMAIN_EVIDENCE_DIR:-target/evidence/virgl-constant-domains}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
node --check renderer/virgl-command/constant-domain.mjs
node --check renderer/virgl-command/state.mjs
node --check renderer/virgl-command/tests/constant-domains.mjs
node --check tools/verify-virgl-constant-domains.mjs
node --check tools/virgl-constant-domains/unit.mjs
python3 -m py_compile tools/virgl-constant-domains/*.py
node tools/virgl-constant-domains/unit.mjs --output "$evidence_dir/unit"
# No compiler semantic change: preserve native full results and prove every new
# authored hardware body through the same built native/Wasm implementations.
bash renderer/virgl-shader/build.sh native
python3 tools/virgl-constant-domains/native.py --binary renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/native"
python3 tools/virgl-constants/native.py --binary renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/legacy/native"
node tools/virgl-constants/decoder.mjs --output "$evidence_dir/legacy/decoder"
# This is the complete affected predecessor runtime gate and its fault controls.
# The new named compatibility receipt preserves the older compiler-pinned receipt.
VIRGL_ASYNC_EVIDENCE_DIR="$evidence_dir/legacy/regression" bash tools/verify-virgl-async-jobs.sh
node tools/verify-virgl-pairs.mjs --output "$evidence_dir/legacy/flat-regression"
node tools/verify-virgl-constants.mjs --output "$evidence_dir/legacy/hardware"
if node tools/verify-virgl-constants.mjs --output "$evidence_dir/legacy/sabotage" --sabotage high-upload; then
  echo 'ERROR: shortened high constant upload escaped the predecessor pixel oracle' >&2
  exit 1
fi
node tools/verify-virgl-constant-domains.mjs --output "$evidence_dir/hardware"
node tools/verify-virgl-constant-domains.mjs --output "$evidence_dir/decoder-bypass" --mode decoder-bypass
if node tools/verify-virgl-constant-domains.mjs --output "$evidence_dir/sabotage" --mode decoder-and-guard-bypass; then
  echo 'ERROR: an actual invalid upload escaped the independent constant-domain oracle' >&2
  exit 1
fi
python3 tools/virgl-constant-domains/receipt.py "$evidence_dir"
