#!/usr/bin/env python3
"""Seal complete D27 critic records and independently reauthenticate the seal."""
import gzip, hashlib, io, json, subprocess, sys, tarfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sha=lambda raw:hashlib.sha256(raw).hexdigest()
NATIVE_HEAD='f79c5444953fcd68348ed2a2ea33ae742c7495eb'

def main():
    recording=Path(sys.argv[1]).resolve();output=Path(sys.argv[2]).resolve();members={}
    for path in recording.rglob('*'):
        if path.is_file():members['critic/'+path.relative_to(recording).as_posix()]=path.read_bytes()
    for suffix in ['c7cdb964','b4ba0e6b']:
        initial=recording.with_name(recording.name+'-initial-'+suffix)
        for path in initial.rglob('*'):
            if path.is_file():members['diagnostic-'+suffix+'/'+path.relative_to(initial).as_posix()]=path.read_bytes()
    for name in ['predictions.json','async-fixture-custody.json','verdict.json']:
        members['audit/'+name]=(output/name).read_bytes()
    for name in ['coverage.json','original-audit.json']:
        members['audit/initial-'+name]=(output/name).read_bytes()
    verdict=json.loads(members['audit/verdict.json']);assert verdict['verdict']=='verified' and all(r['result']=='HELD' for r in verdict['predictions'])
    original=json.loads(members['critic/audit/original-audit.json']);fresh=json.loads(members['critic/audit/fresh-audit.json']);coverage=json.loads(members['critic/audit/coverage.json'])
    assert original['status']==fresh['status']==coverage['status']=='passed' and all(r['held'] for r in coverage['intervals'])
    for name in ['boundaries','fields-0x6c8e9cf5','fields-0xd013cc87','sabotage-fields']:
        report=json.loads(members['critic/'+name+'/report.json']);assert report['gitHead']==NATIVE_HEAD
        assert report['status']==('failed' if name=='sabotage-fields' else 'passed')
        for source in report['sources']:
            raw=members['critic/'+name+'/'+source['archivePath']];assert len(raw)==source['bytes'] and sha(raw)==source['sha256']
            if '/build/' not in source['path']:assert raw==subprocess.check_output(['git','show',NATIVE_HEAD+':'+source['path']],cwd=ROOT)
    # Offline audit/seal code is retained too; it does not change native inputs.
    for name in ['tools/virgl-command/standard-packed-float-image-critic.py','tools/virgl-command/standard-packed-float-image-critic-coverage.py','tools/virgl-command/standard-packed-float-image-critic-seal.py','tools/verify-virgl-standard-packed-float-images-adversarial.sh','Makefile']:
        members['programs/'+name]=(ROOT/name).read_bytes()
    index=(json.dumps(dict(schema='d27-complete-critic-records-v1',task='E6-T11d27',nativeHead=NATIVE_HEAD,records=[dict(path=n,bytes=len(b),sha256=sha(b)) for n,b in sorted(members.items())]),indent=2)+'\n').encode()
    archive=io.BytesIO()
    with gzip.GzipFile(fileobj=archive,mode='wb',mtime=0) as compressed:
        with tarfile.open(fileobj=compressed,mode='w') as tar:
            for name,data in sorted(members.items()):
                info=tarfile.TarInfo(name);info.size=len(data);info.mtime=0;info.mode=0o644;tar.addfile(info,io.BytesIO(data))
    raw=archive.getvalue();output.mkdir(parents=True,exist_ok=True)
    (output/'records.json').write_bytes(index);(output/'recording.tar.gz').write_bytes(raw)
    # Independent read of the actual written archive, not the in-memory members.
    expected={row['path']:row for row in json.loads((output/'records.json').read_text())['records']};seen=set()
    with tarfile.open(output/'recording.tar.gz') as tar:
        for item in tar:
            data=tar.extractfile(item).read();assert item.isfile() and item.name not in seen and item.name in expected
            row=expected[item.name];assert len(data)==row['bytes'] and sha(data)==row['sha256'];seen.add(item.name)
    assert seen==expected.keys()
    manifest=dict(schema='d27-independent-critic-seal-v1',task='E6-T11d27',verdict='verified',nativeHead=NATIVE_HEAD,workerFrozenHead='f8daccb922097c7fa1cd71f601395824a32277e1',workerSubmission='62f86e0202d715f580a09ae15488a115d7999110',runtimeHead='f388827a41e0387d50cbf525141b90ca6a0d2c09',records=len(members),unpackedBytes=sum(map(len,members.values())),archiveBytes=len(raw),archiveSha256=sha((output/'recording.tar.gz').read_bytes()),recordIndexSha256=sha((output/'records.json').read_bytes()),originalAuditSha256=sha(members['critic/audit/original-audit.json']),freshAuditSha256=sha(members['critic/audit/fresh-audit.json']),coverageSha256=sha(members['critic/audit/coverage.json']),verdictSha256=sha(members['audit/verdict.json']),workerArchiveSha256=original['workerArchiveSha256'],workerIndexSha256=original['workerIndexSha256'],guestExecution=False,productionNegotiation=False,productionDrawAuthority=False,authority='isolated-original-R11G11B10-storage-transfers-ranges',completeIndexReauthenticated=True)
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest))

if __name__=='__main__':main()
