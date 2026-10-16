#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_STANDARD_DRAW_ADVERSARIAL_EVIDENCE_DIR:-target/evidence/virgl-standard-draw-adversarial}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
exec > >(tee "$evidence/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ ! -f renderer/virgl-shader/build/wasm/virgl-shader.wasm ]]; then
  if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
  export EMCC
  bash renderer/virgl-shader/build.sh wasm
fi
git diff --check
node --check renderer/virgl-command/tests/standard-instanced-draws.mjs
node --check renderer/virgl-command/tests/standard-instanced-draws-adversarial.mjs
node --check tools/verify-virgl-standard-draw.mjs
python3 -m py_compile tools/virgl-command/standard-draw-adversarial-audit.py
bash -n tools/verify-virgl-standard-draw-adversarial.sh
node tools/verify-virgl-standard-draw.mjs --output "$evidence/normal" --adversarial true
if node tools/verify-virgl-standard-draw.mjs --output "$evidence/fault-divisor" --adversarial true --smoke true --mutation divisor; then
  echo 'ERROR: native divisor2=>1 escaped the promoted physical pixel oracle' >&2
  exit 1
fi
python3 tools/virgl-command/standard-draw-adversarial-audit.py "$evidence" --critic --output "$evidence/independent-audit"
printf 'STANDARD_DRAW_ADVERSARIAL_COMPLETE\n'
