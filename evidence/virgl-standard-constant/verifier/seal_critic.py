"""Seal the critic's new physical recordings and small audits without duplicating worker records."""
import gzip,hashlib,io,json,subprocess,tarfile
from pathlib import Path
BASE=Path(__file__).resolve().parent;ROOT=BASE.parents[2];PHYSICAL=ROOT/'target/evidence/virgl-standard-constant-critic-final'
sha=lambda b:hashlib.sha256(b).hexdigest()
assert (PHYSICAL/'acceptance.log').read_text().rstrip().endswith('STANDARD_CONSTANT_ADVERSARIAL_COMPLETE')
assert json.loads((PHYSICAL/'independent-audit.json').read_text())['status']=='HELD'
assert (ROOT/'renderer/virgl-command/state.mjs').read_bytes()==subprocess.check_output(['git','show','39a9d14b7052c60ca11416bdba4e6eb78a38b1dd:renderer/virgl-command/state.mjs'],cwd=ROOT)
paths=['predictions.json','authentication.json','original-audit.json','coverage-audit.json','source-scope.json','citations.json','verdict.json','authenticate.py','audit_originals.py','audit_coverage.py','seal_critic.py']
members={ 'critic/'+p:(BASE/p).read_bytes() for p in paths }
for p in sorted(PHYSICAL.rglob('*')):
    if p.is_file():members['physical/'+p.relative_to(PHYSICAL).as_posix()]=p.read_bytes()
promoted=['Makefile','renderer/virgl-command/tests/standard-constant-attributes-adversarial.mjs','tools/verify-virgl-standard-constant.mjs','tools/verify-virgl-standard-constant-adversarial.sh','tools/virgl-command/standard-constant-adversarial-oracle.mjs','tools/virgl-command/standard-constant-adversarial-pixels.mjs']
for p in promoted:members['promoted/'+p]=(ROOT/p).read_bytes()
index=dict(schema='D7-critic-record-index-v1',workerSourceHead='39a9d14b7052c60ca11416bdba4e6eb78a38b1dd',workerSubmission='c63127a4954b6c61d23b2595149d8ab20116fdc6',records=[dict(path=p,bytes=len(raw),sha256=sha(raw)) for p,raw in sorted(members.items())])
rawIndex=(json.dumps(index,indent=2)+'\n').encode();(BASE/'records.json').write_bytes(rawIndex)
stream=io.BytesIO()
with gzip.GzipFile(fileobj=stream,mode='wb',mtime=0) as compressed:
    with tarfile.open(fileobj=compressed,mode='w') as archive:
        for p,raw in sorted(members.items()):
            info=tarfile.TarInfo(p);info.size=len(raw);info.mode=0o644;info.mtime=0;archive.addfile(info,io.BytesIO(raw))
packed=stream.getvalue();(BASE/'recording.tar.gz').write_bytes(packed)
manifest=dict(schema='D7-critic-seal-v1',task='E6-T11d7',verdict='verified',authority='isolated-standard-constant-attributes',guestExecution=False,productionNegotiation=False,
              runtimeSourceHead='39a9d14b7052c60ca11416bdba4e6eb78a38b1dd',runtimeStateDigest=sha((ROOT/'renderer/virgl-command/state.mjs').read_bytes()),workerArchiveDigest='598acb64caacea419f099a5fc1bb25fe763c4ce8dfb3eb8c0a76126acea28aca',
              records=len(members),archiveBytes=len(packed),archiveDigest=sha(packed),recordIndexDigest=sha(rawIndex),physicalAuditDigest=sha((PHYSICAL/'independent-audit.json').read_bytes()),predictionsDigest=sha((BASE/'predictions.json').read_bytes()),
              physicalFrames=9,checkedPhysicalPixels=5700,originalWorkerFramesChecked=62,originalWorkerPixelsChecked=25000)
(BASE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest,indent=2))
