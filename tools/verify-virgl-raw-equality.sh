#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_RAW_EQUALITY_EVIDENCE_DIR:-target/evidence/virgl-raw-equality}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
python3 -m py_compile tools/virgl-raw-equality/*.py
for file in renderer/virgl-command/constant-domain.mjs renderer/virgl-shader/tests/raw-equality.mjs renderer/virgl-shader/tests/raw-equality-oracle.mjs tools/virgl-raw-equality/*.mjs; do node --check "$file"; done
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh raw-equality-sanitize
python3 tools/virgl-raw-equality/native.py --binary renderer/virgl-shader/build/raw-equality-sanitize/raw-equality-test --output "$evidence_dir/native"
bash renderer/virgl-shader/build.sh wasm
node tools/virgl-raw-equality/wasm.mjs --native "$evidence_dir/native/native-report.json" --output "$evidence_dir/wasm"
NODE_V8_COVERAGE="$evidence_dir/consumer/v8" node tools/virgl-raw-equality/consumer.mjs --native "$evidence_dir/native/native-report.json" --output "$evidence_dir/consumer"
node tools/virgl-raw-equality/integer-masks-successor.mjs --output "$evidence_dir/integer"
node tools/virgl-raw-equality/float-masks-successor.mjs --output "$evidence_dir/float"
node tools/virgl-raw-equality/browser.mjs --output "$evidence_dir/gpu"
node tools/virgl-raw-equality/oracle.mjs > "$evidence_dir/oracle.json"
python3 tools/virgl-raw-equality/faults.py --output "$evidence_dir/fault-artifacts"
for mode in nan-guard zero-sign ne-complement mask-one; do
 if node tools/virgl-raw-equality/browser.mjs --output "$evidence_dir/fault-$mode" --fault "$mode" --fault-artifacts "$evidence_dir/fault-artifacts"; then
  echo "ERROR: $mode escaped the independent GPU equality oracle" >&2
  exit 1
 fi
done
python3 tools/virgl-raw-equality/receipt.py "$evidence_dir"
python3 tools/virgl-raw-equality/receipt_attacks.py --evidence "$evidence_dir" --output "$evidence_dir/negative-receipts.json"
# Seal the negative checks along with the positive run in the final receipt.
cp "$evidence_dir/receipt.json" "$evidence_dir/positive-receipt.json"
python3 tools/virgl-raw-equality/receipt.py "$evidence_dir"
