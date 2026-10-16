#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_INTEGER_IMAGE_CONSUMER_CRITIC_EVIDENCE_DIR:-target/evidence/virgl-standard-integer-image-consumer-critic}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
exec > >(tee "$evidence/acceptance.log") 2>&1
set -x
git rev-parse HEAD
git diff --check
for file in renderer/virgl-command/tests/standard-integer-image-consumer-critic.mjs tools/verify-virgl-standard-integer-image-consumer.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-integer-image-consumer/critic.py
python3 tools/virgl-integer-image-consumer/predecessor.py "$evidence/predecessor"
mkdir -p "$evidence/node-coverage"
NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-integer-image-consumer.mjs --output "$evidence/node" --node-only true --predecessor "$evidence/predecessor"
node tools/verify-virgl-standard-integer-image-consumer.mjs --output "$evidence/contracts" --mode contracts --predecessor "$evidence/predecessor"
for seed in 1000000007 2147483647 4294967291; do
 node tools/verify-virgl-standard-integer-image-consumer.mjs --output "$evidence/boundary-$seed" --mode boundaries --seed "$seed" --predecessor "$evidence/predecessor"
done
node tools/verify-virgl-standard-integer-image-consumer.mjs --output "$evidence/novel-native" --mode critic --seed 1165158773 --predecessor "$evidence/predecessor"
if node tools/verify-virgl-standard-integer-image-consumer.mjs --output "$evidence/novel-sabotage" --mode critic --seed 1165158773 --fault completed-output --predecessor "$evidence/predecessor"; then
 echo 'ERROR: physical completed-output corruption escaped the critic assertion' >&2
 exit 1
fi
python3 tools/virgl-integer-image-consumer/critic.py "$evidence"
set +x
printf 'INTEGER_IMAGE_CONSUMER_CRITIC_COMPLETE\n'
