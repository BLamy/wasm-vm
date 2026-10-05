#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_EXACT_RECIPROCAL_EVIDENCE_DIR:-target/evidence/virgl-exact-reciprocal}
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
for file in tools/virgl-exact-reciprocal/*.mjs renderer/virgl-shader/tests/exact-reciprocal.mjs renderer/virgl-command/constant-domain.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-exact-reciprocal/*.py
bash -n tools/verify-virgl-exact-reciprocal.sh
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh exact-reciprocal-sanitize
bash renderer/virgl-shader/build.sh native
bash renderer/virgl-shader/build.sh wasm
bash renderer/virgl-shader/build.sh compiler-bounds-wasm-stack
python3 tools/virgl-exact-reciprocal/capture-provenance.py "$evidence_dir/provenance.json"
mkdir -p "$evidence_dir/node-v8"
NODE_V8_COVERAGE="$evidence_dir/node-v8" node tools/virgl-exact-reciprocal/native-wasm.mjs "$evidence_dir"
VIRGL_EXACT_PAIR_EVIDENCE_DIR="$evidence_dir/prior-exact-pair" make verify-E6-T12g6m3c > "$evidence_dir/prior-exact-pair.log" 2>&1
for seed in 1 2 3; do
  node tools/virgl-exact-reciprocal/browser.mjs --output "$evidence_dir/gpu-$seed" --seed "$seed"
  python3 tools/virgl-exact-reciprocal/capture-check.py "$evidence_dir/gpu-$seed/report.json" "$evidence_dir/capture-$seed.json"
done
python3 tools/virgl-exact-reciprocal/fault-build.py
if node tools/virgl-exact-reciprocal/browser.mjs --output "$evidence_dir/fault-shadow" --fault shadow --seed 1; then
  echo 'ERROR: altered compiler shadow escaped physical predictions' >&2
  exit 1
fi
python3 tools/virgl-exact-reciprocal/capture-check.py "$evidence_dir/fault-shadow/report.json" "$evidence_dir/capture-fault.json" --fault
python3 - "$evidence_dir" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1]); report = json.loads((root/'gpu-1/report.json').read_text())
report['acceptance']['frames'][0]['observed']['rgba'][0] ^= 1
(root/'sabotaged.json').write_text(json.dumps(report)+'\n')
PY
if python3 tools/virgl-exact-reciprocal/capture-check.py "$evidence_dir/sabotaged.json" "$evidence_dir/sabotage-accepted.json" > "$evidence_dir/sabotage.log" 2>&1; then
  echo 'ERROR: sabotaged physical pixel escaped independent checker' >&2
  exit 1
fi
xcrun llvm-profdata merge -sparse "$evidence_dir/native.profraw" -o "$evidence_dir/native.profdata"
xcrun llvm-cov export renderer/virgl-shader/build/exact-reciprocal-sanitize/exact-reciprocal-test -instr-profile="$evidence_dir/native.profdata" > "$evidence_dir/native-coverage.json"
python3 tools/virgl-exact-reciprocal/receipt.py "$evidence_dir"
