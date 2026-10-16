#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=target/evidence/virgl-zero-cap
mkdir -p "$evidence"
python3 -m py_compile tools/virgl-zero-cap/*.py tools/virgl-coordinate-prefix/capture-banks.py
node --check tools/virgl-zero-cap/original-rejection.mjs
node --check tools/virgl-coordinate-prefix/zero-cap-browser.mjs
node --check renderer/virgl-shader/tests/zero-cap.mjs
bash -n tools/verify-virgl-zero-cap.sh
bash renderer/virgl-shader/build.sh guard-check > "$evidence/guard-check.log" 2>&1
python3 tools/virgl-coordinate-prefix/capture-banks.py "$evidence/banks.bin" > "$evidence/capture.log"
bash renderer/virgl-shader/build.sh zero-cap-sanitize > "$evidence/native-build.log" 2>&1
LLVM_PROFILE_FILE="$PWD/$evidence/native.profraw" \
  renderer/virgl-shader/build/zero-cap-sanitize/zero-cap-test "$evidence/banks.bin" \
  > "$evidence/native.out"
mkdir -p renderer/virgl-shader/build/zero-cap-wasm
cp "$evidence/banks.bin" renderer/virgl-shader/build/zero-cap-wasm/banks.bin
EMCC=$(bash tools/setup-virgl-emsdk.sh) \
  bash renderer/virgl-shader/build.sh zero-cap-wasm > "$evidence/wasm-build.log" 2>&1
(cd renderer/virgl-shader/build/zero-cap-wasm && node zero-cap.js /banks.bin) \
  > "$evidence/wasm.out"
cmp "$evidence/native.out" "$evidence/wasm.out"
EMCC=$(bash tools/setup-virgl-emsdk.sh) \
  bash renderer/virgl-shader/build.sh wasm > "$evidence/production-wasm-build.log" 2>&1
node tools/virgl-zero-cap/original-rejection.mjs "$evidence/original-92cb.json" \
  > "$evidence/original-92cb.log"
node tools/virgl-coordinate-prefix/zero-cap-browser.mjs --output "$evidence/browser" \
  > "$evidence/browser.log" 2>&1
for fault in coordinate branch; do
  if node tools/virgl-coordinate-prefix/zero-cap-browser.mjs \
       --output "$evidence/browser-fault-$fault" --fault "$fault" \
       > "$evidence/browser-fault-$fault.log" 2>&1; then
    echo "Physical $fault fault unexpectedly passed." >&2
    exit 1
  fi
done
python3 - "$evidence" <<'PY'
from pathlib import Path
import json,sys
p=Path(sys.argv[1]); hot=json.loads((p/'browser/report.json').read_text())
assert hot['status']=='passed' and hot['acceptance']['status']=='passed'
assert len(hot['acceptance']['frames'])==12
assert sum(len(f['pixels']) for f in hot['acceptance']['frames'])==192
assert len(hot['acceptance']['rejections'])==6
assert all(hot['acceptance']['renderer'] and 'ANGLE' in hot['acceptance']['renderer'] for _ in [0])
for fault in ['coordinate','branch']:
    report=json.loads((p/f'browser-fault-{fault}/report.json').read_text())
    assert report['status']=='failed' and 'independent zero-cap pixel' in report['failure']['message'], fault
assert json.loads((p/'original-92cb.json').read_text())['status']=='passed'
PY
xcrun llvm-profdata merge -sparse "$evidence/native.profraw" -o "$evidence/native.profdata"
xcrun llvm-cov export renderer/virgl-shader/build/zero-cap-sanitize/zero-cap-test \
  -instr-profile="$evidence/native.profdata" > "$evidence/native-coverage.json"
python3 - "$evidence" <<'PY'
from pathlib import Path
import hashlib,json,subprocess,sys
p=Path(sys.argv[1]); sha=lambda x:hashlib.sha256(x.read_bytes()).hexdigest()
files=['banks.bin','banks.json','native.out','wasm.out','browser/report.json',
       'browser/browser.png','browser-fault-coordinate/report.json',
       'browser-fault-branch/report.json','original-92cb.json','native-coverage.json']
sources=['Makefile','renderer/virgl-shader/build.sh','renderer/virgl-shader/raw_bits.c',
         'renderer/virgl-shader/native_tests/zero_cap.c',
         'renderer/virgl-shader/tests/zero-cap.mjs',
         'tools/verify-virgl-zero-cap.sh','tools/virgl-coordinate-prefix/zero-cap-browser.mjs',
         'tools/virgl-zero-cap/original-rejection.mjs','tools/virgl-zero-cap/cold.py',
         'tools/virgl-zero-cap/seal.py',
         'tasks/epic-6-transcendence/E6-T12g6m4c-zero-capped-min-branch.md']
generated=['renderer/virgl-shader/build/zero-cap-sanitize/zero-cap-test',
           'renderer/virgl-shader/build/zero-cap-wasm/zero-cap.js',
           'renderer/virgl-shader/build/zero-cap-wasm/zero-cap.data',
           'renderer/virgl-shader/build/zero-cap-wasm/zero-cap.wasm',
           'renderer/virgl-shader/build/wasm/virgl-shader.mjs',
           'renderer/virgl-shader/build/wasm/virgl-shader.wasm']
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
dirty=subprocess.check_output(['git','diff','--name-only','HEAD'],text=True).strip()
assert not dirty, f'exact-head recording requires committed sources: {dirty}'
browser=json.loads((p/'browser/report.json').read_text())
assert browser['gitHead']==head and not browser['trackedChanges'] and browser['status']=='passed'
receipt={'schema':'virgl-zero-cap-worker-receipt-v1','status':'passed',
         'gitHead':head,'files':{name:sha(p/name) for name in files},
         'sources':{name:sha(Path(name)) for name in sources},
         'generated':{name:sha(Path(name)) for name in generated}}
(p/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print('c580 zero cap: native/Wasm, six negatives, 192 physical pixels and faults passed')
PY
