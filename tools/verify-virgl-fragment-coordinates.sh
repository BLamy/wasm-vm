#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
coordinate_evidence=${VIRGL_COORDINATE_EVIDENCE_DIR:-target/evidence/virgl-fragment-coordinates}
mkdir -p "$coordinate_evidence"
coordinate_evidence=$(cd "$coordinate_evidence" && pwd)
rm -f "$coordinate_evidence/receipt.json"
exec > >(tee "$coordinate_evidence/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
git diff --check
for file in renderer/virgl-shader/tests/fragment-coordinates.mjs tools/virgl-fragment-coordinates/*.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-fragment-coordinates/*.py
bash -n tools/verify-virgl-fragment-coordinates.sh
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh coordinate-sanitize
bash renderer/virgl-shader/build.sh native
node tools/virgl-fragment-coordinates/native.mjs "$coordinate_evidence/native"
bash renderer/virgl-shader/build.sh wasm
node tools/virgl-fragment-coordinates/wasm.mjs "$coordinate_evidence/native/report.json" "$coordinate_evidence/wasm"
node tools/virgl-compiler-bounds/retained.mjs "$coordinate_evidence/retained"
node tools/virgl-fragment-coordinates/legacy.mjs "$coordinate_evidence/legacy.json"
for spec in joins:compiler-bounds-joins hex:hex-literal-regressions signed:signed-integer-regressions conversion:signed-conversion-regressions scalar:scalar-operation-regressions minimum:minimum-selection-regressions fraction:precise-fraction-regressions saturation:saturation-regressions exponent:exponent-logarithm-regressions sine:sine-regressions power:power-regressions; do
  node "renderer/virgl-shader/tests/${spec#*:}.mjs" --native renderer/virgl-shader/build/native/virgl-shader --output "$coordinate_evidence/independent-${spec%%:*}-guards.json"
done
NODE_V8_COVERAGE="$coordinate_evidence/node-consumer-coverage" node tools/virgl-fragment-coordinates/consumer.mjs "$coordinate_evidence/native/report.json" "$coordinate_evidence/consumer.json"
for seed in 2654435769 608135816 2242054355; do
  python3 tools/virgl-fragment-coordinates/reference.py "$seed" "renderer/virgl-shader/build/coordinate-reference-$seed.json"
  node tools/virgl-fragment-coordinates/browser.mjs --output "$coordinate_evidence/gpu-$seed" --seed "$seed"
done
for fault in x y z w; do
  if node tools/virgl-fragment-coordinates/browser.mjs --output "$coordinate_evidence/fault-$fault" --fault "$fault"; then
    echo "ERROR: $fault coordinate fault escaped the independent pixel oracle" >&2
    exit 1
  fi
done
python3 tools/virgl-fragment-coordinates/receipt.py "$coordinate_evidence"
