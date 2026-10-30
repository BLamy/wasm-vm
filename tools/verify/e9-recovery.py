#!/usr/bin/env python3
"""Bounded recovery integration: codecs, durable cuts, Linux branches and physical GPU faults."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

if sys.flags.optimize:
    raise RuntimeError('recovery assertions require the normal Python interpreter')

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
environment = {key: value for key, value in os.environ.items()
               if not key.startswith('CARGO_') and key not in
               ('RUSTFLAGS', 'RUSTDOCFLAGS', 'RUST_LOG', 'RUSTC_WRAPPER',
                'RUSTC_WORKSPACE_WRAPPER', 'RUSTC_BOOTSTRAP', 'NODE_OPTIONS',
                'NODE_PATH', 'PYTHONOPTIMIZE', 'PYTHONPATH', 'PYTHONSTARTUP')}
environment.update(CARGO_BUILD_JOBS='4', CARGO_INCREMENTAL='0', CARGO_TERM_COLOR='never',
                   E9_GPU_RESULT_EVIDENCE=str(output / 'native'),
                   E9_BRANCH_EVIDENCE=str(output / 'native'))

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, env=environment, text=True).strip()

def sha(file):
    digest = hashlib.sha256()
    with file.open('rb') as source:
        for block in iter(lambda: source.read(1048576), b''):
            digest.update(block)
    return digest.hexdigest()

report = dict(task='E9-T23', risk='high', status='running', head=git('rev-parse', 'HEAD'),
              started=time.time(), commands=[], evidence=[],
              recordedHarness={name: sha(ROOT / name) for name in
                  ['tools/verify/e9-recovery.py', 'tools/verify/e9-recovery-codecs.mjs',
                   'tools/verify/e9-recovery-browser.mjs', 'tools/verify/e9-session-retention-storage.mjs']},
              scope='Bounded storage/codec/branch/GPU recovery; no long original cold boot or performance claim',
              userWaiver='evidence/e9-t22u-user-waiver-20261028/receipt.json')

def save():
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')

def run(name, command, timeout=600):
    report['active'] = name
    save()
    print(name, flush=True)
    began = time.time()
    with (output / (name + '.log')).open('wb') as log:
        process = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=log,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = process.wait(timeout=timeout)
        except BaseException:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
            raise
    report['commands'].append(dict(name=name, command=command, exitCode=code,
                                   seconds=time.time() - began, logSha256=sha(output / (name + '.log'))))
    save()
    assert code == 0, name + ' failed; inspect preserved log'

def evidence(name):
    file = output / name / 'report.json'
    result = json.loads(file.read_text())
    assert result['status'] == 'passed', name + ' did not pass'
    assert result['head'] == report['head'], name + ' wrong source head'
    assert not result.get('dirty', ''), name + ' source was dirty'
    report['evidence'].append(dict(name=name, path=str(file), sha256=sha(file)))
    return result

try:
    assert not git('status', '--porcelain', '--untracked-files=all'), 'freeze source before acceptance'
    run('task-policy', ['python3', '-B', 'tools/check_task_policy.py'])
    run('format', ['cargo', 'fmt', '--all', '--check'])
    run('storage-clippy', ['cargo', 'clippy', '--locked', '-p', 'wasm-vm-storage',
                          '--all-targets', '--', '-D', 'warnings'])
    run('storage-tests', ['cargo', 'test', '--locked', '-p', 'wasm-vm-storage',
                         '--test', 'session_manifest', '--test', 'session_manifest_critic',
                         '--test', 'session_local', '--test', 'session_publication',
                         '--test', 'session_witness', '--', '--nocapture'])
    run('native-gpu-branches', ['cargo', 'test', '--locked', '-p', 'wasm-vm-core',
         '--features', 'virgl-renderer,virgl-control-proof,gpu-trace,trace',
         '--test', 'e9_branch', '--test', 'session_gpu_results', '--', '--nocapture', '--test-threads=1'])
    for label, script in [('gpu-results', 'e9-gpu-results-files.py'), ('pending-gpu', 'e9-pending-gpu-files.py')]:
        run('native-byte-oracle-' + label, ['python3', '-B', 'tools/verify/' + script,
                                         '--directory', str(output / 'native')])
    run('wasm-metadata', ['cargo', 'build', '--locked', '-p', 'wasm-vm-session-web',
                          '--target', 'wasm32-unknown-unknown'])
    run('codecs', ['node', '--max-old-space-size=128', 'tools/verify/e9-recovery-codecs.mjs',
                   '--output', str(output / 'codecs')], timeout=60)
    codecs = evidence('codecs')
    assert codecs['mutations'] >= 10000 and codecs['cases'] >= 12000
    run('durable-recovery', ['node', 'tools/verify/e9-recovery-browser.mjs',
                             '--output', str(output / 'durable-recovery')], timeout=300)
    durable = evidence('durable-recovery')
    assert len(durable['crashes']) == 15 and len(durable['rows']) == 3
    assert all(len(row['schedules']) == 16 and len(row['garbageCollection']) == 2
               for row in durable['rows'])
    run('linux-branches', ['node', 'tools/verify/e9-branch-browser.mjs', '--include-deltas',
                           '--output', str(output / 'linux-branches')], timeout=600)
    linux = evidence('linux-branches')
    assert len(linux['publicationCancellation']) == 2
    run('linux-byte-oracle', ['python3', '-B', 'tools/verify/e9-branch-files.py',
                              '--directory', str(output / 'linux-branches'), '--kind', 'software'])
    run('gpu-recovery', ['node', 'tools/verify/e9-gpu-replay-browser.mjs',
                         '--output', str(output / 'gpu-recovery')], timeout=600)
    gpu = evidence('gpu-recovery')
    assert gpu['contextLoss']['status'] == 'passed'
    assert gpu['attacks']['cancellation'] and gpu['attacks']['refusals']
    run('gpu-byte-oracle', ['python3', '-B', 'tools/verify/e9-gpu-replay-files.py',
                            '--directory', str(output / 'gpu-recovery')])
    run('gpu-branches', ['node', 'tools/verify/e9-branch-gpu-browser.mjs',
                         '--output', str(output / 'gpu-branches')], timeout=600)
    branches = evidence('gpu-branches')
    assert any(row['kind'] == 'context-loss' and row['lost'] for row in branches['attacks'])
    run('gpu-branch-byte-oracle', ['python3', '-B', 'tools/verify/e9-branch-files.py',
                                   '--directory', str(output / 'gpu-branches'), '--kind', 'gpu'])
    assert git('rev-parse', 'HEAD') == report['head'] and not git('status', '--porcelain')
    report['status'] = 'passed'
except BaseException as error:
    report.update(status='failed', failure=str(error))
finally:
    report['finished'] = time.time()
    save()
    print(json.dumps(dict(status=report['status'], output=str(output), failure=report.get('failure'))), flush=True)
sys.exit(0 if report['status'] == 'passed' else 1)
