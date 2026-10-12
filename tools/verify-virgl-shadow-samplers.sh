#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_SHADOW_SAMPLER_EVIDENCE_DIR:-target/evidence/virgl-shadow-samplers}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
exec > >(tee "$evidence/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
set -x
git rev-parse HEAD
git diff --check
for file in renderer/virgl-command/{state,decoder,constant-domain}.mjs renderer/virgl-command/tests/standard-shadow-samplers*.mjs tools/virgl-shadow-samplers/*.mjs tools/verify-virgl-shadow-samplers.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-shadow-samplers/*.py
bash -n tools/verify-virgl-shadow-samplers.sh
python3 tools/virgl-shadow-samplers/seal-test.py
python3 tools/virgl-shadow-samplers/predecessor.py "$evidence/predecessor"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/virgl-shadow-samplers/metadata.mjs "$evidence/metadata"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/virgl-shadow-samplers/historical.mjs "$evidence/predecessor"
for mode in matrix formats bindings typed mips query-only same-image refusals reflection; do
 node tools/verify-virgl-shadow-samplers.mjs --output "$evidence/hardware-$mode" --mode "$mode"
 python3 tools/virgl-shadow-samplers/pixels.py "$evidence/hardware-$mode"
done
node tools/verify-virgl-shadow-samplers.mjs --output "$evidence/hardware-inherited" --mode inherited
node tools/virgl-shadow-samplers/inherited.mjs "$evidence/hardware-inherited"
python3 tools/virgl-ordered-stencil/physical.py "$evidence/hardware-inherited"
node tools/verify-virgl-shadow-samplers.mjs --output "$evidence/hardware-historical" --mode historical
node tools/virgl-instanced-stencil/values.mjs "$evidence/hardware-historical"
python3 tools/virgl-ordered-stencil/physical.py "$evidence/hardware-historical"
for seed in 0x493a170d 0x8ed16c35 0xc92b704f; do
 node tools/verify-virgl-shadow-samplers.mjs --output "$evidence/hardware-boundaries-$seed" --mode boundaries --seed "$seed"
 python3 tools/virgl-shadow-samplers/pixels.py "$evidence/hardware-boundaries-$seed"
done
for fault in compare mask; do
 if node tools/verify-virgl-shadow-samplers.mjs --output "$evidence/fault-$fault" --fault "$fault"; then
  echo 'ERROR: completed corrupt comparison or view control escaped the original-byte oracle' >&2
  exit 1
 fi
 python3 tools/virgl-shadow-samplers/pixels.py "$evidence/fault-$fault" --control
done
python3 tools/virgl-shadow-samplers/coverage.py "$evidence"
set +x
printf 'SHADOW_SAMPLER_RECORDING_COMPLETE\n'
python3 tools/virgl-shadow-samplers/receipt.py "$evidence"
