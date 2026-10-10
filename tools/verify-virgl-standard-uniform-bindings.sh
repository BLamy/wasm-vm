#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_UNIFORM_BINDINGS_EVIDENCE_DIR:-target/evidence/virgl-standard-uniform-bindings}
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
for file in renderer/virgl-command/{decoder,resources,state}.mjs renderer/virgl-command/tests/{standard-uniform-buffer-bindings,standard-instanced-draws}.mjs tools/verify-virgl-standard-uniform-bindings.mjs tools/virgl-command/standard-uniform-binding-{fixtures,oracle,pixels}.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/standard-uniform-binding-{receipt,coverage,cold,seal}.py
bash -n tools/verify-virgl-standard-uniform-bindings.sh
# D16 owns unchanged C/native/sanitizer semantics. Rebuild the actual Wasm
# compiler and exercise its original outputs through this new native boundary.
bash renderer/virgl-shader/build.sh wasm
mkdir -p "$evidence/node-coverage"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-uniform-bindings.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-uniform-bindings.mjs --output "$evidence/hardware"
for fault in block-word range-offset slot-zero-variant; do
  if node tools/verify-virgl-standard-uniform-bindings.mjs --output "$evidence/fault-$fault" --fault "$fault"; then
    echo 'ERROR: uniform binding fault escaped original completed-fence pixels' >&2
    exit 1
  fi
done
node tools/virgl-command/standard-uniform-binding-pixels.mjs "$evidence"
# Affected old resource admission and old standard renderer entry points.
VIRGL_RESOURCE_EVIDENCE_DIR="$evidence/retained-resources" bash tools/verify-virgl-resource-transfers.sh
node tools/verify-virgl-standard-packed.mjs --output "$evidence/retained-standard-wire" --node-only true
node tools/verify-virgl-standard-packed.mjs --output "$evidence/retained-standard-hardware"
python3 tools/virgl-command/standard-uniform-binding-coverage.py "$evidence"
set +x
printf 'UNIFORM_BINDINGS_RECORDING_COMPLETE\n'
python3 tools/virgl-command/standard-uniform-binding-receipt.py "$evidence"
