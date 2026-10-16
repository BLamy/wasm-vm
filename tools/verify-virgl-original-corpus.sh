#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_ORIGINAL_CORPUS_EVIDENCE_DIR:-target/evidence/virgl-original-corpus}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
python3 tools/virgl-original-corpus/toolchain.py > "$evidence_dir/toolchain.json"
python3 -m py_compile tools/virgl-original-corpus/*.py
for file in renderer/virgl-shader/tests/original-corpus.mjs renderer/virgl-shader/tests/captured-textured-scene.mjs tools/virgl-original-corpus/*.mjs; do node --check "$file"; done
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh original-corpus-sanitize
python3 tools/virgl-original-corpus/native.py --binary renderer/virgl-shader/build/original-corpus-sanitize/original-corpus-test --output "$evidence_dir/native"
bash renderer/virgl-shader/build.sh wasm
node tools/virgl-original-corpus/wasm.mjs --native "$evidence_dir/native/report.json" --output "$evidence_dir/wasm"
node tools/virgl-original-corpus/consumer.mjs > "$evidence_dir/consumer.json"
node tools/virgl-original-corpus/verifier-regressions.mjs > "$evidence_dir/admission-regressions.json"
node tools/virgl-original-corpus/reference.mjs > "$evidence_dir/reference.json"
node tools/virgl-original-corpus/browser.mjs --output "$evidence_dir/gpu"
for seed in 430670705 2480340481; do
  node tools/virgl-original-corpus/reference.mjs "$seed" > "$evidence_dir/reference-$seed.json"
  node tools/virgl-original-corpus/browser.mjs --output "$evidence_dir/gpu-$seed" --seed "$seed"
done
python3 tools/virgl-original-corpus/verifier.py "$evidence_dir/gpu/report.json" "$evidence_dir/gpu-430670705/report.json" "$evidence_dir/gpu-2480340481/report.json" > "$evidence_dir/literal-verifier.jsonl"
python3 tools/virgl-original-corpus/faults.py --output "$evidence_dir/fault"
node tools/verify-virgl-shader.mjs --output "$evidence_dir/retained-literal"
node tools/verify-virgl-captured-shaders.mjs --output "$evidence_dir/retained-scene"
node tools/virgl-ordered-masks/browser.mjs --output "$evidence_dir/retained-mask"
node tools/virgl-precise-word/browser.mjs --output "$evidence_dir/retained-precise"
node tools/virgl-raw-equality/browser.mjs --output "$evidence_dir/retained-equality"
node tools/virgl-selected-lanes/browser.mjs --output "$evidence_dir/retained-selected"
node tools/virgl-radial-domain/browser.mjs --output "$evidence_dir/retained-radial"
node tools/virgl-raster-bank/browser.mjs --output "$evidence_dir/retained-raster"
node tools/virgl-precise-arithmetic/browser.mjs --output "$evidence_dir/retained-arithmetic"
node renderer/virgl-command/tests/precise-arithmetic-verifier-regressions.mjs > "$evidence_dir/retained-arithmetic-regressions.log"
node renderer/virgl-command/tests/raster-bank-verifier-regressions.mjs > "$evidence_dir/retained-raster-regressions.log"
python3 tools/virgl-original-corpus/receipt.py "$evidence_dir"
