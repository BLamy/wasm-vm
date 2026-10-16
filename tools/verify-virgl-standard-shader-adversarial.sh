#!/usr/bin/env bash
# Promoted fresh verifier suite. No runtime changes or complete API claims.
set -euo pipefail
cd "$(dirname "$0")/.."
output=${VIRGL_STANDARD_ADVERSARIAL_EVIDENCE_DIR:-target/evidence/virgl-standard-shader-adversarial}
mkdir -p "$output/native" "$output/abi" "$output/coverage"
output=$(cd "$output" && pwd)
exec > >(tee "$output/acceptance.log") 2>&1
export ASAN_OPTIONS=abort_on_error=1 UBSAN_OPTIONS=halt_on_error=1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
python3 tools/virgl-standard-shader/adversarial-cases.py "$output"
clang -std=gnu11 -Wall -Wextra -Werror -Irenderer/virgl-shader/vendor/src/gallium/include tools/virgl-standard-shader/enums.c -o "$output/abi/enums"
"$output/abi/enums" > "$output/abi/native.json"
bash renderer/virgl-shader/build.sh standard-native
renderer/virgl-shader/build/standard-native/standard-test "$output/native/cases.bin" > "$output/native/native.jsonl"
bash renderer/virgl-shader/build.sh standard-sanitize
LLVM_PROFILE_FILE="$output/coverage/native.profraw" renderer/virgl-shader/build/standard-sanitize/standard-test "$output/native/cases.bin" > "$output/native/sanitize.jsonl"
cmp "$output/native/native.jsonl" "$output/native/sanitize.jsonl"
python3 tools/virgl-standard-shader/metadata.py "$output/native"
xcrun llvm-profdata merge -sparse "$output/coverage/native.profraw" -o "$output/coverage/native.profdata"
xcrun llvm-cov export renderer/virgl-shader/build/standard-sanitize/standard-test -instr-profile="$output/coverage/native.profdata" > "$output/coverage/native.json"
bash renderer/virgl-shader/build.sh wasm
node tools/virgl-standard-shader/node.mjs "$output/native"
node tools/virgl-standard-shader/adversarial-pressure.mjs "$output"
node tools/virgl-standard-shader/adversarial-browser.mjs --output "$output/hardware" --inputs "$output"
for fault in sine oracle; do
  if node tools/virgl-standard-shader/adversarial-browser.mjs --output "$output/sabotage-$fault" --inputs "$output" --fault "$fault"; then
    echo "ERROR: critic $fault sabotage escaped its physical oracle" >&2
    exit 1
  fi
done
python3 tools/virgl-standard-shader/adversarial-pixels.py "$output"
