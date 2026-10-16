#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_STANDARD_TOPOLOGY_ADVERSARIAL_EVIDENCE_DIR:-target/evidence/virgl-standard-topology-adversarial}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
exec > >(tee "$evidence/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ ! -f renderer/virgl-shader/build/wasm/virgl-shader.wasm ]]; then
  if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
  export EMCC
  bash renderer/virgl-shader/build.sh wasm
fi
git diff --check
for file in renderer/virgl-command/tests/standard-core-topologies-adversarial.mjs tools/virgl-command/standard-topology-adversarial-{oracle,pixels}.mjs; do node --check "$file"; done
bash -n tools/verify-virgl-standard-topology-adversarial.sh
node --input-type=module -e 'import fs from "node:fs"; import {runWireAcceptance} from "./renderer/virgl-command/tests/standard-core-topologies-adversarial.mjs"; fs.writeFileSync(process.argv[1], JSON.stringify(runWireAcceptance(), null, 2) + "\n")' "$evidence/wire.json"
node tools/verify-virgl-standard-topology.mjs --output "$evidence/hardware" --adversarial true
if node tools/verify-virgl-standard-topology.mjs --output "$evidence/fault-mode" --adversarial true --smoke true --mutation mode; then
  echo 'ERROR: actual native mode mutation escaped the promoted pixel oracle' >&2
  exit 1
fi
node tools/virgl-command/standard-topology-adversarial-pixels.mjs "$evidence"
printf 'STANDARD_TOPOLOGY_ADVERSARIAL_COMPLETE\n'
