#!/usr/bin/env python3
"""Freeze the high-risk durable witness/reference boundary and its direct proofs."""
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
out = a.output.resolve(); out.mkdir(parents=True, exist_ok=False)
root = a.cold_clone.resolve() if a.cold_clone else SOURCE
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=SOURCE, text=True).strip()
env = {k: v for k, v in os.environ.items() if k not in ('RUSTFLAGS', 'RUSTDOCFLAGS', 'RUST_LOG') and not k.startswith('CARGO_')}
env.update(CARGO_TERM_COLOR='never', CARGO_INCREMENTAL='0', CARGO_BUILD_JOBS='4')
if a.cold_clone: env.update(CARGO_PROFILE_DEV_DEBUG='0', CARGO_PROFILE_TEST_DEBUG='0')
report = {'task': 'E9-T22i', 'risk': 'high', 'status': 'running', 'head': head, 'commands': [], 'started': time.time(),
          'clone': str(root) if a.cold_clone else None,
          'scope': 'Required bounded v2 witness pages, immutable append, complete durable graph/GC and storage-only archives; v1 unchanged. No whole-history reader/executor, desktop or performance qualification.'}

def sha(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for part in iter(lambda: stream.read(1048576), b''): digest.update(part)
    return digest.hexdigest()

def save(): (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
def clean(where):
    status = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=where, text=True)
    assert not status, 'clean exact-head acceptance required: ' + status
    return status

def run(name, command, timeout=3600, cwd=None):
    report['active'] = name; save(); print(name, flush=True); started = time.time()
    with (out / (name + '.log')).open('wb') as log:
        result = subprocess.run(command, cwd=cwd or root, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
    report['commands'].append({'name': name, 'command': command, 'exit_code': result.returncode, 'seconds': time.time() - started})
    save(); assert result.returncode == 0, name + ' failed; inspect retained log'

try:
    clean(SOURCE)
    if a.cold_clone:
        assert not root.exists(), 'cold destination must not exist'
        run('clone', ['git', 'clone', '--quiet', '--no-hardlinks', '--sparse', '--no-checkout', str(SOURCE), str(root)], cwd=SOURCE)
        run('checkout', ['git', 'checkout', '--quiet', '--detach', head])
        projection = subprocess.check_output(['git', 'sparse-checkout', 'list'], cwd=SOURCE, text=True).splitlines()
        assert projection and {'crates', 'tools', 'tests', 'web', 'releases', 'docs'} <= set(projection)
        report['sourceProjection'] = {'mode': 'cone', 'paths': projection,
            'scope': 'Identical source-complete authoritative checkout; excludes only unused historical evidence archives. All code, tests, native guest/runtime artifacts and direct gate dependencies are required.'}
        run('sparse-source-projection', ['git', 'sparse-checkout', 'set', '--cone', *projection])
        assert not (root / 'target').exists() and not (root / 'web/node_modules').exists()
        run('browser-dependencies', ['npm', 'ci', '--prefix', 'web', '--no-audit', '--no-fund'])
    clean(root)
    run('policy', ['python3', '-B', 'tools/check_task_policy.py'])
    run('format', ['cargo', 'fmt', '--all', '--check'])
    run('affected-clippy', ['cargo', 'clippy', '--locked', '-p', 'wasm-vm-storage', '-p', 'wasm-vm-session-web', '-p', 'wasm-vm-wasm', '--all-targets', '--features', 'virgl-renderer', '--', '-D', 'warnings'])
    run('storage-native', ['cargo', 'test', '--locked', '-p', 'wasm-vm-storage', '--', '--nocapture'])
    run('wasm-target-clippy', ['cargo', 'clippy', '--locked', '-p', 'wasm-vm-session-web', '-p', 'wasm-vm-wasm', '--target', 'wasm32-unknown-unknown', '--features', 'virgl-renderer', '--', '-D', 'warnings'])
    run('guest-artifact-reproduction', ['node', 'tools/verify/build-e9-gpu-journal-stream.mjs'])
    run('browser-build', ['make', 'web-build'])
    names = ['session-witness-pages.js', 'session-witness-graph.js', 'session-witness-archives.js', 'witness-pages-probe.js',
             'session-gpu-journal.js', 'session-store.js', 'session-inputs.js', 'session-bundle-format.js', 'session-bundles.js',
             'session-timeline.js', 'session-library.js', 'main.js', 'roadmap.js', 'gpu-checkpoint-build.js', 'pkg/wasm_vm_wasm.js',
             'pkg/wasm_vm_wasm_bg.wasm', 'session-pkg/wasm_vm_session.js', 'session-pkg/wasm_vm_session_bg.wasm']
    report['rebuiltRuntime'] = []
    for name in names:
        file = root / 'web' / name
        assert file.read_bytes() == (root / 'web/dist' / name).read_bytes(), 'stale built artifact: ' + name
        report['rebuiltRuntime'].append({'path': name, 'bytes': file.stat().st_size, 'sha256': sha(file)})
    for name in names:
        if name.endswith('.js'): run('syntax-' + Path(name).stem, ['node', '--check', str(Path('web') / name)])
    for name in ['e9-witness-pages-browser.mjs', 'e9-witness-pages-attacks.mjs', 'e9-witness-pages-v1-control.mjs', 'e9-witness-archive-locales.mjs', 'e9-witness-archive-locales-browser.mjs', 'e9-witness-pages-demo.mjs']:
        run('syntax-' + Path(name).stem, ['node', '--check', str(Path('tools/verify') / name)])
    run('legacy-canonical-formats', ['node', '--test', 'tools/verify/e9-bundle-format.test.mjs', 'tools/verify/e9-session-witnesses.test.mjs', 'tools/verify/e9-timeline-console.test.mjs'])
    run('docs', ['node', 'tools/check-docs.mjs'])
    run('native-witness-pages-and-attacks', ['node', 'tools/verify/e9-witness-pages-browser.mjs', '--output', str(out / 'witnesses'), '--witnesses', '130', '--mutate-middle'], timeout=5400)
    run('independent-literal-witnesses', ['python3', '-B', 'tools/verify/e9-witness-pages-files.py', '--directory', str(out / 'witnesses')])
    run('gpu-replay-regression', ['node', 'tools/verify/e9-gpu-replay-browser.mjs', '--output', str(out / 'gpu-replay')])
    run('independent-gpu-regression', ['python3', '-B', 'tools/verify/e9-gpu-replay-files.py', '--directory', str(out / 'gpu-replay')])
    run('v1-store-crash-race-quota-regression', ['node', 'tools/verify/e9-session-store-browser.mjs', '--output', str(out / 'store-regression')])
    run('built-demo', ['node', 'tools/verify/e9-witness-pages-demo.mjs', '--output', str(out / 'demo')], timeout=5400)
    if not a.cold_clone:
        run('local-gauntlet', ['python3', '-B', 'tools/verify/e9-local-gauntlet.py', '--task', 'E9-T22i', '--output', str(out / 'gauntlet')], timeout=21600)
    report['finalCheckoutStatus'] = clean(root)
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip() == head
    report['status'] = 'passed'
except BaseException as error:
    report['status'] = 'failed'; report['failure'] = repr(error); raise
finally:
    report.pop('active', None); report['finished'] = time.time(); report['sourceRoot'] = str(root)
    changed = subprocess.check_output(['git', 'diff', '--name-only', 'e52219ad5bbf70531f7237a0e72d187573e726a5', head], cwd=SOURCE, text=True).splitlines()
    report['sources'] = [{'path': name, 'sha256': sha(root / name)} for name in changed if (root / name).is_file()]
    report['files'] = [{'path': str(f.relative_to(out)), 'bytes': f.stat().st_size, 'sha256': sha(f)} for f in sorted(out.rglob('*')) if f.is_file() and f != out / 'report.json']
    save()
