#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_ORDERED_STENCIL_CRITIC_EVIDENCE_DIR:-target/evidence/virgl-ordered-stencil-critic-recurring}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
[[ ! -f "$evidence/reporting-complete.json" ]] || { printf '%s\n' 'refuse to overwrite a closed critic capture' >&2; exit 1; }
exec > >(tee -a "$evidence/acceptance.log") 2>&1
if [[ ! -f renderer/virgl-shader/build/wasm/virgl-shader.wasm ]]; then
  if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
  export EMCC
  bash renderer/virgl-shader/build.sh wasm
fi
set -x
git rev-parse HEAD
git diff --check
python3 tools/check_task_policy.py
node --check renderer/virgl-command/tests/standard-ordered-stencil-critic.mjs
node --check tools/verify-virgl-ordered-stencil.mjs
python3 -m py_compile tools/virgl-ordered-stencil/critic-audit.py tools/virgl-ordered-stencil/critic-custody.py tools/virgl-ordered-stencil/critic-seal.py tools/virgl-ordered-stencil/critic-physical.py
capture() {
 local destination=$1
 shift
 if [[ -f "$destination/report.json" ]]; then
  # Incremental verification carries a completed physical recording only when
  # every captured runtime, actor, runner, compiler and dependency body is exact.
  python3 - "$destination" <<'PY'
import hashlib,json,sys
from pathlib import Path
p=Path(sys.argv[1]);r=json.loads((p/'report.json').read_text())
assert r['status']=='passed' and r['browserErrors']==dict(console=[],page=[],requests=[])
for s in r['sources']:
 body=(p/'source'/s['path']).read_bytes()
 assert len(body)==s['bytes'] and hashlib.sha256(body).hexdigest()==s['sha256']
 assert Path(s['path']).read_bytes()==body,s['path']
print('HELD immutable physical capture',p,'head',r['gitHead'])
PY
 else
  node tools/verify-virgl-ordered-stencil.mjs --output "$destination" "$@"
 fi
}
for seed in 0x243f6a88 0x85a308d3 0x13198a2e; do
 capture "$evidence/schedule-$seed" --mode boundaries --seed "$seed"
 node tools/virgl-ordered-stencil/values.mjs "$evidence/schedule-$seed"
 python3 tools/virgl-ordered-stencil/critic-physical.py "$evidence/schedule-$seed"
 python3 tools/virgl-ordered-stencil/critic-audit.py native "$evidence/schedule-$seed" "$evidence/schedule-$seed/fresh-direct-native-audit.json"
done
capture "$evidence/novel" --mode critic-ordered
node tools/virgl-ordered-stencil/values.mjs "$evidence/novel"
python3 tools/virgl-ordered-stencil/critic-physical.py "$evidence/novel"
python3 tools/virgl-ordered-stencil/critic-audit.py hand "$evidence/novel" "$evidence/novel/hand-audit.json"
python3 tools/virgl-ordered-stencil/critic-audit.py native "$evidence/novel" "$evidence/novel/fresh-direct-native-audit.json"
if node tools/verify-virgl-ordered-stencil.mjs --output "$evidence/fault-order" --mode critic-ordered --fault order; then
 printf '%s\n' 'ERROR: served whole-face grouping escaped the unchanged hand prediction' >&2
 exit 1
fi
node tools/virgl-ordered-stencil/values.mjs "$evidence/fault-order" --control
python3 tools/virgl-ordered-stencil/critic-audit.py control "$evidence/fault-order" "$evidence/fault-order/hand-control-audit.json"
set +x
printf '%s\n' 'FRESH_ORDERED_STENCIL_CRITIC_COMPLETE'
python3 - "$evidence" <<'PY'
import hashlib,json,subprocess,sys
from pathlib import Path
p=Path(sys.argv[1]);head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
names=['schedule-0x243f6a88','schedule-0x85a308d3','schedule-0x13198a2e','novel','fault-order']
records={};heads={}
for name in names:
 raw=(p/name/'report.json').read_bytes();r=json.loads(raw)
 assert r['status']==('failed' if name.startswith('fault-') else 'passed')
 for s in r['sources']:
  body=(p/name/'source'/s['path']).read_bytes()
  assert len(body)==s['bytes'] and hashlib.sha256(body).hexdigest()==s['sha256']
  assert Path(s['path']).read_bytes()==body,s['path']
 records[name]=hashlib.sha256(raw).hexdigest()
 heads[name]=r['gitHead']
assert not subprocess.check_output(['git','diff','--name-only','HEAD'],text=True).strip()
(p/'reporting-complete.json').write_text(json.dumps(dict(status='passed',gitHead=head,captureHeads=heads,reportDigests=records,allCapturedSourceBodiesExact=True,guestExecution=False,productionNegotiation=False),indent=2)+'\n')
PY
