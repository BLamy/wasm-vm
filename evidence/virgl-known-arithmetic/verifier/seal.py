#!/usr/bin/env python3
"""Seal critic-authored predictions, original-profile audit and actual attacks."""
from pathlib import Path
import hashlib,json,gzip,io,tarfile,subprocess
ROOT=Path(__file__).resolve().parents[3];E=Path(__file__).parent;O=ROOT/'target/evidence/virgl-known-arithmetic-critic';U=O/'unpacked'
sha=lambda b:hashlib.sha256(b).hexdigest();members={}
for p in sorted(E.glob('*')):
 if p.is_file()and p.name not in['manifest.json','records.json','recording.tar.gz']:members['critic/'+p.name]=p.read_bytes()
for pattern in ['*-original-coverage.json','*-original-merged.profdata','hot-original-known-header-coverage.txt','independent-cases.bin','independent-native.*','wasm-consumer-attacks.log','fourth-gpu.log','sabotage*','initial-*','second-*']:
 for p in sorted(O.glob(pattern)):
  if p.is_file():members['raw/'+p.name]=p.read_bytes()
for folder in ['gpu-2654435769','node-critic-coverage']:
 for p in sorted((O/folder).rglob('*')):
  if p.is_file():members['raw/'+str(p.relative_to(O))]=p.read_bytes()
for path in ['raw_known_arithmetic.h','build/known-arithmetic-sanitize/known-test']:
 p=O/'sabotage-source'/path;members['raw/sabotage-source/'+path]=p.read_bytes()
members['original/known-arithmetic-sanitize/known-test']=(U/'generated/known-arithmetic-sanitize/known-test').read_bytes()
for path in ['known-arithmetic-sanitize/known-test','native/virgl-shader','wasm/virgl-shader.mjs','wasm/virgl-shader.wasm']:
 p=U/'generated'/path
 assert sha(p.read_bytes())==next(s['sha256']for s in json.loads((U/'hot/receipt.json').read_bytes())['sources']if s['path']=='renderer/virgl-shader/build/'+path)
index={'schema':'virgl-known-arithmetic-critic-records-v1','task':'E6-T12g6m1','sourceHead':'cba5ae02ba16dc15b7b51d5dcdd808f88fcaf1ee','submissionHead':'5c6daa5fd87bccc7dc39398b6f6ba6d22991585c','records':[{'path':n,'bytes':len(b),'sha256':sha(b)}for n,b in sorted(members.items())]}
b=(json.dumps(index,indent=2)+'\n').encode();(E/'records.json').write_bytes(b)
f=io.BytesIO()
with gzip.GzipFile(fileobj=f,mode='wb',mtime=0)as gz:
 with tarfile.open(fileobj=gz,mode='w')as t:
  for name,raw in sorted(members.items()):
   row=tarfile.TarInfo(name);row.size=len(raw);row.mtime=0;row.mode=0o755 if name.endswith('/known-test')else 0o644;t.addfile(row,io.BytesIO(raw))
archive=f.getvalue();(E/'recording.tar.gz').write_bytes(archive)
manifest={'schema':'virgl-known-arithmetic-critic-seal-v1','task':'E6-T12g6m1','verdict':'needs-evidence','sourceHead':index['sourceHead'],'submissionHead':index['submissionHead'],'base':'bfd5c97f7d71f510fccd2bd120f43b3d8b54159f','records':len(members),'archive':{'path':'recording.tar.gz','bytes':len(archive),'sha256':sha(archive)},'recordIndex':{'path':'records.json','bytes':len(b),'sha256':sha(b)},'predictionsSha256':sha((E/'predictions.json').read_bytes()),'verdictSha256':sha((E/'verdict.json').read_bytes()),'workerManifestSha256':'e211633f326cd8e43e37a1585d9c892f84fa8d1eea5f13ac00bcf98d4104d15f','originalBoundaryChanged':False,'historicalUntrackedPreserved':True,'productionNegotiation':False,'guestExecution':False}
(E/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
with tarfile.open(E/'recording.tar.gz')as t:
 assert len(t.getmembers())==len(index['records'])
 for row in index['records']:
  raw=t.extractfile(row['path']).read();assert len(raw)==row['bytes']and sha(raw)==row['sha256']
print(json.dumps({'manifestSha256':sha((E/'manifest.json').read_bytes()),'archiveSha256':sha(archive),'indexSha256':sha(b),'records':len(members),'archiveBytes':len(archive),'verdictSha256':manifest['verdictSha256']}))
