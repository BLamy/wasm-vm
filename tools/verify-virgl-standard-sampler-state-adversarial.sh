#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_SAMPLER_ADVERSARIAL_DIR:-target/evidence/virgl-standard-sampler-state-adversarial}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ ! -f renderer/virgl-shader/build/wasm/virgl-shader.wasm ]]; then
  if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
  export EMCC
  bash renderer/virgl-shader/build.sh wasm
fi
node --check tools/verify-virgl-standard-sampler-state-adversarial.mjs
node --check tools/virgl-command/standard-sampler-adversarial-body.mjs
python3 -m py_compile tools/virgl-command/standard-sampler-adversarial-audit.py tools/virgl-command/standard_sampler_literal_model.py
for seed in 362436069 521288629 733973753; do
  node tools/verify-virgl-standard-sampler-state-adversarial.mjs --output "$evidence/gpu-$seed" --seed "$seed" --mode novel
done
for fault in wrap filter; do
  if node tools/verify-virgl-standard-sampler-state-adversarial.mjs --output "$evidence/sabotage-$fault" --seed 733973753 --mode novel --fault "$fault"; then
    echo 'ERROR: actual original sampler mapping sabotage escaped completed-fence seam pixels' >&2
    exit 1
  fi
done
python3 tools/virgl-command/standard-sampler-adversarial-audit.py "$evidence"
