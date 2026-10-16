#!/usr/bin/env bash
# File-specific high register banks through fixed-memory Wasm and hardware WebGL2.
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_BANK_EVIDENCE_DIR:-target/evidence/virgl-banks}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
python3 -m py_compile tools/virgl-banks/inventory.py tools/virgl-banks/native.py tools/virgl-banks/receipt.py tools/virgl-banks/cold.py
node --check renderer/virgl-shader/tests/banks.mjs
node --check tools/verify-virgl-banks.mjs
python3 tools/virgl-banks/inventory.py --output "$evidence_dir/inventory.json"
bash renderer/virgl-shader/build.sh bank-sanitize
python3 tools/virgl-banks/native.py --binary renderer/virgl-shader/build/bank-sanitize/bank-test --output "$evidence_dir/native"
# Carries all shader, flat-pair, renderer-state and original draw evidence forward.
VIRGL_PAIR_EVIDENCE_DIR="$evidence_dir/regression" bash tools/verify-virgl-pairs.sh
node tools/verify-virgl-banks.mjs --output "$evidence_dir/hardware"
if node tools/verify-virgl-banks.mjs --output "$evidence_dir/sabotage" --sabotage high-alias; then
    echo 'ERROR: high constant alias escaped the independent hardware oracle' >&2
    exit 1
fi
python3 tools/virgl-banks/receipt.py "$evidence_dir"
