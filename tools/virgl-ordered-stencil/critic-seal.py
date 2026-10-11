#!/usr/bin/env python3
"""Seal all complete fresh critic bodies, original sources and independent audits."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

ROOT=Path(__file__).resolve().parents[2]
sha=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT)
RUNTIME='renderer/virgl-command/state.mjs'
FREEZE='c510692cc77e0f0c99d1e2f28dff9de6de2f3372'

def main():
    p=argparse.ArgumentParser();p.add_argument('capture',type=Path);p.add_argument('output',type=Path);p.add_argument('replay',type=Path)
    args=p.parse_args();capture=args.capture.resolve();output=args.output.resolve();replay=args.replay.resolve()
    assert not (output/'recording.tar.gz').exists(),'refuse to overwrite closed critic archive'
    head=git('rev-parse','HEAD').decode().strip();assert not git('diff','--name-only','HEAD').strip()
    assert (ROOT/RUNTIME).read_bytes()==git('show',FREEZE+':'+RUNTIME),'critic must not fix runtime'
    marker=json.loads((capture/'reporting-complete.json').read_text());assert marker['status']=='passed' and marker['gitHead']==head
    names=['schedule-0x243f6a88','schedule-0x85a308d3','schedule-0x13198a2e','novel','fault-order'];source_pins={}
    for name in names:
        raw=(capture/name/'report.json').read_bytes();report=json.loads(raw)
        assert sha(raw)==marker['reportDigests'][name] and report['gitHead']==head
        assert report['status']==('failed' if name=='fault-order' else 'passed') and report['browserErrors']==dict(console=[],page=[],requests=[])
        for row in report['sources']:
            body=(capture/name/'source'/row['path']).read_bytes()
            assert len(body)==row['bytes'] and sha(body)==row['sha256']
            assert row['path'] not in source_pins or source_pins[row['path']]==row['sha256']
            source_pins[row['path']]=row['sha256']
            assert (ROOT/row['path']).read_bytes()==body
        if name=='fault-order':
            m=report['mutation'];body=(capture/name/'served'/m['path']).read_bytes()
            assert len(body)==m['delivered']['bytes'] and sha(body)==m['delivered']['sha256']
        for row in report['servedFiles']:
            if row['path']=='/':continue
            expected=report['mutation']['delivered']['sha256'] if name=='fault-order' and row['path']=='/'+report['mutation']['path'] else source_pins[row['path'][1:]]
            assert row['sha256']==expected
        cov=json.loads((capture/name/'browser-coverage.json').read_text())
        for script in cov['scripts']:
            assert sha(script['sourceBody'].encode())==script['sha256']
            assert next(row for row in report['servedFiles'] if row['path']=='/'+script['source'])['sha256']==script['sha256']
        evidence=report['browserResult'].get('result') or report['partial']
        assert 'Metal' in evidence['gpu'] and 'M4' in evidence['gpu'] and report['browser']['headless'] is False
        for ref in evidence['blobs']:
            zipped=(capture/name/ref['path']).read_bytes();body=gzip.decompress(zipped)
            assert sha(zipped)==ref['gzipSha256'] and len(body)==ref['bytes'] and sha(body)==ref['sha256']
        for ref in evidence['runs']:
            if 'path' in ref:
                body=(capture/name/ref['path']).read_bytes();assert len(body)==ref['bytes'] and sha(body)==ref['sha256']
        for field in ['screenshot','browserCoverage']:
            ref=report[field];assert sha((capture/name/ref['path']).read_bytes())==ref['sha256']
    assert json.loads((replay/'replay-result.json').read_text())['status']=='passed'
    members={}
    for path in sorted(capture.rglob('*')):
        if path.is_file():members['capture/'+path.relative_to(capture).as_posix()]=path.read_bytes()
    excluded={'recording.tar.gz','records.json','manifest.json','reopening-audit.json','VERDICT.md'}
    for path in sorted(output.rglob('*')):
        if path.is_file() and path.name not in excluded and '__pycache__' not in path.parts:
            members['audit/'+path.relative_to(output).as_posix()]=path.read_bytes()
    for path in sorted(replay.rglob('*')):
        if path.is_file() and (path.name.endswith('-audit.json') or path.name in ['independent-values.json','replay-result.json']):
            members['worker-replay/'+path.relative_to(replay).as_posix()]=path.read_bytes()
    # Source closure covers the actual native runner and the independently run
    # inverses/lifetime imports, plus all original primary/compiler bodies.
    roots=['renderer/virgl-command','renderer/virgl-shader','tools/virgl-command','tools/virgl-ordered-stencil',
           'tools/virgl-stencil','tools/virgl-unorm-depth','tools/virgl-packed-depth-consumer',
           'tools/virgl-floating-depth','tools/virgl-floating-depth-consumer',
           'tools/verify-virgl-ordered-stencil.mjs','tools/verify-virgl-ordered-stencil-critic.sh',
           'tools/verify-virgl-ordered-stencil.sh','Makefile','AGENTS.md','tools/check_task_policy.py',
           'web/package.json','web/package-lock.json','tasks/epic-6-transcendence/E6-T11d45-ordered-stencil.md']
    closure=git('ls-files',*roots).decode().splitlines();source_closure={}
    for name in sorted(set(closure)|set(source_pins)):
        body=(ROOT/name).read_bytes()
        if '/build/wasm/' not in name:assert body==git('show',head+':'+name),name
        if name in source_pins:assert sha(body)==source_pins[name],name
        members['source/'+name]=body;source_closure[name]=dict(bytes=len(body),sha256=sha(body))
    records=[dict(path=name,bytes=len(body),sha256=sha(body)) for name,body in sorted(members.items())]
    index=(json.dumps(dict(schema='d45-fresh-critic-records-v1',task='E6-T11d45',sourceHead=head,records=records),indent=2)+'\n').encode()
    stream=io.BytesIO();physical={};physical_count=0
    with gzip.GzipFile(fileobj=stream,mode='wb',mtime=0) as gz:
        with tarfile.open(fileobj=gz,mode='w') as tar:
            for name,body in sorted(members.items()):
                info=tarfile.TarInfo(name);info.size=len(body);info.mtime=0;info.mode=0o644
                key=(len(body),sha(body));earlier=physical.get(key)
                if earlier:
                    assert members[earlier]==body
                    info.type=tarfile.LNKTYPE;info.linkname=earlier;info.size=0;tar.addfile(info)
                else:
                    tar.addfile(info,io.BytesIO(body));physical[key]=name;physical_count+=1
    archive=stream.getvalue();output.mkdir(parents=True,exist_ok=True)
    (output/'recording.tar.gz').write_bytes(archive);(output/'records.json').write_bytes(index)
    indexed={r['path']:r for r in records};seen=set();phys={};logical_bytes=0;links=0
    with tarfile.open(fileobj=io.BytesIO(gzip.decompress((output/'recording.tar.gz').read_bytes())),mode='r:') as reopened:
        for entry in reopened.getmembers():
            assert entry.name in indexed and entry.name not in seen and (entry.isfile() or entry.islnk());seen.add(entry.name)
            if entry.islnk():
                assert entry.linkname in phys;target=phys[entry.linkname];assert target.offset<entry.offset and target.isfile();links+=1
            else:target=entry;phys[entry.name]=entry
            body=reopened.extractfile(target).read();r=indexed[entry.name]
            assert len(body)==r['bytes'] and sha(body)==r['sha256'];logical_bytes+=len(body)
    assert seen==set(indexed) and len(phys)==physical_count
    reopening=dict(status='passed',logicalMembers=len(seen),physicalBodies=len(phys),hardlinks=links,
                   logicalBytes=logical_bytes,allCompleteLogicalBodiesReopened=True,earlierRegularHardlinkTargetsOnly=True,
                   archiveSha256=sha(archive),recordIndexSha256=sha(index))
    reopen_raw=(json.dumps(reopening,indent=2)+'\n').encode();(output/'reopening-audit.json').write_bytes(reopen_raw)
    manifest=dict(schema='d45-fresh-critic-seal-v1',task='E6-T11d45',sourceHead=head,runtimeFreeze=FREEZE,
                  records=len(seen),physicalBodies=len(phys),logicalBytes=logical_bytes,archive=dict(path='recording.tar.gz',bytes=len(archive),sha256=sha(archive)),
                  recordIndexSha256=sha(index),reopeningAuditSha256=sha(reopen_raw),sourceClosure=source_closure,
                  sourceClosureIncluded=True,allCompleteBodiesReopened=True,predictionsFrozenBeforeNative=True,
                  guestExecution=False,productionNegotiation=False,productionDrawAuthority=False)
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(dict(sourceHead=head,records=len(seen),physicalBodies=len(phys),archive=manifest['archive'],indexSha256=sha(index))))
if __name__=='__main__':main()
