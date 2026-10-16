#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_STANDARD_PACKED_EVIDENCE_DIR:-target/evidence/virgl-standard-packed}
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
for file in renderer/virgl-command/{decoder,state}.mjs renderer/virgl-shader/standard.mjs renderer/virgl-command/tests/{standard-packed-vertex-fetch,standard-compact-vertex-fetch,standard-scalar-vertex-fetch,standard-scalar-vertex-fetch-adversarial,standard-integer-vertex-inputs,standard-instanced-draws}.mjs tools/verify-virgl-standard-packed.mjs tools/virgl-command/standard-packed-{oracle,pixels,compiler}.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/standard-packed-{receipt,cold,seal,coverage}.py
bash -n tools/verify-virgl-standard-packed.sh
VIRGL_STANDARD_SHADER_EVIDENCE_DIR="$evidence/compiler-retained" bash tools/verify-virgl-standard-shader.sh
mkdir -p "$evidence/abi" "$evidence/native" "$evidence/coverage" "$evidence/node-coverage" "$evidence/typed-retained"
for mode in native sanitize; do
  flags=(-g)
  if [[ $mode == sanitize ]]; then flags+=(-fsanitize=address,undefined -fno-omit-frame-pointer); fi
  clang -std=gnu11 -Wall -Wextra -Werror -DUTIL_ARCH_LITTLE_ENDIAN=1 -DUTIL_ARCH_BIG_ENDIAN=0 "${flags[@]}" -Irenderer/virgl-shader/vendor/src/gallium/include -Irenderer/virgl-shader/vendor/src/mesa/pipe -Irenderer/virgl-shader/vendor/src/mesa/compat -Irenderer/virgl-shader/vendor/src/mesa -Irenderer/virgl-shader/vendor/src tools/virgl-command/standard-packed-enums.c -o "$evidence/abi/packed-$mode"
  "$evidence/abi/packed-$mode" > "$evidence/abi/packed-$mode.json"
done
cmp "$evidence/abi/packed-native.json" "$evidence/abi/packed-sanitize.json"
node tools/virgl-command/standard-packed-compiler.mjs cases "$evidence/native"
bash renderer/virgl-shader/build.sh standard-packed-native
renderer/virgl-shader/build/standard-packed-native/standard-packed-test "$evidence/native/cases.bin" > "$evidence/native/native.jsonl"
bash renderer/virgl-shader/build.sh standard-packed-sanitize
LLVM_PROFILE_FILE="$evidence/coverage/matrix.profraw" renderer/virgl-shader/build/standard-packed-sanitize/standard-packed-test "$evidence/native/cases.bin" > "$evidence/native/sanitize.jsonl"
cmp "$evidence/native/native.jsonl" "$evidence/native/sanitize.jsonl"
bash renderer/virgl-shader/build.sh standard-packed-allocation-sanitize
LLVM_PROFILE_FILE="$evidence/coverage/allocations.profraw" renderer/virgl-shader/build/standard-packed-allocation-sanitize/standard-packed-allocation-test > "$evidence/native/allocations.jsonl"
for mode in matrix allocations; do
 binary=standard-packed-sanitize/standard-packed-test
 if [[ $mode == allocations ]]; then binary=standard-packed-allocation-sanitize/standard-packed-allocation-test; fi
 xcrun llvm-profdata merge -sparse "$evidence/coverage/$mode.profraw" -o "$evidence/coverage/$mode.profdata"
 xcrun llvm-cov export "renderer/virgl-shader/build/$binary" -instr-profile="$evidence/coverage/$mode.profdata" > "$evidence/coverage/$mode.json"
done
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/virgl-command/standard-packed-compiler.mjs audit "$evidence/native"
# Preserve the distinct typed entry point and all its genuine allocation faults.
node tools/virgl-command/standard-integer-compiler.mjs cases "$evidence/typed-retained"
bash renderer/virgl-shader/build.sh standard-integer-native
renderer/virgl-shader/build/standard-integer-native/standard-integer-test "$evidence/typed-retained/cases.bin" > "$evidence/typed-retained/native.jsonl"
bash renderer/virgl-shader/build.sh standard-integer-sanitize
LLVM_PROFILE_FILE="$evidence/coverage/typed-retained.profraw" renderer/virgl-shader/build/standard-integer-sanitize/standard-integer-test "$evidence/typed-retained/cases.bin" > "$evidence/typed-retained/sanitize.jsonl"
cmp "$evidence/typed-retained/native.jsonl" "$evidence/typed-retained/sanitize.jsonl"
bash renderer/virgl-shader/build.sh standard-integer-allocation-sanitize
LLVM_PROFILE_FILE="$evidence/coverage/typed-retained-allocations.profraw" renderer/virgl-shader/build/standard-integer-allocation-sanitize/standard-integer-allocation-test > "$evidence/typed-retained/allocations.jsonl"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/virgl-command/standard-integer-compiler.mjs audit "$evidence/typed-retained"
for family in compact scalar integer; do
  node "tools/verify-virgl-standard-$family.mjs" --output "$evidence/retained-$family/wire" --node-only true
  node "tools/verify-virgl-standard-$family.mjs" --output "$evidence/retained-$family/hardware"
  case $family in
    compact) faults=(native-normalize constant-unpack);;
    scalar) faults=(native-signedness constant-scaled);;
    integer) faults=(native-signedness constant-word shader-conversion);;
  esac
  for fault in "${faults[@]}"; do
    if node "tools/verify-virgl-standard-$family.mjs" --output "$evidence/retained-$family/fault-$fault" --smoke true --mutation "$fault"; then
      echo 'ERROR: retained original-fetch fault escaped pixels' >&2
      exit 1
    fi
  done
  node "tools/virgl-command/standard-$family-pixels.mjs" "$evidence/retained-$family"
done
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-packed.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-packed.mjs --output "$evidence/hardware"
for fault in native-normalize constant-field shader-sign; do
  if node tools/verify-virgl-standard-packed.mjs --output "$evidence/fault-$fault" --smoke true --mutation "$fault"; then
    echo 'ERROR: actual packed-fetch fault escaped original pixels' >&2
    exit 1
  fi
done
node tools/virgl-command/standard-packed-pixels.mjs "$evidence"
python3 tools/virgl-command/standard-packed-coverage.py "$evidence"
set +x
printf 'STANDARD_PACKED_RECORDING_COMPLETE\n'
python3 tools/virgl-command/standard-packed-receipt.py "$evidence"
