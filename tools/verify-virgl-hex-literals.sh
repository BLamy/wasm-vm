#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_HEX_LITERALS_EVIDENCE_DIR:-target/evidence/virgl-hex-literals}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
git diff --check
for file in renderer/virgl-shader/tests/hex-literals.mjs tools/virgl-hex-literals/*.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-hex-literals/*.py
bash -n tools/verify-virgl-hex-literals.sh
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh hex-literals-sanitize
bash renderer/virgl-shader/build.sh native
node tools/virgl-hex-literals/native.mjs "$evidence_dir/native"
bash renderer/virgl-shader/build.sh wasm
node tools/virgl-hex-literals/wasm.mjs "$evidence_dir/native/report.json" "$evidence_dir/wasm"
# Incremental replay of unchanged G6b guards and literal original outcomes.
node tools/virgl-compiler-bounds/retained.mjs "$evidence_dir/retained"
node renderer/virgl-shader/tests/compiler-bounds-joins.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$evidence_dir/independent-joins.json"
for seed in 883475089 2552332019 3860417495; do
  node tools/virgl-hex-literals/browser.mjs --output "$evidence_dir/gpu-$seed" --seed "$seed"
done
for fault in vertex fragment; do
  if node tools/virgl-hex-literals/browser.mjs --output "$evidence_dir/fault-$fault" --fault "$fault"; then
    echo "ERROR: $fault literal corruption escaped the independent hardware oracle" >&2
    exit 1
  fi
done
python3 tools/virgl-hex-literals/receipt.py "$evidence_dir"
