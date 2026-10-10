#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_TEXTURE_STORAGE_EVIDENCE_DIR:-target/evidence/virgl-standard-texture-storage}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
rm -f "$evidence/receipt.json"
exec > >(tee "$evidence/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
git diff --check
for file in renderer/virgl-command/{decoder,resources}.mjs renderer/virgl-command/tests/standard-texture-storage.mjs tools/verify-virgl-standard-texture-storage.mjs tools/virgl-command/standard-texture-{fixtures,pixels}.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/standard-texture-{receipt,coverage,cold,seal}.py
bash -n tools/verify-virgl-standard-texture-storage.sh
bash renderer/virgl-shader/build.sh wasm
mkdir -p "$evidence/node-coverage"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-texture-storage.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-texture-storage.mjs --output "$evidence/hardware"
for fault in upload-level read-level; do
  if node tools/verify-virgl-standard-texture-storage.mjs --output "$evidence/fault-$fault" --fault "$fault"; then
    echo 'ERROR: native level-selection fault escaped completed-fence original bytes' >&2
    exit 1
  fi
done
node tools/virgl-command/standard-texture-pixels.mjs "$evidence"
# Only metadata, transfer levels and native color storage changed. Shader,
# sampler/draw/ownership proofs carry by exact source/dependency/evidence identity.
node tools/verify-virgl-command-decoder.mjs --output "$evidence/retained-command-decoder"
node tools/verify-virgl-resource-transfers.mjs --output "$evidence/retained-resource-transfers"
node tools/verify-virgl-color-formats.mjs --output "$evidence/retained-color-formats"
python3 tools/virgl-command/standard-texture-coverage.py "$evidence"
set +x
printf 'TEXTURE_STORAGE_RECORDING_COMPLETE\n'
python3 tools/virgl-command/standard-texture-receipt.py "$evidence"
