#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_STENCIL_CRITIC_EVIDENCE_DIR:-target/evidence/virgl-stencil-critic-recurring}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
exec > >(tee "$evidence/acceptance.log") 2>&1
if [[ ! -f renderer/virgl-shader/build/wasm/virgl-shader.wasm ]]; then
  if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
  export EMCC
  bash renderer/virgl-shader/build.sh wasm
fi
set -x
git rev-parse HEAD
git diff --check
node --check renderer/virgl-command/tests/standard-stencil-critic.mjs
node --check renderer/virgl-command/tests/standard-stencil-switch-critic.mjs
node --check tools/verify-virgl-standard-stencil.mjs
python3 -m py_compile tools/virgl-stencil/critic_audit.py tools/virgl-stencil/critic_custody.py tools/virgl-stencil/critic_seal.py
for seed in 0x70119abd 0x4aa534b7 0xf0097321; do
  node tools/verify-virgl-standard-stencil.mjs --output "$evidence/schedule-$seed" --mode boundaries --seed "$seed"
  python3 tools/virgl-stencil/values.py "$evidence/schedule-$seed"
done
node tools/verify-virgl-standard-stencil.mjs --output "$evidence/ordered" --mode critic-ordered
python3 tools/virgl-stencil/values.py "$evidence/ordered"
python3 tools/virgl-stencil/critic_audit.py ordered "$evidence/ordered"
node tools/verify-virgl-standard-stencil.mjs --output "$evidence/switch" --mode critic-switch
python3 tools/virgl-stencil/critic_audit.py switch "$evidence/switch"
if node tools/verify-virgl-standard-stencil.mjs --output "$evidence/fault-completed-stencil" --mode operations --smoke true --fault completed-stencil; then
  printf '%s\n' 'ERROR: completed real stencil corruption escaped the collector' >&2
  exit 1
fi
python3 tools/virgl-stencil/values.py --control "$evidence/fault-completed-stencil"
python3 - "$evidence/fault-completed-stencil" <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1]);a=json.loads((p/'independent-values.json').read_text())
assert a['status']=='refuted' and any('/exact-S8' in d['where'] for d in a['differences'])
PY
set +x
printf '%s\n' 'CRITIC_STENCIL_RECORDING_COMPLETE'
