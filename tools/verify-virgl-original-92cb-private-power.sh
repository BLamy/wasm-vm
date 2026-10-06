#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=target/evidence/virgl-92cb-private-power
mkdir -p "$evidence"
vertex=evidence/virgl-workload-inventory/captures/es2gears/shaders/7bf4d0d0f981a9feb958d6595302b15d564fc846e6d5ee71874f0921b31e613e.tgsi
fragment=evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi

# Re-run the independently verified physical domain on this exact source head.
make verify-E6-T12g6m5b2b1 > "$evidence/predecessor.log" 2>&1
cp target/evidence/virgl-92cb-raster/geometry.bin "$evidence/geometry.bin"
cp target/evidence/virgl-92cb-raster/raster.json "$evidence/raster.json"
python3 tools/virgl-92cb-power-domain/pin_private_inputs.py --check
python3 -m py_compile tools/virgl-92cb-power-domain/private_*.py
node --check renderer/virgl-shader/index.mjs
node --check renderer/virgl-shader/tests/original-92cb-private-power.mjs
node --check tools/virgl-92cb-power-domain/private_browser.mjs
bash -n tools/verify-virgl-original-92cb-private-power.sh

bash renderer/virgl-shader/build.sh original-92cb-private-power-sanitize \
  > "$evidence/native-build.log" 2>&1
LLVM_PROFILE_FILE="$PWD/$evidence/native.profraw" \
  renderer/virgl-shader/build/original-92cb-private-power-sanitize/original-92cb-private-power-test \
  "$vertex" "$fragment" target/evidence/virgl-92cb-raster/geometry.bin > "$evidence/native.out"
mkdir -p renderer/virgl-shader/build/original-92cb-private-power-wasm
cp "$vertex" renderer/virgl-shader/build/original-92cb-private-power-wasm/vertex.tgsi
cp "$fragment" renderer/virgl-shader/build/original-92cb-private-power-wasm/fragment.tgsi
cp target/evidence/virgl-92cb-raster/geometry.bin \
  renderer/virgl-shader/build/original-92cb-private-power-wasm/geometry.bin
emcc_bin=$(bash tools/setup-virgl-emsdk.sh)
EMCC="$emcc_bin" bash renderer/virgl-shader/build.sh original-92cb-private-power-wasm \
  > "$evidence/wasm-build.log" 2>&1
EMCC="$emcc_bin" bash renderer/virgl-shader/build.sh wasm \
  > "$evidence/production-wasm-build.log" 2>&1
(cd renderer/virgl-shader/build/original-92cb-private-power-wasm && \
  node original-92cb-private-power.js /vertex.tgsi /fragment.tgsi /geometry.bin) \
  > "$evidence/wasm.out"
cmp "$evidence/native.out" "$evidence/wasm.out"

node tools/virgl-92cb-power-domain/private_browser.mjs --output "$evidence/browser"
for fault in source bank negative nonfinite geometry zero-crossing \
    post-source post-bank post-geometry post-parsed-bank post-parsed-quad post-sample viewport; do
  if node tools/virgl-92cb-power-domain/private_browser.mjs \
      --output "$evidence/fault-$fault" --fault "$fault" \
      > "$evidence/fault-$fault.log" 2>&1; then
    echo "Private original 92cb $fault fault unexpectedly passed." >&2
    exit 1
  fi
done
xcrun llvm-profdata merge -sparse "$evidence/native.profraw" -o "$evidence/native.profdata"
xcrun llvm-cov export \
  renderer/virgl-shader/build/original-92cb-private-power-sanitize/original-92cb-private-power-test \
  -instr-profile="$evidence/native.profdata" > "$evidence/native-coverage.json"
python3 tools/virgl-92cb-power-domain/private_receipt.py "$evidence/browser"
