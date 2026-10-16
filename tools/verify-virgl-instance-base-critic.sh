#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
output=${VIRGL_INSTANCE_BASE_CRITIC_EVIDENCE_DIR:-target/evidence/virgl-instance-base-critic/acceptance}
mkdir -p "$output"
output=$(cd "$output" && pwd)
exec > >(tee "$output/acceptance.log") 2>&1
set -x
git rev-parse HEAD
git diff --check
for file in tools/virgl-instance-base/critic_*.mjs renderer/virgl-shader/tests/standard-instance-base-critic.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-instance-base/critic_*.py
bash -n tools/verify-virgl-instance-base-critic.sh
python3 tools/virgl-instance-base/critic_custody.py target/evidence/virgl-instance-base-critic
for kind in hot cold; do
 python3 tools/virgl-instance-base/critic_checks.py "target/evidence/virgl-instance-base-critic/worker-reopened/$kind"
 for mode in hardware fault-wrong-offset; do
  python3 tools/virgl-instance-base/critic_pixels.py "target/evidence/virgl-instance-base-critic/worker-reopened/$kind/$mode" "target/evidence/virgl-instance-base-critic/worker-reopened/$kind/native/native.jsonl"
 done
done
node tools/virgl-instance-base/critic_compiler.mjs "$output/compiler"
ASAN_OPTIONS=abort_on_error=1 UBSAN_OPTIONS=halt_on_error=1 LLVM_PROFILE_FILE="$output/allocations.profraw" renderer/virgl-shader/build/standard-instance-base-allocation-sanitize/standard-instance-base-allocation-test > "$output/allocations.jsonl"
node tools/virgl-instance-base/critic_browser.mjs prepare "$output/original-native"
for seed in 0x32a913f7 0x96d1c02b 0xd009c68f; do
 node tools/virgl-instance-base/critic_browser.mjs --inputs "$output/original-native" --output "$output/schedule-$seed" --seed "$seed"
 python3 tools/virgl-instance-base/critic_pixels.py "$output/schedule-$seed" "$output/original-native/native.jsonl"
done
if node tools/virgl-instance-base/critic_browser.mjs --inputs "$output/original-native" --output "$output/fault-completed-offset" --seed 0x32a913f7 --fault completed-offset; then
 echo 'ERROR: completed native offset sabotage escaped original expectations' >&2
 exit 1
fi
python3 tools/virgl-instance-base/critic_pixels.py "$output/fault-completed-offset" "$output/original-native/native.jsonl"
python3 - "$output/fault-completed-offset/critic-original-pixels.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert r['status']=='refuted' and len(r['mismatches'])==36
assert {p['lane'] for p in r['mismatches']}=={0,2,3}
assert r['physicalSyncs']==2
PY
set +x
printf 'INSTANCE_BASE_CRITIC_RECORDING_COMPLETE\n'
