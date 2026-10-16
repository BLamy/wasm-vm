#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_STANDARD_INTEGER_EVIDENCE_DIR:-target/evidence/virgl-standard-integer}
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
for file in renderer/virgl-command/{decoder,state,constant-domain}.mjs renderer/virgl-shader/standard.mjs renderer/virgl-command/tests/{standard-integer-vertex-inputs,standard-compact-vertex-fetch,standard-scalar-vertex-fetch}.mjs tools/verify-virgl-standard-integer.mjs tools/virgl-command/standard-integer-{oracle,pixels,compiler}.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/standard-integer-{receipt,cold,seal,coverage}.py
bash -n tools/verify-virgl-standard-integer.sh
# The standard C facet/shared emitter changed. Retain the full affected compiler
# gate, its literal/native/Wasm oracle, allocation faults and ordinary/private anchors.
VIRGL_STANDARD_SHADER_EVIDENCE_DIR="$evidence/compiler-retained" bash tools/verify-virgl-standard-shader.sh
mkdir -p "$evidence/abi" "$evidence/native" "$evidence/coverage" "$evidence/node-coverage"
for mode in native sanitize; do
 flags=(-g)
 if [[ $mode == sanitize ]]; then flags+=(-fsanitize=address,undefined -fno-omit-frame-pointer); fi
 clang -std=gnu11 -Wall -Wextra -Werror -DUTIL_ARCH_LITTLE_ENDIAN=1 -DUTIL_ARCH_BIG_ENDIAN=0 "${flags[@]}" -Irenderer/virgl-shader/vendor/src/gallium/include -Irenderer/virgl-shader/vendor/src/mesa/pipe -Irenderer/virgl-shader/vendor/src/mesa/compat -Irenderer/virgl-shader/vendor/src/mesa -Irenderer/virgl-shader/vendor/src tools/virgl-command/standard-integer-enums.c -o "$evidence/abi/integer-$mode"
 "$evidence/abi/integer-$mode" > "$evidence/abi/integer-$mode.json"
done
cmp "$evidence/abi/integer-native.json" "$evidence/abi/integer-sanitize.json"
node tools/virgl-command/standard-integer-compiler.mjs cases "$evidence/native"
bash renderer/virgl-shader/build.sh standard-integer-native
renderer/virgl-shader/build/standard-integer-native/standard-integer-test "$evidence/native/cases.bin" > "$evidence/native/native.jsonl"
bash renderer/virgl-shader/build.sh standard-integer-sanitize
LLVM_PROFILE_FILE="$evidence/coverage/matrix.profraw" renderer/virgl-shader/build/standard-integer-sanitize/standard-integer-test "$evidence/native/cases.bin" > "$evidence/native/sanitize.jsonl"
cmp "$evidence/native/native.jsonl" "$evidence/native/sanitize.jsonl"
bash renderer/virgl-shader/build.sh standard-integer-allocation-sanitize
LLVM_PROFILE_FILE="$evidence/coverage/allocations.profraw" renderer/virgl-shader/build/standard-integer-allocation-sanitize/standard-integer-allocation-test > "$evidence/native/allocations.jsonl"
for mode in matrix allocations; do
 binary=standard-integer-sanitize/standard-integer-test
 if [[ $mode == allocations ]]; then binary=standard-integer-allocation-sanitize/standard-integer-allocation-test; fi
 xcrun llvm-profdata merge -sparse "$evidence/coverage/$mode.profraw" -o "$evidence/coverage/$mode.profdata"
 xcrun llvm-cov export "renderer/virgl-shader/build/$binary" -instr-profile="$evidence/coverage/$mode.profdata" > "$evidence/coverage/$mode.json"
done
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/virgl-command/standard-integer-compiler.mjs audit "$evidence/native"
node tools/verify-virgl-standard-integer.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-integer.mjs --output "$evidence/hardware"
for fault in native-signedness constant-word shader-conversion; do
 if node tools/verify-virgl-standard-integer.mjs --output "$evidence/fault-$fault" --smoke true --mutation "$fault"; then
  echo 'ERROR: actual integer input fault escaped original full pixels' >&2
  exit 1
 fi
done
node tools/virgl-command/standard-integer-pixels.mjs "$evidence"
# Preserve the changed floating dispatch paths, including their original oracles
# and two successful native draw/fence sabotages. Historical archives stay intact.
node tools/verify-virgl-standard-scalar.mjs --output "$evidence/retained-scalar/wire" --node-only true
node tools/verify-virgl-standard-scalar.mjs --output "$evidence/retained-scalar/hardware"
for fault in native-signedness constant-scaled; do
 if node tools/verify-virgl-standard-scalar.mjs --output "$evidence/retained-scalar/fault-$fault" --smoke true --mutation "$fault"; then exit 1; fi
done
node tools/virgl-command/standard-scalar-pixels.mjs "$evidence/retained-scalar"
node tools/verify-virgl-standard-compact.mjs --output "$evidence/retained-compact/hardware"
for fault in native-normalize constant-unpack; do
 if node tools/verify-virgl-standard-compact.mjs --output "$evidence/retained-compact/fault-$fault" --smoke true --mutation "$fault"; then exit 1; fi
done
node tools/virgl-command/standard-compact-pixels.mjs "$evidence/retained-compact"
python3 tools/virgl-command/standard-integer-coverage.py "$evidence"
set +x
printf 'STANDARD_INTEGER_RECORDING_COMPLETE\n'
python3 tools/virgl-command/standard-integer-receipt.py "$evidence"
