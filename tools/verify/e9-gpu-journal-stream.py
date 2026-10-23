#!/usr/bin/env python3
"""Freeze and record the scoped high-risk GPU journal publication submission."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

SOURCE = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--cold-clone', type=Path)
a = p.parse_args()
out = a.output.resolve()
out.mkdir(parents=True, exist_ok=False)
root = a.cold_clone.resolve() if a.cold_clone else SOURCE
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=SOURCE, text=True).strip()
env = {k: v for k, v in os.environ.items() if k not in ('RUSTFLAGS', 'RUSTDOCFLAGS', 'RUST_LOG') and not k.startswith('CARGO_')}
env.update(CARGO_TERM_COLOR='never', CARGO_INCREMENTAL='0', CARGO_BUILD_JOBS='4')
if a.cold_clone:
    env.update(CARGO_PROFILE_DEV_DEBUG='0', CARGO_PROFILE_TEST_DEBUG='0')
report = {'task': 'E9-T22e', 'risk': 'high', 'status': 'running', 'head': head, 'commands': [],
          'started': time.time(), 'clone': str(root) if a.cold_clone else None,
          'scope': 'Bounded checkpoint-interval GPU journal publication with actual native UART/block receipts, preserved resident/durable limits; full desktop, whole-history reader/replay and performance remain separate.'}


def sha(file):
    h = hashlib.sha256()
    with file.open('rb') as f:
        for part in iter(lambda: f.read(1048576), b''):
            h.update(part)
    return h.hexdigest()


def save():
    (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')


def clean(where):
    value = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=where, text=True)
    assert not value, 'clean exact-head acceptance required: ' + value
    return value


def run(name, command, timeout=3600, cwd=None):
    report['active'] = name
    save()
    print(name, flush=True)
    start = time.time()
    with (out / (name + '.log')).open('wb') as log:
        result = subprocess.run(command, cwd=cwd or root, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
    report['commands'].append({'name': name, 'command': command, 'exit_code': result.returncode, 'seconds': time.time() - start})
    save()
    assert result.returncode == 0, name + ' failed; inspect its retained log'


try:
    clean(SOURCE)
    if a.cold_clone:
        assert not root.exists(), 'cold destination must not exist'
        run('clone', ['git', 'clone', '--quiet', '--no-hardlinks', '--no-checkout', str(SOURCE), str(root)], cwd=SOURCE)
        run('checkout', ['git', 'checkout', '--quiet', '--detach', head])
        assert not (root / 'target').exists() and not (root / 'web/node_modules').exists()
        run('browser-dependencies', ['npm', 'ci', '--prefix', 'web', '--no-audit', '--no-fund'])
        report['wallPolicy'] = 'Fresh exact-head cold proof; full local regression wall runs once in the primary submission.'
    clean(root)
    run('policy', ['python3', '-B', 'tools/check_task_policy.py'])
    run('format', ['cargo', 'fmt', '--all', '--check'])
    run('affected-clippy', ['cargo', 'clippy', '--locked', '-p', 'wasm-vm-storage', '-p', 'wasm-vm-wasm', '--all-targets', '--features', 'virgl-renderer', '--', '-D', 'warnings'])
    run('storage-native', ['cargo', 'test', '--locked', '-p', 'wasm-vm-storage', '--', '--nocapture'])
    command = ['cargo', 'test', '--locked', '-p', 'wasm-vm-core', '--features', 'trace,virgl-renderer']
    for name in ['e9_event_clock', 'e9_device_completions', 'e9_session_checkpoint', 'e9_incremental_keyframes', 'e9_deterministic_replay', 'e9_replay_plan_bounds']:
        command.extend(['--test', name])
    run('native-record-checkpoint-replay', command + ['--', '--nocapture'])
    run('wasm-target-clippy', ['cargo', 'clippy', '--locked', '-p', 'wasm-vm-wasm', '--target', 'wasm32-unknown-unknown', '--features', 'virgl-renderer', '--', '-D', 'warnings'])
    run('guest-artifact-reproduction', ['node', 'tools/verify/build-e9-gpu-journal-stream.mjs'])
    run('browser-build', ['make', 'web-build'])
    for name in ['session-gpu-journal.js', 'gpu-journal-stream-probe.js', 'main.js', 'roadmap.js', 'gpu-checkpoint-build.js',
                 'pkg/wasm_vm_wasm.js', 'pkg/wasm_vm_wasm_bg.wasm', 'session-pkg/wasm_vm_session_bg.wasm',
                 'assets/e9-gpu-journal-stream-image.json', *['assets/e9-gpu-journal-stream-' + v + '.' + suffix for v in ['count', 'bytes'] for suffix in ['bin', 'json']]]:
        assert (root / 'web' / name).read_bytes() == (root / 'web/dist' / name).read_bytes(), 'stale built artifact: ' + name
    app = (root / 'web/index.html').read_bytes()
    for before, after in [(b'./node_modules/@xterm/xterm/css/xterm.css', b'./vendor/xterm/xterm.css'),
                          (b'./node_modules/@xterm/xterm/lib/xterm.js', b'./vendor/xterm/xterm.js'),
                          (b'./node_modules/@xterm/addon-fit/lib/addon-fit.js', b'./vendor/xterm/addon-fit.js'),
                          (b'./landing.html', b'./')]:
        app = app.replace(before, after)
    assert app == (root / 'web/dist/app.html').read_bytes(), 'built HTML differs from prescribed mapping'
    for name in ['web/session-gpu-journal.js', 'web/gpu-journal-stream-probe.js', 'web/main.js', 'tools/verify/e9-gpu-journal-stream-browser.mjs', 'tools/verify/e9-gpu-journal-stream-demo.mjs', 'tools/verify/e9-gpu-replay-browser.mjs']:
        run('syntax-' + Path(name).stem, ['node', '--check', name])
    run('docs', ['node', 'tools/check-docs.mjs'])
    run('native-browser-journal', ['node', 'tools/verify/e9-gpu-journal-stream-browser.mjs', '--output', str(out / 'native-browser-journal'), '--events', '4100', '--block-bytes', '67125760'])
    run('independent-journal-bytes', ['python3', '-B', 'tools/verify/e9-gpu-journal-stream-files.py', '--directory', str(out / 'native-browser-journal')])
    run('gpu-replay-and-publication-regression', ['node', 'tools/verify/e9-gpu-replay-browser.mjs', '--output', str(out / 'gpu-replay')])
    run('independent-gpu-regression', ['python3', '-B', 'tools/verify/e9-gpu-replay-files.py', '--directory', str(out / 'gpu-replay')])
    run('store-crash-race-quota-regression', ['node', 'tools/verify/e9-session-store-browser.mjs', '--output', str(out / 'store-regression')])
    run('built-demo', ['node', 'tools/verify/e9-gpu-journal-stream-demo.mjs', '--output', str(out / 'demo')])
    if not a.cold_clone:
        run('local-gauntlet', ['python3', '-B', 'tools/verify/e9-local-gauntlet.py', '--task', 'E9-T22e', '--output', str(out / 'gauntlet')], timeout=21600)
    report['finalCheckoutStatus'] = clean(root)
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip() == head
    report['status'] = 'passed'
except BaseException as error:
    report['status'] = 'failed'
    report['failure'] = repr(error)
    raise
finally:
    report.pop('active', None)
    report['finished'] = time.time()
    report['sourceRoot'] = str(root)
    changed = subprocess.check_output(['git', 'diff', '--name-only', 'ffb0659098ec1e0b6e360055c3c92d25035ec3c8', head], cwd=SOURCE, text=True).splitlines()
    report['sources'] = [{'path': name, 'sha256': sha(root / name)} for name in changed if (root / name).is_file()]
    report['files'] = [{'path': str(f.relative_to(out)), 'bytes': f.stat().st_size, 'sha256': sha(f)} for f in sorted(out.rglob('*')) if f.is_file() and f != out / 'report.json']
    save()
