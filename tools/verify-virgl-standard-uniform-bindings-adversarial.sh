#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_UNIFORM_BINDINGS_ADVERSARIAL_DIR:-target/evidence/virgl-standard-uniform-bindings-adversarial}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
exec > >(tee "$evidence/acceptance.log") 2>&1
node --check tools/verify-virgl-standard-uniform-bindings-adversarial.mjs
node --check tools/virgl-command/standard-uniform-binding-adversarial-body.mjs
python3 -m py_compile tools/virgl-command/standard-uniform-binding-adversarial-audit.py
for seed in 3141592653 733973753; do
  node tools/verify-virgl-standard-uniform-bindings-adversarial.mjs --output "$evidence/gpu-$seed" --seed "$seed"
done
if node tools/verify-virgl-standard-uniform-bindings-adversarial.mjs --output "$evidence/sabotage-range" --seed 3141592653 --fault range-offset; then
  echo 'ERROR: distinct-stage original pixel oracle failed to catch native range sabotage' >&2
  exit 1
fi
python3 tools/virgl-command/standard-uniform-binding-adversarial-audit.py "$evidence"
