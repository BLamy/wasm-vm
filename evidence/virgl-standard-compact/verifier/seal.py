"""Seal critic predictions, independent audits and actual promoted GPU recordings."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
sha=lambda b:hashlib.sha256(b).hexdigest()
members={}
names=['predictions.json','authentication.json','physical-audit.json','coverage-audit.json',
       'fresh-audit.json','citations.json','verdict.json','authenticate.py','coverage.py','audit.mjs','fresh-audit.mjs','seal.py']
for name in names:members[name]=(HERE/name).read_bytes()
for directory in ['final-gpu','final-sabotage-native','final-sabotage-constant']:
    for path in sorted((HERE/directory).rglob('*')):
        if path.is_file():members[path.relative_to(HERE).as_posix()]=path.read_bytes()
verdict=json.loads(members['verdict.json'])
fresh=json.loads(members['fresh-audit.json'])
assert verdict['verdict']=='verified' and all(p['status']=='HELD' for p in verdict['predictions'])
assert json.loads(members['authentication.json'])['status']=='passed'
for name in ['physical-audit.json','coverage-audit.json','fresh-audit.json']:
    assert json.loads(members[name])['status']=='passed'
for name,digest in fresh['files'].items():assert sha(members[name])==digest
for path,digest in fresh['sources'].items():
    if '/build/' in path:data=(ROOT/path).read_bytes()
    else:data=subprocess.check_output(['git','show',fresh['sourceHead']+':'+path],cwd=ROOT)
    assert sha(data)==digest,path
    members['sources/'+path]=data
index={'schema':'standard-compact-critic-records-v1','task':'E6-T11d12','sourceHead':fresh['sourceHead'],
       'records':[{'path':name,'bytes':len(data),'sha256':sha(data)} for name,data in sorted(members.items())]}
raw=(json.dumps(index,indent=2)+'\n').encode();(HERE/'records.json').write_bytes(raw)
buffer=io.BytesIO()
with gzip.GzipFile(fileobj=buffer,mode='wb',mtime=0) as gz:
    with tarfile.open(fileobj=gz,mode='w') as archive:
        for name,data in sorted(members.items()):
            entry=tarfile.TarInfo(name);entry.size=len(data);entry.mode=0o644;entry.mtime=0
            archive.addfile(entry,io.BytesIO(data))
packed=buffer.getvalue();(HERE/'recording.tar.gz').write_bytes(packed)
manifest={'schema':'standard-compact-critic-seal-v1','task':'E6-T11d12','verdict':'verified',
          'runtimeSourceHead':verdict['runtimeHead'],'harnessSourceHead':fresh['sourceHead'],
          'workerArchiveSha256':verdict['workerArchiveSha256'],'archiveSha256':sha(packed),
          'archiveBytes':len(packed),'recordIndexSha256':sha(raw),'records':len(members),
          'sources':fresh['sources'],'baselineFrames':450,'baselinePixels':120320,
          'freshFrames':44,'freshPixels':fresh['pixels'],'ownPhysicalSabotages':2,
          'predictionResults':{p['id']:p['status'] for p in verdict['predictions']},
          'portableNaNPayload':False,'guestExecution':False,'productionDrawAuthority':False,
          'authority':'isolated-standard-compact-floating-fetch'}
(HERE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({k:manifest[k] for k in ['verdict','records','archiveSha256','recordIndexSha256','archiveBytes']}))
