#!/usr/bin/env python3
"""Repair only the input object-oracle proof gap; authenticate every carried artifact first."""
import argparse
import ast
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--recorded', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
base, out = a.recorded.resolve(), a.output.resolve()
assert base != out and base not in out.parents and out not in base.parents, 'overlapping evidence paths'
env = {k: v for k, v in os.environ.items() if k not in ('RUSTFLAGS', 'RUSTDOCFLAGS', 'RUST_LOG') and not k.startswith('CARGO_')}
env.update(GIT_OPTIONAL_LOCKS='0', CARGO_TERM_COLOR='never')

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, env=env)

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()

assert not git('status', '--porcelain', '--untracked-files=all'), 'source must be clean'
old = json.loads((base / 'report.json').read_bytes())
assert old['task'] == 'E9-T10' and old['status'] == 'failed'
assert re.fullmatch(r'[0-9a-f]{40}', old['head']), 'invalid recorded head'
frozen_runner = ast.parse(git('show', old['head'] + ':tools/verify/e9-input-recording.py').decode())
frozen_sources = next(ast.literal_eval(node.value) for node in frozen_runner.body if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'sources' for t in node.targets))
assert set(old['source_sha256']) == set(frozen_sources), 'recorded source inventory mismatch'
expected = ['policy', 'format', 'native-clippy', 'core-native', 'execution-and-device-native',
            'jit-native', 'boundary-native', 'storage-native', 'native-guest-oracle',
            'core-no-std-wasm', 'boundary-default-wasm', 'boundary-wasm-clippy', 'browser-build',
            'syntax-loader', 'syntax-session-inputs', 'syntax-input-recording-probe',
            'syntax-session-library', 'syntax-e9-input-recording-browser', 'input-and-worker-protocol',
            'documentation', 'contract', 'retained-gpu-integrity', 'browser', 'browser-object-oracle']
assert [c['name'] for c in old['commands']] == expected, 'unexpected prior gate sequence'
assert all(c['exit_code'] == 0 for c in old['commands'][:-1]) and old['commands'][-1]['exit_code'] != 0
head = git('rev-parse', 'HEAD').decode().strip()
allowed = {'Makefile', 'tools/verify/e9-input-recording-browser-files.py',
           'tools/verify/e9-input-recording-resume.py',
           'tools/verify/tests/test_e9_input_recording_resume.py', 'tasks/QUEUE.md',
           'tasks/epic-9-session-time-travel/E9-T10-user-input-recording.md'}
changed = set(git('diff', '--name-only', old['head'], head).decode().splitlines())
assert changed <= allowed, 'runtime/dependency boundary changed: ' + str(changed - allowed)
for name, digest in old['source_sha256'].items():
    assert hashlib.sha256(git('show', old['head'] + ':' + name)).hexdigest() == digest, 'recorded source identity mismatch: ' + name
    if name not in allowed:
        assert sha(ROOT / name) == digest, 'current source identity mismatch: ' + name
paths = {entry['path'] for entry in old['files']}
assert {name + '.log' for name in expected} | {'browser/report.json', 'native/input-oracle.json'} <= paths, 'incomplete original inventory'
for entry in old['files']:
    relative = Path(entry['path'])
    assert not relative.is_absolute() and '..' not in relative.parts, 'unsafe artifact path'
    path = base / relative
    assert path.resolve().is_relative_to(base), 'artifact escapes recording'
    assert path.stat().st_size == entry['bytes'] and sha(path) == entry['sha256'], 'recording digest mismatch: ' + str(relative)
actual_paths = {str(f.relative_to(base)) for f in base.rglob('*') if f.is_file()}
assert actual_paths - paths <= {'report.json', 'browser/input-prefix-oracle.json'}, 'unlisted carried material'
browser = json.loads((base / 'browser/report.json').read_bytes())
assert browser['status'] == 'passed' and browser['head'] == old['head'] and not browser['development'] and browser['errors'] == []
out.mkdir(parents=True, exist_ok=False)
# APFS clones remain independent files; no original recording or profile is reopened or edited.
for path in base.iterdir():
    if path.name != 'report.json':
        subprocess.run(['cp', '-cR', str(path), str(out / path.name)], check=True)
(out / 'carried-report.json').write_bytes((base / 'report.json').read_bytes())
report = {'task': 'E9-T10', 'status': 'running', 'head': head, 'runtime_head': old['head'],
          'started': time.time(), 'scope': 'Unchanged runtime proof carried by authenticated artifacts; corrected object oracle and unrun remainder executed at this head.',
          'carried_from': {'directory': str(base), 'report_sha256': sha(base / 'report.json'), 'allowed_harness_delta': sorted(changed)},
          'commands': [{**c, 'execution_head': old['head'], 'carried': True} for c in old['commands'][:-1] if c['name'] not in ('policy', 'native-guest-oracle')]}

def run(name, command, timeout=1200):
    print(name, flush=True)
    started = time.time()
    with (out / (name + '.log')).open('wb') as log:
        result = subprocess.run(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
    report['commands'].append({'name': name, 'command': command, 'seconds': time.time() - started,
                               'exit_code': result.returncode, 'execution_head': head, 'carried': False})
    assert result.returncode == 0, name + ' failed'

try:
    run('policy', ['python3', 'tools/check_task_policy.py'])
    run('proof-reuse-safety', ['python3', '-B', 'tools/verify/tests/test_e9_input_recording_resume.py', '--recorded', str(base), '--output', str(out / 'reuse-safety.json')])
    run('native-guest-oracle', ['python3', '-B', 'tools/verify/e9-input-recording-files.py', '--directory', str(out / 'native')])
    run('browser-object-oracle', ['python3', '-B', 'tools/verify/e9-input-recording-browser-files.py', '--directory', str(out / 'browser')])
    run('browser-clock-oracle', ['python3', '-B', 'tools/verify/e9-event-clock-files.py', '--directory', str(out / 'browser/event-clock-regression')])
    run('retained-gpu-browser', ['node', 'tools/verify/e9-retained-gpu-browser.mjs', '--output', str(out / 'retained-gpu-browser')])
    gpu = json.loads((out / 'retained-gpu-browser/report.json').read_bytes())
    assert gpu['status'] == 'passed' and gpu['head'] == head and not gpu['development'] and gpu['errors'] == []
    assert not git('status', '--porcelain', '--untracked-files=all')
    report['status'] = 'passed'
except BaseException as error:
    report['status'], report['failure'] = 'failed', str(error)
    raise
finally:
    report['source_sha256'] = {name: sha(ROOT / name) for name in old['source_sha256']}
    report['source_sha256']['tools/verify/e9-input-recording-resume.py'] = sha(Path(__file__))
    report['source_sha256']['tools/verify/tests/test_e9_input_recording_resume.py'] = sha(ROOT / 'tools/verify/tests/test_e9_input_recording_resume.py')
    report['files'] = [{'path': str(f.relative_to(out)), 'bytes': f.stat().st_size, 'sha256': sha(f)}
                       for f in sorted(out.rglob('*')) if f.is_file() and f != out / 'report.json']
    report['finished'] = time.time()
    (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
