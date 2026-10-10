#!/usr/bin/env python3
"""Seal the critic's complete recorded inputs, native runs, audits and source bytes."""
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


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();source=args.input.resolve();output=args.output.resolve()
    head=git('rev-parse','HEAD').decode().strip()
    assert not git('diff','--name-only','HEAD').strip(),'freeze tracked critic source before sealing'
    worker=json.loads((ROOT/'evidence/virgl-standard-float-consumer/worker/manifest.json').read_text())
    final=json.loads((source/'audit-final/original-audit.json').read_text())
    assert final['status']=='passed-original-state-audit'and not any(r['coverageGapCount']for r in final['sourceClosure'])
    assert (source/'native-final/acceptance.log').read_bytes().endswith(b'FLOAT_CONSUMER_CRITIC_RECORDING_COMPLETE\n')
    members={}
    def add(name,raw):
        assert name not in members
        members[name]=raw
    for path in sorted(source.rglob('*')):
        if path.is_file():add('critic/'+path.relative_to(source).as_posix(),path.read_bytes())
    # Reopen exact Git bytes for every authoritative retained run, including the
    # earlier completed experiment. The ephemeral precheck preceded the harness
    # commit; preserve it in full without granting it source or runtime authority.
    # Generated modules match the
    # authenticated unchanged fixed-memory worker compiler.
    for report in source.rglob('report.json'):
        if 'precheck-wire' in report.relative_to(source).parts:continue
        record=json.loads(report.read_text())
        if 'gitHead'not in record or 'sources'not in record:continue
        for item in record['sources']:
            name=item['path']
            if '/build/'in name:
                raw=(ROOT/name).read_bytes();key='generated/'+name
            else:
                raw=git('show',record['gitHead']+':'+name);key='sources/'+record['gitHead']+'/'+name
            assert len(raw)==item['bytes']and sha(raw)==item['sha256'],(report,name)
            if key not in members:add(key,raw)
            else:assert members[key]==raw
    for name in git('ls-files','tools/virgl-command/standard-float-consumer-adversarial*','tools/verify-virgl-standard-float-consumer-adversarial*','renderer/virgl-command/tests/standard-float-consumer-adversarial.mjs','Makefile').decode().splitlines():
        raw=git('show',head+':'+name);assert raw==(ROOT/name).read_bytes();key='sources/'+head+'/'+name
        if key not in members:add(key,raw)
    for name in ['manifest.json','records.json']:
        add('worker-reference/'+name,(ROOT/'evidence/virgl-standard-float-consumer/worker'/name).read_bytes())
    output.mkdir(parents=True,exist_ok=True)
    index=(json.dumps(dict(schema='independent-float-consumer-critic-records-v1',task='E6-T11d26',sourceHead=head,
                          records=[dict(path=name,bytes=len(raw),sha256=sha(raw))for name,raw in sorted(members.items())]),indent=2)+'\n').encode()
    (output/'records.json').write_bytes(index)
    buffer=io.BytesIO()
    with gzip.GzipFile(fileobj=buffer,mode='wb',mtime=0)as compressed:
        with tarfile.open(fileobj=compressed,mode='w')as archive:
            for name,raw in sorted(members.items()):
                info=tarfile.TarInfo(name);info.size=len(raw);info.mtime=0;info.mode=0o644
                archive.addfile(info,io.BytesIO(raw))
    raw=buffer.getvalue();(output/'recording.tar.gz').write_bytes(raw)
    manifest=dict(schema='independent-float-consumer-critic-seal-v1',task='E6-T11d26',verdict='verified',sourceHead=head,
                  workerFrozenHead=worker['sourceHead'],workerArchiveSha256=worker['archiveSha256'],workerIndexSha256=worker['recordIndexSha256'],
                  records=len(members),unpackedBytes=sum(map(len,members.values())),archiveBytes=len(raw),archiveSha256=sha(raw),recordIndexSha256=sha(index),
                  nativeFreeze='c4be7146cb3859761eb40a0d70d3d7746647bb07',originalAuditSha256=sha((source/'audit-final/original-audit.json').read_bytes()),
                  precheckAuthority=False,
                  guestExecution=False,productionDrawAuthority=False,authority='isolated-original-floating-image-consumer')
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    # Independent reopening, not reliance on the writer's member loop.
    wanted={r['path']:r for r in json.loads(index)['records']};seen=set()
    with tarfile.open(output/'recording.tar.gz','r:gz')as archive:
        for item in archive:
            assert item.isfile()and item.name in wanted and item.name not in seen
            data=archive.extractfile(item).read();expected=wanted[item.name]
            assert len(data)==expected['bytes']and sha(data)==expected['sha256'];seen.add(item.name)
    assert seen==set(wanted)
    print(json.dumps(manifest))


if __name__=='__main__':main()
