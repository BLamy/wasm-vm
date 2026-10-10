#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_STANDARD_SHADER_EVIDENCE_DIR:-target/evidence/virgl-standard-shader}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
rm -f "$evidence/receipt.json"
exec > >(tee "$evidence/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
export ASAN_OPTIONS=abort_on_error=1
export UBSAN_OPTIONS=halt_on_error=1
set -x
git rev-parse HEAD
git diff --check
python3 tools/virgl-original-corpus/toolchain.py > "$evidence/toolchain.json"
python3 -m py_compile tools/virgl-standard-shader/*.py
bash -n tools/verify-virgl-standard-shader.sh
for file in renderer/virgl-shader/standard.mjs renderer/virgl-shader/tests/standard-browser.mjs tools/virgl-standard-shader/*.mjs; do node --check "$file"; done
mkdir -p "$evidence/abi" "$evidence/native" "$evidence/coverage" "$evidence/stack"
for mode in native sanitize; do
  flags=(-g)
  if [[ $mode == sanitize ]]; then flags+=(-fsanitize=address,undefined -fno-omit-frame-pointer); fi
  clang -std=gnu11 -Wall -Wextra -Werror "${flags[@]}" -Irenderer/virgl-shader/vendor/src/gallium/include tools/virgl-standard-shader/enums.c -o "$evidence/abi/enums-$mode"
  "$evidence/abi/enums-$mode" > "$evidence/abi/$mode.json"
done
cmp "$evidence/abi/native.json" "$evidence/abi/sanitize.json"
bash renderer/virgl-shader/build.sh guard-check
python3 tools/virgl-standard-shader/cases.py "$evidence/native"
bash renderer/virgl-shader/build.sh standard-native
renderer/virgl-shader/build/standard-native/standard-test "$evidence/native/cases.bin" > "$evidence/native/native.jsonl"
bash renderer/virgl-shader/build.sh standard-sanitize
LLVM_PROFILE_FILE="$evidence/coverage/matrix.profraw" renderer/virgl-shader/build/standard-sanitize/standard-test "$evidence/native/cases.bin" > "$evidence/native/sanitize.jsonl"
cmp "$evidence/native/native.jsonl" "$evidence/native/sanitize.jsonl"
python3 tools/virgl-standard-shader/metadata.py "$evidence/native"
bash renderer/virgl-shader/build.sh standard-allocation-sanitize
LLVM_PROFILE_FILE="$evidence/coverage/allocations.profraw" renderer/virgl-shader/build/standard-allocation-sanitize/standard-allocation-test > "$evidence/native/allocations.jsonl"
xcrun llvm-profdata merge -sparse "$evidence/coverage/matrix.profraw" -o "$evidence/coverage/matrix.profdata"
xcrun llvm-cov export renderer/virgl-shader/build/standard-sanitize/standard-test -instr-profile="$evidence/coverage/matrix.profdata" > "$evidence/coverage/matrix.json"
xcrun llvm-profdata merge -sparse "$evidence/coverage/allocations.profraw" -o "$evidence/coverage/allocations.profdata"
xcrun llvm-cov export renderer/virgl-shader/build/standard-allocation-sanitize/standard-allocation-test -instr-profile="$evidence/coverage/allocations.profdata" > "$evidence/coverage/allocations.json"
bash renderer/virgl-shader/build.sh standard-wasm-stack
cp renderer/virgl-shader/build/standard-wasm-stack/*.su "$evidence/stack/"
bash renderer/virgl-shader/build.sh wasm
node tools/virgl-standard-shader/node.mjs "$evidence/native"
python3 tools/virgl-92cb-geometry/capture.py "$evidence/geometry.bin" > "$evidence/geometry.log"
python3 tools/virgl-original-c580/capture-pairs.py "$evidence/c580.bin" > "$evidence/c580.log"
node tools/virgl-standard-shader/browser.mjs --output "$evidence/hardware" --inputs "$evidence"
if node tools/virgl-standard-shader/browser.mjs --output "$evidence/fault-sine" --inputs "$evidence" --fault sine; then
  echo 'ERROR: actual SIN-to-COS emission escaped the independent pixel oracle' >&2
  exit 1
fi
node tools/virgl-standard-shader/pixels.mjs "$evidence"
# Retain direct ordinary/raw/private behavior. Their unchanged HELD numerical
# proofs remain carried; these are affected-path checks at the new frozen head.
bash renderer/virgl-shader/build.sh sanitize
node tools/virgl-original-corpus/browser.mjs --output "$evidence/retained-ordinary"
node tools/verify-virgl-raw-bits.mjs --output "$evidence/retained-raw"
mkdir -p target/evidence/virgl-92cb-raster target/evidence/virgl-original-c580
cp "$evidence/geometry.bin" target/evidence/virgl-92cb-raster/geometry.bin
cp "$evidence/c580.bin" target/evidence/virgl-original-c580/banks.bin
python3 tools/virgl-92cb-raster/capture.py target/evidence/virgl-92cb-raster/raster.json > "$evidence/retained-raster.log"
node tools/virgl-original-programs/browser.mjs --output "$evidence/retained-private-92cb"
node tools/virgl-original-c580/browser.mjs --output "$evidence/retained-private-c580"
python3 tools/virgl-standard-shader/receipt.py "$evidence"
