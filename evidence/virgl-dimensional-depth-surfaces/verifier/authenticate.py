"""Independent complete archive authentication; never imports worker custody code."""
import gzip
import hashlib
import io
import json
import subprocess
import tarfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
COLD = REPO / 'target/evidence/dimensional-depth-surfaces-cold-final-03'
BASE = '2aca65e9328aa1433fb516511ca554fdd96b422d'
RUNTIME = 'cb04190a0fd8d989fb54fb7b2caf39cc86a8a0e7'
HARNESS = '2f1e09f52ef3529b591887a08721fb234e77e500'
PINS = {
    'virgl-dimensional-depth-surfaces/worker': '71593ab497a192777ed4970ed58537157f217f9de901b9a91f470754d28e7f74',
    'virgl-dimensional-depth-surfaces/carried-cb04190a': '1222b4323df91f51bc2e4b1375fdde9cd2d1131b909edbad7492dacee1a5e683',
    'virgl-dimensional-color-surfaces/worker': 'cdcaa8ba0a2a80d789c7df623818b31cdd491af575ac9a92540b8df25d39cc4e',
    'virgl-dimensional-color-surfaces/verifier': 'f048564e0495ce5f984336c5dabf0e1fb3fe90e1d86028c9624530adcde75cfe',
    'virgl-dimensional-depth-views/worker': '6e4047173d8fefb25d1763ba2eb9e9c40534bddd70f02544cb05e843f6005145',
    'virgl-dimensional-depth-views/verifier': '1e7b66672d57a8caa6224d02f6c1e12bef85b3cf2f01d9082ee7c2f48341356e',
    'virgl-dimensional-depth/worker': '109f0a3a84cbf48bca63f28206a568cd0f7b78019e26202d96b8890870504a55',
    'virgl-dimensional-depth/verifier': '69815fdc9b938a99b5022c6f876c43eea3656beb336855f2ce49df187b3da4a5',
    'virgl-dimensional-shadow-samplers/worker': '8b577966f92fc4dc89d90026a90d8fbf59a3de3d11c21d262b6ec71da062c32c',
    'virgl-dimensional-shadow-samplers/verifier': '2a618ef4b0aa3695b82910ca576714ce3de544fdfc30117485bbfa4573d873dc',
    'virgl-dimensional-views/worker': '0d33df88ff4eab46b34d7c376fda9f4d69ae1120c6bba9e82a3fd468e8afd135',
    'virgl-dimensional-views/verifier': 'bf8aaeb347ad4aead9304fbfc4759fe74f1e622328f0399fc13c3b412318d590',
    'virgl-dimensional-views/transport-verifier': 'b2b93f53f8fe0029e20cb506b33aac01406f2a5151d36601804cf334c5f88591',
    'virgl-native-dimensional/worker': '7c8fb3ab46b3659ce855e77a80afc161a14f808b491a6753caa6c53231b0d0e6',
    'virgl-native-dimensional/verifier': 'd290f464b5be7dbd39e01cc588aa9d4ed580bb4d7e688c345443e86e87ec2dc5',
    'virgl-dimensional-shadow-shaders/worker': '862ccad57dcd39ef940c2ba495c4a638e3e30f82fd4b34546240937b7ce550f1',
}
sha = lambda body: hashlib.sha256(body).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=REPO)


