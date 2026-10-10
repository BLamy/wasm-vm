#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_STANDARD_POINTS_EVIDENCE_DIR:-target/evidence/virgl-standard-points}
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
for file in renderer/virgl-command/{state,constant-domain,decoder}.mjs renderer/virgl-command/tests/standard-native-points.mjs tools/verify-virgl-standard-points.mjs tools/virgl-command/standard-point-{oracle,pixels}.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/standard-point-{cases,receipt,cold,seal}.py
bash -n tools/verify-virgl-standard-points.sh
# The standard C path changed; preserve all directly affected compiler/native
# shader checks plus its authenticated, unchanged legacy/raw/private boundary.
VIRGL_STANDARD_SHADER_EVIDENCE_DIR="$evidence/retained-compiler" bash tools/verify-virgl-standard-shader.sh
mkdir -p "$evidence/abi" "$evidence/native" "$evidence/coverage"
for mode in native sanitize; do
  flags=()
  if [[ $mode == sanitize ]]; then flags+=(-fsanitize=address,undefined -fno-omit-frame-pointer); fi
  clang -std=gnu11 -Wall -Wextra -Werror -DUTIL_ARCH_LITTLE_ENDIAN=1 -DUTIL_ARCH_BIG_ENDIAN=0 "${flags[@]}" -Irenderer/virgl-shader/vendor/src/gallium/include -Irenderer/virgl-shader/vendor/src/mesa/pipe -Irenderer/virgl-shader/vendor/src/mesa/compat -Irenderer/virgl-shader/vendor/src/mesa -Irenderer/virgl-shader/vendor/src tools/virgl-command/standard-point-enums.c -o "$evidence/abi/points-$mode"
  "$evidence/abi/points-$mode" > "$evidence/abi/points-$mode.json"
done
cmp "$evidence/abi/points-native.json" "$evidence/abi/points-sanitize.json"
cp "$evidence/retained-compiler/abi/native.json" "$evidence/abi/native.json"
python3 tools/virgl-command/standard-point-cases.py "$evidence/native"
renderer/virgl-shader/build/standard-native/standard-test "$evidence/native/cases.bin" > "$evidence/native/native.jsonl"
LLVM_PROFILE_FILE="$evidence/coverage/points.profraw" renderer/virgl-shader/build/standard-sanitize/standard-test "$evidence/native/cases.bin" > "$evidence/native/sanitize.jsonl"
cmp "$evidence/native/native.jsonl" "$evidence/native/sanitize.jsonl"
python3 tools/virgl-standard-shader/metadata.py "$evidence/native"
node tools/virgl-standard-shader/node.mjs "$evidence/native"
xcrun llvm-profdata merge -sparse "$evidence/coverage/points.profraw" -o "$evidence/coverage/points.profdata"
xcrun llvm-cov export renderer/virgl-shader/build/standard-sanitize/standard-test -instr-profile="$evidence/coverage/points.profdata" > "$evidence/coverage/points.json"
# Changed metadata and uniforms execute through both selected primitive lists
# and the default original restart path. Their historical records stay sealed.
node tools/verify-virgl-standard-assembly.mjs --output "$evidence/retained-assembly/hardware"
for fault in list-order provoking; do
  if node tools/verify-virgl-standard-assembly.mjs --output "$evidence/retained-assembly/fault-$fault" --smoke true --mutation "$fault"; then
    echo 'ERROR: original assembly regression escaped its pixel oracle' >&2
    exit 1
  fi
done
node tools/virgl-command/standard-assembly-pixels.mjs "$evidence/retained-assembly"
node tools/verify-virgl-standard-restart.mjs --output "$evidence/retained-restart/hardware"
if node tools/verify-virgl-standard-restart.mjs --output "$evidence/retained-restart/fault-restart" --smoke true --mutation restart; then
  echo 'ERROR: original default restart regression escaped its pixel oracle' >&2
  exit 1
fi
node tools/virgl-command/standard-restart-pixels.mjs "$evidence/retained-restart"
node tools/verify-virgl-standard-points.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-points.mjs --output "$evidence/hardware"
for fault in size-selection coord-y; do
  if node tools/verify-virgl-standard-points.mjs --output "$evidence/fault-$fault" --smoke true --mutation "$fault"; then
    echo 'ERROR: completed native point regression escaped its original pixel oracle' >&2
    exit 1
  fi
done
node tools/virgl-command/standard-point-pixels.mjs "$evidence"
set +x
printf 'STANDARD_POINTS_RECORDING_COMPLETE\n'
python3 tools/virgl-command/standard-point-receipt.py "$evidence"
