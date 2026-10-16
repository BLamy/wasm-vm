#!/usr/bin/env python3
"""Authenticate the incremental recording without replacing the first critic seal."""
from pathlib import Path, PurePosixPath
import hashlib, json, subprocess, tarfile

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
RAW = ROOT / 'target/evidence/virgl-known-arithmetic-critic-supplement'
RUNTIME = 'cba5ae02ba16dc15b7b51d5dcdd808f88fcaf1ee'
HARNESS = '5353cf8591a94dbd962f92ee69b488ff18b8ebf0'
SEALS = {
    'worker': ('e211633f326cd8e43e37a1585d9c892f84fa8d1eea5f13ac00bcf98d4104d15f',
               'cde41a7216f85761baf09b9b8646777e8703f1f449b0af270b31daf87a3813aa',
               '67a4726f63fe00ab9fd9f9c708c26ea89d47dff988aeb53fd6dd169d3fe017b0'),
    'verifier': ('c9b4adfe834ac13e6f343ab8048ee059fc67b2d3a6405335d8ed6d6a7aa1502f',
                 'baf7e9f401baff5e1042f7b826345e6893dfee8e7069bec0e11390470b71f67f',
                 '40afc73663871d44d0da14430e4e1d6bb44a531a77adbbdd241be8a11f3be315'),
    'worker/supplement': ('eafc73232ac1d2d807bde62ad21c8a11473b985c3ad06ee85ce3194d9c7a4841',
                          '987800d6a1d94ab0527b406f88236bf818c6f19374c701e68f940edcc3e04c5c',
                          '7784a22b0ab540b159241182c0281dad8c2ac534204f7653138219f63e681d97'),
}

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def main():
    RAW.mkdir(parents=True, exist_ok=True)
    seals = []
    for folder, digests in SEALS.items():
        base = ROOT / 'evidence/virgl-known-arithmetic' / folder
        files = ['manifest.json', 'recording.tar.gz', 'records.json']
        assert tuple(sha((base / name).read_bytes()) for name in files) == digests, folder
        seals.append(dict(path=str(base.relative_to(ROOT)), manifestSha256=digests[0],
                          archiveSha256=digests[1], indexSha256=digests[2]))
    base = ROOT / 'evidence/virgl-known-arithmetic/worker/supplement'
    manifest = json.loads((base / 'manifest.json').read_bytes())
    index = json.loads((base / 'records.json').read_bytes())
    assert manifest['harnessHead'] == index['harnessHead'] == HARNESS
    assert manifest['runtimeHead'] == index['runtimeHead'] == RUNTIME
    records = index['records']
    assert len(records) == manifest['records'] == 42
    names = [r['path'] for r in records]
    assert len(set(names)) == len(names)
    unpacked = RAW / 'unpacked'
    assert not unpacked.exists(), 'never overwrite a prior extraction'
    unpacked.mkdir()
    with tarfile.open(base / 'recording.tar.gz') as archive:
        members = archive.getmembers()
        assert sorted(m.name for m in members) == sorted(names)
        for m in members:
            p = PurePosixPath(m.name)
            assert m.isfile() and not p.is_absolute() and '..' not in p.parts
            record = next(r for r in records if r['path'] == m.name)
            raw = archive.extractfile(m).read()
            assert len(raw) == m.size == record['bytes']
            assert sha(raw) == record['sha256'], m.name
            destination = unpacked / m.name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(raw)
            if m.name.endswith('/original/known-test'):
                destination.chmod(0o755)
    bindings = []
    for s in manifest['sources']:
        raw = (ROOT / s['path']).read_bytes()
        assert raw == git('show', HARNESS + ':' + s['path'])
        assert raw == (unpacked / 'source' / s['path']).read_bytes()
        assert len(raw) == s['bytes'] and sha(raw) == s['sha256']
        bindings.append(dict(kind='harness', **s))
    prior = json.loads((ROOT / 'evidence/virgl-known-arithmetic/verifier/verdict.json').read_bytes())
    assert manifest['runtimeSources'] == prior['unchangedBoundarySources']
    for s in manifest['runtimeSources']:
        raw = (ROOT / s['path']).read_bytes()
        assert raw == git('show', RUNTIME + ':' + s['path'])
        assert sha(raw) == s['sha256']
        bindings.append(dict(kind='runtime', **s))
    assert not git('diff', '--name-only', RUNTIME, 'HEAD', '--', 'renderer/virgl-shader',
                   'renderer/virgl-command', 'AGENTS.md'), 'dependency boundary unchanged'
    old_archive = ROOT / 'evidence/virgl-known-arithmetic/worker/recording.tar.gz'
    originals = []
    with tarfile.open(old_archive) as archive:
        for kind, prefix in [('hot', 'generated'), ('cold', 'cold-generated')]:
            for name, old in [('known-test', prefix + '/known-arithmetic-sanitize/known-test'),
                              ('virgl-shader.mjs', prefix + '/wasm/virgl-shader.mjs'),
                              ('virgl-shader.wasm', prefix + '/wasm/virgl-shader.wasm')]:
                raw = (unpacked / kind / 'original' / name).read_bytes()
                assert raw == archive.extractfile(old).read(), (kind, name)
                originals.append(dict(kind=kind, path=kind + '/original/' + name,
                                      originalMember=old, bytes=len(raw), sha256=sha(raw)))
    initial = Path('/tmp/known-arithmetic-verifier-initial-untracked.zlist').read_bytes()
    assert sha(initial) == '17fd92fd454a14a44fddc4db0beadc4246a92f4ff749e57a8e2762aca638f8ac'
    current = git('ls-files', '--others', '--exclude-standard', '-z')
    historical = b'\0'.join(p for p in current.split(b'\0')
                            if p and not p.startswith(b'evidence/virgl-known-arithmetic/verifier/supplement/')) + b'\0'
    assert historical == initial and len(historical.split(b'\0')) - 1 == 4202
    result = dict(schema='virgl-known-arithmetic-incremental-authentication-v1', status='passed',
                  submission=git('rev-parse', 'HEAD').decode().strip(), runtimeHead=RUNTIME,
                  harnessHead=HARNESS, seals=seals, members=records, sourceBindings=bindings,
                  originals=originals, carriedHeld=[p['id'] for p in prior['predictionResults']
                                                  if p['status'] == 'HELD'],
                  historicalUntracked=dict(count=4202, sha256=sha(historical)))
    (OUT / 'authentication.json').write_text(json.dumps(result, indent=2) + '\n')
    print('42 members and original hot/cold artifacts authenticate; runtime, prior seals and 4202 paths unchanged.')

if __name__ == '__main__':
    main()
