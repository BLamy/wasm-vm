#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_GEARS_SHADER_EVIDENCE_DIR:-target/evidence/virgl-gears-shaders}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
git diff --check
for file in renderer/virgl-shader/tests/gears-originals.mjs renderer/virgl-shader/tests/gears-exact-alpha.mjs tools/virgl-gears-shaders/*.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-gears-shaders/*.py
bash -n tools/verify-virgl-gears-shaders.sh
# Proof-harness boundary: compiler/runtime semantics are unchanged. Rebuild the
# affected native/wasm converter and preserve F6's unchanged numerical suite.
bash renderer/virgl-shader/build.sh native
bash renderer/virgl-shader/build.sh wasm
python3 tools/virgl-gears-shaders/provenance.py --output "$evidence_dir/provenance.json"
node tools/virgl-gears-shaders/compiler.mjs "$evidence_dir/compiler.json"
for seed in 1648868771 254715103 3281536249; do
  node tools/virgl-gears-shaders/browser.mjs --output "$evidence_dir/gpu-$seed" --seed "$seed" --provenance "$evidence_dir/provenance.json"
done
node renderer/virgl-shader/tests/gears-exact-alpha.mjs "$evidence_dir"/gpu-*/report.json
for fault in lighting auxiliary forced-alpha; do
  if node tools/virgl-gears-shaders/browser.mjs --output "$evidence_dir/fault-$fault" --fault "$fault" --provenance "$evidence_dir/provenance.json"; then
    echo "ERROR: $fault escaped the independent physical shader oracle" >&2
    exit 1
  fi
done
node tools/virgl-original-corpus/browser.mjs --output "$evidence_dir/retained-f6"
python3 tools/virgl-gears-shaders/receipt.py "$evidence_dir"