def authenticate(family, digest):
    directory = REPO / 'evidence' / family
    raw = (directory / 'manifest.json').read_bytes()
    assert sha(raw) == digest
    manifest = json.loads(raw)
    index_raw = (directory / 'records.json').read_bytes()
    assert sha(index_raw) == manifest['recordIndexSha256']
    index = json.loads(index_raw)
    rows = index['records'] if isinstance(index, dict) else index
    assert len(rows) == len({r['path'] for r in rows})
    if not family.startswith('virgl-dimensional-depth-surfaces/'):
        for name in ['manifest.json', 'records.json']:
            assert (directory / name).read_bytes() == git('show', BASE + ':evidence/' + family + '/' + name)
    if 'archiveParts' in manifest:
        pieces = []
        for part in manifest['archiveParts']:
            body = (directory / part['path']).read_bytes()
            assert len(body) == part['bytes'] and sha(body) == part['sha256']
            pieces.append(body)
        archive = b''.join(pieces)
        del pieces
    else:
        archive = (directory / 'recording.tar.gz').read_bytes()
    assert sha(archive) == manifest['archiveSha256']
    assert len(archive) == manifest.get('archiveBytes', len(archive))
    seen, stored, links, bound = {}, 0, 0, 0
    with gzip.GzipFile(fileobj=io.BytesIO(archive)) as decoded:
        with tarfile.open(fileobj=decoded, mode='r|') as stream:
            for i, member in enumerate(stream):
                assert i < len(rows)
                row = rows[i]
                assert member.name == row['path']
                pin = row['bytes'], row['sha256']
                assert member.name not in seen
                if member.islnk():
                    assert member.linkname in seen and seen[member.linkname] == pin
                    assert row.get('target', member.linkname) == member.linkname
                    links += 1
                else:
                    assert member.isfile()
                    body = stream.extractfile(member)
                    count, h = 0, hashlib.sha256()
                    while True:
                        block = body.read(1024 * 1024)
                        if not block:
                            break
                        count += len(block)
                        h.update(block)
                    assert (count, h.hexdigest()) == pin
                    stored += 1
                seen[member.name] = pin
                if family == 'virgl-dimensional-depth-surfaces/worker' and member.name.startswith('cold/'):
                    file = COLD / member.name[len('cold/'):]
                    assert file.is_file() and (file.stat().st_size, sha(file.read_bytes())) == pin, member.name
                    bound += 1
        while True:
            tail = decoded.read(1024 * 1024)
            if not tail:
                break
            assert not any(tail), 'non-padding bytes after tar EOF'
    assert len(seen) == len(rows)
    result = dict(family=family, manifestSha256=digest, indexSha256=sha(index_raw), archiveSha256=sha(archive),
                  archiveBytes=len(archive), reopenedMembers=len(rows), storedBodies=stored, backwardLinks=links,
                  gzipEofChecked=True, inspectedColdBodiesBoundToSeal=bound)
    print(json.dumps(result), flush=True)
    return result


results = [authenticate(family, digest) for family, digest in PINS.items()]
for path in ['renderer/virgl-command/' + n + '.mjs' for n in ['decoder', 'resources', 'state', 'control-bridge']]:
    assert git('show', RUNTIME + ':' + path) == git('show', HARNESS + ':' + path) == (REPO / path).read_bytes()
original = json.loads((REPO / 'target/evidence/dimensional-depth-surfaces-cold-final-01/report.json').read_bytes())
current = json.loads((COLD / 'report.json').read_bytes())
receipt = json.loads((COLD / 'recording/receipt.json').read_bytes())
assert original['head'] == RUNTIME and original['exitCode'] == 2
assert current['head'] == receipt['head'] == HARNESS and current['exitCode'] == 0
assert not current['cleanBefore'] and not current['cleanAfter']
assert current['receiptSha256'] == sha((COLD / 'recording/receipt.json').read_bytes())
assert receipt['carriedRuntimeHead'] == RUNTIME
identity = receipt['carriedSourceCustody']
assert identity['originalColdHead'] == RUNTIME and identity['harnessHead'] == HARNESS and not identity['recordingsRelabeled']
allowed = {'Makefile', *['tools/virgl-dimensional-depth-surfaces/' + n for n in ['predecessor.py','verify.py','cold.py','seal.py','incremental.py']]}
changed = git('diff', '--name-only', RUNTIME, HARNESS).decode().splitlines()
assert changed == identity['allowedProofOnlyChanges']
assert all(p in allowed or p.startswith('evidence/virgl-dimensional-depth-surfaces/carried-cb04190a/') for p in changed)
for relative, pin in receipt['sources'].items():
    body = (COLD / 'recording/sources' / relative).read_bytes()
    assert (len(body), sha(body)) == (pin['bytes'], pin['sha256'])
    assert body == git('show', HARNESS + ':' + relative)
commands = identity['originalCommands']
assert commands[-1]['name'] == 'coverage-audit' and commands[-1]['exitCode'] == 1
assert all(c['exitCode'] == c['expected'] for c in commands[:-1])
assert len(commands[:-1]) == 39 and len(identity['carriedPassedCommands']) == 34
assert len(receipt['commands']) == 8 and all(c['exitCode'] == c['expected'] == 0 for c in receipt['commands'])
for command in receipt['commands']:
    for stream in ['stdout','stderr']:
        assert sha((COLD / 'recording' / (command['name'] + '.' + stream)).read_bytes()) == command[stream+'Sha256']
report = dict(schema='dimensional-depth-surface-independent-authentication-v1', seals=results,
              dependenciesReopened=sum(r['reopenedMembers'] for r in results[2:]), originalPassedCommands=39,
              carriedPassedCommands=34, executedRepairCommands=8, runtimeHead=RUNTIME, harnessHead=HARNESS,
              runtimeBodiesIdentical=True, inspectedColdBodiesAuthenticated=True, recordingsRelabeled=False)
(OUT / 'authentication.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(dict(status='passed', dependenciesReopened=report['dependenciesReopened'], seals=len(results))))
