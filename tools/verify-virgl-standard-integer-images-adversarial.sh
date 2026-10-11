#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
capture=${VIRGL_INTEGER_IMAGE_CRITIC_EVIDENCE_DIR:-target/evidence/virgl-standard-integer-images-critic}
mkdir -p "$capture"
capture=$(cd "$capture" && pwd)
exec > >(tee "$capture/critic.log") 2>&1
set -x
git rev-parse HEAD
git diff --check
python3 -m py_compile tools/virgl-command/standard-integer-image-{critic,critic-seal}.py
node --check renderer/virgl-command/tests/standard-integer-image-critic.mjs
node --check tools/verify-virgl-standard-integer-images-adversarial.mjs
python3 tools/virgl-command/standard-integer-image-critic.py --capture "$capture" --reopen --fetch-specs
python3 tools/virgl-command/standard-integer-image-critic.py --capture "$capture" --declare
mkdir -p "$capture/fresh/node-coverage"
NODE_V8_COVERAGE="$capture/fresh/node-coverage" node tools/verify-virgl-standard-integer-images.mjs --output "$capture/fresh/wire" --node-only true
node tools/verify-virgl-standard-integer-images.mjs --output "$capture/fresh/hardware-matrix" --seed 0x243f6a88
for seed in 0x6a09e667 0xbb67ae85 0x3c6ef372; do
 node tools/verify-virgl-standard-integer-images.mjs --output "$capture/fresh/hardware-boundaries-$seed" --mode boundaries --seed "$seed"
done
for fault in upload-lane copy-level; do
 if node tools/verify-virgl-standard-integer-images.mjs --output "$capture/fresh/fault-$fault" --fault "$fault" --seed 0x510e527f; then
  echo 'ERROR: real native wrong integer words escaped unchanged worker fixture' >&2
  exit 1
 fi
done
node tools/verify-virgl-standard-integer-images-adversarial.mjs --output "$capture/novel-native" --inputs "$capture/novel-input-declaration.json"
if node tools/verify-virgl-standard-integer-images-adversarial.mjs --output "$capture/sabotage-post-fence" --inputs "$capture/novel-input-declaration.json" --fault post-fence; then
 echo 'ERROR: real post-fence wrong integer pixels escaped unchanged critic oracle' >&2
 exit 1
fi
python3 tools/virgl-command/standard-integer-image-critic.py --capture "$capture"
set +x
printf 'INTEGER_IMAGE_CRITIC_COMPLETE\n'
