#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
output=${VIRGL_STANDARD_UNIFORM_ADVERSARIAL_DIR:-target/evidence/virgl-standard-uniform-adversarial}
mkdir -p "$output"
output=$(cd "$output" && pwd)
exec > >(tee "$output/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC ASAN_OPTIONS=abort_on_error=1 UBSAN_OPTIONS=halt_on_error=1
for file in tools/virgl-standard-uniform/adversarial/*.mjs; do node --check "$file"; done
for file in tools/virgl-standard-uniform/adversarial/*.sh; do bash -n "$file"; done
bash renderer/virgl-shader/build.sh standard-uniform-native
bash renderer/virgl-shader/build.sh wasm
bash tools/virgl-standard-uniform/adversarial/build-original-offsets.sh "$output/native"
LLVM_PROFILE_FILE="$output/native/offsets.profraw" "$output/native/original-offsets" > "$output/native/original-offsets.jsonl"
node tools/virgl-standard-uniform/adversarial/recheck-wasm.mjs "$output/native"
xcrun llvm-profdata merge -sparse "$output/native/offsets.profraw" -o "$output/native/offsets.profdata"
xcrun llvm-cov export "$output/native/original-offsets" -instr-profile="$output/native/offsets.profdata" > "$output/native/offsets-coverage.json"
node tools/virgl-standard-uniform/adversarial/run-novel.mjs "$output/hardware"
node tools/virgl-standard-uniform/adversarial/run-novel.mjs "$output/sabotage" sabotage
printf 'Original signed16/direct-limit regression and 64 completed endpoint draws passed; post-fence sabotage rejected.\n'
