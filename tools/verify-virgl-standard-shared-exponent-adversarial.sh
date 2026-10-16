#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_SHARED_EXPONENT_CRITIC_DIR:-target/evidence/virgl-standard-shared-exponent-critic}
mkdir -p "$evidence"
node --check renderer/virgl-command/tests/standard-shared-exponent-critic.mjs
node --check tools/verify-virgl-standard-shared-exponent-critic.mjs
python3 -m py_compile tools/virgl-command/standard-shared-exponent-critic.py
python3 tools/virgl-command/standard-shared-exponent-critic.py --output "$evidence" --prepare
node tools/verify-virgl-standard-shared-exponent-critic.mjs --output "$evidence/novel-native"
for seed in 0x6a09e667 0xbb67ae85 0x3c6ef372; do
  node tools/verify-virgl-standard-shared-exponent-images.mjs --output "$evidence/fresh-boundaries-$seed" --mode boundaries --seed "$seed"
  python3 tools/virgl-command/standard-shared-exponent-values.py "$evidence/fresh-boundaries-$seed"
done
if node tools/verify-virgl-standard-shared-exponent-critic.mjs --output "$evidence/sabotage-blue-field" --fault blue-field; then
  echo 'ERROR: real post-fence blue-field corruption escaped the original-bit critic oracle' >&2
  exit 1
fi
python3 tools/virgl-command/standard-shared-exponent-critic.py --output "$evidence"
