#!/usr/bin/env bash
# Indirect constant addresses through actual shared-renderer GPU commands.
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_INDIRECT_CONSTANTS_EVIDENCE_DIR:-target/evidence/virgl-indirect-constants}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
python3 -m py_compile tools/virgl-indirect-constants/*.py
node --check renderer/virgl-command/constant-domain.mjs
node --check renderer/virgl-command/tests/indirect-constants.mjs
node --check renderer/virgl-command/tests/indirect-constants-oracle.mjs
node --check tools/verify-virgl-indirect-constants.mjs
node --check tools/virgl-indirect-constants/consumer_compat.mjs
node --check tools/virgl-indirect-constants/wasm.mjs
node --check tools/virgl-indirect-constants/fault_wasm.mjs
node --check tools/virgl-indirect-constants/profiles.mjs
node --check tools/virgl-indirect-constants/consumer-unit.mjs
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh indirect-constant-sanitize
python3 tools/virgl-indirect-constants/native.py --binary renderer/virgl-shader/build/indirect-constant-sanitize/indirect-constant-test --output "$evidence_dir/native"
bash renderer/virgl-shader/build.sh native
bash renderer/virgl-shader/build.sh wasm
node tools/virgl-indirect-constants/wasm.mjs --native "$evidence_dir/native/native-report.json" --output "$evidence_dir/wasm"
node tools/virgl-indirect-constants/profiles.mjs --output "$evidence_dir/profiles"
node tools/virgl-indirect-constants/consumer-unit.mjs --output "$evidence_dir/consumer-unit"
node tools/verify-virgl-raw-bits.mjs --output "$evidence_dir/shader-regression/raw"
node tools/verify-virgl-integer-masks.mjs --output "$evidence_dir/shader-regression/integer"
node tools/verify-virgl-float-masks.mjs --output "$evidence_dir/shader-regression/float"
node tools/verify-virgl-numeric-floats.mjs --output "$evidence_dir/shader-regression/numeric"
node tools/verify-virgl-component-floats.mjs --output "$evidence_dir/shader-regression/component"
node tools/verify-virgl-dot-reciprocals.mjs --output "$evidence_dir/shader-regression/dot"
constant_dir="$evidence_dir/constant-regression"
python3 tools/virgl-constant-compiler/faults.py --output "$constant_dir/fault-artifacts"
node tools/verify-virgl-constant-compiler.mjs --output "$constant_dir/hardware"
node tools/verify-virgl-constant-compiler.mjs --output "$constant_dir/decoder-bypass" --mode decoder-bypass
for attack in missing-contract numeric-index; do
  if node tools/verify-virgl-constant-compiler.mjs --output "$constant_dir/sabotage-$attack" --mode "$attack" --fault-artifacts "$constant_dir/fault-artifacts"; then
    echo "ERROR: $attack escaped unchanged E6b real compiler GPU oracle" >&2
    exit 1
  fi
done
structured_dir="$evidence_dir/structured-regression"
python3 tools/virgl-structured-conditionals/faults.py --output "$structured_dir/fault-artifacts"
node tools/verify-virgl-structured-conditionals.mjs --output "$structured_dir/hardware"
if node tools/verify-virgl-structured-conditionals.mjs --output "$structured_dir/sabotage-branch-polarity" --mode branch-polarity --fault-artifacts "$structured_dir/fault-artifacts"; then
  echo 'ERROR: branch polarity escaped retained E7 real compiler GPU oracle' >&2
  exit 1
fi
consumer_dir="$evidence_dir/consumer-regression"
node tools/virgl-constant-domains/unit.mjs --output "$consumer_dir/unit"
python3 tools/virgl-indirect-constants/consumer_native_compat.py --binary renderer/virgl-shader/build/native/virgl-shader --output "$consumer_dir/native"
python3 tools/virgl-constants/native.py --binary renderer/virgl-shader/build/native/virgl-shader --output "$consumer_dir/legacy/native"
node tools/virgl-constants/decoder.mjs --output "$consumer_dir/legacy/decoder"
async_dir="$consumer_dir/legacy/regression"
node tools/verify-virgl-command-decoder.mjs --output "$async_dir/regression/decoder" --node-only true
node tools/verify-virgl-resource-transfers.mjs --output "$async_dir/regression/resources"
node tools/verify-virgl-object-state.mjs --output "$async_dir/regression/state"
node tools/verify-virgl-draw-replay.mjs --output "$async_dir/regression/draw"
node tools/verify-virgl-async-jobs.mjs --output "$async_dir/hardware"
for attack in early-collect index-class; do
  if node tools/verify-virgl-async-jobs.mjs --output "$async_dir/sabotage-$attack" --sabotage "$attack"; then
    echo "ERROR: $attack escaped unchanged async GPU sequencing oracle" >&2
    exit 1
  fi
done
python3 tools/virgl-command/async-receipt.py "$async_dir"
node tools/verify-virgl-pairs.mjs --output "$consumer_dir/legacy/flat-regression"
node tools/verify-virgl-constants.mjs --output "$consumer_dir/legacy/hardware"
if node tools/verify-virgl-constants.mjs --output "$consumer_dir/legacy/sabotage" --sabotage high-upload; then
  echo 'ERROR: shortened high-bank upload escaped unchanged legacy pixel oracle' >&2
  exit 1
fi
node tools/virgl-indirect-constants/consumer_compat.mjs --output "$consumer_dir/hardware"
node tools/virgl-indirect-constants/consumer_compat.mjs --output "$consumer_dir/decoder-bypass" --mode decoder-bypass
if node tools/virgl-indirect-constants/consumer_compat.mjs --output "$consumer_dir/sabotage" --mode decoder-and-guard-bypass; then
  echo 'ERROR: invalid native upload escaped unchanged independent finite-bank oracle' >&2
  exit 1
fi
python3 tools/virgl-indirect-constants/faults.py --output "$evidence_dir/fault-artifacts"
node tools/verify-virgl-indirect-constants.mjs --output "$evidence_dir/hardware"
node tools/verify-virgl-indirect-constants.mjs --output "$evidence_dir/sabotage-decoder-bypass" --mode decoder-bypass
if node tools/verify-virgl-indirect-constants.mjs --output "$evidence_dir/sabotage-index-offset" --mode index-offset --fault-artifacts "$evidence_dir/fault-artifacts"; then
  echo 'ERROR: incorrect indirect address escaped independent GPU oracle' >&2
  exit 1
fi
python3 tools/virgl-indirect-constants/receipt.py "$evidence_dir"
