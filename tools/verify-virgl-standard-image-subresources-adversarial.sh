#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_IMAGE_SUBRESOURCES_ADVERSARIAL_DIR:-target/evidence/virgl-standard-image-subresources-adversarial}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
rm -f "$evidence/receipt.json"
exec > >(tee "$evidence/acceptance.log") 2>&1
node --check tools/virgl-command/standard-image-adversarial.mjs
node --check tools/verify-virgl-standard-image-subresources-adversarial.mjs
node --check renderer/virgl-command/tests/standard-image-boundaries.mjs
python3 -m py_compile tools/virgl-command/standard-image-adversarial-audit.py
bash -n tools/verify-virgl-standard-image-subresources-adversarial.sh
python3 tools/virgl-command/standard-image-adversarial-audit.py "$evidence" --predict
mkdir -p "$evidence/node-coverage"
for seed in 1779033703 3144134277 1013904242; do
  NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-image-subresources-adversarial.mjs --output "$evidence/boundaries-$seed" --mode boundaries --seed "$seed"
  NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-image-subresources-adversarial.mjs --output "$evidence/seed-$seed" --mode novel --seed "$seed"
  python3 tools/virgl-command/standard-image-adversarial-audit.py "$evidence/seed-$seed"
done
if NODE_V8_COVERAGE="$evidence/node-coverage" node tools/verify-virgl-standard-image-subresources-adversarial.mjs --output "$evidence/fault-retained-copy-level" --mode novel --seed 1779033703 --fault retained-copy-level; then
  echo 'ERROR: native wrong-mip selection escaped the completed-fence original oracle' >&2
  exit 1
fi
python3 tools/virgl-command/standard-image-adversarial-audit.py "$evidence/fault-retained-copy-level" --fault
python3 - "$evidence" <<'PY'
from pathlib import Path
import hashlib,json,subprocess,sys
root=Path.cwd();out=Path(sys.argv[1]);sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
proofs=[json.loads((out/name/'independent-audit.json').read_text()) for name in ['seed-1779033703','seed-3144134277','seed-1013904242','fault-retained-copy-level']]
assert all(p['status']=='passed' and p['predictionsMadeBeforeNativeExecution'] for p in proofs)
boundaries=[]
for seed in [1779033703,3144134277,1013904242]:
    name='boundaries-'+str(seed);report=json.loads((out/name/'report.json').read_text())
    assert report['status']=='passed' and report['gitHead']==head
    boundaries.append(dict(path=name+'/report.json',sha256=sha(out/name/'report.json'),seed=seed))
files={p.relative_to(out).as_posix():sha(p) for p in out.rglob('*') if p.is_file() and p.name not in ['receipt.json','acceptance.log']}
names=['renderer/virgl-command/resources.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/tests/standard-image-boundaries.mjs','tools/virgl-command/standard-image-adversarial.mjs','tools/virgl-command/standard-image-adversarial-audit.py','tools/verify-virgl-standard-image-subresources-adversarial.mjs','tools/verify-virgl-standard-image-subresources-adversarial.sh','Makefile']
sources={name:sha(root/name) for name in names}
for name,digest in sources.items():assert hashlib.sha256(subprocess.check_output(['git','show',head+':'+name])).hexdigest()==digest,'freeze promoted source '+name
receipt=dict(schema='independent-original-image-adversarial-receipt-v1',task='E6-T11d21',status='passed',gitHead=head,proofs=proofs,boundaries=boundaries,sources=sources,files=files,authority='isolated-original-image-retained-generation',guestExecution=False,productionNegotiation=False,performanceClaim=False)
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print('Independent original image adversarial recording complete')
PY
