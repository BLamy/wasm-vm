#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_ORDERED_MASK_EVIDENCE_DIR:-target/evidence/virgl-ordered-masks}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
python3 -m py_compile tools/virgl-ordered-masks/*.py
for file in renderer/virgl-command/tests/ordered-masks.mjs tools/virgl-ordered-masks/*.mjs tools/lib/virgl-browser-runner.mjs; do node --check "$file"; done
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh ordered-mask-sanitize
python3 tools/virgl-ordered-masks/native.py --binary renderer/virgl-shader/build/ordered-mask-sanitize/ordered-mask-test --output "$evidence_dir/native"
bash renderer/virgl-shader/build.sh wasm
node tools/virgl-ordered-masks/wasm.mjs --native "$evidence_dir/native/native-report.json" --output "$evidence_dir/wasm"
node tools/virgl-ordered-masks/reference.mjs > "$evidence_dir/reference.json"
node tools/virgl-ordered-masks/browser.mjs --output "$evidence_dir/gpu"
python3 tools/virgl-ordered-masks/faults.py --output "$evidence_dir/faults"
node tools/virgl-precise-word/browser.mjs --output "$evidence_dir/retained-precise"
node tools/virgl-raw-equality/browser.mjs --output "$evidence_dir/retained-equality"
node tools/virgl-selected-lanes/browser.mjs --output "$evidence_dir/retained-selected"
node tools/virgl-radial-domain/browser.mjs --output "$evidence_dir/retained-radial"
node renderer/virgl-command/tests/precise-word-regressions.mjs > "$evidence_dir/retained-precise-regressions.log"
bash renderer/virgl-shader/native_tests/precise_upstream_allocations.sh "$evidence_dir/retained-upstream" > "$evidence_dir/retained-upstream-allocations.log" 2>&1
node renderer/virgl-command/tests/radial-domain-regressions.mjs > "$evidence_dir/retained-radial-regressions.log"
python3 tools/virgl-ordered-masks/receipt.py "$evidence_dir"
