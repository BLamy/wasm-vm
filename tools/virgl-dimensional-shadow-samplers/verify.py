"""One final frozen affected submission for original dimensional comparisons."""
import argparse
import hashlib
import json
import os
import subprocess
import time
from pathlib import Path

repo = Path(__file__).resolve().parents[2]
base = '93021c5a28b99357532844de6ea4944291774099'
p = argparse.ArgumentParser()
p.add_argument('--output', required=True)
root = Path(p.parse_args().output).resolve()
assert not root.exists(), 'preserve earlier recordings'
root.mkdir(parents=True)
sha = lambda body: hashlib.sha256(body).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=repo, text=True).strip()
head = git('rev-parse', 'HEAD')
assert not git('status', '--porcelain', '--untracked-files=no')
env = {k: v for k, v in os.environ.items() if not k.startswith(('CARGO_', 'RUST', 'LLVM_PROFILE', 'VIRGL_', 'NODE_', 'npm_', 'NPM_', 'CHROME')) and k not in {'CC', 'CXX', 'CFLAGS', 'CPPFLAGS', 'LDFLAGS', 'EMCC', 'EM_CONFIG', 'EMSDK', 'PYTHONPATH', 'PYTHONHOME'}}
steps = []


def run(name, command, expected=0, overrides=None, timeout=1200):
    print(name + ': running', flush=True)
    start = time.monotonic()
    result = subprocess.run(command, cwd=repo, env={**env, **(overrides or {})}, capture_output=True, timeout=timeout)
    for stream in ['stdout', 'stderr']:
        (root / (name + '.' + stream)).write_bytes(getattr(result, stream))
    steps.append(dict(name=name, command=command, exitCode=result.returncode, expected=expected,
                      overrides=overrides or {}, seconds=time.monotonic() - start,
                      stdoutSha256=sha(result.stdout), stderrSha256=sha(result.stderr)))
    (root / 'commands.json').write_text(json.dumps(steps, indent=2) + '\n')
    assert result.returncode == expected, (name, result.stderr[-4000:].decode(errors='replace'))
    print(name + ': expected exit ' + str(expected), flush=True)


run('policy', ['python3', 'tools/check_task_policy.py'])
run('diff-format', ['git', 'diff', '--check', base, 'HEAD'])
run('predecessor', ['python3', 'tools/virgl-dimensional-shadow-samplers/predecessor.py', str(root / 'predecessor')])
run('format', ['cargo', 'fmt', '--check', '-p', 'wasm-vm-core', '-p', 'wasm-vm-wasm'])
run('clippy-default', ['cargo', 'clippy', '--offline', '-p', 'wasm-vm-core', '--lib', '--', '-D', 'warnings'])
run('clippy-wasm', ['cargo', 'clippy', '--offline', '-p', 'wasm-vm-wasm', '--lib', '--target', 'wasm32-unknown-unknown', '--features', 'virgl-control-proof', '--', '-D', 'warnings'])
for test in ['virtio_gpu_submit3d', 'virtio_gpu_control3d']:
    run('native-' + test, ['cargo', 'test', '--offline', '-p', 'wasm-vm-core', '--features', 'virgl-control-proof,gpu-trace,trace', '--test', test, '--', '--nocapture', '--test-threads=1'])
for name, features in [('default', []), ('selected', ['--features', 'virgl-control-proof'])]:
    run('wasm-core-' + name, ['cargo', 'build', '--offline', '-p', 'wasm-vm-core', '--no-default-features', '--target', 'wasm32-unknown-unknown', *features])
run('wasm-proof', ['wasm-pack', 'build', 'crates/wasm', '--dev', '--target', 'web', '--out-dir', '../../target/virgl-desktop-submit/pkg', '--features', 'virgl-control-proof'])
paths = ['renderer/virgl-command/' + name + '.mjs' for name in ['constant-domain', 'state', 'control-bridge']]
for file in [*map(Path, paths), repo / 'renderer/virgl-command/tests/native-dimensional-shadow-samplers.mjs', *(repo / 'tools/virgl-dimensional-shadow-samplers').glob('*.mjs')]:
    run('syntax-' + file.stem, ['node', '--check', str(file)])
run('python-syntax', ['python3', '-m', 'py_compile', *map(str, (repo / 'tools/virgl-dimensional-shadow-samplers').glob('*.py'))])
if not (repo / 'web/node_modules/playwright').is_dir():
    run('npm-dependencies', ['npm', '--prefix', 'web', 'ci', '--no-audit', '--no-fund'])
