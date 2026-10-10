#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=target/evidence/virgl-coordinate-prefix
mkdir -p "$evidence"
python3 -m py_compile tools/virgl-coordinate-prefix/*.py
node --check tools/virgl-coordinate-prefix/browser.mjs
node --check renderer/virgl-shader/tests/coordinate-prefix.mjs
bash -n tools/verify-virgl-coordinate-prefix.sh
bash renderer/virgl-shader/build.sh guard-check > "$evidence/guard-check.log" 2>&1
python3 tools/virgl-coordinate-prefix/capture-banks.py "$evidence/banks.bin" > "$evidence/capture.log"
bash renderer/virgl-shader/build.sh coordinate-prefix-sanitize > "$evidence/native-build.log" 2>&1
LLVM_PROFILE_FILE="$PWD/$evidence/native.profraw" \
  renderer/virgl-shader/build/coordinate-prefix-sanitize/coordinate-prefix-test "$evidence/banks.bin" \
  > "$evidence/native.out"
mkdir -p renderer/virgl-shader/build/coordinate-prefix-wasm
cp "$evidence/banks.bin" renderer/virgl-shader/build/coordinate-prefix-wasm/banks.bin
EMCC=$(bash tools/setup-virgl-emsdk.sh) \
  bash renderer/virgl-shader/build.sh coordinate-prefix-wasm > "$evidence/wasm-build.log" 2>&1
(cd renderer/virgl-shader/build/coordinate-prefix-wasm && node coordinate-prefix.js /banks.bin) \
  > "$evidence/wasm.out"
python3 tools/virgl-coordinate-prefix/check-prefix.py "$evidence/banks.bin" \
  "$evidence/native.out" "$evidence/wasm.out" "$evidence/independent.json" \
  > "$evidence/independent.log"
EMCC=$(bash tools/setup-virgl-emsdk.sh) \
  bash renderer/virgl-shader/build.sh wasm > "$evidence/production-wasm-build.log" 2>&1
bash renderer/virgl-shader/build.sh exact-reciprocal-sanitize > "$evidence/reciprocal-build.log" 2>&1
LLVM_PROFILE_FILE="$PWD/$evidence/reciprocal.profraw" \
  node tools/virgl-exact-reciprocal/native-wasm.mjs "$evidence/reciprocal-regression" \
  > "$evidence/reciprocal-regression.log"
python3 - "$evidence/reciprocal-regression/native-wasm.json" <<'PY'
import json,sys
run=json.load(open(sys.argv[1]))
cases={case['name']:case for case in run['cases']}
assert run['status']=='passed'
for name in ['full-original-92cb','full-original-c580']:
    assert cases[name]['accept'] is False, name
PY
node tools/virgl-coordinate-prefix/browser.mjs --output "$evidence/browser" \
  > "$evidence/browser.log" 2>&1
if node tools/virgl-coordinate-prefix/browser.mjs --output "$evidence/browser-fault" \
     --fault coordinate > "$evidence/browser-fault.log" 2>&1; then
  echo 'Physical coordinate source fault unexpectedly passed.' >&2
  exit 1
fi
python3 - "$evidence/browser-fault/report.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert r['status']=='failed' and 'independent original-prefix pixel' in r['failure']['message']
PY
python3 tools/virgl-coordinate-prefix/fault-build.py "$evidence/banks.bin" "$evidence/source-fault" \
  > "$evidence/source-fault.log"
mkdir -p "$evidence/sabotage"
cp "$evidence/banks.bin" "$evidence/sabotage/banks.bin"
cp "$evidence/banks.json" "$evidence/sabotage/banks.json"
python3 - "$evidence/sabotage/banks.bin" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); data=bytearray(p.read_bytes()); data[8+4*32*4]^=1; p.write_bytes(data)
PY
if python3 tools/virgl-coordinate-prefix/check-prefix.py "$evidence/sabotage/banks.bin" \
     "$evidence/native.out" "$evidence/wasm.out" "$evidence/sabotage/report.json" \
     > "$evidence/sabotage/rejection.log" 2>&1; then
  echo 'Authenticated bank sabotage unexpectedly passed.' >&2
  exit 1
fi
xcrun llvm-profdata merge -sparse "$evidence/native.profraw" -o "$evidence/native.profdata"
xcrun llvm-cov export renderer/virgl-shader/build/coordinate-prefix-sanitize/coordinate-prefix-test \
  -instr-profile="$evidence/native.profdata" > "$evidence/native-coverage.json"
python3 - "$evidence" <<'PY'
from pathlib import Path
import hashlib,json,subprocess,sys
p=Path(sys.argv[1]); sha=lambda x:hashlib.sha256(x.read_bytes()).hexdigest()
files=['banks.bin','banks.json','native.out','wasm.out','independent.json','browser/report.json',
       'browser/browser.png','browser-fault/report.json','source-fault/manifest.json',
       'sabotage/rejection.log','native-coverage.json']
sources=['Makefile','renderer/virgl-shader/bridge.c','renderer/virgl-shader/build.sh',
         'renderer/virgl-shader/raw_bits.c','renderer/virgl-shader/raw_bits.h',
         'renderer/virgl-shader/native_tests/coordinate_prefix.c',
         'renderer/virgl-shader/tests/coordinate-prefix.mjs',
         'tools/verify-virgl-coordinate-prefix.sh',
         'tools/virgl-coordinate-prefix/browser.mjs',
         'tools/virgl-coordinate-prefix/capture-banks.py',
         'tools/virgl-coordinate-prefix/check-prefix.py',
         'tools/virgl-coordinate-prefix/cold.py',
         'tools/virgl-coordinate-prefix/fault-build.py',
         'tools/virgl-coordinate-prefix/seal.py',
         'tasks/epic-6-transcendence/E6-T12g6m4b-coordinate-prefix-range.md']
generated=['renderer/virgl-shader/build/coordinate-prefix-sanitize/coordinate-prefix-test',
           'renderer/virgl-shader/build/coordinate-prefix-wasm/coordinate-prefix.js',
           'renderer/virgl-shader/build/coordinate-prefix-wasm/coordinate-prefix.wasm',
           'renderer/virgl-shader/build/wasm/virgl-shader.wasm']
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
dirty=subprocess.check_output(['git','diff','--name-only','HEAD'],text=True).strip()
assert not dirty, f'exact-head recording requires committed sources: {dirty}'
browser=json.loads((p/'browser/report.json').read_text())
assert browser['gitHead']==head and not browser['trackedChanges'] and browser['status']=='passed'
receipt={'schema':'virgl-coordinate-prefix-worker-receipt-v2','status':'passed',
         'gitHead':head,'files':{name:sha(p/name) for name in files},
         'sources':{name:sha(Path(name)) for name in sources},
         'generated':{name:sha(Path(name)) for name in generated}}
(p/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print('c580 finite prefix: native/Wasm, 3 banks, 96 physical pixels, both source faults and sabotage passed')
PY
