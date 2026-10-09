#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_VERTEX_CONSTANT_EVIDENCE_DIR:-target/evidence/virgl-vertex-constant}
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
for file in renderer/virgl-command/{decoder,state,constant-domain}.mjs renderer/virgl-command/tests/vertex-constants.mjs tools/verify-virgl-vertex-constants.mjs tools/virgl-command/vertex-constant-native.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/vertex-constant-{receipt,cold,seal}.py
bash -n tools/verify-virgl-vertex-constants.sh
bash renderer/virgl-shader/build.sh guard-check
for mode in vertex-constant-native vertex-constant-sanitize vertex-constant-scratch-sanitize; do bash renderer/virgl-shader/build.sh "$mode"; done
bash renderer/virgl-shader/build.sh wasm
bash renderer/virgl-shader/build.sh compiler-bounds-wasm-stack
mkdir -p "$evidence_dir/stack"
cp renderer/virgl-shader/build/compiler-bounds-wasm-stack/*.su "$evidence_dir/stack/"
node tools/virgl-command/vertex-constant-native.mjs "$evidence_dir/native"
# Current source, ordinary and raw compiler resource envelope and recovery.
bash renderer/virgl-shader/build.sh compiler-bounds-sanitize
bash renderer/virgl-shader/build.sh native
node tools/virgl-compiler-bounds/native.mjs "$evidence_dir/compiler-native"
node tools/virgl-compiler-bounds/wasm.mjs "$evidence_dir/compiler-native/report.json" "$evidence_dir/compiler-wasm"
node tools/virgl-compiler-bounds/retained.mjs "$evidence_dir/compiler-retained"
node tools/virgl-command/vertex-constant-joins.mjs "$evidence_dir/compiler-joins.json"
VIRGL_CACHE_EVIDENCE_DIR="$evidence_dir/regression" make verify-E6-T12i
node renderer/virgl-command/tests/cache-boundaries.mjs --output "$evidence_dir/promoted-cache"
node tools/verify-virgl-vertex-constants.mjs --output "$evidence_dir/hardware"
if node tools/verify-virgl-vertex-constants.mjs --output "$evidence_dir/fault-upload-limit" --mutation upload-limit; then
  echo 'ERROR: truncated high-bank upload escaped the literal pixel oracle' >&2
  exit 1
fi
python3 tools/virgl-command/vertex-constant-receipt.py "$evidence_dir"
