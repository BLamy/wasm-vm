"""Seal the complete independent critic recording and reopen every byte to EOF."""
import gzip
import hashlib
import io
import json
import tarfile
from pathlib import Path

OUT = Path(__file__).resolve().parent
REPO = OUT.parents[2]
sha = lambda body: hashlib.sha256(body).hexdigest()

verdict = json.loads((OUT / 'verdict.json').read_bytes())
assert verdict['verdict'] == 'verified' and not verdict['remainingEvidence']
assert set(verdict['predictions'].values()) == {'HELD'}
for name, digest in verdict['reportDigests'].items():
    assert sha((OUT / name).read_bytes()) == digest, name
assert json.loads((OUT / 'final-checks.json').read_bytes())['status'] == 'passed'
assert sha((OUT.parent / 'worker/manifest.json').read_bytes()) == 'cd82a9b788f33e1261f62694c40f0d22d4eedbe591a8f53a7204dbdd43440b1d'
assert sha((OUT.parent / 'deployment/manifest.json').read_bytes()) == '94011feafe8720006fea2c4eab4e529c5d7b826d76cb590c86034001a673d8a0'
regression = (REPO / 'tools/virgl-stream-output-shaders/alias-browser.mjs').read_bytes()
for name in ['alias-clean', 'alias-reversed']:
    assert regression == (OUT / name / 'recorder.mjs').read_bytes()

excluded = {'manifest.json', 'records.json'}
files = [path for path in sorted(OUT.rglob('*'))
         if path.is_file() and path.name not in excluded
         and not path.name.startswith('recording.tar.gz.part-')
         and '__pycache__' not in path.parts]
rows, saved = [], {}
buffer = io.BytesIO()
with gzip.GzipFile(fileobj=buffer, mode='wb', compresslevel=9, mtime=0, filename='') as compressed:
    with tarfile.open(fileobj=compressed, mode='w|', format=tarfile.PAX_FORMAT) as archive:
        for path in files:
            body = path.read_bytes()
            identity = len(body), sha(body)
            name = 'verifier/' + path.relative_to(OUT).as_posix()
            row = dict(path=name, bytes=identity[0], sha256=identity[1])
            member = tarfile.TarInfo(name)
            member.mode, member.mtime = 0o644, 0
            if identity in saved:
                member.type, member.linkname = tarfile.LNKTYPE, saved[identity]
                row.update(kind='hardlink', target=member.linkname)
                archive.addfile(member)
            else:
                saved[identity] = name
                member.size = len(body)
                row['kind'] = 'file'
                archive.addfile(member, io.BytesIO(body))
            rows.append(row)
raw = buffer.getvalue()
parts = []
for i, start in enumerate(range(0, len(raw), 16 * 1024 * 1024)):
    name = 'recording.tar.gz.part-' + str(i).zfill(4)
    body = raw[start:start + 16 * 1024 * 1024]
    (OUT / name).write_bytes(body)
    parts.append(dict(path=name, bytes=len(body), sha256=sha(body)))
index = json.dumps(dict(schema='stream-output-shaders-critic-record-index-v1', records=rows), indent=2).encode() + b'\n'
(OUT / 'records.json').write_bytes(index)
manifest = dict(schema='stream-output-shaders-independent-verifier-seal-v1', task='E6-T11d65',
                submission=verdict['submission'], frozenSource=verdict['frozenSource'],
                runtimeImplementation='cefb45fd363e3f3d03d6cf72615b9b9273ccdc6e',
                verifiedBase='6f43010dfa7b3e08bfe62f62543b7ee0468e1a21', verdict='verified',
                predictions=verdict['predictions'], records=len(rows), storedBodies=len(saved),
                recordIndexSha256=sha(index), archiveSha256=sha(raw), archiveBytes=len(raw), archiveParts=parts,
                workerManifestSha256='cd82a9b788f33e1261f62694c40f0d22d4eedbe591a8f53a7204dbdd43440b1d',
                deploymentManifestSha256='94011feafe8720006fea2c4eab4e529c5d7b826d76cb590c86034001a673d8a0',
                promotedRegressionSha256=sha(regression), criticRuntimeChanges=False)
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')

# Reopen the on-disk parts, not the writer's in-memory archive.
reopened = bytearray()
for part in parts:
    body = (OUT / part['path']).read_bytes()
    assert (len(body), sha(body)) == (part['bytes'], part['sha256'])
    reopened.extend(body)
assert (len(reopened), sha(reopened)) == (manifest['archiveBytes'], manifest['archiveSha256'])
assert sha((OUT / 'records.json').read_bytes()) == manifest['recordIndexSha256']
seen = {}
with gzip.GzipFile(fileobj=io.BytesIO(reopened)) as decoded:
    with tarfile.open(fileobj=decoded, mode='r|') as archive:
        for i, member in enumerate(archive):
            assert i < len(rows)
            row = rows[i]
            assert member.name == row['path'] and member.name not in seen
            identity = row['bytes'], row['sha256']
            if member.islnk():
                assert row['kind'] == 'hardlink' and member.linkname == row['target']
                assert member.linkname in seen and seen[member.linkname] == identity
            else:
                assert member.isfile() and row['kind'] == 'file'
                body = archive.extractfile(member).read()
                assert (len(body), sha(body)) == identity
            seen[member.name] = identity
    while True:
        tail = decoded.read(1024 * 1024)
        if not tail:
            break
        assert not any(tail)
assert len(seen) == len(rows)
print(json.dumps(dict(status='passed', reopenedMembers=len(rows), storedBodies=len(saved),
                      backwardLinks=len(rows)-len(saved), archiveBytes=len(raw),
                      manifestSha256=sha((OUT / 'manifest.json').read_bytes()),
                      indexSha256=sha(index), archiveSha256=sha(raw), gzipEofChecked=True)))
