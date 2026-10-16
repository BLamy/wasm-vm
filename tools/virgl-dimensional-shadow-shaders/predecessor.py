"""Authenticate complete verified D60 readiness, including the unchanged D57 compiler."""
import hashlib,json,sys,tarfile
from pathlib import Path
repo=Path(__file__).resolve().parents[2];out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
seal=repo/'evidence/virgl-production-readiness/dimensional-shadow-compiler-gap'
sha=lambda b:hashlib.sha256(b).hexdigest()
assert sha((seal/'manifest.json').read_bytes())=='b4e2f002125e4420a3d1497069d35b9ce0d46238bb90e0cfca4f2c2601ff9adb'
manifest=json.loads((seal/'manifest.json').read_bytes());index=json.loads((seal/'records.json').read_bytes())
assert sha((seal/'records.json').read_bytes())==manifest['recordIndexSha256']
assert sha((seal/'recording.tar.gz').read_bytes())==manifest['archiveSha256']
assert manifest['head']=='04ab18042036bf0ab19864bbe38e787dd4aadf48'
with tarfile.open(seal/'recording.tar.gz','r:gz') as archive:
    assert archive.getnames()==[r['path'] for r in index['records']]
    for r in index['records']:
        body=archive.extractfile(r['path']).read();assert len(body)==r['bytes'] and sha(body)==r['sha256']
        if r['path'].startswith('admission/sources/renderer/virgl-shader/build/wasm/'):
            (out/Path(r['path']).name).write_bytes(body)
(out/'authentication.json').write_text(json.dumps(dict(status='passed',predecessor=manifest['head'],reopenedMembers=len(index['records']),manifest=manifest),indent=2)+'\n')
print('Reopened all38 complete verified-head baseline bodies.')
