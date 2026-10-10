#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_KNOWN_BRANCHES_EVIDENCE_DIR:-target/evidence/virgl-known-branches}
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
for file in renderer/virgl-shader/tests/known-branches.mjs tools/virgl-known-branches/*.mjs tools/virgl-known-arithmetic/supplement.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-known-branches/*.py
bash -n tools/verify-virgl-known-branches.sh
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh known-branch-sanitize
bash renderer/virgl-shader/build.sh native
node tools/virgl-known-branches/native.mjs "$evidence_dir/native"
bash renderer/virgl-shader/build.sh wasm
node tools/virgl-known-branches/wasm.mjs "$evidence_dir/native/report.json" "$evidence_dir/wasm"
NODE_V8_COVERAGE="$evidence_dir/node-v8" node tools/virgl-known-branches/consumer.mjs "$evidence_dir/native/report.json" "$evidence_dir/consumer.json"
bash renderer/virgl-shader/build.sh known-arithmetic-sanitize
node tools/virgl-known-arithmetic/supplement.mjs renderer/virgl-shader/build/known-arithmetic-sanitize/known-test renderer/virgl-shader/build/wasm/virgl-shader.mjs "$evidence_dir/inherited-supplement"
python3 - "$evidence_dir" <<'PY'
import hashlib,json,sys
from pathlib import Path
base=Path(sys.argv[1]);binary=Path('renderer/virgl-shader/build/known-arithmetic-sanitize/known-test');raw=binary.read_bytes()
(base/'inherited-supplement/binary.json').write_text(json.dumps({'binary':{'path':str(binary),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}},indent=2)+'\n')
PY
node tools/virgl-known-branches/legacy.mjs "$evidence_dir/legacy.json"
for seed in 608135816 2242054355 320440878; do
  node tools/virgl-known-branches/browser.mjs --output "$evidence_dir/gpu-$seed" --seed "$seed"
  python3 tools/virgl-known-branches/capture-check.py "$evidence_dir/gpu-$seed/report.json" "$evidence_dir/capture-$seed.json"
done
for fault in word control; do
  if node tools/virgl-known-branches/browser.mjs --output "$evidence_dir/fault-$fault" --fault "$fault"; then
    echo "ERROR: $fault source corruption escaped physical predictions" >&2
    exit 1
  fi
  python3 tools/virgl-known-branches/capture-check.py "$evidence_dir/fault-$fault/report.json" "$evidence_dir/capture-fault-$fault.json"
done
python3 tools/virgl-known-branches/coverage.py "$evidence_dir"
python3 tools/virgl-known-branches/receipt.py "$evidence_dir"
