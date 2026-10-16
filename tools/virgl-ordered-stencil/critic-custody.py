#!/usr/bin/env python3
"""Fresh independent full-body/hardlink custody audit; never alters worker records."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
BASE = 'ff80836249c9f235cae516421498a574b51b6f9c'
FREEZE = 'c510692cc77e0f0c99d1e2f28dff9de6de2f3372'
SUBMISSION = '1d3955ec1f41b4dd32e9161eccc1eae6d7fd9633'
PINS = {
 'd45': ('evidence/virgl-ordered-stencil/worker', 83324,
         '6e1ab959e3e04a2998eabf4b60233419f3b0934ee33ccf2d36b09e441c28886c',
         'bfee67b4e66aa3645f1f05a7847ef0e8f6ee5f092904a60ff56ab28c22aae8eb',
         '5d40d9cf0650b561637863b24cd52984cf1fbaf08ebf988e8a57940add1f13ed',75846524),
 'd44-worker': ('evidence/virgl-stencil/worker',42535,
         '386cdb8880bcf72d20a9bf5d6c2bb1eef58023da64974448b42ef7edab445055',
         'e590aee23a07f06a68542a118dea90eb9823d31a3669dbfad17294566c8f9271',
         '46beab4bf23c06c2b8f826e41db8b0969cfd380b2a9bdcf750a4cc12322a848c',42370970),
 'd44-critic': ('evidence/virgl-stencil/verifier',6445,
         'a15d8b849cc8e3eef90a9116a16f16155c65130af3271c74b574bda5ce8b4b63',
         '4a73ffbdbc9461bfe0fa3997c9f22fcffb208b06636a900133b6b8cb8317594e',
         '6256d79d6cef23c6e20ce7b068773fddc5069d1f20183c0a9533e27c73e68ede',12899252),
 'gap': ('evidence/virgl-production-readiness/ordered-stencil-gap',938,None,
         'd62a3e86621ec234a2ca29bc5bd571a978e849af83813386d24a211ec8797a8c',
         'e37ee5c94be466e78b59271f0a2d9d1cf4afe52bf07b35e2d3b33143935be41b',2866674),
}
sha=lambda raw: hashlib.sha256(raw).hexdigest()
git=lambda *args: subprocess.check_output(['git',*args],cwd=ROOT)

def body_pin(path,digest,length=None):
    raw=path.read_bytes()
    assert sha(raw)==digest,str(path)
    assert length is None or len(raw)==length,str(path)
    return raw

def reopen(label,destination):
    folder,count,manifest_sha,index_sha,archive_sha,archive_bytes=PINS[label]
    index_raw=body_pin(ROOT/folder/'records.json',index_sha)
    parsed=json.loads(index_raw);records=parsed if isinstance(parsed,list) else parsed['records']
    expected={r['path']:r for r in records};assert len(expected)==len(records)==count
    manifest_raw=None
    if manifest_sha:
        manifest_raw=body_pin(ROOT/folder/'manifest.json',manifest_sha)
        manifest=json.loads(manifest_raw)
        assert manifest.get('recordIndexSha256',manifest.get('index',{}).get('sha256'))==index_sha
        assert manifest.get('archiveSha256',manifest.get('archive',{}).get('sha256'))==archive_sha
    archive_path=ROOT/folder/'recording.tar.gz'
    archive_raw=body_pin(archive_path,archive_sha,archive_bytes)
    del archive_raw
    if label.startswith('d44'):
        for name in ['manifest.json','records.json','recording.tar.gz']:
            assert (ROOT/folder/name).read_bytes()==git('show',BASE+':'+folder+'/'+name)
    if label=='d45':
        for name in ['manifest.json','records.json','recording.tar.gz']:
            assert (ROOT/folder/name).read_bytes()==git('show',SUBMISSION+':'+folder+'/'+name)
    assert not destination.exists(), 'refuse to overwrite earlier independent reopening'
    destination.mkdir(parents=True)
    physical={};seen=set();logical_bytes=0;links=0
    with tarfile.open(archive_path,mode='r|gz') as archive:
        for entry in archive:
            path=PurePosixPath(entry.name)
            assert not path.is_absolute() and '..' not in path.parts and entry.name in expected
            assert entry.name not in seen and (entry.isfile() or entry.islnk())
            seen.add(entry.name);dest=destination/entry.name;dest.parent.mkdir(parents=True,exist_ok=True)
            if entry.isfile():
                raw=archive.extractfile(entry).read();assert len(raw)==entry.size
                dest.write_bytes(raw);physical[entry.name]=(entry.offset,dest)
            else:
                assert entry.linkname in physical,'hardlink target is not an earlier physical regular body'
                offset,target=physical[entry.linkname];assert offset<entry.offset
                raw=target.read_bytes();os.link(target,dest);links+=1
            record=expected[entry.name]
            assert len(raw)==record['bytes'] and sha(raw)==record['sha256'],entry.name
            logical_bytes+=len(raw)
    assert seen==set(expected)
    return dict(folder=folder,members=len(seen),physicalBodies=len(physical),hardlinks=links,
                logicalBytes=logical_bytes,manifestSha256=manifest_sha,indexSha256=index_sha,
                archiveSha256=archive_sha,archiveBytes=archive_bytes,allBodiesReopened=True,
                extraction=str(destination))

def receipt(unpacked,prefix):
    raw=(unpacked/prefix/'receipt.json').read_bytes();r=json.loads(raw)
    expected_sha={'hot':'1963002b56559bdf2c7efed661a1e54eb389d2a291eb8d0f63db63db935ceecf',
                  'cold':'e045b25dfd225076460d96f85c681d7963c3d2f99b25ba71aa240d22bb9df980'}[prefix]
    assert sha(raw)==expected_sha and r['gitHead']==FREEZE and r['status']=='passed'
    for name,digest in r['files'].items():
        body_pin(unpacked/prefix/name,digest)
    for name,digest in r['sources'].items():
        body=git('show',FREEZE+':'+name);assert sha(body)==digest,name
        if not name.startswith('evidence/'):
            assert (unpacked/'source'/name).read_bytes()==body,name
        # The submitted task/queue carry the later claim and implemented status;
        # the archived acceptance still authenticates their exact freeze bodies.
        current_head=SUBMISSION if name in {'tasks/QUEUE.md',
            'tasks/epic-6-transcendence/E6-T11d45-ordered-stencil.md'} else FREEZE
        assert (ROOT/name).read_bytes()==git('show',current_head+':'+name),name
    for name,digest in r['generated'].items():
        body_pin(unpacked/(prefix+'-generated')/name,digest)
        body_pin(ROOT/name,digest)
    assert r['predecessor']==BASE and r['dependency']['reopenedMembers']==48980
    assert not r['guestExecution'] and not r['productionNegotiation'] and not r['productionDrawAuthority']
    return dict(sha256=expected_sha,files=len(r['files']),sources=len(r['sources']),
                generated=r['generated'],counts=r['counts'])

def main():
    p=argparse.ArgumentParser();p.add_argument('output',type=Path);p.add_argument('--unpack',type=Path,required=True)
    args=p.parse_args();output=args.output.resolve();output.mkdir(parents=True,exist_ok=True)
    scratch=args.unpack.resolve();assert not scratch.exists(),'refuse to overwrite closed independent records'
    d45_log=git('show',SUBMISSION+':tasks/epic-6-transcendence/E6-T11d45-ordered-stencil.md').decode()
    d44_log=git('show',BASE+':tasks/epic-6-transcendence/E6-T11d44-standard-stencil-consumer.md').decode()
    for label,pin in PINS.items():
        log=d44_log if label.startswith('d44') else d45_log
        for digest in [pin[2],pin[3],pin[4]]:
            if digest:assert digest in log,'unpublished source for custody pin '+label
    records={label:reopen(label,scratch/label) for label in PINS}
    u=scratch/'d45';receipts={prefix:receipt(u,prefix) for prefix in ['hot','cold']}
    cold_raw=body_pin(u/'cold/report.json','7a6e6cbd87183e8385f9fef867bf184756630752fb1961c511591e495e34331b')
    cold=json.loads(cold_raw)
    assert cold['gitHead']==cold['cloneHead']==FREEZE and cold['status']=='passed'
    assert cold['exitCode']==0 and not cold['statusBefore'] and not cold['statusAfter']
    assert cold['command']==['make','verify-E6-T11d45'] and 'RUST_LOG' in cold['removedEnvironmentNames']
    assert cold['receiptSha256']==receipts['cold']['sha256']
    body_pin(u/'cold/cold.log',cold['logSha256'])
    # Metadata/evidence-only submission commits preserve the completed final run.
    changed=git('diff','--name-only',FREEZE,SUBMISSION).decode().splitlines()
    assert all(name.startswith('evidence/virgl-ordered-stencil/worker/') or name in {
        'tasks/QUEUE.md','tasks/epic-6-transcendence/E6-T11d45-ordered-stencil.md'} for name in changed)
    for primary in ['tools/virgl-stencil/primary.json','tools/virgl-floating-depth/primary.json',
                    'tools/virgl-floating-depth-consumer/primary.json']:
        body=(ROOT/primary).read_bytes();assert body==git('show',BASE+':'+primary)
        for ref in json.loads(body)['sources']:
            body_pin(ROOT/ref['path'],ref['sha256'],ref['bytes'])
    negative=body_pin(ROOT/'evidence/virgl-production-readiness/standard-ordered-stencil-gap.json',
                      'ab0246ef23fb77e353bbbe451c86372050a97e3fb748ce676a71c1f5a06cff4c')
    assert json.loads(negative)['sourceHead']==BASE
    result=dict(schema='d45-fresh-independent-custody-v1',status='passed',workerSubmission=SUBMISSION,
                runtimeFreeze=FREEZE,predecessor=BASE,records=records,receipts=receipts,
                coldReportSha256=sha(cold_raw),coldClone=cold['clone'],coldRemovedNames=cold['removedEnvironmentNames'],
                primaryBodiesHeld=True,submissionDelta=changed)
    (output/'custody-audit.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(status='passed',members=sum(r['members'] for r in records.values()),
                         receipts={p:r['sha256'] for p,r in receipts.items()})))
if __name__=='__main__':main()
