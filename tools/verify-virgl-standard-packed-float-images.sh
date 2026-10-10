#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_PACKED_FLOAT_IMAGE_EVIDENCE_DIR:-target/evidence/virgl-standard-packed-float-images}
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
for file in renderer/virgl-command/{resources,packed-float-images}.mjs renderer/virgl-command/tests/standard-packed-float-image{-rig,-boundaries}.mjs renderer/virgl-command/tests/standard-packed-float-images.mjs tools/verify-virgl-standard-packed-float-images.mjs tools/virgl-command/standard-packed-float-image-{fixtures,scalars}.mjs; do
 node --check "$file"
done
python3 -m py_compile tools/virgl-command/standard-packed-float-image-{values,scalar-vectors,serving,receipt,coverage,cold,seal}.py tools/virgl-command/standard_packed_float_scalar.py
bash -n tools/verify-virgl-standard-packed-float-images.sh
bash renderer/virgl-shader/build.sh wasm
mkdir -p "$evidence/node-coverage"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-packed-float-images.mjs --output "$evidence/wire" --node-only true
python3 tools/virgl-command/standard-packed-float-image-serving.py "$evidence"
python3 tools/virgl-command/standard-packed-float-image-scalar-vectors.py "$evidence/scalar-vectors.json"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/virgl-command/standard-packed-float-image-scalars.mjs "$evidence/scalar-vectors.json" "$evidence/scalar-audit.json"
node tools/verify-virgl-standard-packed-float-images.mjs --output "$evidence/hardware-matrix"
for seed in 0xa5471e03 0x13579bdf 0x9e3779b9; do
 node tools/verify-virgl-standard-packed-float-images.mjs --output "$evidence/hardware-boundaries-$seed" --mode boundaries --seed "$seed"
done
for fault in upload-lane copy-level; do
 if node tools/verify-virgl-standard-packed-float-images.mjs --output "$evidence/fault-$fault" --fault "$fault"; then
  echo 'ERROR: wrong native packed selection escaped the original input oracle' >&2
  exit 1
 fi
done
python3 tools/virgl-command/standard-packed-float-image-values.py "$evidence"
node tools/verify-virgl-standard-float-images.mjs --output "$evidence/retained-float-storage" --smoke true
node tools/verify-virgl-async-jobs.mjs --output "$evidence/retained-async-jobs"
python3 tools/virgl-command/standard-packed-float-image-coverage.py "$evidence"
set +x
printf 'PACKED_FLOAT_IMAGE_RECORDING_COMPLETE\n'
python3 tools/virgl-command/standard-packed-float-image-receipt.py "$evidence"
