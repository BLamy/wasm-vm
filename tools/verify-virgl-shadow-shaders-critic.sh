#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
critic_evidence=${VIRGL_SHADOW_CRITIC_EVIDENCE_DIR:-target/evidence/virgl-shadow-critic}
mkdir -p "$critic_evidence/independent" "$critic_evidence/coverage" "$critic_evidence/node-coverage"
critic_evidence=$(cd "$critic_evidence" && pwd)
exec > >(tee "$critic_evidence/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC ASAN_OPTIONS=abort_on_error=1 UBSAN_OPTIONS=halt_on_error=1
set -x
git rev-parse HEAD
git diff --check
for file in tools/virgl-shadow-shaders-critic/*.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-shadow-shaders-critic/*.py
bash -n tools/verify-virgl-shadow-shaders-critic.sh
if [[ -n ${VIRGL_SHADOW_CRITIC_CARRY_DIR:-} ]]; then
python3 tools/virgl-shadow-shaders-critic/carry.py "$VIRGL_SHADOW_CRITIC_CARRY_DIR" "$critic_evidence"
else
python3 tools/virgl-shadow-shaders-critic/authenticate.py "$critic_evidence"
node tools/virgl-shadow-shaders-critic/audit-worker.mjs "$critic_evidence"
python3 tools/virgl-shadow-shaders-critic/audit.py coverage "$critic_evidence"
python3 tools/virgl-shadow-shaders-critic/audit.py worker "$critic_evidence"
python3 tools/virgl-original-corpus/toolchain.py > "$critic_evidence/toolchain.json"
node tools/virgl-shadow-shaders-critic/compiler.mjs prepare "$critic_evidence/independent"
bash renderer/virgl-shader/build.sh standard-shadow-texture-native
renderer/virgl-shader/build/standard-shadow-texture-native/standard-shadow-texture-test "$critic_evidence/independent/cases.bin" > "$critic_evidence/independent/native.jsonl"
bash renderer/virgl-shader/build.sh standard-shadow-texture-sanitize
LLVM_PROFILE_FILE="$critic_evidence/coverage/critic.profraw" renderer/virgl-shader/build/standard-shadow-texture-sanitize/standard-shadow-texture-test "$critic_evidence/independent/cases.bin" > "$critic_evidence/independent/sanitize.jsonl"
bash renderer/virgl-shader/build.sh standard-shadow-texture-allocation-sanitize
LLVM_PROFILE_FILE="$critic_evidence/coverage/allocations.profraw" renderer/virgl-shader/build/standard-shadow-texture-allocation-sanitize/standard-shadow-texture-allocation-test > "$critic_evidence/independent/allocations.jsonl"
for mode in critic allocations; do
 critic_binary=standard-shadow-texture-sanitize/standard-shadow-texture-test
 if [[ "$mode" == allocations ]]; then critic_binary=standard-shadow-texture-allocation-sanitize/standard-shadow-texture-allocation-test; fi
 xcrun llvm-profdata merge -sparse "$critic_evidence/coverage/$mode.profraw" -o "$critic_evidence/coverage/$mode.profdata"
 xcrun llvm-cov export "renderer/virgl-shader/build/$critic_binary" -instr-profile="$critic_evidence/coverage/$mode.profdata" > "$critic_evidence/coverage/$mode.json"
done
bash renderer/virgl-shader/build.sh wasm
NODE_V8_COVERAGE="$critic_evidence/node-coverage" node tools/virgl-shadow-shaders-critic/compiler.mjs audit "$critic_evidence/independent"
fi
node tools/virgl-shadow-shaders-critic/tokens.mjs "$critic_evidence"
node tools/virgl-shadow-shaders-critic/browser.mjs --inputs "$critic_evidence/independent" --output "$critic_evidence/independent/hardware"
python3 tools/virgl-shadow-shaders-critic/audit.py novel "$critic_evidence"
set +x
printf 'Independent shadow critic acceptance completed.\n'
