"""Read-only authentication of the incremental production GPU parent capsule."""
from pathlib import Path
import gzip,hashlib,io,json,tarfile
root=Path(__file__).resolve().parents[3]
here=Path(__file__).resolve().parent
sha=lambda body:hashlib.sha256(body).hexdigest()
manifest=json.loads((here/'manifest.json').read_text());index=(here/'records.json').read_bytes()
assert sha(index)==manifest['recordIndexSha256']
archive=(here/'closure.tar.gz').read_bytes();assert len(archive)==manifest['archiveBytes'] and sha(archive)==manifest['archiveSha256']
expected={r['path']:r for r in json.loads(index)['records']};bodies={}
with tarfile.open(fileobj=io.BytesIO(gzip.decompress(archive)),mode='r:') as t:
 entries=t.getmembers();assert len(entries)==len(expected)
 for entry in entries:
  assert entry.isfile() and not entry.name.startswith('/') and '..' not in Path(entry.name).parts
  body=t.extractfile(entry).read();row=expected[entry.name];assert len(body)==row['bytes'] and sha(body)==row['sha256'];bodies[entry.name]=body
refs=json.loads(bodies['reference-authentication.json'])['authenticatedReferences']
for row in refs:
 body=(root/row['path']).read_bytes();assert len(body)==row['bytes'] and sha(body)==row['sha256'],row['path']
for name,body in bodies.items():
 if name.startswith('source/'):assert (root/name[7:]).read_bytes()==body,name
source_map=json.loads(bodies['prepared-proof-map.json'])
original=[]
def collect(x):
 if isinstance(x,dict):
  if isinstance(x.get('path'),str) and 'sha256' in x:original.append(x)
  for v in x.values():collect(v)
 elif isinstance(x,list):
  for v in x:collect(v)
collect(source_map)
assert len(original)==len(refs),'no prepared reference may be omitted'
print(json.dumps(dict(status='passed',sourceHead=manifest['sourceHead'],archiveSha256=sha(archive),members=len(bodies),inheritedReferences=len(refs),runtimeChanged=False)))
