#!/usr/bin/env bash
# Contract/prototype gate; does not enable or deploy a guest renderer.
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_CONTRACT_EVIDENCE_DIR:-target/evidence/virgl-contract}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
set -x
git rev-parse HEAD
python3 -m py_compile tools/virgl-contract/verify.py tools/virgl-contract/test_verify.py
python3 -m unittest discover -s tools/virgl-contract -p 'test_*.py' -v
node --check tools/verify-virgl-contract-browser.mjs
node --check renderer/virgl-contract/browser.mjs
bash renderer/virgl-shader/build.sh native
bash renderer/virgl-shader/build.sh wasm
node tools/verify-virgl-contract-browser.mjs --output "$evidence_dir/browser"
python3 tools/virgl-contract/verify.py --browser-report "$evidence_dir/browser/report.json" --output "$evidence_dir/receipt.json"
