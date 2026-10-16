#!/usr/bin/env python3
"""Seal the fresh critic's actual signed-conversion records, then authenticate them."""
from pathlib import Path
import gzip
import hashlib
import io
import json
import tarfile

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent

def sha(data):
    return hashlib.sha256(data).hexdigest()

def dump(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')

excluded = {'unpacked', 'scratch', '__pycache__', 'manifest.json', 'records.json',
            'recording.tar.gz', 'changed-line-coverage.json', 'seal-authentication.json'}
files = {}
for path in sorted(OUT.rglob('*')):
    rel = path.relative_to(OUT)
    if path.is_file() and not path.is_symlink() and not any(p in excluded for p in rel.parts):
        files[rel.as_posix()] = path
files['native/virgl-shader-current'] = OUT / 'scratch/current/renderer/virgl-shader/build/native/virgl-shader'
files['native/virgl-shader-range-fault'] = OUT / 'scratch/range-fault/renderer/virgl-shader/build/native/virgl-shader'
files['promoted/signed-conversion-regressions.mjs'] = ROOT / 'renderer/virgl-shader/tests/signed-conversion-regressions.mjs'
rows = []
for name, path in sorted(files.items()):
    data = path.read_bytes()
    rows.append({'path': name, 'bytes': len(data), 'sha256': sha(data)})
index = {'schema': 'critic-signed-conversion-record-index-v1', 'task': 'E6-T12g6e', 'records': rows}
dump(OUT / 'records.json', index)
with (OUT / 'recording.tar.gz').open('wb') as raw:
    with gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode='w', format=tarfile.PAX_FORMAT) as tar:
            for row in rows:
                data = files[row['path']].read_bytes()
                assert len(data) == row['bytes'] and sha(data) == row['sha256']
                info = tarfile.TarInfo(row['path'])
                info.size = len(data)
                info.mtime = 0
                info.uid = info.gid = 0
                info.uname = info.gname = ''
                info.mode = 0o755 if row['path'].startswith('native/') or row['path'] == 'cold-recorded-sanitize' else 0o644
                tar.addfile(info, io.BytesIO(data))
with tarfile.open(OUT / 'recording.tar.gz', 'r:gz') as tar:
    members = tar.getmembers()
    assert [m.name for m in members] == [r['path'] for r in rows]
    for member, row in zip(members, rows):
        assert member.isfile() and member.size == row['bytes']
        data = tar.extractfile(member).read()
        assert sha(data) == row['sha256'], row['path']
verdict = json.loads((OUT / 'verdict.json').read_text())
for name, expected in verdict['digests'].items():
    assert sha((OUT / name).read_bytes()) == expected, name
for p in verdict['predictions']:
    assert p['status'] == 'HELD'
    for citation in p['citations']:
        assert sha((OUT / citation['path']).read_bytes()) == citation['sha256'], citation['path']
assert sha(files['promoted/signed-conversion-regressions.mjs'].read_bytes()) == verdict['promotedTest']['sha256']
worker_archive = OUT.parent / 'worker/recording.tar.gz'
worker_index = OUT.parent / 'worker/records.json'
worker_sha = sha(worker_archive.read_bytes())
assert worker_sha == '0302fd33c25937206456e6549502f89122fdb73f622c920c573be8bc4da6b336'
manifest = {
    'schema': 'critic-signed-conversion-seal-v1',
    'task': 'E6-T12g6e', 'role': 'fresh adversarial verifier', 'verdict': 'verified',
    'base': verdict['base'], 'runtimeHead': verdict['runtimeHead'], 'sourceHead': verdict['sourceHead'],
    'submissionHead': verdict['submissionHead'],
    'archive': {'path': 'recording.tar.gz', 'bytes': (OUT / 'recording.tar.gz').stat().st_size,
                'sha256': sha((OUT / 'recording.tar.gz').read_bytes()), 'members': len(rows)},
    'index': {'path': 'records.json', 'sha256': sha((OUT / 'records.json').read_bytes())},
    'report': {'path': 'verdict.json', 'sha256': sha((OUT / 'verdict.json').read_bytes())},
    'promotedTest': verdict['promotedTest'],
    'workerDependency': {'archive': '../worker/recording.tar.gz', 'sha256': worker_sha,
                         'indexSha256': sha(worker_index.read_bytes()), 'members': 81},
    'scope': verdict['scope'], 'predictionsHeld': len(verdict['predictions']),
    'failed': [], 'needsEvidence': [], 'memberAuthentication': 'all members reopened and length/SHA256 checked',
    'implementationEdited': False, 'duplicateColdCloneRun': False,
}
dump(OUT / 'manifest.json', manifest)
print(json.dumps(manifest, indent=2))
