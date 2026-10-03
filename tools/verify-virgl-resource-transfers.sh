#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_RESOURCE_EVIDENCE_DIR:-target/evidence/virgl-resources}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
set -x
git rev-parse HEAD
node --check renderer/virgl-command/resources.mjs
node --check renderer/virgl-command/tests/resources-acceptance.mjs
node --check tools/virgl-command/resource-fixtures.mjs
node --check tools/verify-virgl-resource-transfers.mjs
python3 -m py_compile tools/virgl-command/resources-receipt.py tools/virgl-command/resources-cold.py tools/virgl-command/resources-coverage.py
node tools/verify-virgl-command-decoder.mjs --output "$evidence_dir/decoder" --node-only true
coverage_dir=$(mktemp -d)
NODE_V8_COVERAGE="$coverage_dir" node tools/verify-virgl-resource-transfers.mjs --output "$evidence_dir/hardware"
python3 tools/virgl-command/resources-coverage.py "$coverage_dir" "$evidence_dir/node-coverage.json"
rm -rf "$coverage_dir"
for attack in texture-texel index-byte; do
  if node tools/verify-virgl-resource-transfers.mjs --output "$evidence_dir/sabotage-$attack" --sabotage "$attack"; then
    echo "ERROR: $attack corruption escaped the independent GPU transfer oracle" >&2
    exit 1
  fi
done
python3 tools/virgl-command/resources-receipt.py "$evidence_dir"
