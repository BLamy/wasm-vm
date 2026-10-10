#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_BYTE_COLOR_ADVERSARIAL_DIR:-target/evidence/virgl-standard-byte-color-adversarial}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
for file in tools/verify-virgl-standard-byte-color-adversarial.mjs tools/virgl-command/standard-byte-color-adversarial.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/standard-byte-color-adversarial-audit.py
for seed in 0x31415927 0x27182818; do
  node tools/verify-virgl-standard-byte-color-adversarial.mjs --output "$evidence/novel-$seed" --seed "$seed"
done
if node tools/verify-virgl-standard-byte-color-adversarial.mjs --output "$evidence/fault-native-encoding" --seed 0x31415927 --fault srgb-storage; then
  echo 'ERROR: real native encoding control escaped the unchanged original oracle' >&2
  exit 1
fi
python3 tools/virgl-command/standard-byte-color-adversarial-audit.py "$evidence"
