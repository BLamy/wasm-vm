"""Finish sealed-body custody without trusting generated files in the checkout."""
import gzip
import hashlib
import io
import json
import subprocess
import tarfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
SCRATCH = REPO / 'target/evidence/d64-final-reopened'
AUTHORITY = REPO / 'target/evidence/d64-final-authority'
DEPLOYMENT = REPO / 'target/evidence/d64-final-deployment-reopened'
sha = lambda b: hashlib.sha256(b).hexdigest()
git = lambda *a: subprocess.check_output(['git', *a], cwd=REPO)


def reopen(directory, pin, select):
    raw = (directory / 'manifest.json').read_bytes()
    assert sha(raw) == pin
    manifest = json.loads(raw)
    index_raw = (directory / 'records.json').read_bytes()
    assert sha(index_raw) == manifest['recordIndexSha256']
    index = json.loads(index_raw)
    rows = index['records'] if isinstance(index, dict) else index
    assert len(rows) == len({r['path'] for r in rows})
    parts = []
    if 'archiveParts' in manifest:
        for part in manifest['archiveParts']:
            body = (directory / part['path']).read_bytes()
            assert (len(body), sha(body)) == (part['bytes'], part['sha256'])
            parts.append(body)
    else:
        parts.append((directory / 'recording.tar.gz').read_bytes())
    archive = b''.join(parts)
    assert (len(archive), sha(archive)) == (manifest['archiveBytes'], manifest['archiveSha256'])
    del parts
    by_path = {r['path']: r for r in rows}
    wanted = {r['path']: select(r['path']) for r in rows if select(r['path']) is not None}
    roots = set()
    for name in wanted:
        while by_path[name].get('kind') == 'hardlink':
            name = by_path[name]['target']
        roots.add(name)
    saved, seen, bodies, links = {}, {}, 0, 0
    with gzip.GzipFile(fileobj=io.BytesIO(archive)) as decoded:
        with tarfile.open(fileobj=decoded, mode='r|') as stream:
            for i, member in enumerate(stream):
                assert i < len(rows)
                row = rows[i]
                assert member.name == row['path'] and member.name not in seen
                assert not Path(member.name).is_absolute() and '..' not in Path(member.name).parts
                identity = row['bytes'], row['sha256']
                if member.islnk():
                    assert member.linkname in seen and seen[member.linkname] == identity
                    assert row['target'] == member.linkname
                    links += 1
                else:
                    assert member.isfile() and member.size == row['bytes']
                    body = stream.extractfile(member).read()
                    assert (len(body), sha(body)) == identity
                    if member.name in roots:
                        saved[member.name] = body
                    bodies += 1
                seen[member.name] = identity
        while True:
            tail = decoded.read(1024 * 1024)
            if not tail:
                break
            assert not any(tail)
    assert len(seen) == len(rows)
    exported = []
    for name, dest in wanted.items():
        root = name
        while by_path[root].get('kind') == 'hardlink':
            root = by_path[root]['target']
        body = saved[root]
        assert (len(body), sha(body)) == (by_path[name]['bytes'], by_path[name]['sha256'])
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(body)
        exported.append(dict(member=name, file=dest.relative_to(REPO).as_posix(), bytes=len(body), sha256=sha(body)))
    return dict(manifestSha256=pin, indexSha256=sha(index_raw), archiveSha256=sha(archive),
                members=len(rows), storedBodies=bodies, backwardLinks=links, gzipEofChecked=True, exported=exported)


