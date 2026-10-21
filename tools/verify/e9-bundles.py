#!/usr/bin/env python3
"""Record complete local bundle transfers at a clean head, including a fresh-clone mode."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

SOURCE = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--output', required=True, type=Path)
p.add_argument('--cold-clone', type=Path)
a = p.parse_args()
out = a.output.resolve()
out.mkdir(parents=True, exist_ok=False)
root = a.cold_clone.resolve() if a.cold_clone else SOURCE
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=SOURCE, text=True).strip()
env = {key: value for key, value in os.environ.items()
       if key not in ('RUSTFLAGS', 'RUSTDOCFLAGS', 'RUST_LOG') and not key.startswith('CARGO_')}
env.update(CARGO_TERM_COLOR='never', CARGO_INCREMENTAL='0', CARGO_BUILD_JOBS='4')
if a.cold_clone:
    env.update(CARGO_PROFILE_DEV_DEBUG='0', CARGO_PROFILE_TEST_DEBUG='0')
report = dict(task='E9-T21', risk='high', status='running', head=head, commands=[], started=time.time(),
              clone=str(root) if a.cold_clone else None,
              scope='Finished exact software/GPU bundles, complete local closure, fresh profiles and last-transaction publication; no new desktop/performance qualification.')


def sha(file):
    digest = hashlib.sha256()
    with file.open('rb') as source:
        for block in iter(lambda: source.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def write():
    (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')


def clean(directory):
    status = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=directory, text=True)
    assert not status, 'clean frozen acceptance required: ' + status
    return status


def run(name, command, timeout=1800, cwd=None):
    report['active'] = name
    write()
    print(name, flush=True)
    started = time.time()
    with (out / (name + '.log')).open('wb') as log:
        result = subprocess.run(command, cwd=cwd or root, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
    report['commands'].append(dict(name=name, command=command, exit_code=result.returncode, seconds=time.time() - started))
    write()
    assert result.returncode == 0, name + ' failed; inspect its log'


try:
    clean(SOURCE)
    if a.cold_clone:
        assert not root.exists(), 'cold clone destination must not exist'
        run('clone', ['git', 'clone', '--quiet', '--no-hardlinks', '--no-checkout', str(SOURCE), str(root)], cwd=SOURCE)
        run('checkout', ['git', 'checkout', '--quiet', '--detach', head])
        assert not (root / 'target').exists() and not (root / 'web/node_modules').exists()
        report['wallPolicy'] = 'Fresh portability proof; full local wall executes directly once in the primary submission.'
    clean(root)
    run('policy', ['python3', '-B', 'tools/check_task_policy.py'])
    run('format', ['cargo', 'fmt', '--check'])
    run('storage-clippy', ['cargo', 'clippy', '--locked', '-p', 'wasm-vm-storage', '--all-targets', '--', '-D', 'warnings'])
    run('storage-manifest-publication', ['cargo', 'test', '--locked', '-p', 'wasm-vm-storage', '--test', 'session_manifest',
                                        '--test', 'session_manifest_critic', '--test', 'session_publication', '--test', 'disk_root', '--', '--nocapture'])
    run('wasm-clippy', ['cargo', 'clippy', '--locked', '-p', 'wasm-vm-wasm', '--target', 'wasm32-unknown-unknown',
                        '--features', 'virgl-renderer', '--', '-D', 'warnings'])
    # Dependency installation must finish before any browser loads Playwright modules.
    run('browser-build', ['make', 'web-build'])
    run('bundle-format-witness-unit', ['node', '--test', 'tools/verify/e9-bundle-format.test.mjs',
                                      'tools/verify/e9-session-witnesses.test.mjs', 'tools/verify/e9-timeline-console.test.mjs'])
    run('docs', ['node', 'tools/check-docs.mjs'])
    runtime = ['pkg/wasm_vm_wasm.js', 'pkg/wasm_vm_wasm_bg.wasm', 'session-pkg/wasm_vm_session_bg.wasm',
               'gpu-checkpoint-build.js', 'roadmap.js', 'session-bundle-format.js', 'session-bundles.js', 'session-witnesses.js',
               'session-store.js', 'session-timeline.js', 'session-branches.js', 'session-gpu-branches.js', 'session-gpu-branch-worker.js',
               'session-library.css']
    report['rebuiltRuntime'] = []
    for name in runtime:
        source, dist = root / 'web' / name, root / 'web/dist' / name
        assert source.read_bytes() == dist.read_bytes(), 'rebuilt runtime differs from committed dist: ' + name
        report['rebuiltRuntime'].append(dict(path=name, bytes=source.stat().st_size, sha256=sha(source)))
    status = 'verified' if '\nstatus: verified\n' in (root / 'tasks/epic-9-session-time-travel/E9-T21-session-export-import.md').read_text() else 'in-progress'
    run('built-demo', ['node', 'tools/verify/e9-gpu-results-browser.mjs', '--output', str(out / 'demo'),
                       '--branch-status', 'verified', '--bundle-status', status])
    run('real-linux-source-and-GC', ['node', 'tools/verify/e9-branch-browser.mjs', '--output', str(out / 'software'), '--include-deltas'])
    run('independent-Linux-files', ['python3', '-B', 'tools/verify/e9-branch-files.py', '--directory', str(out / 'software'), '--kind', 'software'])
    run('physical-GPU-source-and-GC', ['node', 'tools/verify/e9-branch-gpu-browser.mjs', '--output', str(out / 'gpu')])
    run('independent-GPU-files-counter', ['python3', '-B', 'tools/verify/e9-branch-files.py', '--directory', str(out / 'gpu'), '--kind', 'gpu'])
    run('permanent-owned-input-race', ['node', 'tools/verify/e9-branch-input-ownership.mjs', '--source', str(out / 'gpu'), '--output', str(out / 'owned-input')])
    run('fresh-profile-UI-bundles', ['node', 'tools/verify/e9-bundle-browser.mjs', '--software', str(out / 'software'),
                                    '--gpu', str(out / 'gpu'), '--output', str(out / 'bundles')], timeout=3600)
    run('independent-archive-closure-state', ['python3', '-B', 'tools/verify/e9-bundle-files.py', '--directory', str(out / 'bundles')])
    if not a.cold_clone:
        run('local-gauntlet', ['python3', '-B', 'tools/verify/e9-local-gauntlet.py', '--task', 'E9-T21', '--output', str(out / 'gauntlet')], timeout=10800)
    report['finalCheckoutStatus'] = clean(root)
    report['finalHead'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    assert report['finalHead'] == head, 'revision changed during acceptance'
    report['status'] = 'passed'
except BaseException as error:
    report['status'] = 'failed'
    report['failure'] = repr(error)
    raise
finally:
    report.pop('active', None)
    report['finished'] = time.time()
    changed = subprocess.check_output(['git', 'diff', '--name-only', 'c72ebf38a', head], cwd=SOURCE, text=True).splitlines()
    report['sourceRoot'] = str(root)
    report['sources'] = [dict(path=name, sha256=sha(root / name)) for name in changed if (root / name).is_file()]
    report['files'] = [dict(path=str(file.relative_to(out)), bytes=file.stat().st_size, sha256=sha(file))
                       for file in sorted(out.rglob('*')) if file.is_file() and file != out / 'report.json']
    write()
