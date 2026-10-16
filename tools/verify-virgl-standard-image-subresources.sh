#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_IMAGE_SUBRESOURCES_EVIDENCE_DIR:-target/evidence/virgl-standard-image-subresources}
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
for file in renderer/virgl-command/{decoder,resources,state}.mjs renderer/virgl-command/tests/standard-image-{rig,matrix,boundaries,subresources}.mjs tools/verify-virgl-standard-image-subresources.mjs tools/virgl-command/standard-image-{fixtures,pixels}.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/standard-image-{receipt,coverage,cold,seal}.py
bash -n tools/verify-virgl-standard-image-subresources.sh
bash renderer/virgl-shader/build.sh wasm
mkdir -p "$evidence/node-coverage"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-image-subresources.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-image-subresources.mjs --output "$evidence/hardware-matrix"
for seed in 0xa5471e03 0x13579bdf 0x9e3779b9; do
  node tools/verify-virgl-standard-image-subresources.mjs --output "$evidence/hardware-boundaries-$seed" --mode boundaries --seed "$seed"
done
for fault in copy-level surface-level; do
  if node tools/verify-virgl-standard-image-subresources.mjs --output "$evidence/fault-$fault" --fault "$fault"; then
    echo 'ERROR: native image selection fault escaped completed-fence original pixels' >&2
    exit 1
  fi
done
node tools/virgl-command/standard-image-pixels.mjs "$evidence"
# Exercise the changed shared decoder/store and both legacy and original async
# draw consumers. Unchanged compiler and older boundaries carry exact evidence.
node tools/verify-virgl-command-decoder.mjs --output "$evidence/retained-command-decoder"
node tools/verify-virgl-resource-transfers.mjs --output "$evidence/retained-resource-transfers"
node tools/verify-virgl-color-formats.mjs --output "$evidence/retained-color-formats"
node tools/verify-virgl-async-jobs.mjs --output "$evidence/retained-async-jobs"
node tools/verify-virgl-standard-sampler-state.mjs --output "$evidence/retained-standard-sampler" --smoke true
python3 tools/virgl-command/standard-image-coverage.py "$evidence"
set +x
printf 'IMAGE_SUBRESOURCES_RECORDING_COMPLETE\n'
python3 tools/virgl-command/standard-image-receipt.py "$evidence"
