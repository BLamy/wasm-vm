#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_PACKED_NORMALIZED_EVIDENCE_DIR:-target/evidence/virgl-standard-packed-normalized-images}
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
for file in renderer/virgl-command/{resources,packed-normalized-images}.mjs renderer/virgl-command/tests/standard-packed-normalized-{rig,wire,images,boundaries}.mjs tools/verify-virgl-standard-packed-normalized-images.mjs tools/virgl-command/standard-packed-normalized-fixtures.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/standard-packed-normalized-{values,predecessor,receipt,coverage,cold,seal}.py
bash -n tools/verify-virgl-standard-packed-normalized-images.sh
bash renderer/virgl-shader/build.sh wasm
mkdir -p "$evidence/node-coverage"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-packed-normalized-images.mjs --output "$evidence/wire" --node-only true
python3 tools/virgl-command/standard-packed-normalized-predecessor.py "$evidence"
node tools/verify-virgl-standard-packed-normalized-images.mjs --output "$evidence/hardware-matrix"
for seed in 0xa5471e03 0x13579bdf 0x9e3779b9; do node tools/verify-virgl-standard-packed-normalized-images.mjs --output "$evidence/hardware-boundaries-$seed" --mode boundaries --seed "$seed"; done
for fault in upload-lane copy-level completed-word; do
 if node tools/verify-virgl-standard-packed-normalized-images.mjs --output "$evidence/fault-$fault" --fault "$fault"; then echo 'ERROR: physical packed native corruption escaped the original oracle' >&2; exit 1; fi
done
python3 tools/virgl-command/standard-packed-normalized-values.py "$evidence"
node tools/verify-virgl-standard-integer-images.mjs --output "$evidence/retained-integer-storage" --smoke true
node tools/verify-virgl-standard-float-images.mjs --output "$evidence/retained-float-storage" --smoke true
node tools/verify-virgl-standard-packed-float-images.mjs --output "$evidence/retained-packed-float-storage" --smoke true
node tools/verify-virgl-standard-shared-exponent-images.mjs --output "$evidence/retained-shared-storage" --smoke true
node tools/verify-virgl-standard-byte-color-images.mjs --output "$evidence/retained-byte-storage" --smoke true
node tools/verify-virgl-color-formats.mjs --output "$evidence/retained-color-formats"
node tools/verify-virgl-resource-transfers.mjs --output "$evidence/retained-resource-jobs"
python3 tools/virgl-command/standard-packed-normalized-coverage.py "$evidence"
set +x
printf 'PACKED_NORMALIZED_RECORDING_COMPLETE\n'
python3 tools/virgl-command/standard-packed-normalized-receipt.py "$evidence"
