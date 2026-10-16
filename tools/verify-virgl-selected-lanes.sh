#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_SELECTED_LANES_EVIDENCE_DIR:-target/evidence/virgl-selected-lanes}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
python3 -m py_compile tools/virgl-selected-lanes/*.py
for file in renderer/virgl-command/tests/selected-lanes.mjs renderer/virgl-command/tests/selected-lanes-oracle.mjs tools/virgl-selected-lanes/*.mjs; do node --check "$file"; done
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh selected-lanes-sanitize
python3 tools/virgl-selected-lanes/native.py --binary renderer/virgl-shader/build/selected-lanes-sanitize/selected-lanes-test --output "$evidence_dir/native"
bash renderer/virgl-shader/build.sh wasm
node tools/virgl-selected-lanes/wasm.mjs --native "$evidence_dir/native/native-report.json" --output "$evidence_dir/wasm"
node tools/virgl-selected-lanes/browser.mjs --output "$evidence_dir/gpu"
node tools/virgl-selected-lanes/oracle.mjs > "$evidence_dir/oracle.json"
# Run F1's unchanged literal hardware oracle, not its obsolete full task gate.
node tools/virgl-raw-equality/browser.mjs --output "$evidence_dir/retained-equality"
node tools/virgl-raw-equality/oracle.mjs > "$evidence_dir/retained-equality-oracle.json"
python3 tools/virgl-selected-lanes/faults.py --output "$evidence_dir/fault-artifacts"
for mode in guard-open width-proof; do
 if node tools/virgl-selected-lanes/browser.mjs --output "$evidence_dir/fault-$mode" --mode "$mode" --fault-artifacts "$evidence_dir/fault-artifacts"; then
  echo "ERROR: $mode escaped its independent hardware witness" >&2
  exit 1
 fi
done
python3 tools/virgl-selected-lanes/receipt.py "$evidence_dir"
python3 tools/virgl-selected-lanes/receipt_attacks.py --evidence "$evidence_dir" --output "$evidence_dir/negative-receipts.json"
cp "$evidence_dir/receipt.json" "$evidence_dir/positive-receipt.json"
python3 tools/virgl-selected-lanes/receipt.py "$evidence_dir"