prior_auth_raw = (OUT / 'authentication.json').read_bytes()
prior_interrogation_raw = (OUT / 'interrogation.json').read_bytes()
prior = json.loads(prior_auth_raw)
interrogation = json.loads(prior_interrogation_raw)
assert interrogation['status'] == 'passed'
assert interrogation['citationsSha256'] == sha((OUT / 'citations.jsonl').read_bytes())
assert interrogation['predictions'] == {k: 'HELD' for k in ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']}
for seal in prior['seals']:
    directory = REPO / 'evidence' / seal['family']
    assert sha((directory / 'manifest.json').read_bytes()) == seal['manifestSha256']
    assert sha((directory / 'records.json').read_bytes()) == seal['indexSha256']
    manifest = json.loads((directory / 'manifest.json').read_bytes())
    if 'archiveParts' in manifest:
        h = hashlib.sha256()
        count = 0
        for part in manifest['archiveParts']:
            body = (directory / part['path']).read_bytes()
            assert (len(body), sha(body)) == (part['bytes'], part['sha256'])
            h.update(body)
            count += len(body)
    else:
        body = (directory / 'recording.tar.gz').read_bytes()
        h = hashlib.sha256(body)
        count = len(body)
    assert (count, h.hexdigest()) == (seal['archiveBytes'], seal['archiveSha256'])

runtime = 'cb04190a0fd8d989fb54fb7b2caf39cc86a8a0e7'
harness = '2f1e09f52ef3529b591887a08721fb234e77e500'
submission = 'fb8c9241678a46f1cf5f5a220add98e0ae010012'
assert git('rev-parse', 'HEAD').decode().strip() == submission
for name in ['decoder', 'resources', 'state', 'control-bridge']:
    p = 'renderer/virgl-command/' + name + '.mjs'
    assert git('show', runtime + ':' + p) == git('show', harness + ':' + p) == (REPO / p).read_bytes()


def worker_select(name):
    source = 'cold/recording/hardware-54831/source/'
    if name.startswith(source):
        return AUTHORITY / 'source' / name[len(source):]
    if name.startswith('cold/recording/') and name.endswith(('/browser-coverage.json', '/report.json', 'coverage-audit.json', '/receipt.json', '/carried-source-custody.json')):
        return SCRATCH / name[len('cold/recording/'):]
    if name.startswith('cold/recording/node-coverage/'):
        return SCRATCH / name[len('cold/recording/'):]
    return None


worker = reopen(REPO / 'evidence/virgl-dimensional-depth-surfaces/worker',
                '71593ab497a192777ed4970ed58537157f217f9de901b9a91f470754d28e7f74', worker_select)
for item in worker['exported']:
    if '/source/' not in item['file']:
        continue
    relative = item['file'].split('/source/', 1)[1]
    if not relative.startswith(('target/', 'renderer/virgl-shader/build/wasm/')):
        assert git('show', runtime + ':' + relative) == (REPO / item['file']).read_bytes()
        assert (REPO / relative).read_bytes() == (REPO / item['file']).read_bytes()

deployment = reopen(REPO / 'target/evidence/d64-deployment-sealed',
                    '44347fcebf978b74fe2d78b18b8257e18c53bf72595b26984e4d04cf4b3ef789',
                    lambda name: DEPLOYMENT / name)
held_deployment = reopen(REPO / 'evidence/virgl-dimensional-color-surfaces/deployment',
                        '22a01eafcf805b79094ee3b311b749f62e533ecbd8c5ff37d41ffba641f897ee',
                        lambda name: REPO / 'target/evidence/d64-final-held-deployment-reopened' / name)
report = dict(schema='dimensional-depth-surfaces-final-custody-v1', status='passed',
              carriedAuthenticationSha256=sha(prior_auth_raw), carriedInterrogationSha256=sha(prior_interrogation_raw),
              carriedCitationsSha256=interrogation['citationsSha256'], carriedPredictions=interrogation['predictions'],
              unchangedPriorSeals=len(prior['seals']), runtimeSource=runtime, harnessSource=harness,
              submission=submission, worker=worker, deployment=deployment, heldDeployment=held_deployment,
              compilerAndSelectedWasmObtainedOnlyFromSeal=True)
(OUT / 'final-custody.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(dict(status='passed', workerMembers=worker['members'], deploymentMembers=deployment['members'],
                      carriedHeld=list(interrogation['predictions']), generatedAuthority=str(AUTHORITY))))
