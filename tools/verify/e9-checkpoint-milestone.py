#!/usr/bin/env python3
"""Record the medium-risk two-guest saved-checkpoint milestone at a frozen source head."""
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
env = {k: v for k, v in os.environ.items() if k not in ('RUSTFLAGS', 'RUSTDOCFLAGS', 'RUST_LOG') and not k.startswith('CARGO_')}
report = {'task': 'E9-T08', 'status': 'running', 'started': time.time(), 'commands': [],
          'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
          'scope': 'Recorded two-fresh-guest reload integration and unified docs over unchanged T05/T06/T07 runtime; no continuous replay claim'}
sources = ['web/session-library.js','web/session-library.css','web/main.js','web/index.html','web/roadmap.js',
           'web/session-checkpoints.js','web/session-store.js','web/session-disk-roots.js','web/loader.js',
           'web/gpu-checkpoint-build.js','web/docs-source/guides/storage.md',
           'tools/verify/e9-checkpoint-milestone.py','tools/verify/e9-checkpoint-milestone-browser.mjs',
           'tools/verify/e9-checkpoint-milestone-files.py','tools/verify/e9-disk-roots-files.py',
           'tools/verify/e9-checkpoint-metadata-critic.mjs',
           'Makefile','web/package.json','web/package-lock.json','tools/build-web-dist.sh']


def sha(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for part in iter(lambda: stream.read(1 << 20), b''):
            digest.update(part)
    return digest.hexdigest()


def clean():
    assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=ROOT), 'source must be clean'


def run(name, command):
    print(name, flush=True)
    started = time.time()
    with (output / (name + '.log')).open('wb') as log:
        result = subprocess.run(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=2400)
    report['commands'].append({'name': name, 'command': command, 'seconds': time.time() - started, 'exit_code': result.returncode})
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    assert result.returncode == 0, name + ' failed'


try:
    clean()
    for name in ['session-library.js', 'session-library.css', 'main.js', 'roadmap.js']:
        assert (ROOT / 'web' / name).read_bytes() == (ROOT / 'web/dist' / name).read_bytes(), 'stale dist: ' + name
    run('policy', ['python3', 'tools/check_task_policy.py'])
    run('driver-syntax', ['node','--check','tools/verify/e9-checkpoint-milestone-browser.mjs'])
    run('critic-syntax', ['node','--check','tools/verify/e9-checkpoint-metadata-critic.mjs'])
    run('oracle-syntax', ['python3','-B','-c',"from pathlib import Path; compile(Path('tools/verify/e9-checkpoint-milestone-files.py').read_bytes(),'milestone-files','exec')"])
    run('worker-protocol', ['node','--test','web/tests/e4-t32-worker-protocol.test.mjs'])
    run('browser-build', ['make','web-build'])
    run('documentation', ['node','tools/check-docs.mjs'])
    run('contract', ['python3','tools/verify/e9-session-contract.py'])
    run('retained-gpu', ['python3','tools/verify/e9-retained-gpu-runtime.py'])
    run('browser', ['node','tools/verify/e9-checkpoint-milestone-browser.mjs','--output',str(output/'browser')])
    browser=json.loads((output/'browser/report.json').read_text())
    assert browser['head']==report['head'] and browser['status']=='passed' and not browser['development'] and browser['errors']==[]
    assert browser['checks']['suite']=={'passed':127,'failed':0}
    assert json.loads((output/'browser/milestone-oracle.json').read_text())['status']=='passed'
    run('metadata-critic', ['node','tools/verify/e9-checkpoint-metadata-critic.mjs',
                          '--evidence',str(output/'browser'),'--output',str(output/'metadata-critic')])
    critic=json.loads((output/'metadata-critic/report.json').read_text())
    assert critic['status']=='passed' and critic['errors']==[] and critic['head']==report['head']
    assert critic['original_report_sha256']==sha(output/'browser/report.json')
    assert critic['expectedHash']==browser['checks']['beta']['frameHash']
    clean()
    report['status'] = 'passed'
except BaseException as error:
    report['status'] = 'failed'
    report['failure'] = str(error)
    raise
finally:
    report['source_sha256'] = {name: sha(ROOT / name) for name in sources}
    report['files'] = [{'path': str(p.relative_to(output)), 'bytes': p.stat().st_size, 'sha256': sha(p)}
                       for p in sorted(output.rglob('*')) if p.is_file() and p != output / 'report.json']
    report['finished'] = time.time()
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
