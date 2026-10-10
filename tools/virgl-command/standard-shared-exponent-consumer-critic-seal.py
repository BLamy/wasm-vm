#!/usr/bin/env python3
"""Seal complete critic inputs, native captures, source closure and interval audit."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT=Path(__file__).resolve().parents[2]
sha=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT)
FROZEN='62011567d7616e2b9bbe888e4754aa2064bde3ee'

def main():
    capture,output=[Path(s).resolve() for s in sys.argv[1:3]]
    output.mkdir(parents=True,exist_ok=True)
    audit=json.loads((capture/'audit.json').read_bytes());coverage=json.loads((capture/'coverage.json').read_bytes())
    assert audit['status']==coverage['status']=='passed' and audit['taskCorrectness']=='HELD'
    assert all(r['held'] or r['waiver'] for r in coverage['intervals'])
    assert not git('diff','--name-only','HEAD')
    head=git('rev-parse','HEAD').decode().strip()
    for name in ['decoder','state']:
        path='renderer/virgl-command/'+name+'.mjs'
        assert (ROOT/path).read_bytes()==git('show',FROZEN+':'+path)
    for name in ['fresh-wire','novel-native','fresh-matrix','historical-native']+['fresh-boundaries-'+s for s in ['0x6a09e667','0xbb67ae85','0x3c6ef372']]+['fresh-fault-original-level','fresh-fault-linear-filter','sabotage-post-fence']:
        report=json.loads((capture/name/'report.json').read_bytes())
        assert report['gitHead']==head
        assert report['status']==('failed' if name.startswith(('fresh-fault-','sabotage-')) else 'passed')
    assert 'SHARED_EXPONENT_CONSUMER_CRITIC_COMPLETE' in (capture/'critic.log').read_text()
    members={}
    for path in sorted(capture.rglob('*')):
        if path.is_file():members['capture/'+path.relative_to(capture).as_posix()]=path.read_bytes()
    for path in ['predictions.json','novel-input-declaration.json','verdict.md']:
        raw=(capture/path).read_bytes();(output/path).write_bytes(raw);members['verdict/'+path]=raw
    receipt=json.loads((capture/'worker/hot/receipt.json').read_bytes())
    for path,digest in receipt['sources'].items():
        original=git('show',FROZEN+':'+path);assert sha(original)==digest
        # Historical sealed data retain their original Git identity and exact
        # authenticated digest. Do not multiply their unchanged recordings.
        if not path.startswith('evidence/'):
            members['source-frozen/'+path]=original
    paths=['AGENTS.md','Makefile','renderer/virgl-command/tests/standard-shared-exponent-consumer-critic.mjs',
           'tools/verify-virgl-standard-shared-exponent-consumer-adversarial.mjs',
           'tools/verify-virgl-standard-shared-exponent-consumer-adversarial.sh',
           'tools/virgl-command/standard-shared-exponent-consumer-critic.py',
           'tools/virgl-command/standard-shared-exponent-consumer-critic-coverage.py',
           'tools/virgl-command/standard-shared-exponent-consumer-critic-seal.py',
           'tasks/epic-6-transcendence/E6-T11d30-standard-shared-exponent-consumer.md']
    for path in paths:
        raw=(ROOT/path).read_bytes();assert raw==git('show',head+':'+path);members['source-critic/'+path]=raw
    index=(json.dumps(dict(schema='d30-full-critic-records-v1',task='E6-T11d30',nativeHead=head,runtimeHead=FROZEN,
                           records=[dict(path=name,bytes=len(raw),sha256=sha(raw)) for name,raw in sorted(members.items())]),indent=2)+'\n').encode()
    (output/'records.json').write_bytes(index)
    memory=io.BytesIO()
    with gzip.GzipFile(fileobj=memory,mode='wb',mtime=0) as compressed:
        with tarfile.open(fileobj=compressed,mode='w') as tar:
            for name,raw in sorted(members.items()):
                info=tarfile.TarInfo(name);info.size,info.mtime,info.mode=len(raw),0,0o644;tar.addfile(info,io.BytesIO(raw))
    raw=memory.getvalue();(output/'recording.tar.gz').write_bytes(raw)
    manifest=dict(schema='d30-full-independent-critic-seal-v1',task='E6-T11d30',verdict='verified',nativeHead=head,runtimeHead=FROZEN,
                  workerSubmission=audit['workerSubmission'],records=len(members),unpackedBytes=sum(map(len,members.values())),archiveBytes=len(raw),
                  archiveSha256=sha(raw),recordIndexSha256=sha(index),auditSha256=sha((capture/'audit.json').read_bytes()),
                  coverageSha256=sha((capture/'coverage.json').read_bytes()),verdictSha256=sha((capture/'verdict.md').read_bytes()),
                  workerArchiveSha256=audit['workerManifest']['archiveSha256'],workerIndexSha256=audit['workerManifest']['recordIndexSha256'],
                  allTaskPredictionsHeld=True,guestExecution=False,productionNegotiation=False,productionDrawAuthority=False,
                  authority='isolated-original-RGB9E5-native-sampler-consumer')
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    seen=set();expected={r['path']:r for r in json.loads((output/'records.json').read_bytes())['records']}
    with tarfile.open(output/'recording.tar.gz','r:gz') as tar:
        for member in tar:
            assert member.isfile() and member.name not in seen and member.name in expected
            raw=tar.extractfile(member).read();row=expected[member.name]
            assert sha(raw)==row['sha256'] and len(raw)==row['bytes'] and raw==members[member.name];seen.add(member.name)
    assert seen==expected.keys()
    print(json.dumps(manifest))

if __name__=='__main__':main()
