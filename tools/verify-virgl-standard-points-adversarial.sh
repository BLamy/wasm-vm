#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_STANDARD_POINTS_ADVERSARIAL_EVIDENCE_DIR:-target/evidence/virgl-standard-points-adversarial}
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
for file in renderer/virgl-command/tests/standard-native-points-adversarial.mjs tools/virgl-command/standard-point-{adversarial-oracle,verifier}.mjs; do node --check "$file"; done
bash -n tools/verify-virgl-standard-points-adversarial.sh
node tools/verify-virgl-standard-points.mjs --output "$evidence/novel" --adversarial true
for fault in size-selection coord-y; do
  if node tools/verify-virgl-standard-points.mjs --output "$evidence/fault-$fault" --adversarial true --smoke true --mutation "$fault"; then
    echo 'ERROR: completed native point mutation escaped the promoted original pixel oracle' >&2
    exit 1
  fi
done
node tools/virgl-command/standard-point-verifier.mjs "$evidence" "$evidence/novel-replay.json" critic
printf 'STANDARD_POINTS_ADVERSARIAL_COMPLETE\n'
