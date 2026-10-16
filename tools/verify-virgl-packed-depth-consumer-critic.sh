#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_PACKED_DEPTH_CRITIC_EVIDENCE_DIR:-target/evidence/virgl-packed-depth-consumer-critic-promoted}
mkdir -p "$evidence"
node --check renderer/virgl-command/tests/standard-packed-depth-consumer-critic.mjs
node --check tools/verify-virgl-packed-depth-consumer-critic.mjs
python3 -m py_compile tools/virgl-packed-depth-consumer/critic.py
node tools/verify-virgl-packed-depth-consumer-critic.mjs --output "$evidence/hardware-novel" --mode critic --seed 0x43c17a6d
python3 tools/virgl-packed-depth-consumer/critic.py "$evidence/hardware-novel"
node tools/verify-virgl-packed-depth-consumer-critic.mjs --output "$evidence/fault-novel-completed-stencil" --mode critic --seed 0x71ea9b43 --fault completed-stencil
python3 tools/virgl-packed-depth-consumer/critic.py "$evidence/fault-novel-completed-stencil" --control
