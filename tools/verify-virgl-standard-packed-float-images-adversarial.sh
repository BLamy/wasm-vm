#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_PACKED_FLOAT_CRITIC_EVIDENCE_DIR:-target/evidence/virgl-standard-packed-float-images-adversarial}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
exec > >(tee "$evidence/acceptance.log") 2>&1
git rev-parse HEAD
git diff --check
node --check tools/verify-virgl-standard-packed-float-images-adversarial.mjs
node --check renderer/virgl-command/tests/standard-packed-float-image-critic.mjs
python3 -m py_compile tools/virgl-command/standard-packed-float-image-critic.py tools/virgl-command/standard-packed-float-image-critic-coverage.py
bash -n tools/verify-virgl-standard-packed-float-images-adversarial.sh
python3 tools/virgl-command/standard-packed-float-image-critic.py "$evidence/audit"
node tools/verify-virgl-standard-packed-float-images-adversarial.mjs --output "$evidence/boundaries" --mode boundaries --seed 0x243f6a88
for seed in 0x6c8e9cf5 0xd013cc87; do
 node tools/verify-virgl-standard-packed-float-images-adversarial.mjs --output "$evidence/fields-$seed" --critic true --seed "$seed"
done
if node tools/verify-virgl-standard-packed-float-images-adversarial.mjs --output "$evidence/sabotage-fields" --critic true --seed 0x6c8e9cf5 --fault upload-lane; then
 echo 'ERROR: actual lane swap escaped the promoted original-input oracle' >&2
 exit 1
fi
python3 tools/virgl-command/standard-packed-float-image-critic.py "$evidence/audit" "$evidence"
python3 tools/virgl-command/standard-packed-float-image-critic-coverage.py "$evidence/audit" "$evidence/boundaries/browser-coverage.json" "$evidence/fields-0x6c8e9cf5/browser-coverage.json" "$evidence/fields-0xd013cc87/browser-coverage.json" "$evidence/sabotage-fields/browser-coverage.json"
python3 - "$evidence" <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1])
coverage=json.loads((p/'audit/coverage.json').read_text())
assert coverage['status']=='passed' and all(row['held'] for row in coverage['intervals'])
print('D27 original/native critic predictions, physical sabotage and all nested changed intervals passed.')
PY
