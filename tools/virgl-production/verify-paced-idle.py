#!/usr/bin/env python3
"""Record the opt-in native/Wasm paced-idle boundary at one frozen head."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

repo = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=repo)
env = {key: value for key, value in os.environ.items()
       if key not in ('RUSTFLAGS', 'RUST_LOG') and not key.startswith(('CARGO_', 'VIRGL_', 'CRITIC_'))}
report = {'task': 'E6-T11d73', 'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip(),
          'scope': 'Explicit clock primitive only; production selection, stock input and deployment remain unproved',
          'status': 'running', 'commands': [], 'started': time.time()}


def run(name, command, timeout=1800):
    print(name, flush=True)
    started = time.time()
    with (output/(name+'.stdout')).open('wb') as stdout, (output/(name+'.stderr')).open('wb') as stderr:
        result = subprocess.run(command, cwd=repo, env=env, stdout=stdout, stderr=stderr, timeout=timeout)
    report['commands'].append({'name': name, 'command': command, 'seconds': time.time()-started,
                               'exitCode': result.returncode})
    (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    assert result.returncode == 0, name+' failed; inspect recorded output'


try:
    run('policy', ['python3', 'tools/check_task_policy.py'])
    run('format', ['cargo', 'fmt', '--all', '--check'])
    run('core-clippy', ['cargo', 'clippy', '-p', 'wasm-vm-core', '--tests', '--features',
                        'virgl-renderer,virgl-control-proof,gpu-trace,trace', '--', '-D', 'warnings'])
    run('core-unit', ['cargo', 'test', '-p', 'wasm-vm-core', '--lib', '--features',
                      'virgl-renderer,virgl-control-proof,gpu-trace,trace'])
    run('native-clock', ['cargo', 'test', '-p', 'wasm-vm-core', '--features', 'virgl-renderer,trace',
                         '--test', 'paced_idle_clock', '--test', 'guest_clock', '--test', 'clock_advance',
                         '--test', 'icount_divider', '--test', 'production_keyboard_host_wait',
                         '--test', 'production_keyboard_wfi_critic', '--', '--nocapture', '--test-threads=1'])
    run('wasm-clippy', ['cargo', 'clippy', '-p', 'wasm-vm-wasm', '--target', 'wasm32-unknown-unknown',
                        '--features', 'virgl-renderer', '--', '-D', 'warnings'])
    run('no-std-wasm', ['cargo', 'build', '-p', 'wasm-vm-core', '--no-default-features', '--target', 'wasm32-unknown-unknown'])
    run('stub-build', ['cargo', 'check', '-p', 'wasm-vm-core', '--features', 'zicsr-stub'])
    run('native-adapter', ['cargo', 'test', '-p', 'wasm-vm-wasm', '--lib', 'guest_clock_tests', '--', '--nocapture'])
    run('wasm-adapter', ['wasm-pack', 'test', '--node', 'crates/wasm', '--lib', '--', 'guest_clock_tests', '--nocapture'])
    run('wasm-clock', ['wasm-pack', 'test', '--node', 'crates/wasm', '--test', 'guest_clock',
                       '--test', 'paced_idle_clock', '--test', 'clock_advance', '--', '--nocapture'])
    run('browser-clock', ['node', 'tools/virgl-production/paced-clock-browser.mjs', '--output', str(output/'browser-clock')])
    run('default', ['node', 'tools/verify-virgl-default-demo.mjs', '--output', str(output/'default'), '--task', 'E6-T11d73'])
    report['status'] = 'passed'
except BaseException as error:
    report['status'] = 'failed'
    report['failure'] = str(error)
    raise
finally:
    report['finished'] = time.time()
    report['files'] = [{'path': str(file.relative_to(output)), 'bytes': file.stat().st_size,
                        'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}
                       for file in sorted(output.rglob('*')) if file.is_file() and file != output/'report.json']
    (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
