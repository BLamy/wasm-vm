#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_STANDARD_CONSTANT_ADVERSARIAL_EVIDENCE_DIR:-target/evidence/virgl-standard-constant-adversarial}
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
for file in renderer/virgl-command/tests/standard-constant-attributes-adversarial.mjs tools/verify-virgl-standard-constant.mjs tools/virgl-command/standard-constant-adversarial-{oracle,pixels}.mjs; do node --check "$file"; done
bash -n tools/verify-virgl-standard-constant-adversarial.sh
node tools/verify-virgl-standard-constant.mjs --output "$evidence/hardware" --adversarial true
if node tools/verify-virgl-standard-constant.mjs --output "$evidence/fault-generic" --adversarial true --smoke true --mutation generic; then
  echo 'ERROR: actual native generic mutation escaped the promoted pixel oracle' >&2
  exit 1
fi
# The router changed only to select this promoted fixture; retain its default route.
node tools/verify-virgl-standard-constant.mjs --output "$evidence/default-routing" --smoke true
node tools/virgl-command/standard-constant-adversarial-pixels.mjs "$evidence"
printf 'STANDARD_CONSTANT_ADVERSARIAL_COMPLETE\n'
