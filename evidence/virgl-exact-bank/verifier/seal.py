#!/usr/bin/env python3
"""Seal original fresh-critic bytes; worker and earlier HELD seals stay immutable."""
from pathlib import Path
import gzip
import hashlib
import io
import json
import tarfile

OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[2]

def sha(raw):return hashlib.sha256(raw).hexdigest()

def main():
    members={}
    skipped={'unpacked','__pycache__'}
    for file in sorted(OUT.rglob('*')):
        if not file.is_file() or any(part in skipped for part in file.relative_to(OUT).parts):continue
        if file.name in {'manifest.json','records.json','recording.tar.gz'}:continue
        members[str(file.relative_to(OUT))]=file.read_bytes()
    members['promoted/critic.mjs']=(ROOT/'tools/virgl-exact-bank/critic.mjs').read_bytes()
    index={'schema':'virgl-exact-bank-critic-records-v1','task':'E6-T12g6m3a',
           'claimHead':'b3dd41b2633adf4dd5d29d8cac848294b8fa4e9f',
           'records':[{'path':name,'bytes':len(raw),'sha256':sha(raw)} for name,raw in sorted(members.items())]}
    index_raw=(json.dumps(index,indent=2)+'\n').encode()
    (OUT/'records.json').write_bytes(index_raw)
    buffer=io.BytesIO()
    with gzip.GzipFile(fileobj=buffer,mode='wb',mtime=0) as zipped:
        with tarfile.open(fileobj=zipped,mode='w') as archive:
            for name,raw in sorted(members.items()):
                entry=tarfile.TarInfo(name);entry.size=len(raw);entry.mode=0o644;entry.mtime=0
                archive.addfile(entry,io.BytesIO(raw))
    raw_archive=buffer.getvalue()
    (OUT/'recording.tar.gz').write_bytes(raw_archive)
    authentication=json.loads((OUT/'authentication.json').read_bytes())
    verdict=json.loads((OUT/'verdict.json').read_bytes())
    assert verdict['verdict']=='verified'
    manifest={'schema':'virgl-exact-bank-critic-seal-v1','task':'E6-T12g6m3a','verdict':'verified',
              'claimHead':index['claimHead'],'workerSourceHead':authentication['sourceHead'],
              'workerDigests':authentication['digests'],'members':len(members),
              'archive':{'path':'recording.tar.gz','bytes':len(raw_archive),'sha256':sha(raw_archive)},
              'recordIndex':{'path':'records.json','bytes':len(index_raw),'sha256':sha(index_raw)},
              'verdictSha256':sha((OUT/'verdict.json').read_bytes()),
              'summary':verdict['summary'],'originalWorkerArchiveMembersReferenced':104}
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    # Check every real archive member once after sealing. No synthetic records.
    with tarfile.open(OUT/'recording.tar.gz','r:gz') as archive:
        assert len(archive.getmembers())==len(members)
        for member in archive.getmembers():
            raw=archive.extractfile(member).read();assert raw==members[member.name]
    print(json.dumps(manifest))

if __name__=='__main__':main()
