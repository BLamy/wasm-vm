#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_INSTANCED_STENCIL_CRITIC_EVIDENCE_DIR:-target/evidence/virgl-instanced-stencil-critic}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
exec > >(tee "$evidence/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
set -x
git rev-parse HEAD
git diff --check
for file in renderer/virgl-command/tests/standard-instanced-stencil-critic.mjs tools/virgl-instanced-stencil/critic-fixtures.mjs tools/verify-virgl-instanced-stencil.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-instanced-stencil/critic_receipt.py
bash -n tools/verify-virgl-instanced-stencil-critic.sh
python3 tools/virgl-instanced-stencil/predecessor.py "$evidence/predecessor"
node tools/virgl-instanced-stencil/metadata.mjs "$evidence/metadata"
for seed in 0x510e527f 0x9b05688c 0x1f83d9ab; do
 node tools/verify-virgl-instanced-stencil.mjs --output "$evidence/boundaries-$seed" --mode boundaries --seed "$seed"
 node tools/virgl-instanced-stencil/values.mjs "$evidence/boundaries-$seed"
 python3 tools/virgl-ordered-stencil/physical.py "$evidence/boundaries-$seed"
 node tools/verify-virgl-instanced-stencil.mjs --output "$evidence/novel-$seed" --mode critic-novel --seed "$seed"
 node tools/virgl-instanced-stencil/values.mjs "$evidence/novel-$seed"
 python3 tools/virgl-ordered-stencil/physical.py "$evidence/novel-$seed"
done
if node tools/verify-virgl-instanced-stencil.mjs --output "$evidence/fault-novel-order" --mode critic-novel --seed 0x510e527f --fault order; then
 echo 'ERROR: completed primitive-major corruption escaped the unchanged original-byte oracle' >&2
 exit 1
fi
node tools/virgl-instanced-stencil/values.mjs "$evidence/fault-novel-order" --control
set +x
printf 'INSTANCED_STENCIL_CRITIC_RECORDING_COMPLETE\n'
python3 tools/virgl-instanced-stencil/critic_receipt.py "$evidence"
