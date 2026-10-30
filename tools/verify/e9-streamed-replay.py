#!/usr/bin/env python3
"""Exact-head high-risk proof for continuous bounded native/Wasm replay."""
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
tree = subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=SOURCE, text=True).strip()
env = {key: value for key, value in os.environ.items()
       if key not in ('RUSTFLAGS', 'RUSTDOCFLAGS', 'RUST_LOG') and not key.startswith('CARGO_')}
env.update(CARGO_TERM_COLOR='never', CARGO_INCREMENTAL='0', CARGO_BUILD_JOBS='4', GIT_OPTIONAL_LOCKS='0')
if args.cold_clone:
    env.update(CARGO_PROFILE_DEV_DEBUG='0', CARGO_PROFILE_TEST_DEBUG='0')
report = {
    'task': 'E9-T22g', 'risk': 'high', 'status': 'running', 'head': head, 'tree': tree,
    'source': str(SOURCE), 'clone': str(root) if args.cold_clone else None,
    'started': time.time(), 'commands': [],
    'scope': 'One private exact software/GPU replay across bounded native windows, unchanged resident limits, host queue and source/GPU predecessor fences. Long full-Linux/Omarchy workload and performance qualification remain E9-T22c/d.'
}


def sha(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for part in iter(lambda: stream.read(1048576), b''):
            digest.update(part)
    return digest.hexdigest()


def save():
    (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')


def clean(where):
    state = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all'],
                                    cwd=where, text=True)
    assert not state, 'exact-head checkout changed: ' + state[:500]


def run(name, command, timeout=3600, cwd=None, extra_env=None):
    report['active'] = name
    save()
    started = time.time()
    with (out / (name + '.log')).open('wb') as log:
        result = subprocess.run(command, cwd=cwd or root, env={**env, **(extra_env or {})},
                                stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
    report['commands'].append({'name': name, 'command': command,
                               'exit_code': result.returncode, 'seconds': time.time() - started})
    save()
    assert result.returncode == 0, name + ' failed; inspect retained log'


try:
    clean(SOURCE)
    if args.cold_clone:
        assert not root.exists(), 'cold destination must be absent'
        run('clone', ['git', 'clone', '--quiet', '--no-hardlinks', '--sparse', '--no-checkout',
                      str(SOURCE), str(root)], cwd=SOURCE)
        run('checkout', ['git', 'checkout', '--quiet', '--detach', head])
        projection = subprocess.check_output(['git', 'sparse-checkout', 'list'],
                                             cwd=SOURCE, text=True).splitlines()
        assert {'crates', 'tools', 'tests', 'web', 'releases', 'guest', 'tasks'} <= set(projection)
        report['sourceProjection'] = projection
        run('sparse-source-projection', ['git', 'sparse-checkout', 'set', '--cone', *projection])
        assert not (root / 'target').exists() and not (root / 'web/node_modules').exists()
    clean(root)
    run('task-policy', ['python3', '-B', 'tools/check_task_policy.py'])
    run('format', ['cargo', 'fmt', '--all', '--check'])
    run('native-clippy', ['cargo', 'clippy', '--locked', '-p', 'wasm-vm-core', '-p', 'wasm-vm-wasm',
                          '--all-targets', '--features', 'virgl-renderer,trace', '--', '-D', 'warnings'])
    run('wasm-clippy', ['cargo', 'clippy', '--locked', '-p', 'wasm-vm-wasm',
                        '--target', 'wasm32-unknown-unknown', '--features',
                        'virgl-renderer,virgl-control-proof', '--', '-D', 'warnings'])
    run('software-and-gpu-long-history', ['cargo', 'test', '--locked', '-p', 'wasm-vm-core',
                                           '--features', 'virgl-renderer,trace', '--test',
                                           'e9_streamed_replay', '--test', 'session_gpu_results',
                                           'session_replay_streamed_initial_to_end', '--', '--nocapture'],
        extra_env={'E9_STREAMED_EVIDENCE': str(out / 'native')})
    run('replay-adversarial-and-observations', ['cargo', 'test', '--locked', '-p', 'wasm-vm-core',
                                                '--features', 'virgl-renderer,trace', '--test',
                                                'e9_streamed_replay', '--test',
                                                'e9_deterministic_replay', '--', '--nocapture'])
    run('gpu-regression', ['cargo', 'test', '--locked', '-p', 'wasm-vm-core',
                            '--features', 'virgl-renderer,trace', '--test',
                            'session_gpu_results', '--', '--nocapture'], timeout=5400)
    for case in ['software-event-count', 'software-body-bytes', 'gpu-event-count', 'gpu-body-bytes']:
        directory = out / 'native' / case
        frontier = json.loads((directory / 'frontiers.json').read_text())
        trace = directory / 'original.guest-trace'
        assert trace.stat().st_size > 0 and int(frontier['final']['eventCursor']) > int(frontier['middle']['eventCursor'])
        assert len(frontier['final']['stateSha256']) == len(frontier['middle']['stateSha256']) == 64
        assert (directory / ('final.resume' if case.startswith('software') else 'final.logical-state')).stat().st_size > 0
        report.setdefault('nativeEvidence', []).append({'case': case, 'traceLines': sum(1 for _ in trace.open()),
            'traceSha256': sha(trace), 'middle': frontier['middle'], 'final': frontier['final']})
    assert int(next(v for v in report['nativeEvidence'] if v['case'] == 'software-event-count')['final']['eventCursor']) > 4096
    assert int(next(v for v in report['nativeEvidence'] if v['case'] == 'gpu-event-count')['final']['eventCursor']) > 4096
    run('browser-probe-syntax', ['node', '--check', 'web/session-streamed-replay-probe.js'])
    run('browser-runner-syntax', ['node', '--check', 'tools/verify/e9-streamed-replay-browser.mjs'])
    run('demo-runner-syntax', ['node', '--check', 'tools/verify/e9-streamed-replay-demo.mjs'])
    run('browser-build-and-dist', ['make', 'web-dist'], timeout=7200)
    for name in ['session-streamed-replay-probe.js', 'main.js', 'roadmap.js',
                 'pkg/wasm_vm_wasm.js', 'pkg/wasm_vm_wasm_bg.wasm']:
        source = root / 'web' / name
        published = root / 'web/dist' / name
        assert source.read_bytes() == published.read_bytes(), 'stale built runtime: ' + name
        report.setdefault('builtRuntime', []).append({'path': name, 'bytes': published.stat().st_size,
                                                        'sha256': sha(published)})
    run('bounded-browser-handoff', ['node', 'tools/verify/e9-streamed-replay-browser.mjs',
                                     '--output', str(out / 'browser')], timeout=2400)
    run('built-demo-and-suite', ['node', 'tools/verify/e9-streamed-replay-demo.mjs',
                                  '--output', str(out / 'demo')], timeout=2400)
    if not args.cold_clone:
        run('full-local-gauntlet', ['python3', '-B', 'tools/verify/e9-local-gauntlet.py',
                                    '--task', 'E9-T22g', '--output', str(out / 'gauntlet')],
            timeout=21600)
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
    changed = subprocess.check_output(['git', 'diff', '--name-only',
                                       'a51717179236acf51ffb3320f899dda8fdbe3578', head],
                                      cwd=SOURCE, text=True).splitlines()
    report['sources'] = [{'path': name, 'sha256': sha(root / name)} for name in changed
                         if (root / name).is_file()]
    report['files'] = [{'path': str(file.relative_to(out)), 'bytes': file.stat().st_size,
                        'sha256': sha(file)} for file in sorted(out.rglob('*'))
                       if file.is_file() and file != out / 'report.json']
    save()
