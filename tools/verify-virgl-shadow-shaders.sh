#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_SHADOW_TEXTURE_EVIDENCE_DIR:-target/evidence/virgl-shadow-shaders}
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
for file in renderer/virgl-shader/standard.mjs renderer/virgl-shader/tests/standard-shadow-texture-browser.mjs tools/virgl-shadow-shaders/*.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-shadow-shaders/*.py
bash -n tools/verify-virgl-shadow-shaders.sh
python3 tools/virgl-shadow-shaders/seal-test.py
mkdir -p "$evidence/native" "$evidence/coverage" "$evidence/node-coverage" "$evidence/stack"
python3 tools/virgl-shadow-shaders/predecessor.py "$evidence/native/predecessor"
node tools/virgl-shadow-shaders/compiler.mjs cases "$evidence/native"
bash renderer/virgl-shader/build.sh standard-shadow-texture-native
renderer/virgl-shader/build/standard-shadow-texture-native/standard-shadow-texture-test "$evidence/native/cases.bin" > "$evidence/native/native.jsonl"
bash renderer/virgl-shader/build.sh standard-shadow-texture-sanitize
LLVM_PROFILE_FILE="$evidence/coverage/matrix.profraw" renderer/virgl-shader/build/standard-shadow-texture-sanitize/standard-shadow-texture-test "$evidence/native/cases.bin" > "$evidence/native/sanitize.jsonl"
cmp "$evidence/native/native.jsonl" "$evidence/native/sanitize.jsonl"
bash renderer/virgl-shader/build.sh standard-shadow-texture-allocation-sanitize
LLVM_PROFILE_FILE="$evidence/coverage/allocations.profraw" renderer/virgl-shader/build/standard-shadow-texture-allocation-sanitize/standard-shadow-texture-allocation-test > "$evidence/native/allocations.jsonl"
for mode in matrix allocations; do
 binary=standard-shadow-texture-sanitize/standard-shadow-texture-test
 if [[ "$mode" == allocations ]]; then binary=standard-shadow-texture-allocation-sanitize/standard-shadow-texture-allocation-test; fi
 xcrun llvm-profdata merge -sparse "$evidence/coverage/$mode.profraw" -o "$evidence/coverage/$mode.profdata"
 xcrun llvm-cov export "renderer/virgl-shader/build/$binary" -instr-profile="$evidence/coverage/$mode.profdata" > "$evidence/coverage/$mode.json"
done
bash renderer/virgl-shader/build.sh standard-wasm-stack
cp renderer/virgl-shader/build/standard-wasm-stack/*.su "$evidence/stack/"
bash renderer/virgl-shader/build.sh wasm
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/virgl-shadow-shaders/compiler.mjs audit "$evidence/native"
node tools/virgl-shadow-shaders/browser.mjs --inputs "$evidence" --output "$evidence/hardware"
if node tools/virgl-shadow-shaders/browser.mjs --inputs "$evidence" --output "$evidence/fault-wrong-mask" --fault wrong-mask; then
 echo 'ERROR: completed wrong shadow view control escaped original words' >&2
 exit 1
fi
python3 tools/virgl-shadow-shaders/pixels.py "$evidence"
python3 tools/virgl-shadow-shaders/coverage.py "$evidence"
set +x
printf 'SHADOW_TEXTURE_RECORDING_COMPLETE\n'
python3 tools/virgl-shadow-shaders/receipt.py "$evidence"
