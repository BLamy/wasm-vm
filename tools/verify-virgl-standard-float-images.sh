#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_FLOAT_IMAGE_EVIDENCE_DIR:-target/evidence/virgl-standard-float-images}
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
for file in renderer/virgl-command/{resources,float-images}.mjs renderer/virgl-command/tests/standard-float-image{-rig,-boundaries}.mjs renderer/virgl-command/tests/standard-float-images.mjs tools/verify-virgl-standard-float-images.mjs tools/virgl-command/standard-float-image-{fixtures,half}.mjs; do
 node --check "$file"
done
python3 - <<'PY' | while IFS= read -r file; do node --check "$file"; done
import json
from pathlib import Path
for name in json.loads(Path('tools/virgl-command/standard-float-image-boundary.json').read_text())['changes']:
    if name.endswith('.mjs'):
        print(name)
PY
python3 -m py_compile tools/virgl-command/standard-float-image-{values,half,receipt,coverage,cold,seal}.py
bash -n tools/verify-virgl-standard-float-images.sh
bash renderer/virgl-shader/build.sh wasm
mkdir -p "$evidence/node-coverage"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-float-images.mjs --output "$evidence/wire" --node-only true
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/virgl-command/standard-float-image-half.mjs "$evidence/half-representation.json"
python3 tools/virgl-command/standard-float-image-half.py "$evidence/half-representation.json"
node tools/verify-virgl-standard-float-images.mjs --output "$evidence/hardware-matrix"
for seed in 0xa5471e03 0x13579bdf 0x9e3779b9; do
 node tools/verify-virgl-standard-float-images.mjs --output "$evidence/hardware-boundaries-$seed" --mode boundaries --seed "$seed"
done
for fault in upload-lane storage-precision copy-level; do
 if node tools/verify-virgl-standard-float-images.mjs --output "$evidence/fault-$fault" --fault "$fault"; then
  echo 'ERROR: wrong native floating selection escaped the original value oracle' >&2
  exit 1
 fi
done
python3 tools/virgl-command/standard-float-image-values.py "$evidence"
# Unselected resource/compiler/consumer facets retain their complete earlier seals.
node tools/verify-virgl-async-jobs.mjs --output "$evidence/retained-async-jobs"
node tools/verify-virgl-standard-uniform-bindings.mjs --output "$evidence/retained-uniform-bindings" --smoke true
node tools/verify-virgl-standard-byte-color-images.mjs --output "$evidence/retained-byte-colors"
node tools/verify-virgl-standard-texture-operations.mjs --output "$evidence/retained-texture-consumer" --smoke true
python3 tools/virgl-command/standard-float-image-coverage.py "$evidence"
set +x
printf 'FLOAT_IMAGE_RECORDING_COMPLETE\n'
python3 tools/virgl-command/standard-float-image-receipt.py "$evidence"
