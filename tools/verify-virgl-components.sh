#!/usr/bin/env bash
# Isolated straight-line shader guard, original corpus and hardware pixel proof.
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_COMPONENT_EVIDENCE_DIR:-target/evidence/virgl-components}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
python3 -m py_compile tools/virgl-components/native.py tools/virgl-components/receipt.py tools/virgl-components/cold.py
node --check renderer/virgl-shader/tests/components.mjs
node --check tools/verify-virgl-components.mjs
# Carries forward the literal and original textured-scene pixels, native
# sanitizer attacks, Wasm parity, API probes and the complete 19-hash inventory.
VIRGL_CAPTURED_SHADER_EVIDENCE_DIR="$evidence_dir/regression" bash tools/verify-virgl-captured-shaders.sh
bash renderer/virgl-shader/build.sh component-sanitize
python3 tools/virgl-components/native.py --binary renderer/virgl-shader/build/component-sanitize/component-test --output "$evidence_dir/native"
node tools/verify-virgl-components.mjs --output "$evidence_dir/hardware"
if node tools/verify-virgl-components.mjs --output "$evidence_dir/sabotage" --sabotage masked-write; then
    echo 'ERROR: masked-write sabotage falsely passed' >&2
    exit 1
fi
python3 tools/virgl-components/receipt.py "$evidence_dir"
