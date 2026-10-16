"""Authenticate whole prerequisite seals and unchanged allocation/DMA/compiler boundaries."""
import json
import subprocess
import sys
from pathlib import Path
from custody import reopen, sha

repo = Path(__file__).resolve().parents[2]
out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
base = '2aca65e9328aa1433fb516511ca554fdd96b422d'
pins = {
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
dependencies, generated = [], {}
git = lambda *args: subprocess.check_output(['git', *args], cwd=repo)
for family, digest in pins.items():
    directory = repo / 'evidence' / family
    for name in ['manifest.json', 'records.json']:
        relative = (directory / name).relative_to(repo).as_posix()
        assert (directory / name).read_bytes() == git('show', base + ':' + relative)

    def selected(name):
        if family == 'virgl-dimensional-shadow-shaders/worker':
            return name.startswith('cold/recording/generated/renderer/virgl-shader/build/wasm/')
        if family == 'virgl-dimensional-color-surfaces/worker':
            return name == 'cold/recording/receipt.json' or (name.startswith('cold/recording/') and name.endswith('/browser-coverage.json') and len(Path(name).parts) == 4 and '/fault-' not in name)
        if family == 'virgl-dimensional-shadow-samplers/worker':
            return name == 'cold/recording/receipt.json' or (name.startswith('cold/recording/') and name.endswith('/browser-coverage.json') and len(Path(name).parts) == 4 and '/fault-' not in name)
        return False

    authentication, bodies = reopen(directory, digest, selected)
    dependencies.append(dict(family=family, **authentication))
    for name, body in bodies.items():
        if '/generated/' in name:
            relative = name.split('/generated/', 1)[1]
            assert relative in {'renderer/virgl-shader/build/wasm/virgl-shader.mjs', 'renderer/virgl-shader/build/wasm/virgl-shader.wasm'}
            generated[relative] = body
        elif name.endswith('/browser-coverage.json'):
            file = (out / 'held-coverage' / name) if family == 'virgl-dimensional-color-surfaces/worker' else (out / 'earlier-d62-coverage' / Path(name).parent / 'd62-browser-coverage.json')
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(body)
        elif name.endswith('/receipt.json'):
            (out / ('d63-receipt.json' if family == 'virgl-dimensional-color-surfaces/worker' else 'd62-receipt.json')).write_bytes(body)
    for name in ['manifest.json', 'records.json']:
        file = out / family / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes((directory / name).read_bytes())
    print('Authenticated ' + family + ': ' + str(authentication['reopenedMembers']) + ' complete members', flush=True)

assert set(generated) == {'renderer/virgl-shader/build/wasm/virgl-shader.mjs', 'renderer/virgl-shader/build/wasm/virgl-shader.wasm'}
for relative, body in generated.items():
    file = repo / relative
    if file.exists():
        assert file.read_bytes() == body
    else:
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(body)
    saved = out / 'generated' / relative
    saved.parent.mkdir(parents=True, exist_ok=True)
    saved.write_bytes(body)
assert not git('diff', '--name-only', base, '--', 'crates', 'renderer/virgl-shader', 'Cargo.toml', 'Cargo.lock', 'renderer/virgl-command/constant-domain.mjs', 'renderer/virgl-command/floating-depth-gpu.mjs')
resources = repo / 'renderer/virgl-command/resources.mjs'
old = git('show', base + ':renderer/virgl-command/resources.mjs').decode()
marker = 'function createTransferBackend('
assert old[old.index(marker):] == resources.read_text()[resources.read_text().index(marker):], 'native allocation/upload/readback/DMA backend must be byte-identical'
for task in ['E6-T11d62-dimensional-shadow-samplers.md', 'E6-T11d58-dimensional-sampler-views.md', 'E6-T11d56-native-dimensional-transfers.md', 'E6-T11d60-dimensional-depth-sampler-views.md', 'E6-T11d63-dimensional-color-surfaces.md']:
    assert '\nstatus: verified\n' in (repo / 'tasks/epic-6-transcendence' / task).read_text()
result = dict(schema='dimensional-depth-surface-predecessors-v1', base=base, dependencies=dependencies,
              generated={name: dict(bytes=len(body), sha256=sha(body)) for name, body in generated.items()},
              unchangedBoundaries=['D61 original C/Wasm shader compiler', 'D62 shader metadata, comparison controls and existing selectors', 'D58/D56 original native allocation, private-copy and guarded DMA backend', 'all native/Wasm guest execution and transport code'],
              nativeBackendSha256=sha(old[old.index(marker):].encode()), actualLinuxGuest=False, productionAuthority=False)
(out / 'authentication.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(dict(status='passed', reopenedMembers=sum(v['reopenedMembers'] for v in dependencies))))
