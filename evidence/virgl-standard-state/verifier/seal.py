"""Seal/check this critic's records; inherited worker bytes remain in their seal."""
from pathlib import Path
import gzip, hashlib, io, json, subprocess, sys, tarfile
V = Path(__file__).resolve().parent
ROOT = V.parents[2]
HEAD = '365b3cf3d076637c347c7e9802420f847d09fbed'
sha = lambda b: hashlib.sha256(b).hexdigest()
excluded = {'manifest.json', 'records.json', 'recording.tar.gz', 'verdict.md'}
allowed_dirs = {'independent-initial', 'independent', 'independent-final',
                'metadata-omission-probe', 'metadata-omission-recheck', 'sabotage'}
if '--verify' in sys.argv:
    manifest = json.loads((V/'manifest.json').read_text())
    index_bytes = (V/'records.json').read_bytes()
    raw = (V/'recording.tar.gz').read_bytes()
    assert sha(raw) == manifest['archiveSha256']
    assert len(raw) == manifest['archiveBytes']
    assert sha(index_bytes) == manifest['recordIndexSha256']
    records = json.loads(index_bytes)
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        members = archive.getmembers()
        assert [m.name for m in members] == [r['path'] for r in records]
        for m, r in zip(members, records):
            assert m.isfile() and m.size == r['bytes']
            assert not m.name.startswith('/') and '..' not in Path(m.name).parts
            assert sha(archive.extractfile(m).read()) == r['sha256']
    assert len(records) == manifest['records']
    print('Authenticated critic seal:', len(records), 'members;', manifest['archiveSha256'])
    sys.exit(0)
blobs = {}
for p in V.rglob('*'):
    if not p.is_file():
        continue
    rel = p.relative_to(V)
    if len(rel.parts) == 1:
        if p.name not in excluded:
            blobs[rel.as_posix()] = p.read_bytes()
    elif rel.parts[0] in allowed_dirs:
        blobs[rel.as_posix()] = p.read_bytes()
for name in ['constant-domain', 'decoder', 'state']:
    path = 'renderer/virgl-command/'+name+'.mjs'
    blobs['source/'+path] = subprocess.check_output(['git', 'show', HEAD+':'+path], cwd=ROOT)
for path in ['renderer/virgl-command/tests/standard-state-boundaries.mjs',
             'tools/verify-virgl-standard-state-adversarial.mjs']:
    blobs['source/'+path] = (ROOT/path).read_bytes()
records = [{'path': p, 'bytes': len(b), 'sha256': sha(b)} for p, b in sorted(blobs.items())]
index = (json.dumps(records, indent=2)+'\n').encode()
(V/'records.json').write_bytes(index)
with (V/'recording.tar.gz').open('wb') as output:
    with gzip.GzipFile(fileobj=output, mode='wb', filename='', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w', format=tarfile.USTAR_FORMAT) as archive:
            for p, b in sorted(blobs.items()):
                entry = tarfile.TarInfo(p)
                entry.size, entry.mode, entry.mtime = len(b), 0o644, 0
                entry.uid = entry.gid = 0
                entry.uname = entry.gname = ''
                archive.addfile(entry, io.BytesIO(b))
raw = (V/'recording.tar.gz').read_bytes()
manifest = {
    'schema': 'virgl-standard-state-critic-seal-v1', 'task': 'E6-T11d5',
    'verdict': 'refuted', 'sourceHead': HEAD,
    'workerClaimHead': 'e5d4dba7b9cd5e8f8085f191d74f5e4a817abddd',
    'records': len(records), 'archiveBytes': len(raw), 'archiveSha256': sha(raw),
    'recordIndexSha256': sha(index),
    'inheritedWorkerArchiveSha256': '553a510d719a5a4dd2617ec3ae1d126ee3a77ed4cbec5d113fb254b33c69d3d0',
    'inheritedCompilerDeviceHead': '9323b44519710dfb2c8a324fe115872b79d274f0',
    'authority': 'isolated-standard-state-binding',
    'guestExecution': False, 'productionDrawAuthority': False,
    'findings': ['F1', 'F2'], 'coverage': 'accounted-with-narrow-waivers',
    'note': 'Raw critic reports and sources are packed here; unpacked worker records are deliberately excluded.'
}
(V/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
print(json.dumps(manifest, indent=2))
