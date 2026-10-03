#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_RADIAL_DOMAIN_EVIDENCE_DIR:-target/evidence/virgl-radial-domain}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json" "$evidence_dir/negative-receipts.json" "$evidence_dir/positive-receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
python3 -m py_compile tools/virgl-radial-domain/*.py
for file in renderer/virgl-command/tests/radial-domain.mjs tools/virgl-radial-domain/*.mjs; do node --check "$file"; done
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh radial-domain-sanitize
python3 tools/virgl-radial-domain/native.py --binary renderer/virgl-shader/build/radial-domain-sanitize/radial-domain-test --output "$evidence_dir/native"
bash renderer/virgl-shader/build.sh wasm
node tools/virgl-radial-domain/wasm.mjs --native "$evidence_dir/native/native-report.json" --output "$evidence_dir/wasm"
python3 tools/virgl-radial-domain/probes.py --output "$evidence_dir/probes"
node tools/virgl-radial-domain/reference.mjs > "$evidence_dir/reference.json"
node tools/virgl-radial-domain/domain.mjs "$evidence_dir/domain"
node tools/virgl-radial-domain/browser.mjs --output "$evidence_dir/gpu"
# Exercise the unchanged verified interpolation words on the successor runtime.
node tools/virgl-selected-lanes/browser.mjs --output "$evidence_dir/retained-selected"
node tools/virgl-selected-lanes/oracle.mjs > "$evidence_dir/retained-selected-oracle.json"
python3 tools/virgl-radial-domain/receipt.py "$evidence_dir"
python3 tools/virgl-radial-domain/receipt_attacks.py --evidence "$evidence_dir" --output "$evidence_dir/negative-receipts.json"
cp "$evidence_dir/receipt.json" "$evidence_dir/positive-receipt.json"
python3 tools/virgl-radial-domain/receipt.py "$evidence_dir"
