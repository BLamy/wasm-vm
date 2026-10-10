#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_BUFFER_ROLES_EVIDENCE_DIR:-target/evidence/virgl-standard-buffer-roles}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
rm -f "$evidence/receipt.json"
exec > >(tee "$evidence/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
git diff --check
for file in renderer/virgl-command/{resources,state}.mjs renderer/virgl-command/tests/standard-buffer-roles.mjs tools/verify-virgl-standard-buffer-roles.mjs tools/virgl-command/standard-buffer-role-{fixtures,oracle,pixels}.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/standard-buffer-role-{receipt,coverage,cold,seal}.py
bash -n tools/verify-virgl-standard-buffer-roles.sh
bash renderer/virgl-shader/build.sh wasm
mkdir -p "$evidence/node-coverage"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-buffer-roles.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-buffer-roles.mjs --output "$evidence/hardware"
for fault in source-word private-index; do
  if node tools/verify-virgl-standard-buffer-roles.mjs --output "$evidence/fault-$fault" --fault "$fault"; then
    echo 'ERROR: native buffer fault escaped completed-fence original pixels' >&2
    exit 1
  fi
done
node tools/virgl-command/standard-buffer-role-pixels.mjs "$evidence"
VIRGL_UNIFORM_BINDINGS_EVIDENCE_DIR="$evidence/retained-uniform" bash tools/verify-virgl-standard-uniform-bindings.sh
node tools/verify-virgl-standard-assembly.mjs --output "$evidence/retained-assembly"
python3 tools/virgl-command/standard-buffer-role-coverage.py "$evidence"
set +x
printf 'BUFFER_ROLES_RECORDING_COMPLETE\n'
python3 tools/virgl-command/standard-buffer-role-receipt.py "$evidence"
