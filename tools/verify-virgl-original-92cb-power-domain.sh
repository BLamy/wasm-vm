#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=target/evidence/virgl-92cb-power-domain
mkdir -p "$evidence"

# Recheck the verified packet/raster layer on this exact source head.
make verify-E6-T12g6m5b2a > "$evidence/predecessor.log" 2>&1
cp target/evidence/virgl-92cb-raster/geometry.bin "$evidence/geometry.bin"
python3 -m py_compile tools/virgl-92cb-power-domain/*.py
node --check renderer/virgl-shader/tests/original-92cb-power-domain.mjs
node --check tools/virgl-92cb-power-domain/browser.mjs
bash -n tools/verify-virgl-original-92cb-power-domain.sh

bash renderer/virgl-shader/build.sh original-92cb-power-domain-sanitize \
  > "$evidence/native-build.log" 2>&1
LLVM_PROFILE_FILE="$PWD/$evidence/native.profraw" \
  renderer/virgl-shader/build/original-92cb-power-domain-sanitize/original-92cb-power-domain-test \
  "$evidence/geometry.bin" > "$evidence/native.out"
mkdir -p renderer/virgl-shader/build/original-92cb-power-domain-wasm
cp "$evidence/geometry.bin" renderer/virgl-shader/build/original-92cb-power-domain-wasm/geometry.bin
emcc_bin=$(bash tools/setup-virgl-emsdk.sh)
EMCC="$emcc_bin" bash renderer/virgl-shader/build.sh original-92cb-power-domain-wasm \
  > "$evidence/wasm-build.log" 2>&1
(cd renderer/virgl-shader/build/original-92cb-power-domain-wasm && \
  node original-92cb-power-domain.js /geometry.bin) > "$evidence/wasm.out"
cmp "$evidence/native.out" "$evidence/wasm.out"

node tools/virgl-92cb-power-domain/browser.mjs --output "$evidence/browser"
for fault in source bank negative nonfinite geometry viewport zero-crossing; do
  if node tools/virgl-92cb-power-domain/browser.mjs --output "$evidence/fault-$fault" \
       --fault "$fault" > "$evidence/fault-$fault.log" 2>&1; then
    echo "Original 92cb physical $fault fault unexpectedly passed." >&2
    exit 1
  fi
done
for fault in bank negative nonfinite geometry zero-crossing; do
  python3 tools/virgl-92cb-power-domain/faults.py "$evidence/geometry.bin" \
    "$evidence/native-fault-$fault.bin" "$fault"
  if renderer/virgl-shader/build/original-92cb-power-domain-sanitize/original-92cb-power-domain-test \
       "$evidence/native-fault-$fault.bin" > "$evidence/native-fault-$fault.log" 2>&1; then
    echo "Original 92cb native $fault fault unexpectedly passed." >&2
    exit 1
  fi
done

xcrun llvm-profdata merge -sparse "$evidence/native.profraw" -o "$evidence/native.profdata"
xcrun llvm-cov export renderer/virgl-shader/build/original-92cb-power-domain-sanitize/original-92cb-power-domain-test \
  -instr-profile="$evidence/native.profdata" > "$evidence/native-coverage.json"
python3 tools/virgl-92cb-power-domain/receipt.py "$evidence/browser"
