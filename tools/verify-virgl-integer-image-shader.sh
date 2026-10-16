#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_INTEGER_SHADER_EVIDENCE_DIR:-target/evidence/virgl-integer-image-shader}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
rm -f "$evidence/receipt.json"
exec > >(tee "$evidence/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC ASAN_OPTIONS=abort_on_error=1 UBSAN_OPTIONS=halt_on_error=1
set -x
git rev-parse HEAD
git diff --check
python3 tools/virgl-original-corpus/toolchain.py > "$evidence/toolchain.json"
for file in renderer/virgl-shader/standard.mjs renderer/virgl-shader/tests/standard-integer-image-shader-browser.mjs tools/virgl-integer-image-shader/*.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-integer-image-shader/*.py
bash -n tools/verify-virgl-integer-image-shader.sh
mkdir -p "$evidence/native" "$evidence/coverage" "$evidence/node-coverage" "$evidence/stack"
python3 tools/virgl-integer-image-shader/predecessor.py "$evidence/native/predecessor"
node tools/virgl-integer-image-shader/compiler.mjs cases "$evidence/native"
bash renderer/virgl-shader/build.sh standard-integer-image-shader-native
renderer/virgl-shader/build/standard-integer-image-shader-native/standard-integer-image-shader-test "$evidence/native/cases.bin" > "$evidence/native/native.jsonl"
bash renderer/virgl-shader/build.sh standard-integer-image-shader-sanitize
LLVM_PROFILE_FILE="$evidence/coverage/matrix.profraw" renderer/virgl-shader/build/standard-integer-image-shader-sanitize/standard-integer-image-shader-test "$evidence/native/cases.bin" > "$evidence/native/sanitize.jsonl"
cmp "$evidence/native/native.jsonl" "$evidence/native/sanitize.jsonl"
bash renderer/virgl-shader/build.sh standard-integer-image-shader-allocation-sanitize
LLVM_PROFILE_FILE="$evidence/coverage/allocations.profraw" renderer/virgl-shader/build/standard-integer-image-shader-allocation-sanitize/standard-integer-image-shader-allocation-test > "$evidence/native/allocations.jsonl"
for mode in matrix allocations; do
 binary=standard-integer-image-shader-sanitize/standard-integer-image-shader-test
 if [[ "$mode" == allocations ]]; then binary=standard-integer-image-shader-allocation-sanitize/standard-integer-image-shader-allocation-test; fi
 xcrun llvm-profdata merge -sparse "$evidence/coverage/$mode.profraw" -o "$evidence/coverage/$mode.profdata"
 xcrun llvm-cov export "renderer/virgl-shader/build/$binary" -instr-profile="$evidence/coverage/$mode.profdata" > "$evidence/coverage/$mode.json"
done
bash renderer/virgl-shader/build.sh standard-wasm-stack
cp renderer/virgl-shader/build/standard-wasm-stack/*.su "$evidence/stack/"
bash renderer/virgl-shader/build.sh wasm
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/virgl-integer-image-shader/compiler.mjs audit "$evidence/native"
# The affected historical FLOAT compiler/facade and whole native pixel path.
mkdir -p "$evidence/retained-texture/native/predecessor"
for file in authentication.json virgl-shader.mjs virgl-shader.wasm; do
 cp "$evidence/native/predecessor/$file" "$evidence/retained-texture/native/predecessor/$file"
done
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/virgl-standard-texture/compiler.mjs audit "$evidence/retained-texture/native"
node tools/virgl-integer-image-shader/browser.mjs --inputs "$evidence" --output "$evidence/hardware"
for fault in wrong-level wrong-words; do
 if node tools/virgl-integer-image-shader/browser.mjs --inputs "$evidence" --output "$evidence/fault-$fault" --fault "$fault"; then
  echo 'ERROR: physical integer shader corruption escaped original words' >&2
  exit 1
 fi
done
python3 tools/virgl-integer-image-shader/pixels.py "$evidence"
node tools/virgl-standard-texture/browser.mjs --inputs "$evidence/retained-texture" --output "$evidence/retained-texture/hardware"
for fault in lod-selection gradient-state query-levels; do
 if node tools/virgl-standard-texture/browser.mjs --inputs "$evidence/retained-texture" --output "$evidence/retained-texture/fault-$fault" --fault "$fault"; then
  echo 'ERROR: historical FLOAT texture corruption escaped original pixels' >&2
  exit 1
 fi
done
python3 tools/virgl-standard-texture/pixels.py "$evidence/retained-texture"
python3 tools/virgl-integer-image-shader/coverage.py "$evidence"
set +x
printf 'INTEGER_IMAGE_SHADER_RECORDING_COMPLETE\n'
python3 tools/virgl-integer-image-shader/receipt.py "$evidence"
