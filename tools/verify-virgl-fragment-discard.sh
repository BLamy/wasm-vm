#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
discard_evidence=${VIRGL_DISCARD_EVIDENCE_DIR:-target/evidence/virgl-fragment-discard}
mkdir -p "$discard_evidence"
discard_evidence=$(cd "$discard_evidence" && pwd)
rm -f "$discard_evidence/receipt.json"
exec > >(tee "$discard_evidence/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
git diff --check
for file in renderer/virgl-command/constant-domain.mjs renderer/virgl-command/state.mjs renderer/virgl-shader/tests/fragment-discard.mjs tools/virgl-fragment-discard/*.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-fragment-discard/*.py
bash -n tools/verify-virgl-fragment-discard.sh
bash renderer/virgl-shader/build.sh guard-check
bash renderer/virgl-shader/build.sh discard-sanitize
bash renderer/virgl-shader/build.sh native
node tools/virgl-fragment-discard/native.mjs "$discard_evidence/native"
bash renderer/virgl-shader/build.sh wasm
node tools/virgl-fragment-discard/wasm.mjs "$discard_evidence/native/report.json" "$discard_evidence/wasm"
node tools/virgl-fragment-discard/independent-guards.mjs --sanitize renderer/virgl-shader/build/discard-sanitize/discard-test --output "$discard_evidence/independent-discard-guards"
node tools/virgl-fragment-coordinates/independent-guards.mjs --native renderer/virgl-shader/build/native/virgl-shader --output "$discard_evidence/independent-coordinate-guards.json"
node tools/virgl-compiler-bounds/retained.mjs "$discard_evidence/retained"
node tools/virgl-fragment-discard/legacy.mjs "$discard_evidence/legacy.json"
for spec in joins:compiler-bounds-joins hex:hex-literal-regressions signed:signed-integer-regressions conversion:signed-conversion-regressions scalar:scalar-operation-regressions minimum:minimum-selection-regressions fraction:precise-fraction-regressions saturation:saturation-regressions exponent:exponent-logarithm-regressions sine:sine-regressions power:power-regressions; do
 node "renderer/virgl-shader/tests/${spec#*:}.mjs" --native renderer/virgl-shader/build/native/virgl-shader --output "$discard_evidence/independent-${spec%%:*}-guards.json"
done
NODE_V8_COVERAGE="$discard_evidence/node-consumer-coverage" node tools/virgl-fragment-discard/consumer.mjs "$discard_evidence/native/report.json" "$discard_evidence/consumer.json"
for seed in 2654435769 608135816 2242054355; do
 python3 tools/virgl-fragment-discard/reference.py "$seed" "renderer/virgl-shader/build/discard-reference-$seed.json"
done
# The shared collector binds every generated JSON. Freeze the complete table
# before the first capture, including files retained from development runs.
for seed in 2654435769 608135816 2242054355; do
 node tools/virgl-fragment-discard/browser.mjs --output "$discard_evidence/gpu-$seed" --seed "$seed"
 python3 tools/virgl-fragment-discard/capture-check.py "$discard_evidence/gpu-$seed/report.json" "$discard_evidence/capture-$seed.json"
 python3 tools/virgl-fragment-discard/independent-oracle.py "$discard_evidence/gpu-$seed/report.json" "$discard_evidence/independent-capture-$seed.json"
done
for fault in inhibit invert x-only unconditional; do
 if node tools/virgl-fragment-discard/browser.mjs --output "$discard_evidence/fault-$fault" --fault "$fault"; then
  echo "ERROR: $fault discard fault escaped the literal pixel oracle" >&2
  exit 1
 fi
 python3 tools/virgl-fragment-discard/capture-check.py "$discard_evidence/fault-$fault/report.json" "$discard_evidence/capture-fault-$fault.json"
 python3 tools/virgl-fragment-discard/independent-oracle.py "$discard_evidence/fault-$fault/report.json" "$discard_evidence/independent-capture-fault-$fault.json"
done
python3 tools/virgl-fragment-discard/receipt.py "$discard_evidence"
