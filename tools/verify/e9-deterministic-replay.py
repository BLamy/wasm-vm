#!/usr/bin/env python3
"""Exact-head native and built-browser evidence for E9-T14 deterministic session replay."""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASELINE_HEAD = 'c52ab64ba390f13b82190aea4977df08c8f91616'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
environment = {key: value for key, value in os.environ.items()
               if key not in ('RUSTFLAGS', 'RUSTDOCFLAGS', 'RUST_LOG') and not key.startswith('CARGO_')}
environment['CARGO_TERM_COLOR'] = 'never'
environment['CARGO_INCREMENTAL'] = '0'
environment['CARGO_BUILD_JOBS'] = '2'
environment['GIT_OPTIONAL_LOCKS'] = '0'
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
tree = subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=ROOT, text=True).strip()
report = {'task': 'E9-T14', 'status': 'running', 'head': head, 'tree': tree,
          'started': time.time(), 'commands': [],
          'build_environment': {'CARGO_INCREMENTAL': '0', 'CARGO_BUILD_JOBS': '2'},
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


def prune_generated_build_cache(relative):
    target = (ROOT / 'target').resolve()
    path = target / relative
    if path.is_dir():
        assert path.name == 'debug' and path.resolve().is_relative_to(target), 'build cache path'
        shutil.rmtree(path)
        report.setdefault('cache_prunes', []).append(str(path))


def carry_previous_native(directory):
    previous = Path(directory).resolve()
    old = json.loads((previous / 'report.json').read_text())
    changed = subprocess.check_output(['git', 'diff', '--name-only', old['head'], head],
                                      cwd=ROOT, text=True).splitlines()
    assert old['task'] == 'E9-T14' and changed == ['tools/verify/e9-deterministic-replay.py'], \
        'carried proof must differ only in its recording script'
    shutil.copy2(previous / 'full-local-gauntlet.log', output / 'carried-full-local-gauntlet.log')
    shutil.copy2(previous / 'remaining-local-gauntlet.log', output / 'carried-native-workspace.log')
    native = (output / 'carried-native-workspace.log').read_text()
    assert 'no-host-float: OK' in native and 'determinism-hazards: production core' in native \
        and 'wasm-pack build crates/wasm --target web' in native, 'native gate did not complete before wasm'
    report['carried_native'] = {'head': old['head'], 'tree': old['tree'], 'source': str(previous),
        'log_sha256': digest(output / 'carried-native-workspace.log'), 'runtime_diff': changed}
    return (output / 'carried-full-local-gauntlet.log').read_text()


def carry_previous_wasm(metadata):
    record = json.loads(Path(metadata).read_text())
    changed = subprocess.check_output(['git', 'diff', '--name-only', record['head'], head],
                                      cwd=ROOT, text=True).splitlines()
    assert record['exit_code'] == 0 and changed == ['tools/verify/e9-deterministic-replay.py'], \
        'carried wasm proof must differ only in its recording script'
    source = Path(record['log']).resolve()
    assert digest(source) == record['sha256'] and 'test result: ok.' in source.read_text(), 'wasm proof log'
    shutil.copy2(source, output / 'carried-wasm-workspace.log')
    report['carried_wasm'] = {'head': record['head'], 'log_sha256': record['sha256'],
                              'runtime_diff': changed}


try:
    clean()
    # The scratch volume is bounded. Native and wasm debug test binaries are independent;
    # discard only generated build artifacts between those evidence stages.
    prune_generated_build_cache(Path('wasm32-unknown-unknown/debug'))
    run('policy', ['python3', 'tools/check_task_policy.py'])
    carried_native = os.environ.get('E9_REPLAY_CARRY_NATIVE')
    if carried_native:
        result = 1
        log = carry_previous_native(carried_native)
    else:
        result = run('full-local-gauntlet', ['make', 'ci'], 7200, allow_failure=True)
        log = (output / 'full-local-gauntlet.log').read_text() if result else ''
    if result:
        known = ['methods `next_transition`, `reserve_transition`, and `advance` are never used',
                 'enum `Preparation` is never used',
                 'methods `begin`, `end`, and `commit` are never used',
                 'methods `begin_source_scope` and `commit_source_scope` are never used',
                 'method `sync_session_devices` is never used']
        assert all(message in log for message in known) and log.count('\nerror:') == 6 \
            and 'error[E' not in log, 'full local gauntlet has a new failure'
        report['baseline_exception'] = {'gate': 'zicsr-stub clippy dead_code',
            'parent': BASELINE_HEAD,
            'finding': 'The same five dead-code diagnostics reproduce on the untouched parent; no T14 code appears in them.'}
        if not carried_native:
            run('native-workspace', ['make', 'test'], 7200)
    run('native-riscv-regression', ['make', 'riscv-tests-suite'], 3600)
    run('replay-native-trace-and-attacks', ['cargo', 'test', '-p', 'wasm-vm-core',
        '--features', 'trace,virgl-renderer', '--test', 'e9_deterministic_replay', '--', '--nocapture'])
    prune_generated_build_cache(Path('debug'))
    run('native-performance-smoke', ['make', 'perf-smoke'], 3600)
    carried_wasm = os.environ.get('E9_REPLAY_CARRY_WASM')
    if carried_wasm:
        carry_previous_wasm(carried_wasm)
    else:
        run('wasm-workspace', ['make', 'wasm'], 7200)
    run('remaining-cross-target', ['make', 'features', 'test-riscv', 'determinism'], 7200)
    prune_generated_build_cache(Path('wasm32-unknown-unknown/debug'))
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
