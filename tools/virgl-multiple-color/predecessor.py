#!/usr/bin/env python3
"""Authenticate both whole D33 seals and carry only unchanged dependency facts."""
import hashlib,json,subprocess,sys,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];BASE='1206a5beb3026de10457cd395d249daf8aff9966'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
out=Path(sys.argv[1]).resolve();out.mkdir(parents=True,exist_ok=True)
subprocess.run(['python3','tools/virgl-integer-image-consumer/predecessor.py',str(out)],cwd=ROOT,check=True)
prior=json.loads((out/'authentication.json').read_text());seals=[]
for role in ['worker','verifier']:
    base=ROOT/'evidence/virgl-integer-image-consumer'/role
    manifest_raw=(base/'manifest.json').read_bytes();manifest=json.loads(manifest_raw);index_raw=(base/'records.json').read_bytes()
    assert sha(index_raw)==manifest['recordIndexSha256'] and sha((base/'recording.tar.gz').read_bytes())==manifest['archiveSha256']
    records=json.loads(index_raw)['records'];wanted={r['path']:r for r in records};assert len(wanted)==len(records)==manifest['records'];seen=set()
    with tarfile.open(base/'recording.tar.gz','r:gz') as tar:
        for member in tar:
            assert member.isfile() and member.name in wanted and member.name not in seen
            raw=tar.extractfile(member).read();r=wanted[member.name];assert len(raw)==r['bytes'] and sha(raw)==r['sha256'];seen.add(member.name)
    assert seen==set(wanted)
    for name in ['manifest.json','records.json','recording.tar.gz']:
        relative=(base/name).relative_to(ROOT).as_posix();assert (base/name).read_bytes()==subprocess.check_output(['git','show',BASE+':'+relative],cwd=ROOT)
    seals.append(dict(role=role,members=len(seen),archiveSha256=manifest['archiveSha256'],recordIndexSha256=sha(index_raw),manifestSha256=sha(manifest_raw)))
old=subprocess.check_output(['git','show',BASE+':renderer/virgl-command/constant-domain.mjs'],cwd=ROOT)
assert (ROOT/'renderer/virgl-command/constant-domain.mjs').read_bytes().startswith(old)
(out/'integer-contract.mjs').write_bytes(old)
unchanged=[]
for prefix in ['renderer/virgl-shader','renderer/virgl-command/resources.mjs','renderer/virgl-command/integer-images.mjs',
               'renderer/virgl-command/shared-exponent-gpu.mjs','renderer/virgl-command/color-images.mjs',
               'renderer/virgl-command/float-images.mjs','renderer/virgl-command/packed-float-images.mjs','renderer/virgl-command/shared-exponent-images.mjs']:
    for name in subprocess.check_output(['git','ls-tree','-r','--name-only',BASE,'--',prefix],cwd=ROOT,text=True).splitlines():
        raw=(ROOT/name).read_bytes();assert raw==subprocess.check_output(['git','show',BASE+':'+name],cwd=ROOT)
        unchanged.append(dict(path=name,bytes=len(raw),sha256=sha(raw)))
result=dict(status='passed',predecessor=BASE,seals=seals,compilerDependency=prior,unchanged=unchanged,
 historicalIntegerContractPrefixSha256=sha(old),sourceConsumerRuntimeCarried=False,compilerStorageFactsCarried=True,guestExecution=False,productionNegotiation=False)
(out/'authentication.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(dict(status='passed',members=sum(s['members'] for s in seals),unchanged=len(unchanged))))
