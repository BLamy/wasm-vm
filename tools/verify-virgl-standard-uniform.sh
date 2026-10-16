#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_STANDARD_UNIFORM_EVIDENCE_DIR:-target/evidence/virgl-standard-uniform}
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
for file in renderer/virgl-shader/standard.mjs renderer/virgl-command/constant-domain.mjs renderer/virgl-shader/tests/standard-uniform-browser.mjs tools/virgl-standard-uniform/*.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-standard-uniform/*.py
bash -n tools/verify-virgl-standard-uniform.sh
VIRGL_STANDARD_SHADER_EVIDENCE_DIR="$evidence/compiler-retained" bash tools/verify-virgl-standard-shader.sh
mkdir -p "$evidence/native" "$evidence/coverage" "$evidence/node-coverage"
node tools/virgl-standard-uniform/compiler.mjs cases "$evidence/native"
bash renderer/virgl-shader/build.sh standard-uniform-native
renderer/virgl-shader/build/standard-uniform-native/standard-uniform-test "$evidence/native/cases.bin" > "$evidence/native/native.jsonl"
bash renderer/virgl-shader/build.sh standard-uniform-sanitize
LLVM_PROFILE_FILE="$evidence/coverage/matrix.profraw" renderer/virgl-shader/build/standard-uniform-sanitize/standard-uniform-test "$evidence/native/cases.bin" > "$evidence/native/sanitize.jsonl"
cmp "$evidence/native/native.jsonl" "$evidence/native/sanitize.jsonl"
bash renderer/virgl-shader/build.sh standard-uniform-allocation-sanitize
LLVM_PROFILE_FILE="$evidence/coverage/allocations.profraw" renderer/virgl-shader/build/standard-uniform-allocation-sanitize/standard-uniform-allocation-test > "$evidence/native/allocations.jsonl"
for mode in matrix allocations; do
 binary=standard-uniform-sanitize/standard-uniform-test
 if [[ $mode == allocations ]]; then binary=standard-uniform-allocation-sanitize/standard-uniform-allocation-test; fi
 xcrun llvm-profdata merge -sparse "$evidence/coverage/$mode.profraw" -o "$evidence/coverage/$mode.profdata"
 xcrun llvm-cov export "renderer/virgl-shader/build/$binary" -instr-profile="$evidence/coverage/$mode.profdata" > "$evidence/coverage/$mode.json"
done
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/virgl-standard-uniform/compiler.mjs audit "$evidence/native"
# Keep the old four-mask and typed ABIs at this exact compiler head. The
# unchanged original wire/resource/lifetime proofs carry by sealed digest.
for family in packed integer; do
  target="$evidence/retained-$family"
  mkdir -p "$target"
  node "tools/virgl-command/standard-$family-compiler.mjs" cases "$target"
  bash renderer/virgl-shader/build.sh "standard-$family-native"
  "renderer/virgl-shader/build/standard-$family-native/standard-$family-test" "$target/cases.bin" > "$target/native.jsonl"
  bash renderer/virgl-shader/build.sh "standard-$family-sanitize"
  LLVM_PROFILE_FILE="$evidence/coverage/$family-retained.profraw" "renderer/virgl-shader/build/standard-$family-sanitize/standard-$family-test" "$target/cases.bin" > "$target/sanitize.jsonl"
  cmp "$target/native.jsonl" "$target/sanitize.jsonl"
  bash renderer/virgl-shader/build.sh "standard-$family-allocation-sanitize"
  LLVM_PROFILE_FILE="$evidence/coverage/$family-retained-allocations.profraw" "renderer/virgl-shader/build/standard-$family-allocation-sanitize/standard-$family-allocation-test" > "$target/allocations.jsonl"
  NODE_V8_COVERAGE="$evidence/node-coverage" node "tools/virgl-command/standard-$family-compiler.mjs" audit "$target"
  node "tools/verify-virgl-standard-$family.mjs" --output "$target/hardware"
  for mode in matrix allocations; do
    binary="standard-$family-sanitize/standard-$family-test";profile="$evidence/coverage/$family-retained.profraw"
    if [[ $mode == allocations ]]; then binary="standard-$family-allocation-sanitize/standard-$family-allocation-test";profile="$evidence/coverage/$family-retained-allocations.profraw"; fi
    xcrun llvm-profdata merge -sparse "$profile" -o "$evidence/coverage/$family-$mode.profdata"
    xcrun llvm-cov export "renderer/virgl-shader/build/$binary" -instr-profile="$evidence/coverage/$family-$mode.profdata" > "$evidence/coverage/$family-$mode.json"
  done
done
node tools/virgl-standard-uniform/browser.mjs --inputs "$evidence" --output "$evidence/hardware"
for fault in block-word range-offset slot-zero-variant; do
  if node tools/virgl-standard-uniform/browser.mjs --inputs "$evidence" --output "$evidence/fault-$fault" --fault "$fault"; then
    echo 'ERROR: uniform fault escaped completed original hardware pixels' >&2
    exit 1
  fi
done
node tools/virgl-standard-uniform/pixels.mjs "$evidence"
python3 tools/virgl-standard-uniform/coverage.py "$evidence"
set +x
printf 'STANDARD_UNIFORM_RECORDING_COMPLETE\n'
python3 tools/virgl-standard-uniform/receipt.py "$evidence"
