#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=target/evidence/virgl-92cb-raster
mkdir -p "$evidence"

# The lower layer independently authenticates all 1,957 draws and every
# original bank word at this exact source head before raster facts are read.
make verify-E6-T12g6m5b1 > "$evidence/predecessor.log" 2>&1
python3 -m py_compile tools/virgl-92cb-raster/*.py
bash -n tools/verify-virgl-original-92cb-raster.sh
cp target/evidence/virgl-92cb-geometry/geometry.bin "$evidence/geometry.bin"
python3 tools/virgl-92cb-raster/capture.py "$evidence/raster.json" > "$evidence/capture.log"
bash renderer/virgl-shader/build.sh original-92cb-raster-sanitize > "$evidence/native-build.log" 2>&1
LLVM_PROFILE_FILE="$PWD/$evidence/native.profraw" \
  renderer/virgl-shader/build/original-92cb-raster-sanitize/original-92cb-raster-test \
  "$evidence/geometry.bin" > "$evidence/native.out"
mkdir -p renderer/virgl-shader/build/original-92cb-raster-wasm
cp "$evidence/geometry.bin" renderer/virgl-shader/build/original-92cb-raster-wasm/geometry.bin
emcc_bin=$(bash tools/setup-virgl-emsdk.sh)
EMCC="$emcc_bin" bash renderer/virgl-shader/build.sh original-92cb-raster-wasm \
  > "$evidence/wasm-build.log" 2>&1
(cd renderer/virgl-shader/build/original-92cb-raster-wasm && \
  node original-92cb-raster.js /geometry.bin) > "$evidence/wasm.out"
cmp "$evidence/native.out" "$evidence/wasm.out"

for fault in viewport sample bank; do
  if python3 tools/virgl-92cb-raster/faults.py "$evidence" "$evidence/fault-$fault" "$fault" \
       > "$evidence/$fault-fault.log" 2>&1; then
    echo "Original 92cb $fault raster fault unexpectedly passed." >&2
    exit 1
  fi
done
rg -q 'original viewport packet is live at every draw' "$evidence/viewport-fault.log"
rg -q 'live single-sample framebuffer resource' "$evidence/sample-fault.log"
rg -q 'original raster evidence scope and sources' "$evidence/bank-fault.log"

xcrun llvm-profdata merge -sparse "$evidence/native.profraw" -o "$evidence/native.profdata"
xcrun llvm-cov export renderer/virgl-shader/build/original-92cb-raster-sanitize/original-92cb-raster-test \
  -instr-profile="$evidence/native.profdata" > "$evidence/native-coverage.json"
python3 tools/virgl-92cb-raster/receipt.py "$evidence"
