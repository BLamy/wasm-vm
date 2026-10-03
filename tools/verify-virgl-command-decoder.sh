#!/usr/bin/env bash
# Parser-only gate. Existing shader and production device semantics are unchanged.
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_COMMAND_EVIDENCE_DIR:-target/evidence/virgl-command}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
set -x
git rev-parse HEAD
node --check renderer/virgl-command/decoder.mjs
node --check renderer/virgl-command/tests/acceptance.mjs
node --check tools/virgl-command/fixtures.mjs
node --check tools/verify-virgl-command-decoder.mjs
python3 -m py_compile tools/virgl-command/receipt.py tools/virgl-command/coverage.py tools/virgl-command/cold.py
python3 -m unittest discover -s tools/virgl-capture/tests -p 'test_*.py' -v
python3 tools/virgl-capture/validate.py evidence/virgl-corpus/captures
coverage_dir=$(mktemp -d "${TMPDIR:-/tmp}/wasm-vm-virgl-command-coverage.XXXXXX")
NODE_V8_COVERAGE="$coverage_dir" node tools/verify-virgl-command-decoder.mjs --output "$evidence_dir/parity"
python3 tools/virgl-command/coverage.py "$coverage_dir" "$evidence_dir/coverage.json"
if node tools/verify-virgl-command-decoder.mjs --output "$evidence_dir/sabotage" --sabotage packet-length; then
  echo 'ERROR: corrupted packet length escaped the independent decoder oracle' >&2
  exit 1
fi
python3 tools/virgl-command/receipt.py "$evidence_dir"
