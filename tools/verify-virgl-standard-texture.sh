#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_STANDARD_TEXTURE_EVIDENCE_DIR:-target/evidence/virgl-standard-texture}
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
for file in renderer/virgl-shader/standard.mjs renderer/virgl-shader/tests/standard-texture-browser.mjs tools/virgl-standard-texture/*.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-standard-texture/*.py
bash -n tools/verify-virgl-standard-texture.sh
mkdir -p "$evidence/native" "$evidence/coverage" "$evidence/node-coverage" "$evidence/stack"
python3 tools/virgl-standard-texture/predecessor.py "$evidence/native/predecessor"
node tools/virgl-standard-texture/compiler.mjs cases "$evidence/native"
bash renderer/virgl-shader/build.sh standard-texture-native
renderer/virgl-shader/build/standard-texture-native/standard-texture-test "$evidence/native/cases.bin" > "$evidence/native/native.jsonl"
bash renderer/virgl-shader/build.sh standard-texture-sanitize
LLVM_PROFILE_FILE="$evidence/coverage/matrix.profraw" renderer/virgl-shader/build/standard-texture-sanitize/standard-texture-test "$evidence/native/cases.bin" > "$evidence/native/sanitize.jsonl"
cmp "$evidence/native/native.jsonl" "$evidence/native/sanitize.jsonl"
bash renderer/virgl-shader/build.sh standard-texture-allocation-sanitize
LLVM_PROFILE_FILE="$evidence/coverage/allocations.profraw" renderer/virgl-shader/build/standard-texture-allocation-sanitize/standard-texture-allocation-test > "$evidence/native/allocations.jsonl"
for mode in matrix allocations; do
 binary=standard-texture-sanitize/standard-texture-test
 if [[ $mode == allocations ]]; then binary=standard-texture-allocation-sanitize/standard-texture-allocation-test; fi
 xcrun llvm-profdata merge -sparse "$evidence/coverage/$mode.profraw" -o "$evidence/coverage/$mode.profdata"
 xcrun llvm-cov export "renderer/virgl-shader/build/$binary" -instr-profile="$evidence/coverage/$mode.profdata" > "$evidence/coverage/$mode.json"
done
bash renderer/virgl-shader/build.sh standard-wasm-stack
cp renderer/virgl-shader/build/standard-wasm-stack/*.su "$evidence/stack/"
bash renderer/virgl-shader/build.sh wasm
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/virgl-standard-texture/compiler.mjs audit "$evidence/native"
# Affected historical public ABIs retain their original frozen admissions and
# metadata. Their resource/transport/native-image proofs carry by D22 seal.
for family in uniform packed integer; do
  target="$evidence/retained-$family"
  mkdir -p "$target"
  compiler="tools/virgl-command/standard-$family-compiler.mjs"
  if [[ $family == uniform ]]; then compiler=tools/virgl-standard-uniform/compiler.mjs; fi
  node "$compiler" cases "$target"
  bash renderer/virgl-shader/build.sh "standard-$family-native"
  "renderer/virgl-shader/build/standard-$family-native/standard-$family-test" "$target/cases.bin" > "$target/native.jsonl"
  bash renderer/virgl-shader/build.sh "standard-$family-sanitize"
  LLVM_PROFILE_FILE="$evidence/coverage/$family-retained.profraw" "renderer/virgl-shader/build/standard-$family-sanitize/standard-$family-test" "$target/cases.bin" > "$target/sanitize.jsonl"
  cmp "$target/native.jsonl" "$target/sanitize.jsonl"
  NODE_V8_COVERAGE="$evidence/node-coverage" node "$compiler" audit "$target"
  xcrun llvm-profdata merge -sparse "$evidence/coverage/$family-retained.profraw" -o "$evidence/coverage/$family-retained.profdata"
  xcrun llvm-cov export "renderer/virgl-shader/build/standard-$family-sanitize/standard-$family-test" -instr-profile="$evidence/coverage/$family-retained.profdata" > "$evidence/coverage/$family-retained.json"
done
node tools/virgl-standard-texture/browser.mjs --inputs "$evidence" --output "$evidence/hardware"
for fault in lod-selection gradient-state query-levels; do
  if node tools/virgl-standard-texture/browser.mjs --inputs "$evidence" --output "$evidence/fault-$fault" --fault "$fault"; then
    echo 'ERROR: native texture state fault escaped original hardware pixels' >&2
    exit 1
  fi
done
python3 tools/virgl-standard-texture/pixels.py "$evidence"
python3 tools/virgl-standard-texture/coverage.py "$evidence"
set +x
printf 'STANDARD_TEXTURE_RECORDING_COMPLETE\n'
python3 tools/virgl-standard-texture/receipt.py "$evidence"
