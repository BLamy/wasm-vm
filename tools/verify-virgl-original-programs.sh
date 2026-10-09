#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=target/evidence/virgl-original-programs
mkdir -p "$evidence"
vertex=evidence/virgl-workload-inventory/captures/es2gears/shaders/7bf4d0d0f981a9feb958d6595302b15d564fc846e6d5ee71874f0921b31e613e.tgsi
fragment=evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi
git diff --check
python3 -m py_compile tools/virgl-original-programs/*.py
for source in renderer/virgl-shader/index.mjs renderer/virgl-shader/tests/original-programs*.mjs tools/virgl-original-programs/*.mjs; do
  node --check "$source"
done
bash -n tools/verify-virgl-original-programs.sh
bash renderer/virgl-shader/build.sh guard-check > "$evidence/guard-check.log" 2>&1
mkdir -p target/evidence/virgl-92cb-raster
python3 tools/virgl-92cb-geometry/capture.py target/evidence/virgl-92cb-raster/geometry.bin > "$evidence/capture.log"
python3 tools/virgl-92cb-raster/capture.py target/evidence/virgl-92cb-raster/raster.json >> "$evidence/capture.log"
python3 tools/virgl-92cb-power-domain/pin_private_inputs.py --check
cp target/evidence/virgl-92cb-raster/geometry.bin "$evidence/geometry.bin"
cp target/evidence/virgl-92cb-raster/raster.json "$evidence/raster.json"
bash renderer/virgl-shader/build.sh original-92cb-complete-sanitize > "$evidence/native-build.log" 2>&1
LLVM_PROFILE_FILE="$PWD/$evidence/native.profraw" \
  renderer/virgl-shader/build/original-92cb-complete-sanitize/original-92cb-complete-test \
  "$vertex" "$fragment" "$evidence/geometry.bin" > "$evidence/native.out"
mkdir -p renderer/virgl-shader/build/original-92cb-complete-wasm
cp "$vertex" renderer/virgl-shader/build/original-92cb-complete-wasm/vertex.tgsi
cp "$fragment" renderer/virgl-shader/build/original-92cb-complete-wasm/fragment.tgsi
cp "$evidence/geometry.bin" renderer/virgl-shader/build/original-92cb-complete-wasm/geometry.bin
emcc_bin=$(bash tools/setup-virgl-emsdk.sh)
EMCC="$emcc_bin" bash renderer/virgl-shader/build.sh original-92cb-complete-wasm > "$evidence/wasm-build.log" 2>&1
(cd renderer/virgl-shader/build/original-92cb-complete-wasm && \
  node original-92cb-complete.js /vertex.tgsi /fragment.tgsi /geometry.bin) > "$evidence/wasm.out"
cmp "$evidence/native.out" "$evidence/wasm.out"
EMCC="$emcc_bin" bash renderer/virgl-shader/build.sh wasm > "$evidence/production-wasm-build.log" 2>&1
node tools/virgl-original-programs/interfaces.mjs > "$evidence/interfaces.json"
node tools/virgl-original-programs/browser.mjs --output "$evidence/browser" > "$evidence/browser.log" 2>&1
for fault in source bank negative nonfinite geometry zero-crossing post-source post-bank \
  post-geometry post-parsed-bank post-parsed-quad post-sample viewport post-bound-exponent \
  post-bound-vertex post-bound-attribute post-bound-color post-buffer-exponent post-clear-exponent \
  output discard power-value power-negative power-subnormal power-nan power-zero power-envelope; do
  if node tools/virgl-original-programs/browser.mjs --output "$evidence/fault-$fault" --fault "$fault" \
      > "$evidence/fault-$fault.log" 2>&1; then
    echo "Full original $fault mutation unexpectedly passed." >&2
    exit 1
  fi
done
xcrun llvm-profdata merge -sparse "$evidence/native.profraw" -o "$evidence/native.profdata"
xcrun llvm-cov export renderer/virgl-shader/build/original-92cb-complete-sanitize/original-92cb-complete-test \
  -instr-profile="$evidence/native.profdata" > "$evidence/native-coverage.json"
node tools/virgl-original-programs/audit.mjs "$evidence" > "$evidence/audit.log"
# Carry the original nineteen and G6a four new bodies through the actual native,
# Wasm and physical pipeline, without re-litigating their unchanged HELD proofs.
EMCC="$emcc_bin" VIRGL_GEARS_SHADER_EVIDENCE_DIR="$PWD/$evidence/retained-gears" \
  make verify-E6-T12g6a > "$evidence/retained-gears.log" 2>&1
bash renderer/virgl-shader/build.sh original-corpus-sanitize > "$evidence/retained-native-build.log" 2>&1
python3 tools/virgl-original-corpus/native.py \
  --binary renderer/virgl-shader/build/original-corpus-sanitize/original-corpus-test \
  --output "$evidence/retained-originals/native" > "$evidence/retained-native.log"
node tools/virgl-original-corpus/wasm.mjs --native "$evidence/retained-originals/native/report.json" \
  --output "$evidence/retained-originals/wasm" > "$evidence/retained-wasm.log"
make verify-E6-T12g6m5a > "$evidence/retained-c580.log" 2>&1
cp -R target/evidence/virgl-original-c580 "$evidence/c580"
python3 tools/virgl-original-programs/receipt.py "$evidence"
