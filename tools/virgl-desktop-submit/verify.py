#!/usr/bin/env python3
"""One frozen-head selected submission gate; held GPU semantics are authenticated."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import time

repo = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
args = parser.parse_args()
root = Path(args.output).resolve()
assert not root.exists(), 'preserve earlier recordings; use a new directory'
root.mkdir(parents=True)
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
base = '0660eebf08a1b047109ed4e2e508132b68d103ba'
assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=repo)
env = {k: v for k, v in os.environ.items() if not k.startswith(('CARGO_', 'RUST', 'LLVM_PROFILE', 'NODE_', 'npm_', 'NPM_'))}
steps = []
sha = lambda b: hashlib.sha256(b).hexdigest()


def run(name, command, overrides=None, expected=0, timeout=1200):
    print(name + ': running', flush=True)
    start = time.monotonic()
    result = subprocess.run(command, cwd=repo, env={**env, **(overrides or {})}, capture_output=True, timeout=timeout)
    (root / (name + '.stdout')).write_bytes(result.stdout)
    (root / (name + '.stderr')).write_bytes(result.stderr)
    steps.append({'name': name, 'command': command, 'overrides': overrides or {}, 'exitCode': result.returncode,
                  'expected': expected, 'seconds': time.monotonic() - start,
                  'stdoutSha256': sha(result.stdout), 'stderrSha256': sha(result.stderr)})
    assert result.returncode == expected, (name, result.stderr[-3500:].decode(errors='replace'))
    print(name + ': expected exit ' + str(expected), flush=True)
    return result


# Current source cannot silently replace any held recording or compiler artifact.
dependencies, carried, compiler = [], {}, {}
for family in ['virgl-resource-capacity', 'virgl-desktop-control', 'virgl-shadow-samplers']:
    for role in ['worker', 'verifier']:
        directory = repo / 'evidence' / family / role
        manifest_raw = (directory / 'manifest.json').read_bytes()
        manifest = json.loads(manifest_raw)
        index_raw = (directory / 'records.json').read_bytes()
        index = json.loads(index_raw)
        archive = directory / 'recording.tar.gz'
        assert sha(index_raw) == manifest['recordIndexSha256']
        assert sha(archive.read_bytes()) == manifest['archiveSha256']
        assert manifest_raw == subprocess.check_output(['git', 'show', f'{base}:evidence/{family}/{role}/manifest.json'], cwd=repo)
        rows = index['records'] if isinstance(index, dict) else index
        expected = {r['path']: r for r in rows}
        with tarfile.open(archive, 'r:gz') as packed:
            members = {m.name: m for m in packed.getmembers()}
            assert set(members) == set(expected)
            for name, item in expected.items():
                raw = packed.extractfile(members[name]).read()
                assert len(raw) == item['bytes'] and sha(raw) == item['sha256']
                if family == 'virgl-resource-capacity' and role == 'worker' and name == 'hot/receipt.json':
                    held = json.loads(raw)
                    carried = {**held['sources'], **held['carriedSources']}
                    (root / 'held-storage-receipt.json').write_bytes(raw)
                if family == 'virgl-shadow-samplers' and role == 'worker' and name.startswith('cold-generated/renderer/virgl-shader/build/wasm/'):
                    relative = name.removeprefix('cold-generated/')
                    compiler[relative] = raw
        dependencies.append({'family': family, 'role': role, 'manifestSha256': sha(manifest_raw),
                             'indexSha256': sha(index_raw), 'archiveSha256': manifest['archiveSha256'],
                             'reopenedBodies': len(rows)})
assert set(compiler) == {'renderer/virgl-shader/build/wasm/virgl-shader.mjs', 'renderer/virgl-shader/build/wasm/virgl-shader.wasm'}
for relative, raw in compiler.items():
    path = repo / relative
    if path.exists():
        assert path.read_bytes() == raw
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
held_pins = {p: d for p, d in carried.items() if p.startswith('renderer/') and p not in {
    'renderer/virgl-command/control-bridge.mjs', 'renderer/virgl-command/tests/submit-acceptance.mjs'}}
for relative, digest in held_pins.items():
    assert sha((repo / relative).read_bytes()) == digest, relative
for relative in ['crates/core/src/dev/virtio/gpu/control3d.rs', 'crates/core/src/dev/virtio/gpu/submit3d.rs']:
    digest = sha(subprocess.check_output(['git', 'show', f'{base}:{relative}'], cwd=repo))
    assert sha((repo / relative).read_bytes()) == digest
    held_pins[relative] = digest

features = 'virgl-control-proof,gpu-trace,trace'
run('policy', ['python3', 'tools/check_task_policy.py'])
run('format', ['cargo', 'fmt', '--check', '-p', 'wasm-vm-core', '-p', 'wasm-vm-wasm'])
run('clippy-default', ['cargo', 'clippy', '--offline', '-p', 'wasm-vm-core', '--lib', '--', '-D', 'warnings'])
run('clippy-selected', ['cargo', 'clippy', '--offline', '-p', 'wasm-vm-core', '--lib', '--features', features,
                      '--test', 'virtio_gpu_submit3d', '--test', 'virtio_gpu_control3d', '--test', 'virtio_gpu_machine', '--', '-D', 'warnings'])
run('clippy-wasm', ['cargo', 'clippy', '--offline', '-p', 'wasm-vm-wasm', '--lib', '--target', 'wasm32-unknown-unknown',
                  '--features', 'virgl-control-proof', '--', '-D', 'warnings'])
coverage_root = root / 'coverage'
coverage_root.mkdir()
instrument = {'RUSTFLAGS': '-C instrument-coverage', 'CARGO_TARGET_DIR': str(repo / 'target/virgl-desktop-submit-coverage'),
              'LLVM_PROFILE_FILE': str(coverage_root / '%m-%p.profraw')}
native_command = ['cargo', 'test', '--offline', '-p', 'wasm-vm-core', '--features', features, '--test', 'virtio_gpu_submit3d']
artifact = run('native-artifact', native_command + ['--no-run', '--message-format=json'], instrument)
artifacts = [json.loads(l) for l in artifact.stdout.splitlines() if l.startswith(b'{')]
binary = Path(next(v['executable'] for v in artifacts if v.get('executable') and v.get('target', {}).get('name') == 'virtio_gpu_submit3d'))
binary_pin = {'path': str(binary), 'bytes': binary.stat().st_size, 'sha256': sha(binary.read_bytes())}
shutil.copyfile(binary, root / 'native-test-binary')
run('native-submit', native_command + ['--', '--nocapture', '--test-threads=1'], instrument)
run('native-control', ['cargo', 'test', '--offline', '-p', 'wasm-vm-core', '--features', features,
                       '--test', 'virtio_gpu_control3d', '--', '--nocapture', '--test-threads=1'])
run('native-gpu', ['cargo', 'test', '--offline', '-p', 'wasm-vm-core', '--features', features, '--lib', 'dev::virtio::gpu::', '--', '--test-threads=1'])
run('native-machine', ['cargo', 'test', '--offline', '-p', 'wasm-vm-core', '--features', features, '--test', 'virtio_gpu_machine', '--', '--test-threads=1'])
for suffix, extra in [('default', []), ('selected', ['--features', 'virgl-control-proof'])]:
    run('wasm-core-' + suffix, ['cargo', 'build', '--offline', '-p', 'wasm-vm-core', '--no-default-features', '--target', 'wasm32-unknown-unknown', *extra])
run('wasm-proof', ['wasm-pack', 'build', 'crates/wasm', '--dev', '--target', 'web', '--out-dir', '../../target/virgl-desktop-submit/pkg', '--features', 'virgl-control-proof'])
for name in ['renderer/virgl-command/control-bridge.mjs', 'renderer/virgl-command/tests/desktop-submit-acceptance.mjs', 'tools/virgl-desktop-submit/browser.mjs']:
    run('syntax-' + Path(name).stem, ['node', '--check', name])
run('hardware', ['node', 'tools/virgl-desktop-submit/browser.mjs', '--output', str(root / 'hardware')])
run('fault-old-job-bound', ['node', 'tools/virgl-desktop-submit/browser.mjs', '--output', str(root / 'fault-old-job-bound'), '--sabotage', 'old-job-bound'], expected=1)
fault = json.loads((root / 'fault-old-job-bound/report.json').read_bytes())
assert 'job admission has no guest completion' in fault['browserResult']['error']['message']
point = fault['browserResult']['point']
assert point['events'][-1]['type'] == 'beginJob' and len(point['events'][-1]['resources']) == 64
assert int.from_bytes(bytes(point['response'][:4]), 'little') == 0x1205
assert point['host']['pending'] is None and len(point['host']['resources']) == 64
run('default-dist-build', ['make', 'web-dist'])
run('default-demo', ['node', 'tools/verify-virgl-default-demo.mjs', '--output', str(root / 'default-demo'), '--task', 'E6-T11d52'])
sysroot = Path(subprocess.check_output(['rustc', '--print', 'sysroot'], cwd=repo, text=True).strip())
host = subprocess.check_output(['rustc', '-vV'], cwd=repo, text=True).split('host: ')[1].splitlines()[0]
llvm = sysroot / 'lib/rustlib' / host / 'bin'
run('coverage-merge', [str(llvm / 'llvm-profdata'), 'merge', '-sparse', *map(str, coverage_root.glob('*.profraw')), '-o', str(root / 'native.profdata')])
export = run('coverage-export', [str(llvm / 'llvm-cov'), 'export', str(binary), '--instr-profile=' + str(root / 'native.profdata')])
(root / 'native-coverage.json').write_bytes(export.stdout)
run('coverage-audit', ['python3', 'tools/virgl-desktop-submit/coverage.py', str(root)])
run('integration-audit', ['python3', 'tools/virgl-desktop-submit/audit.py', str(root)])
source_paths = subprocess.check_output(['git', 'ls-files', 'crates/core', 'crates/wasm', 'renderer/virgl-command',
    'tools/virgl-desktop-submit', 'tools/verify-virgl-default-demo.mjs', 'Cargo.toml', 'Cargo.lock', 'Makefile'], cwd=repo, text=True).splitlines()
pins = {}
for relative in source_paths:
    path = repo / relative
    if not path.is_file():
        continue
    raw = path.read_bytes()
    pins[relative] = {'bytes': len(raw), 'sha256': sha(raw)}
    destination = root / 'sources' / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(raw)
assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=repo)
receipt = {'schema': 'desktop-submit-worker-receipt-v1', 'task': 'E6-T11d52', 'head': head, 'base': base,
    'commands': steps, 'sources': pins, 'binary': binary_pin, 'carriedHostSources': held_pins,
    'dependencySeals': dependencies, 'guestExecution': False, 'productionAuthority': False,
    'hardwareReportSha256': sha((root / 'hardware/report.json').read_bytes()),
    'auditSha256': sha((root / 'integration-audit.json').read_bytes())}
(root / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({'status': 'passed', 'head': head, 'commands': len(steps)}))
