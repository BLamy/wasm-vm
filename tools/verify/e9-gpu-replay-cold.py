#!/usr/bin/env python3
"""Prove the frozen GPU adapter from a pristine clone and a fresh build directory."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--clone', type=Path, required=True)
a = p.parse_args()
out, clone = a.output.resolve(), a.clone.resolve()
assert not clone.exists(), 'cold clone path must not exist'
out.mkdir(parents=True, exist_ok=False)
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
assert not subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True)
env = {k: v for k, v in os.environ.items()
       if k not in ('RUSTFLAGS', 'RUSTDOCFLAGS', 'RUST_LOG') and not k.startswith('CARGO_')}
env['PATH'] = str(Path.home() / '.cargo/bin') + ':/usr/bin:/bin:/usr/sbin:/sbin:' + env['PATH']
# Native debug symbols do not establish a portability claim. Avoid duplicating the
# worker's large debug cache; shipped Wasm still uses the unmodified wasm-release profile.
env.update(CARGO_BUILD_JOBS='4', CARGO_TERM_COLOR='never', CARGO_INCREMENTAL='0',
           CARGO_PROFILE_DEV_DEBUG='0', CARGO_PROFILE_TEST_DEBUG='0',
           E9_GPU_RESULT_EVIDENCE=str(out / 'native'))
report = {'task': 'E9-T18c', 'head': head, 'status': 'running', 'started': time.time(),
          'clone': str(clone), 'commands': [], 'environment': {
              k: v for k, v in env.items() if k.startswith('CARGO_')},
          'scope': 'Cold portability proof; full local make ci is recorded by the worker submission.'}


def sha(file):
    h = hashlib.sha256()
    with file.open('rb') as source:
        for block in iter(lambda: source.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def write():
    (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')


def run(name, command, cwd=clone, timeout=1800):
    report['active'] = name
    write()
    print(name, flush=True)
    start = time.time()
    with (out / (name + '.log')).open('wb') as log:
        result = subprocess.run(command, cwd=cwd, env=env, stdout=log,
                                stderr=subprocess.STDOUT, timeout=timeout)
    report['commands'].append({'name': name, 'command': command,
                               'seconds': time.time() - start, 'exit_code': result.returncode})
    write()
    assert result.returncode == 0, name + ' failed; inspect its log'


try:
    run('clone', ['git', 'clone', '--quiet', '--no-hardlinks', '--no-checkout', str(ROOT), str(clone)], ROOT)
    run('checkout', ['git', 'checkout', '--quiet', '--detach', head])
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=clone, text=True).strip() == head
    assert not (clone / 'target').exists() and not (clone / 'web/node_modules').exists()
    assert not subprocess.check_output(['git', 'status', '--porcelain'], cwd=clone, text=True)
    run('policy', ['python3', 'tools/check_task_policy.py'])
    run('format', ['cargo', 'fmt', '--check'])
    features = 'virgl-renderer,virgl-control-proof,gpu-trace,trace'
    run('gpu-clippy', ['cargo', 'clippy', '--locked', '-p', 'wasm-vm-core', '--tests',
                       '--features', features, '--', '-D', 'warnings'])
    run('gpu-lib', ['cargo', 'test', '--locked', '-p', 'wasm-vm-core', '--features', features,
                    '--lib', '--', '--nocapture'])
    run('rv64-results', ['cargo', 'test', '--locked', '-p', 'wasm-vm-core', '--features', features,
                         '--test', 'session_gpu_results', '--', '--nocapture', '--test-threads=1'])
    for label, script in [('a', 'e9-gpu-results-files.py'), ('b', 'e9-pending-gpu-files.py')]:
        run('independent-' + label + '-bytes', ['python3', '-B', 'tools/verify/' + script,
                                               '--directory', str(out / 'native')])
    run('software-clock-seek', ['cargo', 'test', '--locked', '-p', 'wasm-vm-core', '--features', 'trace',
                                '--test', 'e9_event_clock', '--test', 'e9_seek', '--', '--nocapture'])
    run('storage-results', ['cargo', 'test', '--locked', '-p', 'wasm-vm-storage',
                            '--test', 'session_publication', '--', '--nocapture'])
    run('core-no-std-wasm', ['cargo', 'build', '--locked', '-p', 'wasm-vm-core',
                             '--no-default-features', '--target', 'wasm32-unknown-unknown',
                             '--features', 'virgl-renderer,trace'])
    run('browser-build', ['make', 'web-build'])
    runtime = ['pkg/wasm_vm_wasm.js', 'pkg/wasm_vm_wasm_bg.wasm',
               'session-pkg/wasm_vm_session_bg.wasm', 'gpu-checkpoint-build.js', 'roadmap.js',
               'session-gpu-journal.js', 'session-gpu-replay.js',
               'session-gpu-replay-worker.js', 'session-gpu-replay-format.js']
    report['rebuiltRuntime'] = []
    for name in runtime:
        built, committed = clone / 'web' / name, clone / 'web/dist' / name
        assert built.read_bytes() == committed.read_bytes(), 'cold build differs from committed dist: ' + name
        report['rebuiltRuntime'].append({'path': name, 'bytes': built.stat().st_size, 'sha256': sha(built)})
    run('renderer-codecs', ['node', '--test', 'tools/virgl-production/gpu-checkpoint-codec.test.mjs',
                            'tools/virgl-production/gpu-checkpoint-dma.test.mjs',
                            'tools/virgl-production/critic-checkpoint-dma.test.mjs',
                            'tools/virgl-production/e9-gpu-session-evidence.test.mjs'])
    run('software-console', ['node', '--test', 'tools/verify/e9-timeline-console.test.mjs'])
    run('built-demo', ['node', 'tools/verify/e9-gpu-results-browser.mjs', '--output', str(out / 'demo')])
    run('hardware-browser', ['node', 'tools/verify/e9-gpu-replay-browser.mjs', '--output', str(out / 'browser')])
    run('independent-browser-bytes', ['python3', '-B', 'tools/verify/e9-gpu-replay-files.py',
                                      '--directory', str(out / 'browser')])
    run('gpu-timeline-ui', ['node', 'tools/verify/e9-gpu-timeline-ui.mjs', '--output', str(out / 'gpu-timeline'), '--directory', str(out / 'browser')])
    run('layered-hardware-browser', ['node', 'tools/verify/e9-gpu-replay-browser.mjs', '--fixture', 'layered', '--output', str(out / 'layered-browser')])
    run('independent-layered-bytes', ['python3', '-B', 'tools/verify/e9-gpu-replay-files.py', '--directory', str(out / 'layered-browser')])
    report['finalCheckoutStatus'] = subprocess.check_output(
        ['git', 'status', '--porcelain', '--untracked-files=all'], cwd=clone, text=True)
    assert not report['finalCheckoutStatus'], 'cold acceptance changed the checkout'
    report['status'] = 'passed'
except BaseException as error:
    report['status'] = 'failed'
    report['failure'] = repr(error)
    raise
finally:
    report.pop('active', None)
    report['finished'] = time.time()
    report['files'] = [{'path': str(file.relative_to(out)), 'bytes': file.stat().st_size, 'sha256': sha(file)}
                       for file in sorted(out.rglob('*')) if file.is_file() and file != out / 'report.json']
    write()
