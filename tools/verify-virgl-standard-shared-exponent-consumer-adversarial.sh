#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_SHARED_EXPONENT_CONSUMER_CRITIC_DIR:-target/evidence/virgl-standard-shared-exponent-consumer-critic}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
exec > >(tee "$evidence/critic.log") 2>&1
git rev-parse HEAD
git diff --check
node --check tools/verify-virgl-standard-shared-exponent-consumer-adversarial.mjs
node --check renderer/virgl-command/tests/standard-shared-exponent-consumer-critic.mjs
python3 -m py_compile tools/virgl-command/standard-shared-exponent-consumer-critic{,-coverage,-seal}.py
bash -n tools/verify-virgl-standard-shared-exponent-consumer-adversarial.sh
if [[ ! -f "$evidence/predictions.json" ]]; then
 cp evidence/virgl-standard-shared-exponent-consumer/verifier/predictions.json "$evidence/predictions.json"
fi
node --input-type=module - "$evidence" <<'JS'
import fs from 'node:fs';
import {preparation} from './renderer/virgl-command/tests/standard-shared-exponent-consumer-critic.mjs';
const f=preparation(0x243f6a88);
fs.writeFileSync(process.argv[2]+'/novel-input-declaration.json',JSON.stringify({schema:'d30-original-dual-stage-input-declaration-v1',seed:0x243f6a88,nativeExecuted:false,source:f.source.metadata,views:f.views,vertex:f.vertex,fragment:f.fragment,parameters:f.parameters,originalPrediction:f.originalPrediction,planes:f.source.planes.map(p=>({...p,input:Buffer.from(p.input).toString('hex')})),backing:Buffer.from(f.source.backing).toString('hex')},null,2)+'\n');
JS
mkdir -p "$evidence/fresh-node-coverage"
NODE_V8_COVERAGE="$evidence/fresh-node-coverage" node tools/verify-virgl-standard-shared-exponent-consumer-adversarial.mjs --output "$evidence/fresh-wire" --node-only true
node tools/verify-virgl-standard-shared-exponent-consumer-adversarial.mjs --output "$evidence/novel-native" --mode novel --seed 0x243f6a88
for seed in 0x6a09e667 0xbb67ae85 0x3c6ef372; do
 node tools/verify-virgl-standard-shared-exponent-consumer.mjs --output "$evidence/fresh-boundaries-$seed" --mode boundaries --seed "$seed"
done
node tools/verify-virgl-standard-shared-exponent-consumer.mjs --output "$evidence/fresh-matrix"
node tools/verify-virgl-standard-shared-exponent-consumer-adversarial.mjs --output "$evidence/historical-native" --mode historical
for fault in original-level linear-filter; do
 if node tools/verify-virgl-standard-shared-exponent-consumer.mjs --output "$evidence/fresh-fault-$fault" --fault "$fault"; then
  echo 'ERROR: actual native selection mutation escaped the unchanged original pixel oracle' >&2
  exit 1
 fi
done
if node tools/verify-virgl-standard-shared-exponent-consumer-adversarial.mjs --output "$evidence/sabotage-post-fence" --fault post-fence-pixel; then
 echo 'ERROR: actual post-completion pixel corruption escaped the unchanged pixel oracle' >&2
 exit 1
fi
python3 tools/virgl-command/standard-shared-exponent-consumer-critic.py --output "$evidence"
python3 tools/virgl-command/standard-shared-exponent-consumer-critic-coverage.py "$evidence" "$evidence/historical-native/browser-coverage.json" "$evidence/novel-native/browser-coverage.json"
echo 'SHARED_EXPONENT_CONSUMER_CRITIC_COMPLETE'
