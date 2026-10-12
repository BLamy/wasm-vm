#!/usr/bin/env python3
"""Authenticate the exact published predecessor; carry unchanged compiler/storage facts."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
BASE = '4e924b694715ec40e653e2e0c87ecc49c929d040'
PINS = {
    'worker': ('6e3dac963bac00e954134e0f9ffe3f9f86b595b183b42f823beaa11aacf7b77a', '29ca252c9abaf1c2d29fd0f39d53ff4dc73a416a2f3fa13d5bb6d1b95807733f', '49c9951e44f0aac20e4d709034e606803698ca7465d7f110078acccd29534c8a', 52584),
    'verifier': ('9079ba5b7457d02cdf180075f049e26c542484db1c794a56c7bba676461fb7c6', '67c1175debe54024f70c35eadbe08733ae08930008a1928dc78af4232ce0349e', '642815d0c63aee4e79645203f0cb3437582c46a899eb36dcf159150899d7a05c', 626),
}
GENERATED = {
    'renderer/virgl-shader/build/wasm/virgl-shader.mjs': '4da9f1ed30cff697193e0688a26ee93e48a3e1216485d5184301fec6c31d4879',
    'renderer/virgl-shader/build/wasm/virgl-shader.wasm': 'aba0c891ad406ef876da6f1a86883b3fcdd98de12c1137a4f2feff566f5459f2',
}
SELECTED = {'renderer/virgl-command/'+n+'.mjs' for n in ['state', 'decoder', 'constant-domain']}
sha = lambda raw: hashlib.sha256(raw).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT)


def main(output):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    carried, generated_bodies = [], {}
    for role, (mpin, ipin, apin, count) in PINS.items():
        folder = ROOT/'evidence/virgl-shadow-shaders'/role
        mraw, iraw = (folder/'manifest.json').read_bytes(), (folder/'records.json').read_bytes()
        assert sha(mraw) == mpin and sha(iraw) == ipin
        manifest, records = json.loads(mraw), json.loads(iraw)['records']
        assert len(records) == count == manifest['records']
        parts = manifest['archiveParts']
        bodies = []
        for part in parts:
            raw = (folder/part['path']).read_bytes()
            assert len(raw) == part['bytes'] and sha(raw) == part['sha256']
            assert raw == git('show', BASE+':'+(folder/part['path']).relative_to(ROOT).as_posix())
            bodies.append(raw)
        archive = b''.join(bodies)
        assert sha(archive) == apin == manifest['archiveSha256']
        for name, raw in [('manifest.json', mraw), ('records.json', iraw)]:
            assert raw == git('show', BASE+':'+(folder/name).relative_to(ROOT).as_posix())
        expected, seen, physical, logical = {r['path']: r for r in records}, set(), {}, 0
        assert len(expected) == count
        with tarfile.open(fileobj=io.BytesIO(archive), mode='r|gz') as tar:
            for entry in tar:
                assert entry.name in expected and entry.name not in seen
                assert entry.isfile() or entry.islnk()
                if entry.islnk():
                    assert entry.linkname in physical
                    length, digest = physical[entry.linkname]
                else:
                    raw = tar.extractfile(entry).read()
                    length, digest = len(raw), sha(raw)
                    physical[entry.name] = length, digest
                    if digest in GENERATED.values():
                        assert role == 'worker' or digest in generated_bodies
                        generated_bodies[digest] = raw
                wanted = expected[entry.name]
                assert length == wanted['bytes'] and digest == wanted['sha256']
                seen.add(entry.name)
                logical += length
        assert seen == set(expected)
        carried.append(dict(role=role, records=count, physicalBodies=len(physical), logicalBytes=logical,
                            manifestSha256=mpin, recordIndexSha256=ipin, archiveSha256=apin,
                            evidence=(folder.relative_to(ROOT)).as_posix(), sourceHead=manifest['sourceHead']))
    for name, digest in GENERATED.items():
        raw = generated_bodies[digest]
        target = ROOT/name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            assert target.read_bytes() == raw, 'generated compiler drift'
        else:
            target.write_bytes(raw)
    assert not git('diff', '--name-only', BASE, '--', 'renderer/virgl-shader', 'crates', 'web', 'tools/guest').strip()
    changed = git('diff', '--name-only', BASE, '--', 'renderer/virgl-command').decode().splitlines()
    assert all('/tests/' in name or name in SELECTED for name in changed)
    unchanged, historical = {}, {}
    names = git('ls-files', 'renderer/virgl-command', 'renderer/virgl-shader').decode().splitlines()
    for name in names:
        if '/tests/' in name or name.endswith('.md'):
            continue
        original = git('show', BASE+':'+name)
        if name not in SELECTED:
            assert (ROOT/name).read_bytes() == original
            unchanged[name] = sha(original)
        if name.endswith('.mjs') and ('renderer/virgl-command/' in name or name == 'renderer/virgl-shader/index.mjs'):
            target = output/'historical'/name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(original)
            historical[name] = sha(original)
    primary = json.loads((ROOT/'tools/virgl-shadow-shaders/primary.json').read_text())
    # Complete WebGL source is already pinned by the unchanged storage boundary.
    name = 'tools/virgl-floating-depth/primary/webgl2.html'
    raw = git('show', BASE+':'+name)
    primary['sources'].append(dict(path=name, bytes=len(raw), sha256=sha(raw)))
    for row in primary['sources']:
        raw = (ROOT/row['path']).read_bytes()
        assert len(raw) == row['bytes'] and sha(raw) == row['sha256']
        assert raw == git('show', BASE+':'+row['path'])
    result = dict(status='passed', predecessor=BASE, carried=carried, generated=GENERATED,
                  reopenedMembers=sum(r['records'] for r in carried), unchanged=unchanged,
                  historical=historical, primary=primary, unchangedCompilerAndStorage=True,
                  predecessorSealsArePublishedDependencies=True, guestExecution=False, productionNegotiation=False)
    (output/'authentication.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(dict(status='passed', reopenedMembers=result['reopenedMembers'], generated=GENERATED)))


if __name__ == '__main__':
    main(sys.argv[1])
