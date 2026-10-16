#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_INTEGER_SHADER_CRITIC_EVIDENCE_DIR:-target/evidence/virgl-integer-image-shader-critic-$(git rev-parse --short=12 HEAD)}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
exec > >(tee "$evidence/critic.log") 2>&1
set -x
python3 tools/virgl-integer-image-shader/critic-authenticate.py "$evidence"
python3 tools/virgl-integer-image-shader/critic-words.py "$evidence"
python3 tools/virgl-integer-image-shader/critic-coverage.py "$evidence"
node tools/virgl-integer-image-shader/critic-module.mjs "$evidence"
node tools/virgl-integer-image-shader/critic-inputs.mjs cases "$evidence/fresh"
bash renderer/virgl-shader/build.sh standard-integer-image-shader-native
renderer/virgl-shader/build/standard-integer-image-shader-native/standard-integer-image-shader-test "$evidence/fresh/cases.bin" > "$evidence/fresh/native.jsonl"
bash renderer/virgl-shader/build.sh standard-integer-image-shader-sanitize
ASAN_OPTIONS=abort_on_error=1 UBSAN_OPTIONS=halt_on_error=1 LLVM_PROFILE_FILE="$evidence/fresh/matrix.profraw" renderer/virgl-shader/build/standard-integer-image-shader-sanitize/standard-integer-image-shader-test "$evidence/fresh/cases.bin" > "$evidence/fresh/sanitize.jsonl"
bash renderer/virgl-shader/build.sh standard-integer-image-shader-allocation-sanitize
ASAN_OPTIONS=abort_on_error=1 UBSAN_OPTIONS=halt_on_error=1 LLVM_PROFILE_FILE="$evidence/fresh/allocations.profraw" renderer/virgl-shader/build/standard-integer-image-shader-allocation-sanitize/standard-integer-image-shader-allocation-test > "$evidence/fresh/allocations.jsonl"
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
EMCC="$EMCC" bash renderer/virgl-shader/build.sh wasm
node tools/virgl-integer-image-shader/critic-inputs.mjs audit "$evidence/fresh"
node tools/virgl-integer-image-shader/critic-replay-browser.mjs --inputs "$evidence/worker/hot" --output "$evidence/complete-custody/hardware"
for fault in wrong-level wrong-words; do
 if node tools/virgl-integer-image-shader/critic-replay-browser.mjs --inputs "$evidence/worker/hot" --output "$evidence/complete-custody/fault-$fault" --fault "$fault"; then
  echo "ERROR: actual native $fault texture corruption escaped the unchanged original oracle" >&2
  exit 1
 fi
done
python3 tools/virgl-integer-image-shader/critic-words.py "$evidence"
node tools/virgl-integer-image-shader/critic-browser.mjs --inputs "$evidence/fresh" --output "$evidence/novel-native"
if node tools/virgl-integer-image-shader/critic-browser.mjs --inputs "$evidence/fresh" --output "$evidence/sabotage-post-completion" --fault post-pixel; then
 echo 'ERROR: native post-completion pixel corruption escaped the unchanged original oracle' >&2
 exit 1
fi
python3 tools/virgl-integer-image-shader/critic-native-words.py "$evidence"
set +x
printf 'INTEGER_IMAGE_SHADER_CRITIC_RECORDING_COMPLETE\n'
