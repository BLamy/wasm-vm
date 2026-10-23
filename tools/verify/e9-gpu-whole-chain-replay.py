#!/usr/bin/env python3
"""Frozen-head high-risk proof for paged GPU browser consumers and archives."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

SOURCE = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--cold-clone', type=Path)
args = parser.parse_args()
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=False)
root = args.cold_clone.resolve() if args.cold_clone else SOURCE
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=SOURCE, text=True).strip()
env = {key: value for key, value in os.environ.items()
       if key not in ('RUSTFLAGS', 'RUSTDOCFLAGS', 'RUST_LOG') and not key.startswith('CARGO_')}
env.update(CARGO_TERM_COLOR='never', CARGO_INCREMENTAL='0', CARGO_BUILD_JOBS='4', GIT_OPTIONAL_LOCKS='0')
if args.cold_clone:
    env.update(CARGO_PROFILE_DEV_DEBUG='0', CARGO_PROFILE_TEST_DEBUG='0')
report = {'task': 'E9-T22h', 'risk': 'high', 'status': 'running', 'head': head,
          'clone': str(root) if args.cold_clone else None, 'commands': [], 'started': time.time(),
          'scope': 'Authenticated paged GPU timeline, exact witnessed native continuation, complete archive/retention and physical renderer. Fixed Omarchy workload and performance remain E9-T22c/d.'}


def sha(file):
    hash_ = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1048576), b''):
            hash_.update(chunk)
    return hash_.hexdigest()


def save():
    (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')


def clean(where):
    state = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=where, text=True)
    assert not state, 'exact-head checkout changed: ' + state[:500]


def run(name, command, timeout=3600, cwd=None):
    report['active'] = name
    save()
    start = time.time()
    with (out / (name + '.log')).open('wb') as log:
        result = subprocess.run(command, cwd=cwd or root, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
    report['commands'].append({'name': name, 'command': command,
                               'exit_code': result.returncode, 'seconds': time.time() - start})
    save()
    assert result.returncode == 0, name + ' failed; inspect retained log'


try:
    clean(SOURCE)
    if args.cold_clone:
        assert not root.exists(), 'cold destination must not exist'
        run('clone', ['git', 'clone', '--quiet', '--no-hardlinks', '--sparse', '--no-checkout', str(SOURCE), str(root)], cwd=SOURCE)
        run('checkout', ['git', 'checkout', '--quiet', '--detach', head])
        projection = subprocess.check_output(['git', 'sparse-checkout', 'list'], cwd=SOURCE, text=True).splitlines()
        assert {'crates', 'tools', 'tests', 'web', 'guest', 'releases', 'tasks'} <= set(projection)
        report['sourceProjection'] = projection
        run('sparse-source-projection', ['git', 'sparse-checkout', 'set', '--cone', *projection])
        assert not (root / 'target').exists() and not (root / 'web/node_modules').exists()
        run('browser-dependencies', ['npm', 'ci', '--prefix', 'web', '--no-audit', '--no-fund'], timeout=1800)
    clean(root)
    run('task-policy', ['python3', '-B', 'tools/check_task_policy.py'])
    run('format', ['cargo', 'fmt', '--all', '--check'])
    for name in ['web/session-gpu-replay-windows.js', 'web/session-gpu-history-reader.js',
                 'web/session-gpu-replay-worker.js', 'web/session-gpu-replay.js', 'web/session-bundles.js',
                 'web/session-gpu-reader-demo.js', 'web/session-timeline.js', 'web/session-library.js',
                 'web/main.js', 'web/roadmap.js', 'tools/verify/e9-gpu-whole-chain-replay-browser.mjs',
                 'tools/verify/e9-gpu-reader-stream-demo.mjs']:
        run('syntax-' + Path(name).stem, ['node', '--check', name])
    run('browser-build', ['make', 'web-dist'], timeout=7200)
    run('docs', ['node', 'tools/check-docs.mjs'])
    runtime = ['session-gpu-replay-windows.js', 'session-gpu-history-reader.js',
               'session-gpu-replay-worker.js', 'session-gpu-replay.js', 'session-bundles.js',
               'session-gpu-reader-demo.js', 'session-timeline.js', 'session-library.js',
               'main.js', 'roadmap.js', 'pkg/wasm_vm_wasm_bg.wasm']
    report['builtRuntime'] = []
    for name in runtime:
        source = root / 'web' / name
        built = root / 'web/dist' / name
        assert source.read_bytes() == built.read_bytes(), 'stale built runtime: ' + name
        report['builtRuntime'].append({'path': name, 'bytes': built.stat().st_size, 'sha256': sha(built)})
    app = root / 'web/dist/app.html'
    assert app.is_file() and 'gpu-history-reader-run' in app.read_text(), 'missing GPU demo in deployed app'
    report['builtRuntime'].append({'path': 'app.html', 'bytes': app.stat().st_size, 'sha256': sha(app)})
    run('legacy-v1-gpu-replay', ['node', 'tools/verify/e9-gpu-replay-browser.mjs',
                                 '--output', str(out / 'legacy-gpu')], timeout=2400)
    run('actual-long-gpu-recordings', ['node', 'tools/verify/e9-gpu-reader-stream-browser.mjs',
                                       '--output', str(out / 'fixture'), '--events', '4100', '--mutate-middle'], timeout=5400)
    run('independent-recording-bytes', ['python3', '-B', 'tools/verify/e9-gpu-reader-stream-files.py',
                                        '--directory', str(out / 'fixture')])
    run('whole-chain-browser-and-archive', ['node', 'tools/verify/e9-gpu-whole-chain-replay-browser.mjs',
                                             '--source', str(out / 'fixture'), '--output', str(out / 'browser'),
                                             '--from', 'initial', '--to', 'end', '--zero-egress'], timeout=5400)
    run('built-demo-and-suite', ['node', 'tools/verify/e9-gpu-reader-stream-demo.mjs',
                                  '--output', str(out / 'demo')], timeout=5400)
    if not args.cold_clone:
        run('full-local-gauntlet', ['python3', '-B', 'tools/verify/e9-local-gauntlet.py',
                                    '--task', 'E9-T22h', '--output', str(out / 'gauntlet')], timeout=21600)
    clean(root)
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip() == head
    report['status'] = 'passed'
except BaseException as error:
    report['status'] = 'failed'
    report['failure'] = repr(error)
    raise
finally:
    report.pop('active', None)
    report['finished'] = time.time()
    changed = subprocess.check_output(['git', 'diff', '--name-only', '78398c95e', head], cwd=SOURCE, text=True).splitlines()
    report['sources'] = [{'path': name, 'sha256': sha(root / name)} for name in changed if (root / name).is_file()]
    report['files'] = [{'path': str(file.relative_to(out)), 'bytes': file.stat().st_size, 'sha256': sha(file)}
                       for file in sorted(out.rglob('*')) if file.is_file() and file != out / 'report.json']
    save()
