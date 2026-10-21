#!/usr/bin/env python3
"""Record the medium-risk timeline UI against real Linux replay and independent state oracles."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
env = {k: v for k, v in os.environ.items()
       if k not in ('RUSTFLAGS', 'RUSTDOCFLAGS', 'RUST_LOG') and not k.startswith('CARGO_')}
env['CARGO_TERM_COLOR'] = 'never'
report = {'task': 'E9-T19', 'risk': 'medium', 'status': 'running', 'started': time.time(),
          'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(), 'commands': []}
sources = ['web/session-timeline.js', 'web/session-timeline-runtime.js', 'web/index.html', 'web/main.js',
           'web/session-library.css', 'web/roadmap.js', 'web/README.md', 'web/session-seek.js',
           'web/session-inputs.js', 'web/session-checkpoints.js', 'web/gpu-checkpoint-build.js',
           'tools/verify/e9-timeline-browser.mjs', 'tools/verify/e9-timeline-console.test.mjs',
           'tools/verify/e9-timeline.py', 'Makefile']


def digest(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            h.update(block)
    return h.hexdigest()


def clean():
    assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=ROOT), 'freeze and commit source before recording'


def run(name, command):
    print(name, flush=True)
    start = time.time()
    with (output / (name + '.log')).open('wb') as log:
        result = subprocess.run(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=900)
    report['commands'].append({'name': name, 'command': command, 'seconds': time.time() - start, 'exit_code': result.returncode})
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    assert result.returncode == 0, name + ' failed; inspect the recorded log'


try:
    clean()
    for name in ['session-timeline.js', 'session-timeline-runtime.js', 'main.js', 'roadmap.js', 'session-library.css']:
        assert (ROOT / 'web' / name).read_bytes() == (ROOT / 'web/dist' / name).read_bytes(), 'stale deploy source ' + name
    run('policy', ['python3', 'tools/check_task_policy.py'])
    run('format', ['cargo', 'fmt', '--all', '--check'])
    for name in ['web/session-timeline.js', 'web/session-timeline-runtime.js', 'tools/verify/e9-timeline-browser.mjs']:
        run('syntax-' + Path(name).stem, ['node', '--check', name])
    run('seek-regression', ['cargo', 'test', '-p', 'wasm-vm-core', '--test', 'e9_seek', '--test', 'e9_deterministic_replay'])
    run('target-build', ['make', 'web-build'])
    run('console-controls-regression', ['node', '--test', 'tools/verify/e9-timeline-console.test.mjs'])
    for folder, names in [('pkg', ['wasm_vm_wasm.js', 'wasm_vm_wasm_bg.wasm']),
                          ('session-pkg', ['wasm_vm_session.js', 'wasm_vm_session_bg.wasm'])]:
        for name in names:
            assert (ROOT / 'web' / folder / name).read_bytes() == (ROOT / 'web/dist' / folder / name).read_bytes(), 'stale compiled runtime ' + name
    run('built-browser', ['node', 'tools/verify/e9-timeline-browser.mjs', '--output', str(output / 'browser')])
    browser = json.loads((output / 'browser/report.json').read_text())
    assert browser['status'] == 'passed' and browser['errors'] == [] and not browser['development']
    assert browser['suite'] == {'passed': 127, 'failed': 0}
    clean()
    report['status'] = 'passed'
except BaseException as error:
    report['status'] = 'failed'
    report['failure'] = str(error)
    raise
finally:
    report['source_sha256'] = {name: digest(ROOT / name) for name in sources}
    report['files'] = [{'path': str(file.relative_to(output)), 'bytes': file.stat().st_size, 'sha256': digest(file)}
                       for file in sorted(output.rglob('*')) if file.is_file() and file != output / 'report.json']
    report['finished'] = time.time()
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
