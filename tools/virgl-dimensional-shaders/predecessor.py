"""Reopen the complete exact verified-head negative baseline and old compiler."""
import hashlib,json,sys,tarfile
from pathlib import Path
repo=Path(__file__).resolve().parents[2];out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
seal=repo/'evidence/virgl-production-readiness/dimensional-texture-compiler-gap'
sha=lambda b:hashlib.sha256(b).hexdigest()
assert sha((seal/'manifest.json').read_bytes())=='4fa23f26ae6816805cd9352cb672666ac56710a47358f7db86c920dad7ab32e1'
manifest=json.loads((seal/'manifest.json').read_bytes());index=json.loads((seal/'records.json').read_bytes())
assert sha((seal/'records.json').read_bytes())==manifest['recordIndexSha256']
assert sha((seal/'recording.tar.gz').read_bytes())==manifest['archiveSha256']
with tarfile.open(seal/'recording.tar.gz','r:gz') as archive:
    assert archive.getnames()==[r['path'] for r in index['records']]
    for r in index['records']:
        body=archive.extractfile(r['path']).read();assert len(body)==r['bytes'] and sha(body)==r['sha256']
        if r['path'].startswith('source/renderer/virgl-shader/build/wasm/'):
            (out/Path(r['path']).name).write_bytes(body)
(out/'authentication.json').write_text(json.dumps(dict(status='passed',predecessor=manifest['head'],reopenedMembers=len(index['records']),manifest=manifest),indent=2)+'\n')
print('Reopened all19 exact verified-head compiler baseline bodies.')
