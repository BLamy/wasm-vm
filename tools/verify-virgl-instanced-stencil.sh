#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_INSTANCED_STENCIL_EVIDENCE_DIR:-target/evidence/virgl-instanced-stencil}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
exec > >(tee "$evidence/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
set -x
git rev-parse HEAD
git diff --check
for file in renderer/virgl-command/state.mjs renderer/virgl-command/constant-domain.mjs renderer/virgl-command/tests/standard-instanced-stencil*.mjs tools/virgl-instanced-stencil/*.mjs tools/verify-virgl-instanced-stencil.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-instanced-stencil/*.py
bash -n tools/verify-virgl-instanced-stencil.sh
python3 tools/virgl-instanced-stencil/predecessor.py "$evidence/predecessor"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/virgl-instanced-stencil/metadata.mjs "$evidence/metadata"
for mode in matrix bindings typed segments failures reflection limits; do
 node tools/verify-virgl-instanced-stencil.mjs --output "$evidence/hardware-$mode" --mode "$mode"
 node tools/virgl-instanced-stencil/values.mjs "$evidence/hardware-$mode"
 python3 tools/virgl-ordered-stencil/physical.py "$evidence/hardware-$mode"
done
for seed in 0x47d195a3 0x1f305b97 0xac92e647; do
 node tools/verify-virgl-instanced-stencil.mjs --output "$evidence/hardware-boundaries-$seed" --mode boundaries --seed "$seed"
 node tools/virgl-instanced-stencil/values.mjs "$evidence/hardware-boundaries-$seed"
 python3 tools/virgl-ordered-stencil/physical.py "$evidence/hardware-boundaries-$seed"
done
for fault in order base phase; do
 if node tools/verify-virgl-instanced-stencil.mjs --output "$evidence/fault-$fault" --fault "$fault"; then
  echo 'ERROR: completed corrupt instance order or binding escaped the original-byte oracle' >&2
  exit 1
 fi
 node tools/virgl-instanced-stencil/values.mjs "$evidence/fault-$fault" --control
done
node tools/verify-virgl-instanced-stencil.mjs --output "$evidence/retained-ordered" --mode retained-ordered --smoke true
node tools/virgl-ordered-stencil/values.mjs "$evidence/retained-ordered"
python3 tools/virgl-ordered-stencil/physical.py "$evidence/retained-ordered"
python3 tools/virgl-instanced-stencil/coverage.py "$evidence"
set +x
printf 'INSTANCED_STENCIL_RECORDING_COMPLETE\n'
python3 tools/virgl-instanced-stencil/receipt.py "$evidence"
