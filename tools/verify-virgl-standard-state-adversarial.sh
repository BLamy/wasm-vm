#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_STANDARD_STATE_ADVERSARIAL_EVIDENCE_DIR:-target/evidence/virgl-standard-state-adversarial}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
exec > >(tee "$evidence/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ ! -f renderer/virgl-shader/build/wasm/virgl-shader.wasm ]]; then
  if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
  export EMCC
  bash renderer/virgl-shader/build.sh wasm
fi
node --check renderer/virgl-command/tests/standard-state-boundaries.mjs
node --check tools/verify-virgl-standard-state-adversarial.mjs
python3 -m py_compile tools/virgl-command/standard-state-adversarial-audit.py
node tools/verify-virgl-standard-state-adversarial.mjs --output "$evidence/normal"
if node tools/verify-virgl-standard-state-adversarial.mjs --output "$evidence/fault-native-binding" --mutation native-binding; then
  echo 'ERROR: real active native omission escaped the promoted rejection oracle' >&2
  exit 1
fi
if node tools/verify-virgl-standard-state-adversarial.mjs --output "$evidence/fault-pixel" --mutation vs-blue; then
  echo 'ERROR: real vertex-view corruption escaped the promoted pixel oracle' >&2
  exit 1
fi
python3 tools/virgl-command/standard-state-adversarial-audit.py "$evidence"
printf 'STANDARD_STATE_ADVERSARIAL_COMPLETE\n'
