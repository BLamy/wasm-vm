#!/usr/bin/env python3
"""Record isolated continuations at a frozen head, optionally from a pristine clone."""
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
env.update(CARGO_TERM_COLOR='never', CARGO_INCREMENTAL='0', CARGO_BUILD_JOBS='4',
           E9_BRANCH_EVIDENCE=str(out / 'native'), E9_GPU_RESULT_EVIDENCE=str(out / 'native'))
if args.cold_clone:
    env.update(CARGO_PROFILE_DEV_DEBUG='0', CARGO_PROFILE_TEST_DEBUG='0')
report = dict(task='E9-T20', risk='high', status='running', head=head,
              started=time.time(), commands=[], clone=str(root) if args.cold_clone else None,
              scope='Isolated exact software/GPU continuations, offline effects, real files and physical GPU; desktop budgets remain T22.')
features = 'virgl-renderer,virgl-control-proof,gpu-trace,trace'


def sha(file):
    digest = hashlib.sha256()
    with file.open('rb') as source:
        for block in iter(lambda: source.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def write():
    (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')


def clean(directory):
    status = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all'],
                                     cwd=directory, text=True)
    assert not status, 'frozen acceptance needs clean source: ' + status
    return status


def run(name, command, timeout=1800, cwd=None):
    report['active'] = name
    write()
    print(name, flush=True)
    start = time.time()
    with (out / (name + '.log')).open('wb') as log:
        result = subprocess.run(command, cwd=cwd or root, env=env, stdout=log,
                                stderr=subprocess.STDOUT, timeout=timeout)
    report['commands'].append(dict(name=name, command=command, exit_code=result.returncode,
                                   seconds=time.time() - start))
    write()
    assert result.returncode == 0, name + ' failed; inspect its log'


try:
    clean(SOURCE)
    if args.cold_clone:
        assert not root.exists(), 'cold clone must not exist'
        run('clone', ['git', 'clone', '--quiet', '--no-hardlinks', '--no-checkout', str(SOURCE), str(root)], cwd=SOURCE)
        run('checkout', ['git', 'checkout', '--quiet', '--detach', head])
        assert not (root / 'target').exists() and not (root / 'web/node_modules').exists()
        report['wallPolicy'] = 'Portability proof; the worker records the full local wall once at this exact head.'
    clean(root)
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip() == head
    run('policy', ['python3', '-B', 'tools/check_task_policy.py'])
    run('format', ['cargo', 'fmt', '--check'])
    run('core-clippy', ['cargo', 'clippy', '--locked', '-p', 'wasm-vm-core', '--tests',
                        '--features', features, '--', '-D', 'warnings'])
    run('native-branches', ['cargo', 'test', '--locked', '-p', 'wasm-vm-core', '--features', features,
                            '--test', 'e9_branch', '--test', 'session_gpu_results', '--', '--nocapture', '--test-threads=1'])
    for label, script in [('gpu-results', 'e9-gpu-results-files.py'), ('pending-gpu', 'e9-pending-gpu-files.py')]:
        run('independent-native-' + label, ['python3', '-B', 'tools/verify/' + script,
                                           '--directory', str(out / 'native')])
    run('storage-publication', ['cargo', 'test', '--locked', '-p', 'wasm-vm-storage',
                                '--test', 'session_publication', '--', '--nocapture'])
    run('core-no-std-wasm', ['cargo', 'build', '--locked', '-p', 'wasm-vm-core', '--no-default-features',
                             '--target', 'wasm32-unknown-unknown', '--features', 'virgl-renderer,trace'])
    run('wasm-clippy', ['cargo', 'clippy', '--locked', '-p', 'wasm-vm-wasm', '--target',
                        'wasm32-unknown-unknown', '--features', 'virgl-renderer', '--', '-D', 'warnings'])
    run('fixture-build', ['bash', 'tools/session-branch-fixture/build.sh', str(out / 'fixture')])
    run('fixture-package', ['python3', '-B', 'tools/session-branch-fixture/package.py',
                            str(out / 'fixture/branch-linux.ext2'), str(out / 'fixture/packaged')])
    assert sha(out / 'fixture/branch-linux.ext2') == '06cdb8c321a35eb6fd703d4994a4f8950d10a0b1608770fc3184f37a2fce8154'
    for file in (out / 'fixture/packaged').iterdir():
        assert file.read_bytes() == (root / 'web/assets/session-branch-linux' / file.name).read_bytes(), 'fixture differs: ' + file.name
    run('gpu-guest-build', ['node', 'tools/virgl-production/session-guest/build.mjs'])
    clean(root)
    # Build before starting any Playwright process: npm ci replaces its modules.
    run('browser-build', ['make', 'web-build'])
    run('branch-formats-and-console', ['node', '--test', 'tools/verify/e9-branch-format.test.mjs',
                                      'tools/verify/e9-timeline-console.test.mjs'])
    report['rebuiltRuntime'] = []
    runtime = ['pkg/wasm_vm_wasm.js', 'pkg/wasm_vm_wasm_bg.wasm', 'session-pkg/wasm_vm_session_bg.wasm',
               'gpu-checkpoint-build.js', 'roadmap.js', 'session-branch-format.js', 'session-branches.js',
               'session-file-sample.js', 'session-gpu-branches.js', 'session-gpu-branch-worker.js',
               'session-gpu-journal.js', 'session-gpu-replay.js', 'session-gpu-replay-worker.js',
               'session-gpu-replay-format.js', 'session-inputs.js', 'session-store.js', 'session-seek.js',
               'session-timeline-runtime.js', 'session-timeline.js', 'session-library.css']
    for name in runtime:
        built, committed = root / 'web' / name, root / 'web/dist' / name
        assert built.read_bytes() == committed.read_bytes(), 'cold build differs from committed dist: ' + name
        report['rebuiltRuntime'].append(dict(path=name, bytes=built.stat().st_size, sha256=sha(built)))
    branch_status = 'verified' if '\nstatus: verified\n' in (root / 'tasks/epic-9-session-time-travel/E9-T20-branch-from-history.md').read_text() else 'in-progress'
    run('built-demo', ['node', 'tools/verify/e9-gpu-results-browser.mjs', '--output', str(out / 'demo'),
                       '--branch-status', branch_status])
    run('linux-file-browser', ['node', 'tools/verify/e9-branch-browser.mjs', '--output', str(out / 'software')])
    run('independent-ext2-files', ['python3', '-B', 'tools/verify/e9-branch-files.py',
                                   '--directory', str(out / 'software'), '--kind', 'software'])
    run('physical-gpu-browser', ['node', 'tools/verify/e9-branch-gpu-browser.mjs', '--output', str(out / 'gpu')])
    run('gpu-input-ownership', ['node', 'tools/verify/e9-branch-input-ownership.mjs',
                                '--source', str(out / 'gpu'), '--output', str(out / 'gpu-input-ownership')])
    run('independent-gpu-disk-counter', ['python3', '-B', 'tools/verify/e9-branch-files.py',
                                         '--directory', str(out / 'gpu'), '--kind', 'gpu'])
    # The broad wall runs once, after the narrow gates that can refute this slice.
    if not args.cold_clone:
        # Keep later regression runs from overwriting the narrow recorded evidence.
        env.pop('E9_BRANCH_EVIDENCE')
        env.pop('E9_GPU_RESULT_EVIDENCE')
        run('local-gauntlet', ['python3', '-B', 'tools/verify/e9-local-gauntlet.py', '--task', 'E9-T20',
                               '--output', str(out / 'gauntlet')], timeout=10800)
    report['finalCheckoutStatus'] = clean(root)
    report['finalHead'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    assert report['finalHead'] == head, 'tested revision changed during acceptance'
    report['status'] = 'passed'
except BaseException as error:
    report['status'] = 'failed'
    report['failure'] = repr(error)
    raise
finally:
    report.pop('active', None)
    report['finished'] = time.time()
    changed = subprocess.check_output(['git', 'diff', '--name-only', '5da17ab16', head], cwd=SOURCE, text=True).splitlines()
    report['sourceRoot'] = str(root)
    report['sources'] = [dict(path=name, sha256=sha(root / name)) for name in changed if (root / name).is_file()]
    report['files'] = [dict(path=str(file.relative_to(out)), bytes=file.stat().st_size, sha256=sha(file))
                       for file in sorted(out.rglob('*')) if file.is_file() and file != out / 'report.json']
    write()
