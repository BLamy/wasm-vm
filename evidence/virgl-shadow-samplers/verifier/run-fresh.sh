#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
evidence=${VIRGL_SHADOW_CRITIC_EVIDENCE_DIR:-target/evidence/virgl-shadow-samplers-critic/final}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
exec > >(tee "$evidence/critic.log") 2>&1
set -x
git rev-parse HEAD
git diff --check
for source in evidence/virgl-shadow-samplers/verifier/*.mjs; do node --check "$source"; done
python3 -m py_compile evidence/virgl-shadow-samplers/verifier/*.py
NODE_V8_COVERAGE="$evidence/node-coverage" node evidence/virgl-shadow-samplers/verifier/metadata.mjs "$evidence/metadata"
for seed in 0x61a387d9 0x94ce720a 0xd73ab56b; do
 node evidence/virgl-shadow-samplers/verifier/driver.mjs --output "$evidence/novel-$seed" --module evidence/virgl-shadow-samplers/verifier/novel-body.mjs --seed "$seed"
 python3 evidence/virgl-shadow-samplers/verifier/audit_novel.py "$evidence/novel-$seed" "$evidence/novel-$seed/audit.json"
done
for mode in refusals reflection bindings mips query-only same-image typed inherited historical; do
 node tools/verify-virgl-shadow-samplers.mjs --output "$evidence/hardware-$mode" --mode "$mode" --seed 0x61a387d9
 if [[ "$mode" == inherited ]]; then
  node evidence/virgl-shadow-samplers/verifier/audit-inherited.mjs "$evidence/hardware-$mode" "$evidence/hardware-$mode/critic-audit.json"
  python3 tools/virgl-ordered-stencil/physical.py "$evidence/hardware-$mode"
 elif [[ "$mode" == historical ]]; then
  node tools/virgl-instanced-stencil/values.mjs "$evidence/hardware-$mode"
  python3 tools/virgl-ordered-stencil/physical.py "$evidence/hardware-$mode"
 else
  python3 tools/virgl-shadow-samplers/pixels.py "$evidence/hardware-$mode"
 fi
done
for seed in 0x6ac47308 0xb59d7a1d 0xe174cf53; do
 node tools/verify-virgl-shadow-samplers.mjs --output "$evidence/hardware-boundaries-$seed" --mode boundaries --seed "$seed"
 python3 tools/virgl-shadow-samplers/pixels.py "$evidence/hardware-boundaries-$seed"
done
for fault in compare mask; do
 node evidence/virgl-shadow-samplers/verifier/driver.mjs --output "$evidence/novel-fault-$fault" --module evidence/virgl-shadow-samplers/verifier/novel-body.mjs --seed 0x94ce720a --fault "$fault"
 python3 evidence/virgl-shadow-samplers/verifier/audit_novel.py "$evidence/novel-fault-$fault" "$evidence/novel-fault-$fault/audit.json"
done
set +x
printf 'FRESH_SHADOW_CRITIC_RECORDING_COMPLETE\n'
