#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_INSTANCE_BASE_EVIDENCE_DIR:-target/evidence/virgl-instance-base}
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
for file in renderer/virgl-shader/standard.mjs renderer/virgl-shader/tests/standard-instance-base-browser.mjs tools/virgl-instance-base/*.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-instance-base/*.py
bash -n tools/verify-virgl-instance-base.sh
python3 tools/virgl-instance-base/seal-test.py
mkdir -p "$evidence/native" "$evidence/coverage" "$evidence/node-coverage" "$evidence/stack"
python3 tools/virgl-instance-base/predecessor.py "$evidence/native/predecessor"
node tools/virgl-instance-base/compiler.mjs cases "$evidence/native"
bash renderer/virgl-shader/build.sh standard-instance-base-native
renderer/virgl-shader/build/standard-instance-base-native/standard-instance-base-test "$evidence/native/cases.bin" > "$evidence/native/native.jsonl"
bash renderer/virgl-shader/build.sh standard-instance-base-sanitize
LLVM_PROFILE_FILE="$evidence/coverage/matrix.profraw" renderer/virgl-shader/build/standard-instance-base-sanitize/standard-instance-base-test "$evidence/native/cases.bin" > "$evidence/native/sanitize.jsonl"
cmp "$evidence/native/native.jsonl" "$evidence/native/sanitize.jsonl"
bash renderer/virgl-shader/build.sh standard-instance-base-allocation-sanitize
LLVM_PROFILE_FILE="$evidence/coverage/allocations.profraw" renderer/virgl-shader/build/standard-instance-base-allocation-sanitize/standard-instance-base-allocation-test > "$evidence/native/allocations.jsonl"
for mode in matrix allocations; do
 binary=standard-instance-base-sanitize/standard-instance-base-test
 if [[ "$mode" == allocations ]]; then binary=standard-instance-base-allocation-sanitize/standard-instance-base-allocation-test; fi
 xcrun llvm-profdata merge -sparse "$evidence/coverage/$mode.profraw" -o "$evidence/coverage/$mode.profdata"
 xcrun llvm-cov export "renderer/virgl-shader/build/$binary" -instr-profile="$evidence/coverage/$mode.profdata" > "$evidence/coverage/$mode.json"
done
bash renderer/virgl-shader/build.sh standard-wasm-stack
cp renderer/virgl-shader/build/standard-wasm-stack/*.su "$evidence/stack/"
bash renderer/virgl-shader/build.sh wasm
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/virgl-instance-base/compiler.mjs audit "$evidence/native"
node tools/virgl-instance-base/browser.mjs --inputs "$evidence" --output "$evidence/hardware"
if node tools/virgl-instance-base/browser.mjs --inputs "$evidence" --output "$evidence/fault-wrong-offset" --fault wrong-offset; then
 echo 'ERROR: completed wrong instance offset escaped original words' >&2
 exit 1
fi
python3 tools/virgl-instance-base/pixels.py "$evidence"
python3 tools/virgl-instance-base/coverage.py "$evidence"
set +x
printf 'INSTANCE_BASE_RECORDING_COMPLETE\n'
python3 tools/virgl-instance-base/receipt.py "$evidence"
