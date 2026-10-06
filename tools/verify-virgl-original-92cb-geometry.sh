#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=target/evidence/virgl-92cb-geometry
mkdir -p "$evidence"
vertex=evidence/virgl-workload-inventory/captures/es2gears/shaders/7bf4d0d0f981a9feb958d6595302b15d564fc846e6d5ee71874f0921b31e613e.tgsi
fragment=evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi
python3 -m py_compile tools/virgl-92cb-geometry/*.py
bash -n tools/verify-virgl-original-92cb-geometry.sh
python3 tools/virgl-92cb-geometry/capture.py --self-test > "$evidence/self-test.log"
python3 tools/virgl-92cb-geometry/capture.py "$evidence/geometry.bin" > "$evidence/capture.log"
bash renderer/virgl-shader/build.sh guard-check > "$evidence/guard-check.log" 2>&1
bash renderer/virgl-shader/build.sh original-92cb-geometry-sanitize \
  > "$evidence/native-build.log" 2>&1
LLVM_PROFILE_FILE="$PWD/$evidence/native.profraw" \
  renderer/virgl-shader/build/original-92cb-geometry-sanitize/original-92cb-geometry-test \
  "$vertex" "$fragment" "$evidence/geometry.bin" > "$evidence/native.out"
mkdir -p renderer/virgl-shader/build/original-92cb-geometry-wasm
cp "$vertex" renderer/virgl-shader/build/original-92cb-geometry-wasm/vertex.tgsi
cp "$fragment" renderer/virgl-shader/build/original-92cb-geometry-wasm/fragment.tgsi
cp "$evidence/geometry.bin" renderer/virgl-shader/build/original-92cb-geometry-wasm/geometry.bin
emcc_bin=$(bash tools/setup-virgl-emsdk.sh)
EMCC="$emcc_bin" bash renderer/virgl-shader/build.sh original-92cb-geometry-wasm \
  > "$evidence/wasm-build.log" 2>&1
(cd renderer/virgl-shader/build/original-92cb-geometry-wasm && \
  node original-92cb-geometry.js /vertex.tgsi /fragment.tgsi /geometry.bin) \
  > "$evidence/wasm.out"
cmp "$evidence/native.out" "$evidence/wasm.out"
python3 - "$evidence" <<'PY'
from pathlib import Path
import struct,sys
root=Path(sys.argv[1])
raw=bytearray((root/'geometry.bin').read_bytes())
struct.pack_into('<I',raw,8+5*4,0x7f800000)
(root/'geometry-fault.bin').write_bytes(raw)
raw=bytearray((root/'geometry.bin').read_bytes())
struct.pack_into('<I',raw,8+64+16*4+24*4,0)
(root/'exponent-fault.bin').write_bytes(raw)
PY
for fault in geometry exponent; do
  if renderer/virgl-shader/build/original-92cb-geometry-sanitize/original-92cb-geometry-test \
      "$vertex" "$fragment" "$evidence/$fault-fault.bin" \
      > "$evidence/$fault-fault.log" 2>&1; then
    echo "Original 92cb $fault mutation unexpectedly accepted." >&2
    exit 1
  fi
done
rg -q 'four finite \[0,1\]' "$evidence/geometry-fault.log"
rg -q 'captured center and positive integer exponent' "$evidence/exponent-fault.log"
xcrun llvm-profdata merge -sparse "$evidence/native.profraw" -o "$evidence/native.profdata"
xcrun llvm-cov export renderer/virgl-shader/build/original-92cb-geometry-sanitize/original-92cb-geometry-test \
  -instr-profile="$evidence/native.profdata" > "$evidence/native-coverage.json"
python3 tools/virgl-92cb-geometry/receipt.py "$evidence"
