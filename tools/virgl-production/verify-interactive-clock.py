#!/usr/bin/env python3
"""Record explicit interactive time and the unchanged original desktop acceptance."""
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
report = {'task': 'E6-T11d72', 'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip(),
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
    run('clock-protocol', ['node', '--test', 'web/tests/virgl-interactive-clock.test.mjs',
                         'web/tests/e6-t11d72-interactive-clock-critic.test.mjs',
                         'web/tests/e5-t26i-guest-clock.test.mjs', 'web/tests/e5-t26j-icount-divider.test.mjs',
                         'web/tests/e4-t32-worker-protocol.test.mjs',
                         'tools/virgl-production/critic-fast-boots-protocol.test.mjs',
                         'tools/virgl-production/critic-fast-boots-final.test.mjs'])
    run('native-clock', ['cargo', 'test', '-p', 'wasm-vm-core', '--features', 'virgl-renderer,trace',
                         '--test', 'guest_clock', '--test', 'production_keyboard_host_wait',
                         '--test', 'production_keyboard_wfi_critic', '--', '--nocapture'])
    run('wasm-adapter', ['cargo', 'test', '-p', 'wasm-vm-wasm', '--lib', 'guest_clock_tests', '--', '--nocapture'])
    run('wasm-clock', ['wasm-pack', 'test', '--node', 'crates/wasm', '--lib', '--test', 'guest_clock',
                      '--', 'guest_clock', '--nocapture'])
    run('production', ['python3', 'tools/virgl-production/verify.py', '--task', 'E6-T11d',
                       '--output', str(output/'production')], 4200)
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
