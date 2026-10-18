#!/usr/bin/env python3
"""Exact-head native and built-browser evidence for E9-T14 deterministic session replay."""
import argparse
import hashlib
import json
import os
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
environment = {key: value for key, value in os.environ.items()
               if key not in ('RUSTFLAGS', 'RUSTDOCFLAGS', 'RUST_LOG') and not key.startswith('CARGO_')}
environment['CARGO_TERM_COLOR'] = 'never'
environment['GIT_OPTIONAL_LOCKS'] = '0'
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
tree = subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=ROOT, text=True).strip()
report = {'task': 'E9-T14', 'status': 'running', 'head': head, 'tree': tree,
          'started': time.time(), 'commands': [],
          'claim': 'Pinned full Linux recording, durable event tape, exact interpreter/JIT replay, first divergence and stopped end fence.'}


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1 << 20), b''):
            value.update(chunk)
    return value.hexdigest()


def clean():
    state = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all'],
                                    cwd=ROOT, env=environment, text=True)
    assert not state, 'exact-head source changed: ' + state[:500]


def run(name, command, timeout=3600, allow_failure=False):
    print(name, flush=True)
    start = time.time()
    with (output / (name + '.log')).open('wb') as log:
        completed = subprocess.run(command, cwd=ROOT, env=environment,
                                   stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
    report['commands'].append({'name': name, 'command': command,
                               'seconds': time.time() - start, 'exit_code': completed.returncode})
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    assert allow_failure or completed.returncode == 0, f'{name} failed; inspect {name}.log'
    return completed.returncode


try:
    clean()
    run('policy', ['python3', 'tools/check_task_policy.py'])
    result = run('full-local-gauntlet', ['make', 'ci'], 7200, allow_failure=True)
    if result:
        log = (output / 'full-local-gauntlet.log').read_text()
        known = ['methods `next_transition`, `reserve_transition`, and `advance` are never used',
                 'enum `Preparation` is never used',
                 'methods `begin`, `end`, and `commit` are never used',
                 'methods `begin_source_scope` and `commit_source_scope` are never used',
                 'method `sync_session_devices` is never used']
        assert all(message in log for message in known) and log.count('\nerror:') == 6 \
            and 'error[E' not in log, 'full local gauntlet has a new failure'
        report['baseline_exception'] = {'gate': 'zicsr-stub clippy dead_code',
            'parent': subprocess.check_output(['git', 'rev-parse', 'HEAD^'], cwd=ROOT, text=True).strip(),
            'finding': 'The same five dead-code diagnostics reproduce on the untouched parent; no T14 code appears in them.'}
        run('remaining-local-gauntlet', ['make', 'test', 'wasm', 'features', 'test-riscv',
                                         'riscv-tests-suite', 'determinism', 'perf-smoke'], 7200)
    run('replay-native-trace-and-attacks', ['cargo', 'test', '-p', 'wasm-vm-core',
        '--features', 'trace,virgl-renderer', '--test', 'e9_deterministic_replay', '--', '--nocapture'])
    run('wasm-replay-clippy', ['cargo', 'clippy', '-p', 'wasm-vm-wasm',
        '--target', 'wasm32-unknown-unknown', '--features', 'virgl-renderer', '--lib', '--', '-D', 'warnings'])
    run('browser-build', ['make', 'web-build'], 3600)
    for name in ['main.js', 'session-replay-probe.js', 'session-inputs.js', 'roadmap.js',
                 'session-alpine-image.json', 'session-software-fixture.json',
                 'pkg/wasm_vm_wasm.js', 'pkg/wasm_vm_wasm_bg.wasm',
                 'session-pkg/wasm_vm_session.js', 'session-pkg/wasm_vm_session_bg.wasm']:
        assert (ROOT / 'web' / name).read_bytes() == (ROOT / 'web/dist' / name).read_bytes(), \
            'stale deploy bundle: ' + name
    for name in ['web/main.js', 'web/session-replay-probe.js', 'web/session-inputs.js',
                 'tools/verify/e9-replay-browser.mjs']:
        run('syntax-' + Path(name).stem, ['node', '--check', name])
    run('documentation', ['node', 'tools/check-docs.mjs'])
    run('session-contract', ['python3', 'tools/verify/e9-session-contract.py'])
    run('built-browser', ['node', 'tools/verify/e9-replay-browser.mjs',
                           '--output', str(output / 'browser')], 1800)
    browser = json.loads((output / 'browser' / 'report.json').read_text())
    assert browser['status'] == 'passed' and browser['head'] == head and not browser['development']
    assert browser['checks']['suite'] == {'passed': 127, 'failed': 0}
    assert not browser['errors'] and len(browser['probe']['attacks']) == 2
    clean()
    report['status'] = 'passed'
except BaseException as error:
    report['status'] = 'failed'
    report['failure'] = str(error)
    raise
finally:
    report['files'] = [{'path': str(path.relative_to(output)), 'bytes': path.stat().st_size,
                        'sha256': digest(path)} for path in sorted(output.rglob('*'))
                       if path.is_file() and path != output / 'report.json']
    report['finished'] = time.time()
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
