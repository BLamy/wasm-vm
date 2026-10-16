#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_TEXTURE_OPERATIONS_ADVERSARIAL_DIR:-target/evidence/virgl-standard-texture-operations-adversarial}
mkdir -p "$evidence"
node --check renderer/virgl-command/tests/standard-texture-operations-adversarial.mjs
node --check tools/verify-virgl-standard-texture-operations-adversarial.mjs
python3 -m py_compile tools/virgl-command/standard-texture-operations-adversarial-pixels.py
for seed in 0x749ad013 0x601bc927; do
 node tools/verify-virgl-standard-texture-operations-adversarial.mjs --output "$evidence/novel-seed-$seed" --seed "$seed"
done
if node tools/verify-virgl-standard-texture-operations-adversarial.mjs --output "$evidence/fault-query-levels" --fault query-levels --seed 0x491e762d; then
 echo 'Wrong native query count escaped the independent original completed-fence pixels' >&2
 exit 1
fi
python3 tools/virgl-command/standard-texture-operations-adversarial-pixels.py "$evidence"
