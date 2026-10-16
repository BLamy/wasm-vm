#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_PACKED_NORMALIZED_CONSUMER_EVIDENCE_DIR:-target/evidence/virgl-standard-packed-normalized-consumer}
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
python3 tools/check_task_policy.py
for file in renderer/virgl-command/{decoder,state}.mjs renderer/virgl-command/tests/standard-packed-normalized-consumer{,-rig,-targets,-samples,-boundaries,-wire}.mjs tools/virgl-packed-normalized-consumer/{fixtures,samples}.mjs tools/verify-virgl-standard-packed-normalized-consumer.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-packed-normalized-consumer/{predecessor,pixels,samples,boundaries,coverage,receipt,cold,seal}.py
bash -n tools/verify-virgl-standard-packed-normalized-consumer.sh
bash renderer/virgl-shader/build.sh wasm
python3 tools/virgl-packed-normalized-consumer/predecessor.py "$evidence/predecessor"
mkdir -p "$evidence/node-coverage"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-packed-normalized-consumer.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-packed-normalized-consumer.mjs --output "$evidence/hardware-targets"
python3 tools/virgl-packed-normalized-consumer/pixels.py "$evidence/hardware-targets"
node tools/verify-virgl-standard-packed-normalized-consumer.mjs --output "$evidence/hardware-samples" --mode samples
python3 tools/virgl-packed-normalized-consumer/samples.py "$evidence/hardware-samples"
for seed in 362514859 2882400001 1629686191; do
 node tools/verify-virgl-standard-packed-normalized-consumer.mjs --output "$evidence/target-boundary-$seed" --mode boundaries --seed "$seed"
 python3 tools/virgl-packed-normalized-consumer/boundaries.py "$evidence/target-boundary-$seed"
 node tools/verify-virgl-standard-packed-normalized-consumer.mjs --output "$evidence/sample-boundary-$seed" --mode sample-boundaries --seed "$seed"
 python3 tools/virgl-packed-normalized-consumer/samples.py "$evidence/sample-boundary-$seed"
done
for fault in nonzero-attachment completed-output; do
 if node tools/verify-virgl-standard-packed-normalized-consumer.mjs --output "$evidence/fault-$fault" --fault "$fault"; then
  echo 'ERROR: physical packed target corruption escaped the original oracle' >&2; exit 1
 fi
 python3 tools/virgl-packed-normalized-consumer/pixels.py "$evidence/fault-$fault" --control
done
if node tools/verify-virgl-standard-packed-normalized-consumer.mjs --output "$evidence/fault-sample-plane" --mode samples --fault sample-plane; then
 echo 'ERROR: physical wrong packed sampler escaped the original oracle' >&2; exit 1
fi
python3 tools/virgl-packed-normalized-consumer/samples.py "$evidence/fault-sample-plane" --control
node tools/verify-virgl-standard-packed-normalized-consumer.mjs --output "$evidence/historical" --mode historical
python3 tools/virgl-multiple-color/pixels.py "$evidence/historical"
python3 tools/virgl-packed-normalized-consumer/coverage.py "$evidence"
set +x
printf 'PACKED_NORMALIZED_CONSUMER_RECORDING_COMPLETE\n'
python3 tools/virgl-packed-normalized-consumer/receipt.py "$evidence"
