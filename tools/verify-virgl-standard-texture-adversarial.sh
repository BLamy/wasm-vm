#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
directory=${VIRGL_TEXTURE_ADVERSARIAL_DIR:-target/evidence/virgl-standard-texture-adversarial}
mkdir -p "$directory"
directory=$(cd "$directory" && pwd)
exec > >(tee "$directory/acceptance.log") 2>&1
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
git diff --check
node --check tools/virgl-standard-texture/adversarial-fixtures.mjs
node --check tools/virgl-standard-texture/adversarial.mjs
node --check renderer/virgl-shader/tests/standard-texture-adversarial.mjs
python3 -m py_compile tools/virgl-standard-texture/adversarial-pixels.py
bash renderer/virgl-shader/build.sh standard-texture-native
bash renderer/virgl-shader/build.sh wasm
for seed in 826366247 655894553; do
  node tools/virgl-standard-texture/adversarial.mjs --output "$directory/seed-$seed" --seed "$seed"
done
if node tools/virgl-standard-texture/adversarial.mjs --output "$directory/fault-lod-selection" --seed 826366247 --fault lod-selection; then
  echo 'Wrong native LOD selection escaped the original input oracle' >&2
  exit 1
fi
python3 tools/virgl-standard-texture/adversarial-pixels.py "$directory"
set +x
printf 'Independent original modifier/mip/query pixels and physical LOD control passed.\n'