run('metadata', ['node', 'tools/virgl-dimensional-shadow-samplers/metadata.mjs', str(root / 'metadata')], overrides={'NODE_V8_COVERAGE': str(root / 'node-coverage')})
for seed in [27467, 82021, 164033]:
    run('hardware-' + str(seed), ['node', 'tools/virgl-dimensional-shadow-samplers/browser.mjs', '--output', str(root / ('hardware-' + str(seed))), '--seeds', str(seed)])
    run('boundaries-' + str(seed), ['node', 'tools/virgl-dimensional-shadow-samplers/browser.mjs', '--output', str(root / ('boundaries-' + str(seed))), '--seeds', str(seed), '--boundaries', 'true'])
for mode in ['attacks', 'controls', 'bindings', 'inherited']:
    run(mode, ['node', 'tools/virgl-dimensional-shadow-samplers/browser.mjs', '--output', str(root / mode), '--seeds', '27467', '--' + mode, 'true'])
for fault in ['compare', 'mask']:
    run('fault-' + fault, ['node', 'tools/virgl-dimensional-shadow-samplers/browser.mjs', '--output', str(root / ('fault-' + fault)), '--fault', 'true', '--sabotage', fault, '--seeds', '164033'], expected=1)
run('historical-dimensional-depth-views', ['node', 'tools/virgl-dimensional-depth-views/browser.mjs', '--output', str(root / 'historical-dimensional-depth-views'), '--smoke', 'true', '--seeds', '27449'])
run('historical-bindings', ['node', 'tools/verify-virgl-shadow-samplers.mjs', '--output', str(root / 'historical-bindings'), '--mode', 'bindings', '--smoke', 'true'])
run('historical-texture', ['node', 'tools/verify-virgl-standard-texture-operations.mjs', '--output', str(root / 'historical-texture'), '--smoke', 'true'])
run('physical-audit', ['python3', 'tools/virgl-dimensional-shadow-samplers/audit.py', str(root)])
run('coverage-audit', ['python3', 'tools/virgl-dimensional-shadow-samplers/coverage.py', str(root)])
run('default-dist-build', ['make', 'web-dist'])
run('default-demo', ['node', 'tools/verify-virgl-default-demo.mjs', '--output', str(root / 'default-demo'), '--task', 'E6-T11d62'])
assert not git('status', '--porcelain', '--untracked-files=no')
sources = {}
for relative in git('ls-files', 'renderer/virgl-command', 'renderer/virgl-shader', 'crates/core', 'crates/wasm', 'tools/virgl-dimensional-shadow-samplers', 'tools/virgl-shadow-shaders/primary', 'tools/virgl-shadow-shaders/primary.json', 'tools/virgl-instance-base/primary', 'tools/virgl-floating-depth/primary', 'tools/virgl-floating-depth-consumer/primary', 'tools/verify-virgl-default-demo.mjs', 'tools/build-web-dist.sh', 'web/roadmap.js', 'web/dist', 'Makefile', 'AGENTS.md', 'Cargo.toml', 'Cargo.lock', 'tasks/epic-6-transcendence/E6-T11d62-dimensional-shadow-samplers.md').splitlines():
    file = repo / relative
    if not file.is_file():
        continue
    body = file.read_bytes()
    assert body == subprocess.check_output(['git', 'show', head + ':' + relative], cwd=repo)
    sources[relative] = dict(bytes=len(body), sha256=sha(body))
    destination = root / 'sources' / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(body)
coverage = json.loads((root / 'coverage-audit.json').read_bytes())
physical = json.loads((root / 'physical-audit.json').read_bytes())
assert not coverage['needsEvidence'] and physical['completedPhysicalRefutations'] == 2
receipt = dict(schema='dimensional-shadow-sampler-worker-receipt-v1', task='E6-T11d62', head=head, base=base, commands=steps, sources=sources,
               predecessors=json.loads((root / 'predecessor/authentication.json').read_bytes()), physical=physical,
               coverage=dict(executed=len(coverage['executed']), held=len(coverage['held']), staticWaivers=len(coverage['waived']), newExecutableGaps=0),
               actualLinuxGuest=False, productionAuthority=False)
(root / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(dict(status='passed', head=head, commands=len(steps), coverage=receipt['coverage'])))
