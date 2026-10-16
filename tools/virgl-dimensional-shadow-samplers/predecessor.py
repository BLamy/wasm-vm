"""Carry unchanged compiler, dimensional depth and comparison ownership facts."""
import json
import subprocess
import sys
from pathlib import Path
from custody import reopen, sha

repo = Path(__file__).resolve().parents[2]
out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
base = '93021c5a28b99357532844de6ea4944291774099'
pins = {
    'virgl-dimensional-shadow-shaders/worker': '862ccad57dcd39ef940c2ba495c4a638e3e30f82fd4b34546240937b7ce550f1',
    'virgl-dimensional-shadow-shaders/verifier': '77ef1511cf4ff3a2aceccbdb89c99bce55a6ae89ade0af6cbb9c2ceeb6ec024a',
    'virgl-dimensional-depth-views/worker': '6e4047173d8fefb25d1763ba2eb9e9c40534bddd70f02544cb05e843f6005145',
    'virgl-dimensional-depth-views/verifier': '1e7b66672d57a8caa6224d02f6c1e12bef85b3cf2f01d9082ee7c2f48341356e',
    'virgl-shadow-samplers/worker': 'f6060a1d127854fa230b3f9ba0f50e83941ded19c4e516f5f5e0908a8f901f8f',
    'virgl-shadow-samplers/verifier': 'c4546b2d53e1bf6923127764d3ec37b5375ab75aaf73eac53902572a814e395d',
}
dependencies, generated = [], {}
for family, digest in pins.items():
    directory = repo / 'evidence' / family
    for name in ['manifest.json', 'records.json']:
        relative = (directory / name).relative_to(repo).as_posix()
        assert (directory / name).read_bytes() == subprocess.check_output(['git', 'show', base + ':' + relative], cwd=repo)

    def selected(name):
        if family == 'virgl-dimensional-shadow-shaders/worker':
            return name.startswith('cold/recording/generated/renderer/virgl-shader/build/wasm/') or name == 'cold/recording/receipt.json'
        if family == 'virgl-dimensional-depth-views/worker':
            return name in {'cold/recording/receipt.json', 'cold/recording/private-27449/report.json'} or (name.startswith('cold/recording/') and name.endswith('/browser-coverage.json') and len(Path(name).parts) == 4 and '/fault-' not in name)
        return False

    authentication, bodies = reopen(directory, digest, selected)
    dependencies.append(dict(family=family, **authentication))
    for name, body in bodies.items():
        if family == 'virgl-dimensional-shadow-shaders/worker' and '/generated/' in name:
            relative = name.split('/generated/', 1)[1]
            assert relative in {'renderer/virgl-shader/build/wasm/virgl-shader.mjs', 'renderer/virgl-shader/build/wasm/virgl-shader.wasm'}
            generated[relative] = body
        elif name.endswith('/browser-coverage.json'):
            file = out / 'held-coverage' / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(body)
        elif name.endswith('/private-27449/report.json'):
            file = out / 'held-private-copy/report.json'
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(body)
            report = json.loads(body)
            assert report['status'] == 'passed' and not report['trackedChanges']
            for pin in report['sources']:
                if pin['path'].startswith('renderer/virgl-command/') and not pin['path'].endswith(('state.mjs', 'control-bridge.mjs', 'constant-domain.mjs')):
                    assert sha((repo / pin['path']).read_bytes()) == pin['sha256'], pin['path']
        elif name.endswith('/receipt.json'):
            (out / ('d61-receipt.json' if 'shadow-shaders' in family else 'd60-receipt.json')).write_bytes(body)
    for name in ['manifest.json', 'records.json']:
        file = out / family / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes((directory / name).read_bytes())
    print('Authenticated ' + family + ': ' + str(authentication['reopenedMembers']) + ' complete members', flush=True)

assert set(generated) == {'renderer/virgl-shader/build/wasm/virgl-shader.mjs', 'renderer/virgl-shader/build/wasm/virgl-shader.wasm'}
for relative, body in generated.items():
    file = repo / relative
    if file.exists():
        assert file.read_bytes() == body, relative
    else:
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(body)
    saved = out / 'generated' / relative
    saved.parent.mkdir(parents=True, exist_ok=True)
    saved.write_bytes(body)

assert not subprocess.check_output(['git', 'diff', '--name-only', base, '--', 'crates', 'renderer/virgl-shader', 'Cargo.toml', 'Cargo.lock', 'renderer/virgl-command/resources.mjs', 'renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/floating-depth-gpu.mjs'], cwd=repo)
for task in ['E6-T11d61-dimensional-shadow-shaders.md', 'E6-T11d60-dimensional-depth-sampler-views.md', 'E6-T11d49-shadow-samplers.md']:
    file = repo / 'tasks/epic-6-transcendence' / task
    assert '\nstatus: verified\n' in file.read_text(), task

result = dict(schema='dimensional-shadow-sampler-predecessors-v1', base=base, dependencies=dependencies,
              generated={name: dict(bytes=len(body), sha256=sha(body)) for name, body in generated.items()},
              unchangedBoundaries=['D61 C/Wasm original compiler', 'D60 original decoder, depth storage, private native views and DMA', 'D49 native comparison controls and fence ownership'],
              actualLinuxGuest=False, productionAuthority=False)
assert (out / 'held-private-copy/report.json').is_file()
result['heldPrivateCopy'] = dict(path='held-private-copy/report.json', sha256=sha((out / 'held-private-copy/report.json').read_bytes()),
                               claim='Unchanged D60 depth/private-copy scopes restore incoming native framebuffer and scissor state, including real failed blits; complete original native calls and bodies are authenticated.')
(out / 'authentication.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(dict(status='passed', reopenedMembers=sum(v['reopenedMembers'] for v in dependencies))))
