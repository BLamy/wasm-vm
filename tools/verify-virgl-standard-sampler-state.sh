#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_SAMPLER_STATE_EVIDENCE_DIR:-target/evidence/virgl-standard-sampler-state}
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
for file in renderer/virgl-command/{decoder,state}.mjs renderer/virgl-command/tests/standard-sampler-state.mjs tools/verify-virgl-standard-sampler-state.mjs tools/virgl-command/standard-sampler-{fixtures,oracle,pixels}.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/standard-sampler-{receipt,coverage,cold,seal}.py
bash -n tools/verify-virgl-standard-sampler-state.sh
bash renderer/virgl-shader/build.sh wasm
mkdir -p "$evidence/node-coverage"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-sampler-state.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-sampler-state.mjs --output "$evidence/hardware"
for fault in wrap filter; do
  if node tools/verify-virgl-standard-sampler-state.mjs --output "$evidence/fault-$fault" --fault "$fault"; then
    echo 'ERROR: native sampler fault escaped completed-fence original pixels' >&2
    exit 1
  fi
done
node tools/virgl-command/standard-sampler-pixels.mjs "$evidence"
# Only original sampler admission/native state changed. Buffer/ownership and
# compiler proofs carry by exact unchanged branch/dependency/evidence identity.
node tools/verify-virgl-command-decoder.mjs --output "$evidence/retained-command-decoder"
node tools/verify-virgl-object-state.mjs --output "$evidence/retained-object-state"
python3 tools/virgl-92cb-geometry/capture.py "$evidence/geometry.bin" > "$evidence/geometry.log"
python3 tools/virgl-original-c580/capture-pairs.py "$evidence/c580.bin" > "$evidence/c580.log"
node tools/verify-virgl-standard-state.mjs --output "$evidence/retained-standard-state" --inputs "$evidence"
python3 tools/virgl-command/standard-sampler-coverage.py "$evidence"
set +x
printf 'SAMPLER_STATE_RECORDING_COMPLETE\n'
python3 tools/virgl-command/standard-sampler-receipt.py "$evidence"
