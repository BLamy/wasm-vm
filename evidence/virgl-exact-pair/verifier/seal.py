#!/usr/bin/env python3
"""Deterministically seal the compact independent verifier artifacts."""
from pathlib import Path
from hashlib import sha256
import gzip,io,json,tarfile
out=Path(__file__).resolve().parent
sha=lambda b:sha256(b).hexdigest()
exclude={'manifest.json','records.json','recording.tar.gz'}
members={p.name:p.read_bytes() for p in sorted(out.iterdir()) if p.is_file() and p.name not in exclude}
index={'schema':'virgl-exact-pair-verifier-index-v1','task':'E6-T12g6m3c','sourceHead':'1bbbe70a7bb4c9a9cdc0c3113cbb6b6a1deba733','submissionHead':'69eadeb8e575674e586172e2f292e5a0df3aa9bd','records':[{'path':n,'bytes':len(b),'sha256':sha(b)} for n,b in sorted(members.items())]}
index_bytes=(json.dumps(index,indent=2)+'\n').encode();(out/'records.json').write_bytes(index_bytes)
buffer=io.BytesIO()
with gzip.GzipFile(fileobj=buffer,mode='wb',mtime=0) as zipped:
 with tarfile.open(fileobj=zipped,mode='w') as tar:
  for n,b in sorted(members.items()):
   info=tarfile.TarInfo(n);info.size=len(b);info.mtime=0;info.mode=0o644;tar.addfile(info,io.BytesIO(b))
archive=buffer.getvalue();(out/'recording.tar.gz').write_bytes(archive)
manifest={'schema':'virgl-exact-pair-verifier-seal-v1','task':'E6-T12g6m3c','verdict':'verified','sourceHead':index['sourceHead'],'submissionHead':index['submissionHead'],'workerManifestSha256':'25551b5127c2760ac8ae5f692d3e7af516db52126c758ee3c3abc835db929563','records':len(members),'archive':{'path':'recording.tar.gz','bytes':len(archive),'sha256':sha(archive)},'recordIndex':{'path':'records.json','bytes':len(index_bytes),'sha256':sha(index_bytes)},'verdictSha256':sha((out/'verdict.json').read_bytes()),'authenticationSha256':sha((out/'authentication.json').read_bytes()),'novelSha256':sha((out/'novel.json').read_bytes()),'sabotageSha256':sha((out/'sabotage.json').read_bytes()),'custodySha256':sha((out/'custody.json').read_bytes())}
raw=(json.dumps(manifest,indent=2)+'\n').encode();(out/'manifest.json').write_bytes(raw)
print(json.dumps({'manifestSha256':sha(raw),**manifest},indent=2))
