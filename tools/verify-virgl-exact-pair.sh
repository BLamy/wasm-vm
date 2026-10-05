#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_EXACT_PAIR_EVIDENCE_DIR:-target/evidence/virgl-exact-pair}
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
for file in renderer/virgl-shader/index.mjs renderer/virgl-command/tests/exact-pair.mjs tools/virgl-exact-pair/*.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-exact-pair/*.py
bash -n tools/verify-virgl-exact-pair.sh
node --input-type=module -e 'import fs from "node:fs"; import {cases} from "./tools/virgl-exact-pair/fixtures.mjs"; if(JSON.stringify(cases())!==JSON.stringify(JSON.parse(fs.readFileSync("tools/virgl-exact-pair/fixtures.json"))))process.exit(1)'
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh exact-pair-sanitize
bash renderer/virgl-shader/build.sh native
node tools/virgl-exact-pair/native.mjs "$evidence_dir/native"
bash renderer/virgl-shader/build.sh wasm
bash renderer/virgl-shader/build.sh compiler-bounds-wasm-stack
NODE_V8_COVERAGE="$evidence_dir/node-v8" node tools/virgl-exact-pair/node.mjs "$evidence_dir/native/report.json" "$evidence_dir/node.json"
node tools/virgl-known-branches/legacy.mjs "$evidence_dir/legacy.json"
for seed in 1779033703 3144134277 1013904242; do
  node tools/virgl-exact-pair/browser.mjs --output "$evidence_dir/gpu-$seed" --seed "$seed"
  python3 tools/virgl-exact-pair/capture-check.py "$evidence_dir/gpu-$seed/report.json" "$evidence_dir/node.json" "$evidence_dir/capture-$seed.json"
done
python3 tools/virgl-exact-pair/fault-build.py
for fault in interface metadata; do
  if node tools/virgl-exact-pair/browser.mjs --output "$evidence_dir/fault-$fault" --fault "$fault"; then
    echo "ERROR: $fault compiler source corruption escaped physical predictions" >&2
    exit 1
  fi
  python3 tools/virgl-exact-pair/capture-check.py "$evidence_dir/fault-$fault/report.json" "$evidence_dir/node.json" "$evidence_dir/capture-fault-$fault.json"
done
python3 tools/virgl-exact-pair/coverage.py "$evidence_dir"
python3 tools/virgl-exact-pair/receipt.py "$evidence_dir"
