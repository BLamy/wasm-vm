#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_STANDARD_TOPOLOGY_EVIDENCE_DIR:-target/evidence/virgl-standard-topology}
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
for file in renderer/virgl-command/{decoder,state}.mjs renderer/virgl-command/tests/standard-core-topologies.mjs tools/verify-virgl-standard-topology.mjs tools/virgl-command/standard-topology-{oracle,pixels}.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/standard-topology-{receipt,cold,seal}.py
bash -n tools/verify-virgl-standard-topology.sh
# Build actual compiler once and retain full D6 plus its affected legacy paths.
VIRGL_STANDARD_DRAW_EVIDENCE_DIR="$evidence/retained-standard-draw" make verify-E6-T11d6
# D7 physical behavior is rerun under the new primitive selector. Its historical
# receipt's immutable decoder custody is carried, never relabeled or rewritten.
node tools/verify-virgl-standard-constant.mjs --output "$evidence/retained-constant/hardware"
if node tools/verify-virgl-standard-constant.mjs --output "$evidence/retained-constant/fault-generic" --smoke true --mutation generic; then
  echo 'ERROR: retained native generic corruption escaped its pixel oracle' >&2
  exit 1
fi
node tools/virgl-command/standard-constant-pixels.mjs "$evidence/retained-constant"
node tools/verify-virgl-standard-topology.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-topology.mjs --output "$evidence/hardware"
if node tools/verify-virgl-standard-topology.mjs --output "$evidence/fault-mode" --smoke true --mutation mode; then
  echo 'ERROR: actual native mode corruption escaped its independent pixel oracle' >&2
  exit 1
fi
node tools/virgl-command/standard-topology-pixels.mjs "$evidence"
set +x
printf 'STANDARD_TOPOLOGY_RECORDING_COMPLETE\n'
python3 tools/virgl-command/standard-topology-receipt.py "$evidence"
