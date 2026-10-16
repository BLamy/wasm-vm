#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_PACKED_FLOAT_CONSUMER_CRITIC_EVIDENCE_DIR:-target/evidence/virgl-standard-packed-float-consumer-adversarial}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
exec > >(tee "$evidence/acceptance.log") 2>&1
git rev-parse HEAD
git diff --check
node --check renderer/virgl-command/tests/standard-packed-float-consumer-critic.mjs
node --check tools/verify-virgl-standard-packed-float-consumer-adversarial.mjs
python3 -m py_compile tools/virgl-command/standard-packed-float-consumer-critic.py tools/virgl-command/standard-packed-float-consumer-critic-coverage.py tools/virgl-command/standard-packed-float-consumer-critic-seal.py
bash -n tools/verify-virgl-standard-packed-float-consumer-adversarial.sh
python3 tools/virgl-command/standard-packed-float-consumer-critic.py "$evidence/audit-inherited"
node tools/verify-virgl-standard-packed-float-consumer-adversarial.mjs --output "$evidence/historical" --mode historical
node tools/verify-virgl-standard-packed-float-consumer-adversarial.mjs --output "$evidence/boundaries" --mode boundaries --seed 0xc01dcafe
node tools/verify-virgl-standard-packed-float-consumer-adversarial.mjs --output "$evidence/precision" --mode precision --seed 0xc01dcafe
node tools/verify-virgl-standard-packed-float-consumer-adversarial.mjs --output "$evidence/novel" --mode novel --seed 0xc01dcafe
if node tools/verify-virgl-standard-packed-float-consumer-adversarial.mjs --output "$evidence/sabotage" --mode novel --seed 0xc01dcafe --fault linear-filter; then
 echo 'ERROR: actual forced-nearest sampler escaped the promoted original-input oracle' >&2
 exit 1
fi
python3 tools/virgl-command/standard-packed-float-consumer-critic.py "$evidence/audit" "$evidence"
python3 tools/virgl-command/standard-packed-float-consumer-critic-coverage.py "$evidence/audit" "$evidence/historical/browser-coverage.json" "$evidence/boundaries/browser-coverage.json" "$evidence/precision/browser-coverage.json" "$evidence/novel/browser-coverage.json" "$evidence/sabotage/browser-coverage.json"
python3 - "$evidence/audit/coverage.json" <<'PY'
import json,sys
coverage=json.load(open(sys.argv[1]))
assert coverage['status']=='passed'
assert all(row['held'] or row['waiver'] for row in coverage['intervals'])
print('Full original native critic predictions, physical sabotage and governing nested coverage passed.')
PY
