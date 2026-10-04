#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_COMPILER_BOUNDS_EVIDENCE_DIR:-target/evidence/virgl-compiler-bounds}
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
for file in renderer/virgl-shader/tests/compiler-bounds.mjs tools/virgl-compiler-bounds/*.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-compiler-bounds/*.py
bash -n tools/verify-virgl-compiler-bounds.sh
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh compiler-bounds-sanitize
bash renderer/virgl-shader/build.sh native
node tools/virgl-compiler-bounds/native.mjs "$evidence_dir/native"
bash renderer/virgl-shader/build.sh wasm
bash renderer/virgl-shader/build.sh compiler-bounds-wasm-stack
mkdir -p "$evidence_dir/stack"
cp renderer/virgl-shader/build/compiler-bounds-sanitize/compiler_bounds.su "$evidence_dir/stack/native.su"
cp renderer/virgl-shader/build/compiler-bounds-wasm-stack/*.su "$evidence_dir/stack/"
node tools/virgl-compiler-bounds/wasm.mjs "$evidence_dir/native/report.json" "$evidence_dir/wasm"
node tools/virgl-compiler-bounds/retained.mjs "$evidence_dir/retained"
# Affected historical compiler/profile and pair boundaries, including their
# unchanged original shaders. Carry unrelated renderer leaf recordings forward.
bash renderer/virgl-shader/build.sh original-corpus-sanitize
python3 tools/virgl-original-corpus/native.py --binary renderer/virgl-shader/build/original-corpus-sanitize/original-corpus-test --output "$evidence_dir/retained-f6-native"
node tools/virgl-original-corpus/wasm.mjs --native "$evidence_dir/retained-f6-native/report.json" --output "$evidence_dir/retained-f6-wasm"
node renderer/virgl-command/tests/precise-word-regressions.mjs > "$evidence_dir/precise-word-regressions.log"
node tools/virgl-original-corpus/consumer.mjs > "$evidence_dir/retained-consumer.json"
node tools/virgl-original-corpus/browser.mjs --output "$evidence_dir/retained-f6-gpu"
python3 tools/virgl-gears-shaders/provenance.py --output "$evidence_dir/gears-provenance.json"
node tools/virgl-gears-shaders/compiler.mjs "$evidence_dir/gears-compiler.json"
node tools/virgl-gears-shaders/browser.mjs --output "$evidence_dir/retained-gears-gpu" --provenance "$evidence_dir/gears-provenance.json"
node renderer/virgl-shader/tests/gears-exact-alpha.mjs "$evidence_dir/retained-gears-gpu/report.json"
for seed in 588730525 2202774047 4195890887; do
  node tools/virgl-compiler-bounds/browser.mjs --output "$evidence_dir/gpu-$seed" --seed "$seed"
done
for fault in high-register branch-join counter; do
  if node tools/virgl-compiler-bounds/browser.mjs --output "$evidence_dir/fault-$fault" --fault "$fault"; then
    echo "ERROR: $fault escaped the independent physical shader oracle" >&2
    exit 1
  fi
done
python3 tools/virgl-compiler-bounds/receipt.py "$evidence_dir"
