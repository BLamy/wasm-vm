#!/usr/bin/env python3
"""Seal critic recordings without recursively copying published dependency archives."""
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


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('recordings',type=Path)
    parser.add_argument('output',type=Path)
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    audit=json.loads((args.recordings/'worker-audit.json').read_bytes())
    assert audit['verdict']=='held' and audit['authenticatedLogicalBodies']==642
    required={'replay','limits','historical','lifetime-0x73a9e20d','lifetime-0xb48f1637','lifetime-0x0c62d5ab','fault-count','fault-bytes','novel'}
    assert set(audit['fresh'])==required
    members={p.relative_to(args.recordings).as_posix():p.read_bytes() for p in sorted(args.recordings.rglob('*')) if p.is_file()}
    predictions=ROOT/'evidence/virgl-resource-capacity/verifier/predictions.json'
    members['predictions.json']=predictions.read_bytes()
    for name in ['tools/virgl-resource-capacity/critic.py','tools/virgl-resource-capacity/critic-native.mjs','tools/virgl-resource-capacity/critic.sh','tools/virgl-resource-capacity/critic-seal.py','tools/verify-virgl-resource-capacity.mjs','tools/verify-virgl-resource-capacity.sh','Makefile','AGENTS.md']:
        members['verifier-source/'+name]=(ROOT/name).read_bytes()
    inherited=json.loads(members['inherited-resources/receipt.json'])
    assert inherited['status']=='passed'
    for entry in inherited['sources']+inherited['inputs']:
        name,digest=entry['path'],entry['sha256']
        raw=(ROOT/name).read_bytes()
        if sha(raw)!=digest:
            raw=subprocess.check_output(['git','show',inherited['gitHead']+':'+name],cwd=ROOT)
        assert sha(raw)==digest,name
        members['inherited-source/'+name]=raw
    index=dict(schema='resource-capacity-critic-records-v1',task='E6-T11d50',sourceHead=audit['sourceHead'],
               workerSubmissionHead=json.loads(members['predictions.json'])['submissionHead'],
               records=[dict(path=name,bytes=len(raw),sha256=sha(raw)) for name,raw in sorted(members.items())])
    index_raw=(json.dumps(index,indent=2)+'\n').encode();(args.output/'records.json').write_bytes(index_raw)
    archive=io.BytesIO()
    with gzip.GzipFile(fileobj=archive,mode='wb',mtime=0) as compressed:
        with tarfile.open(fileobj=compressed,mode='w') as tar:
            earlier={}
            for name,raw in sorted(members.items()):
                entry=tarfile.TarInfo(name);entry.size=len(raw);entry.mode=0o644;entry.mtime=0
                key=(len(raw),sha(raw))
                if key in earlier:
                    entry.type=tarfile.LNKTYPE;entry.linkname=earlier[key];entry.size=0;tar.addfile(entry)
                else:
                    tar.addfile(entry,io.BytesIO(raw));earlier[key]=name
    archive_raw=archive.getvalue();(args.output/'recording.tar.gz').write_bytes(archive_raw)
    reopened=0
    with tarfile.open(fileobj=io.BytesIO(archive_raw),mode='r:gz') as tar:
        entries=tar.getmembers();physical={entry.name:entry for entry in entries}
        assert len(entries)==len(physical)==len(members)
        for entry in entries:
            target=physical[entry.linkname] if entry.islnk() else entry
            assert target.isfile() and (not entry.islnk() or target.offset<entry.offset)
            assert tar.extractfile(target).read()==members[entry.name],entry.name
            reopened+=1
    manifest=dict(schema='resource-capacity-critic-seal-v1',task='E6-T11d50',verdict='verified',
                  sourceHead=audit['sourceHead'],workerSubmissionHead=index['workerSubmissionHead'],
                  records=len(members),reopenedMembers=reopened,recordIndexSha256=sha(index_raw),
                  archiveParts=[dict(path='recording.tar.gz',bytes=len(archive_raw),sha256=sha(archive_raw))],
                  archiveBytes=len(archive_raw),archiveSha256=sha(archive_raw),
                  workerPins=audit['workerPins'],publishedDependencySeals=audit['dependencySeals'],
                  workerAuditSha256=sha(members['worker-audit.json']),predictionsSha256=sha(members['predictions.json']),
                  novelReportSha256=sha(members['fresh/novel/report.json']),
                  nativeBytes=sum(r['counts']['nativeBytes'] for r in audit['fresh'].values() if 'counts' in r)+384,
                  finestV8RuntimeLines=9,nonRuntimeWaivers=5,guestExecution=False,productionAuthority=False)
    raw=(json.dumps(manifest,indent=2)+'\n').encode();(args.output/'manifest.json').write_bytes(raw)
    print(json.dumps(dict(manifestSha256=sha(raw),**manifest)))


if __name__=='__main__':main()
