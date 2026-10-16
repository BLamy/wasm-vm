#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=target/evidence/virgl-original-c580
mkdir -p "$evidence"
vertex=evidence/virgl-workload-inventory/captures/es2gears/shaders/403b0529c632d3d2ffe4584ede810f5745e8b76ca2ab4f575e1073d8f29fcf0c.tgsi
fragment=evidence/virgl-workload-inventory/captures/es2gears/shaders/c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f.tgsi
python3 -m py_compile tools/virgl-original-c580/*.py
node --check renderer/virgl-shader/tests/original-c580.mjs
node --check tools/virgl-original-c580/browser.mjs
bash -n tools/verify-virgl-original-c580.sh
bash renderer/virgl-shader/build.sh guard-check > "$evidence/guard-check.log" 2>&1
python3 tools/virgl-original-c580/capture-pairs.py "$evidence/banks.bin" > "$evidence/capture.log"
bash renderer/virgl-shader/build.sh original-c580-sanitize > "$evidence/native-build.log" 2>&1
LLVM_PROFILE_FILE="$PWD/$evidence/native.profraw" \
  renderer/virgl-shader/build/original-c580-sanitize/original-c580-test \
  "$vertex" "$fragment" "$evidence/banks.bin" > "$evidence/native.out"
mkdir -p renderer/virgl-shader/build/original-c580-wasm
cp "$vertex" renderer/virgl-shader/build/original-c580-wasm/vertex.tgsi
cp "$fragment" renderer/virgl-shader/build/original-c580-wasm/fragment.tgsi
cp "$evidence/banks.bin" renderer/virgl-shader/build/original-c580-wasm/banks.bin
emcc_bin=$(bash tools/setup-virgl-emsdk.sh)
EMCC="$emcc_bin" bash renderer/virgl-shader/build.sh original-c580-wasm \
  > "$evidence/wasm-build.log" 2>&1
(cd renderer/virgl-shader/build/original-c580-wasm && \
  node original-c580.js /vertex.tgsi /fragment.tgsi /banks.bin) > "$evidence/wasm.out"
cmp "$evidence/native.out" "$evidence/wasm.out"
EMCC="$emcc_bin" bash renderer/virgl-shader/build.sh wasm \
  > "$evidence/production-wasm-build.log" 2>&1
node tools/virgl-original-c580/browser.mjs --output "$evidence/browser" \
  > "$evidence/browser.log" 2>&1
for fault in discard output; do
  if node tools/virgl-original-c580/browser.mjs \
       --output "$evidence/browser-fault-$fault" --fault "$fault" \
       > "$evidence/browser-fault-$fault.log" 2>&1; then
    echo "Original c580 $fault source fault unexpectedly passed." >&2
    exit 1
  fi
done
xcrun llvm-profdata merge -sparse "$evidence/native.profraw" -o "$evidence/native.profdata"
xcrun llvm-cov export renderer/virgl-shader/build/original-c580-sanitize/original-c580-test \
  -instr-profile="$evidence/native.profdata" > "$evidence/native-coverage.json"
python3 tools/virgl-original-c580/receipt.py "$evidence"
