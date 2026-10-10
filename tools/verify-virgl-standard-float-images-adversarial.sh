#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_FLOAT_IMAGE_ADVERSARIAL_DIR:-target/evidence/virgl-standard-float-images-adversarial}
mkdir -p "$evidence"
python3 tools/virgl-command/standard-float-image-adversarial.py generate "$evidence/original-inputs.json"
node --check renderer/virgl-command/tests/standard-float-image-adversarial.mjs
node --check tools/verify-virgl-standard-float-images-adversarial.mjs
node tools/verify-virgl-standard-float-images-adversarial.mjs --inputs "$evidence/original-inputs.json" --output "$evidence/healthy"
node tools/verify-virgl-standard-float-images-adversarial.mjs --inputs "$evidence/original-inputs.json" --output "$evidence/control" --fault precision
python3 tools/virgl-command/standard-float-image-adversarial.py audit "$evidence/original-inputs.json" "$evidence/healthy" "$evidence/control" "$evidence/independent-audit.json"
