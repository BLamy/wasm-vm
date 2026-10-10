#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_TEXTURE_STORAGE_ADVERSARIAL_DIR:-target/evidence/virgl-standard-texture-storage-adversarial}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
exec > >(tee "$evidence/acceptance.log") 2>&1
node --check tools/virgl-command/standard-texture-adversarial.mjs
node --check tools/verify-virgl-standard-texture-storage-adversarial.mjs
python3 -m py_compile tools/virgl-command/standard-texture-adversarial-audit.py
bash -n tools/verify-virgl-standard-texture-storage-adversarial.sh
for seed in 2463613825 2135583533 3091592025; do
  node tools/verify-virgl-standard-texture-storage-adversarial.mjs --module tools/virgl-command/standard-texture-adversarial.mjs --output "$evidence/seed-$seed" --seed "$seed"
  python3 tools/virgl-command/standard-texture-adversarial-audit.py "$evidence/seed-$seed"
done
if node tools/verify-virgl-standard-texture-storage-adversarial.mjs --module tools/virgl-command/standard-texture-adversarial.mjs --output "$evidence/fault-native-level" --seed 2463613825 --fault native-level; then
  echo 'ERROR: native retained-level corruption escaped the unchanged original oracle' >&2
  exit 1
fi
python3 tools/virgl-command/standard-texture-adversarial-audit.py "$evidence/fault-native-level" --fault
python3 - "$evidence" <<'PY'
from pathlib import Path
import hashlib,json,subprocess,sys
root=Path.cwd();out=Path(sys.argv[1]);sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
proofs=[json.loads((out/name/'independent-audit.json').read_text())for name in ['seed-2463613825','seed-2135583533','seed-3091592025','fault-native-level']]
assert all(p['status']=='passed'for p in proofs)
files={p.relative_to(out).as_posix():sha(p)for p in out.rglob('*')if p.is_file()and p.name not in ['receipt.json','acceptance.log']}
sources={name:sha(root/name)for name in ['renderer/virgl-command/resources.mjs','renderer/virgl-command/decoder.mjs','tools/virgl-command/standard-texture-adversarial.mjs','tools/virgl-command/standard-texture-adversarial-audit.py','tools/verify-virgl-standard-texture-storage-adversarial.mjs','tools/verify-virgl-standard-texture-storage-adversarial.sh','Makefile']}
for name,digest in sources.items():assert hashlib.sha256(subprocess.check_output(['git','show',head+':'+name])).hexdigest()==digest,'freeze promoted source '+name
receipt=dict(schema='independent-original-mip-adversarial-receipt-v1',task='E6-T11d20',status='passed',gitHead=head,proofs=proofs,sources=sources,files=files,authority='isolated-original-mip-storage-transfers',guestExecution=False,productionNegotiation=False,performanceClaim=False)
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print('Independent original mip adversarial recording complete')
PY
