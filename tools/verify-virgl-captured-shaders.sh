#!/usr/bin/env bash
# Complete isolated frontend gate; production guest GPU remains disabled.
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_CAPTURED_SHADER_EVIDENCE_DIR:-target/evidence/virgl-captured-shaders}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
set -x
git rev-parse HEAD
python3 -m py_compile tools/virgl-captured-shaders/native.py tools/virgl-captured-shaders/receipt.py tools/virgl-contract/verify.py
python3 -m unittest discover -s tools/virgl-contract -p 'test_*.py' -v
node --check tools/lib/virgl-browser-runner.mjs
node --check tools/verify-virgl-shader.mjs
node --check tools/verify-virgl-captured-shaders.mjs
node --check renderer/virgl-shader/tests/captured-textured-scene.mjs
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh native
bash renderer/virgl-shader/build.sh sanitize
bash renderer/virgl-shader/build.sh captured-sanitize
python3 tools/virgl-captured-shaders/native.py --binary renderer/virgl-shader/build/captured-sanitize/captured-test --output "$evidence_dir/native"
bash renderer/virgl-shader/build.sh wasm
node tools/verify-virgl-shader.mjs --output "$evidence_dir/literal"
node tools/verify-virgl-captured-shaders.mjs --output "$evidence_dir/captured"
if node tools/verify-virgl-captured-shaders.mjs --output "$evidence_dir/sabotage" --sabotage texture-texel; then
    echo 'ERROR: texture sabotage falsely passed' >&2
    exit 1
fi
node tools/verify-virgl-contract-browser.mjs --output "$evidence_dir/contract/browser"
python3 tools/virgl-contract/verify.py --browser-report "$evidence_dir/contract/browser/report.json" --output "$evidence_dir/contract/receipt.json"
python3 tools/virgl-captured-shaders/receipt.py "$evidence_dir"
