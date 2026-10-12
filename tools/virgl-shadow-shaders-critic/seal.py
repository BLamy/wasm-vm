#!/usr/bin/env python3
"""Seal the frozen fresh critic, actual binaries and full carried worker archives."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import time

ROOT=Path(__file__).resolve().parents[2]
sha=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT)


def main(directory,output):
    directory,output=Path(directory).resolve(),Path(output).resolve();head=git('rev-parse','HEAD').decode().strip()
    assert not git('diff','--name-only','HEAD').strip(),'freeze tracked source before sealing'
    for _ in range(100):
        log=(directory/'acceptance.log').read_bytes()
        if log.endswith(b'Independent shadow critic acceptance completed.\n'):break
        time.sleep(.01)
    else:raise ValueError('fresh critic recording incomplete')
    names=['authentication.json','original-response-audit.json','coverage-fine.json','worker-original-physical-audit.json','environment-stack-audit.json','novel-physical-audit.json','independent/audit.json']
    audits={name:json.loads((directory/name).read_bytes()) for name in names}
    assert all(a['status']=='passed' for a in audits.values())
    report=json.loads((directory/'independent/hardware/report.json').read_bytes());assert report['status']=='passed' and report['gitHead']==head and not report['trackedChanges']
    assert report['browserErrors']==dict(console=[],page=[],requests=[])
    assert report['acceptance']['frames'][0]['status']=='held' and report['acceptance']['frames'][1]['status']=='refuted'
    assert len(report['acceptance']['frames'][1]['misses'])==4
    allocations=[json.loads(line) for line in (directory/'independent/allocations.jsonl').read_text().splitlines()]
    assert allocations[-1]['faults']==allocations[-1]['recoveries']==213 and allocations[-1]['callerMutation'] and not allocations[-1]['partialResults']
    members={}
    for file in sorted(directory.rglob('*')):
        if not file.is_file() or file.is_relative_to(directory/'unpacked'):continue
        members['fresh/'+file.relative_to(directory).as_posix()]=file.read_bytes()
    # Full source closure behind the actual frozen checker and carried compiler.
    source_names={row['path'] for row in audits['authentication.json']['sourceClosure']}
    source_names.update(git('ls-files','AGENTS.md','Makefile','tools/virgl-shadow-shaders-critic','tools/verify-virgl-shadow-shaders-critic.sh','tools/lib/virgl-browser-runner.mjs','tools/virgl-original-corpus/toolchain.py','tools/virgl-original-corpus/shared.py','tools/setup-virgl-emsdk.sh','web/package.json','web/package-lock.json','evidence/virgl-shadow-shaders/verifier/predictions.json').decode().splitlines())
    for name in sorted(source_names):
        raw=(ROOT/name).read_bytes();assert raw==git('show',head+':'+name),name
        members['source/'+name]=raw
    generated={}
    for item in report['sources']+report['servedFiles']:
        name=item['path'];raw=(ROOT/name).read_bytes();assert sha(raw)==item['sha256'] and len(raw)==item['size'],name
        if '/build/' in name or name.startswith('target/'):
            generated[name]=sha(raw);members['generated/'+name]=raw
        else:
            assert raw==git('show',head+':'+name),name
            members['source/'+name]=raw
    for mode,binary in [('native','standard-shadow-texture-test'),('sanitize','standard-shadow-texture-test'),('allocation-sanitize','standard-shadow-texture-allocation-test')]:
        name='renderer/virgl-shader/build/standard-shadow-texture-'+mode+'/'+binary
        raw=(ROOT/name).read_bytes();generated[name]=sha(raw);members['generated/'+name]=raw
    worker=ROOT/'evidence/virgl-shadow-shaders/worker';wmraw=(worker/'manifest.json').read_bytes();wm=json.loads(wmraw)
    assert sha(wmraw)==audits['authentication.json']['worker']['manifestSha256']
    for leaf in ['manifest.json','records.json']+[part['path'] for part in wm['archiveParts']]:
        members['carried-worker-seal/'+leaf]=(worker/leaf).read_bytes()
    index=(json.dumps(dict(schema='independent-original-shadow-critic-records-v1',task='E6-T11d48',sourceHead=head,workerFreeze=wm['sourceHead'],records=[dict(path=name,bytes=len(raw),sha256=sha(raw)) for name,raw in sorted(members.items())]),indent=2)+'\n').encode()
    archive=io.BytesIO()
    with gzip.GzipFile(fileobj=archive,mode='wb',mtime=0) as compressed:
        with tarfile.open(fileobj=compressed,mode='w') as tar:
            physical={}
            for name,raw in sorted(members.items()):
                info=tarfile.TarInfo(name);info.size=len(raw);info.mtime=0;info.mode=0o644;key=(len(raw),sha(raw));earlier=physical.get(key)
                if earlier:
                    assert members[earlier]==raw;info.type=tarfile.LNKTYPE;info.linkname=earlier;info.size=0;tar.addfile(info)
                else:tar.addfile(info,io.BytesIO(raw));physical[key]=name
    raw=archive.getvalue();output.mkdir(parents=True,exist_ok=True);parts=[]
    for number,at in enumerate(range(0,len(raw),16*1024*1024)):
        name='recording.tar.gz.part-'+str(number).zfill(4);body=raw[at:at+16*1024*1024];(output/name).write_bytes(body);parts.append(dict(path=name,bytes=len(body),sha256=sha(body)))
    restored=b''.join((output/part['path']).read_bytes() for part in parts);assert restored==raw
    expected={row['path']:row for row in json.loads(index)['records']};bodies={};seen=set();logical=0
    with tarfile.open(fileobj=io.BytesIO(restored),mode='r|gz') as tar:
        for entry in tar:
            assert entry.name in expected and entry.name not in seen and (entry.isfile() or entry.islnk())
            if entry.islnk():assert entry.linkname in bodies;body=bytes(bodies[entry.linkname])
            else:body=tar.extractfile(entry).read();bodies[entry.name]=body
            row=expected[entry.name];assert len(body)==row['bytes'] and sha(body)==row['sha256'];seen.add(entry.name);logical+=len(body)
    assert seen==set(expected)
    (output/'records.json').write_bytes(index)
    manifest=dict(schema='independent-original-shadow-critic-seal-v1',task='E6-T11d48',sourceHead=head,workerFreeze=wm['sourceHead'],submission='b0bc023d80c06cf0a449eb7648632b3a9a0af137',predecessor='41c1aa490d19d8c307ea7bdbb5647acf346681f4',status='passed',records=len(members),reopenedMembers=len(seen),physicalBodies=len(bodies),logicalBytes=logical,archiveBytes=len(raw),archiveSha256=sha(raw),archiveParts=parts,recordIndexSha256=sha(index),completeWorkerSealIncluded=True,reopenedWorkerMembers=52584,reopenedPredecessorMembers=213503,independentCases=audits['independent/audit.json']['cases'],physicalBaselineWords=24,physicallyRefutedWords=4,finestCoverage=audits['coverage-fine.json']['counts'],audits={name:sha((directory/name).read_bytes()) for name in names},generated=generated,guestExecution=False,productionNegotiation=False,productionDrawAuthority=False)
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest))


if __name__=='__main__':main(*sys.argv[1:])
