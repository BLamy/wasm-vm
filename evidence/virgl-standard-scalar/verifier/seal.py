#!/usr/bin/env python3
"""Seal the fresh critic's predictions, complete bounded GPU attacks and audits."""
from pathlib import Path
import gzip
import hashlib
import io
import json
import subprocess
import tarfile

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
sha=lambda b:hashlib.sha256(b).hexdigest()
members={}
names=['predictions.json','authentication.json','physical-audit.json','coverage-audit.json','fresh-audit.json','citations.json','hunk-audit.json','verdict.json','authenticate.py','coverage.py','audit.mjs','fresh-authenticate.py','finish.py','seal.py']
for name in names:members[name]=(HERE/name).read_bytes()
verdict=json.loads(members['verdict.json']);fresh=json.loads(members['fresh-audit.json'])
assert verdict['verdict']=='verified' and all(p['status']=='HELD' for p in verdict['predictions'])
for name in ['authentication.json','physical-audit.json','coverage-audit.json','fresh-audit.json','hunk-audit.json']:
    assert json.loads(members[name])['status']=='passed'
for name,digest in fresh['files'].items():
    raw=(HERE/name).read_bytes();assert sha(raw)==digest
    members[name]=raw
for name,digest in fresh['sources'].items():
    raw=(ROOT/name).read_bytes() if '/build/' in name else subprocess.check_output(['git','show',fresh['sourceHead']+':'+name],cwd=ROOT)
    assert sha(raw)==digest
    members['sources/'+name]=raw
index={'schema':'standard-scalar-critic-records-v1','task':'E6-T11d13','sourceHead':fresh['sourceHead'],'records':[{'path':name,'bytes':len(raw),'sha256':sha(raw)} for name,raw in sorted(members.items())]}
raw=(json.dumps(index,indent=2)+'\n').encode();(HERE/'records.json').write_bytes(raw)
buffer=io.BytesIO()
with gzip.GzipFile(fileobj=buffer,mode='wb',mtime=0) as gz:
    with tarfile.open(fileobj=gz,mode='w') as tar:
        for name,data in sorted(members.items()):
            entry=tarfile.TarInfo(name);entry.size=len(data);entry.mode=0o644;entry.mtime=0
            tar.addfile(entry,io.BytesIO(data))
packed=buffer.getvalue();(HERE/'recording.tar.gz').write_bytes(packed)
manifest={'schema':'standard-scalar-critic-seal-v1','task':'E6-T11d13','verdict':'verified','runtimeSourceHead':verdict['runtimeHead'],'harnessSourceHead':fresh['sourceHead'],'workerArchiveSha256':verdict['workerArchiveSha256'],'archiveSha256':sha(packed),'archiveBytes':len(packed),'recordIndexSha256':sha(raw),'records':len(members),'sources':fresh['sources'],'baselineScalarFrames':782,'baselineScalarPixels':205824,'baselineRetainedFrames':538,'baselineRetainedPixels':183808,'freshFrames':92,'freshPixels':70656,'baselineFaultWitnesses':8,'ownPhysicalSabotages':2,'predictionResults':{p['id']:p['status'] for p in verdict['predictions']},'carriedHistoricalFiles':154,'guestExecution':False,'productionDrawAuthority':False,'portableGeneralArrayArithmetic':False,'authority':'isolated-standard-scalar-floating-fetch'}
(HERE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
# Read back every record from the newly produced artifact before adjudication.
with tarfile.open(fileobj=io.BytesIO(packed),mode='r:gz') as tar:
    rows={row['path']:row for row in index['records']}
    assert len(tar.getmembers())==len(rows)
    for entry in tar.getmembers():
        data=tar.extractfile(entry).read();row=rows[entry.name]
        assert len(data)==row['bytes'] and sha(data)==row['sha256']
print(json.dumps({k:manifest[k] for k in ['verdict','records','archiveSha256','recordIndexSha256','archiveBytes']}))
