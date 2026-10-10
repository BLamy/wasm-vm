#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_FLOAT_CONSUMER_ADVERSARIAL_EVIDENCE_DIR:-target/evidence/virgl-standard-float-consumer-verifier/native}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
exec > >(tee "$evidence/acceptance.log") 2>&1
git rev-parse HEAD
git diff --check
node --check renderer/virgl-command/tests/standard-float-consumer-adversarial.mjs
node --check tools/verify-virgl-standard-float-consumer-adversarial.mjs
python3 -m py_compile tools/virgl-command/standard-float-consumer-adversarial-audit.py
bash -n tools/verify-virgl-standard-float-consumer-adversarial.sh
mkdir -p "$evidence/node-coverage"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-float-consumer-adversarial.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-float-consumer-adversarial.mjs --output "$evidence/hardware-independent" --seed 0x71f4362b
node tools/verify-virgl-standard-float-consumer-adversarial.mjs --output "$evidence/fault-independent-filter" --fault linear-filter --seed 0x71f4362b
python3 tools/virgl-command/standard-float-consumer-adversarial-audit.py --output "$evidence/audit" --native "$evidence"
printf 'FLOAT_CONSUMER_CRITIC_RECORDING_COMPLETE\n'
