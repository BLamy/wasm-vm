"""Fresh independent seal authentication and immutable-body reopening."""
import gzip
import hashlib
import io
import json
import os
import subprocess
import tarfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
OPENED = REPO / 'target/evidence/d65-critic-opened-01'
BASE = '6f43010dfa7b3e08bfe62f62543b7ee0468e1a21'
SOURCE = '31bf0781db74fea94f51c9d6fa3217d16227bc99'
SUBMISSION = '0c167360a8d01a1e51b7be1309d6caf70fbff611'
sha = lambda b: hashlib.sha256(b).hexdigest()
git = lambda *a: subprocess.check_output(['git', *a], cwd=REPO)


def reopen(family, pin, destination):
    directory = REPO / 'evidence' / family
    manifest_raw = (directory / 'manifest.json').read_bytes()
    assert sha(manifest_raw) == pin
    manifest = json.loads(manifest_raw)
    index_raw = (directory / 'records.json').read_bytes()
    assert sha(index_raw) == manifest['recordIndexSha256']
    index = json.loads(index_raw)
    rows = index['records'] if isinstance(index, dict) else index
    assert len(rows) == len({r['path'] for r in rows}) == manifest['records']
    parts = []
    if 'archiveParts' in manifest:
        for part in manifest['archiveParts']:
            body = (directory / part['path']).read_bytes()
            assert (len(body), sha(body)) == (part['bytes'], part['sha256'])
            parts.append(body)
    else:
        parts.append((directory / 'recording.tar.gz').read_bytes())
    raw = b''.join(parts)
    assert (len(raw), sha(raw)) == (manifest['archiveBytes'], manifest['archiveSha256'])
    del parts
    seen, stored, links = {}, 0, 0
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as decoded:
        with tarfile.open(fileobj=decoded, mode='r|') as archive:
            for i, member in enumerate(archive):
                assert i < len(rows)
                row = rows[i]
                assert member.name == row['path'] and member.name not in seen
                assert not Path(member.name).is_absolute() and '..' not in Path(member.name).parts
                identity = row['bytes'], row['sha256']
                target = destination / member.name
                target.parent.mkdir(parents=True, exist_ok=True)
                if member.islnk():
                    assert member.linkname in seen and seen[member.linkname] == identity
                    assert row['target'] == member.linkname
                    body_path = destination / member.linkname
                    assert (body_path.stat().st_size, sha(body_path.read_bytes())) == identity
                    if target.exists():
                        assert (target.stat().st_size, sha(target.read_bytes())) == identity
                    else:
                        os.link(body_path, target)
                    links += 1
                else:
                    assert member.isfile() and member.size == row['bytes']
                    body = archive.extractfile(member).read()
                    assert (len(body), sha(body)) == identity
                    if target.exists():
                        assert target.read_bytes() == body
                    else:
                        target.write_bytes(body)
                    stored += 1
                seen[member.name] = identity
        while True:
            tail = decoded.read(1024 * 1024)
            if not tail:
                break
            assert not any(tail)
    assert len(seen) == len(rows)
    result = dict(family=family, manifestSha256=pin, indexSha256=sha(index_raw),
                  archiveSha256=sha(raw), archiveBytes=len(raw), reopenedMembers=len(rows),
                  storedBodies=stored, backwardLinks=links, gzipEofChecked=True,
                  reopenedRoot=destination.relative_to(REPO).as_posix())
    print(json.dumps(result), flush=True)
    return result


assert git('rev-parse', 'HEAD').decode().strip() == SUBMISSION
assert not git('status', '--porcelain', '--untracked-files=no')
worker = reopen('virgl-stream-output-shaders/worker',
                'cd82a9b788f33e1261f62694c40f0d22d4eedbe591a8f53a7204dbdd43440b1d', OPENED / 'worker')
deployment = reopen('virgl-stream-output-shaders/deployment',
                    '94011feafe8720006fea2c4eab4e529c5d7b826d76cb590c86034001a673d8a0', OPENED / 'deployment')
manifest = json.loads((REPO / 'evidence/virgl-stream-output-shaders/worker/manifest.json').read_bytes())
held = []
for seal in manifest['predecessors']['held']:
    directory = REPO / seal['path']
    for name in ['manifest.json', 'records.json']:
        assert (directory / name).read_bytes() == git('show', BASE + ':' + seal['path'] + '/' + name)
    assert sha((directory / 'manifest.json').read_bytes()) == seal['manifestSha256']
    assert sha((directory / 'records.json').read_bytes()) == seal['indexSha256']
    old_manifest = json.loads((directory / 'manifest.json').read_bytes())
    h = hashlib.sha256()
    count = 0
    for part in old_manifest['archiveParts']:
        body = (directory / part['path']).read_bytes()
        assert (len(body), sha(body)) == (part['bytes'], part['sha256'])
        h.update(body)
        count += len(body)
    assert (count, h.hexdigest()) == (seal['archiveBytes'], seal['archiveSha256'])
    held.append(dict(**seal, unchanged=True, authority='Carried independent HELD D64 facts at the unchanged source/dependency/evidence boundary.'))
for boundary in ['crates', 'renderer/virgl-command', 'tools/guest']:
    assert not git('diff', '--name-only', BASE, SUBMISSION, '--', boundary)
assert not git('diff', '--name-only', 'cefb45fd', SOURCE, '--', 'renderer')
assert not git('diff', '--name-only', SOURCE, SUBMISSION, '--', 'renderer', 'tools', 'web')
cold = json.loads((OPENED / 'worker/cold/report.json').read_bytes())
receipt = json.loads((OPENED / 'worker/cold/recording/receipt.json').read_bytes())
assert cold['head'] == receipt['head'] == SOURCE and cold['exitCode'] == 0
assert not cold['cleanBefore'] and not cold['cleanAfter']
assert len(receipt['commands']) == 42 and all(c['exitCode'] == c['expected'] for c in receipt['commands'])
for command in receipt['commands']:
    for stream in ['stdout', 'stderr']:
        assert sha((OPENED / 'worker/cold/recording' / (command['name'] + '.' + stream)).read_bytes()) == command[stream + 'Sha256']
for relative, pin in receipt['sources'].items():
    body = (OPENED / 'worker/cold/recording/sources' / relative).read_bytes()
    assert (len(body), sha(body)) == (pin['bytes'], pin['sha256'])
    assert body == git('show', SOURCE + ':' + relative)
result = dict(schema='stream-output-shaders-independent-authentication-v1', status='passed',
              worker=worker, deployment=deployment, heldPredecessors=held, coldHead=SOURCE,
              submission=SUBMISSION, coldCommands=42, coldCleanBefore=True, coldCleanAfter=True,
              runtimeUnchangedByProofRepair=True, currentSourceBodiesEqualFrozenReceipt=True)
(OUT / 'authentication.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(dict(status='passed', coldCommands=42, workerMembers=worker['reopenedMembers'], deploymentMembers=deployment['reopenedMembers'])))
