#!/usr/bin/env python3
"""Authenticate every fresh-critic seal member; optionally restore records."""
from pathlib import Path,PurePosixPath
import hashlib,json,sys,tarfile
HERE=Path(__file__).resolve().parent
sha=lambda raw:hashlib.sha256(raw).hexdigest()
manifest=json.loads((HERE/'manifest.json').read_text());index_raw=(HERE/'records.json').read_bytes();index=json.loads(index_raw)
assert sha(index_raw)==manifest['recordIndexSha256']
archive=(HERE/'recording.tar.gz').read_bytes();assert len(archive)==manifest['archiveBytes'] and sha(archive)==manifest['archiveSha256']
records={r['path']:r for r in index['records']};assert len(records)==len(index['records'])==manifest['records']
seen=set()
with tarfile.open(HERE/'recording.tar.gz','r:gz') as tar:
 for member in tar:
  p=PurePosixPath(member.name);assert member.isfile() and not p.is_absolute() and '..' not in p.parts and member.name not in seen
  raw=tar.extractfile(member).read();r=records[member.name];assert r['bytes']==member.size==len(raw) and r['sha256']==sha(raw)
  if '--extract' in sys.argv:
   out=HERE/member.name;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(raw)
  seen.add(member.name)
assert seen==set(records)
worker=HERE.parent/'worker';assert sha((worker/'recording.tar.gz').read_bytes())==manifest['workerArchiveSha256'];assert sha((worker/'records.json').read_bytes())==manifest['workerIndexSha256']
for name,digest in manifest['sources'].items():assert records['sources/'+name]['sha256']==digest
for name,digest in manifest['generated'].items():assert records['generated/'+name]['sha256']==digest
print(json.dumps(dict(status='passed',records=len(seen),archiveSha256=manifest['archiveSha256'],recordIndexSha256=manifest['recordIndexSha256'])))
