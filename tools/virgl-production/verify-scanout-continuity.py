#!/usr/bin/env python3
"""Record scanout continuity through the original worker and physical browser."""
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
assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=repo), 'freeze tracked source'
env = {key: value for key, value in os.environ.items()
       if key not in ('RUSTFLAGS', 'RUSTDOCFLAGS', 'RUST_LOG')
       and not key.startswith(('CARGO_', 'VIRGL_', 'CRITIC_'))}
report = {'task': 'E6-T11d74d1', 'status': 'running', 'commands': [], 'started': time.time(),
          'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip(),
          'scope': 'Original native/MMIO supervisor and production worker, no Linux/Mesa publication claim',
          'carried': {'nativeAndDma': 'E6-T11d74c independently verified at baf3d1035eec4e184eb2704bc52c2ce17066b1ed; unchanged native/storage/loader/gpu-pair boundaries',
                      'recordingSha256': '353bf7155806c99f89d083a32822aaae41f50daae0f70946be9f6457ce9913a1'}}


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def run(name, command, timeout=1800, extra=None, expected=0):
    print(name, flush=True)
    started = time.time()
    with (output/(name+'.stdout')).open('wb') as stdout, (output/(name+'.stderr')).open('wb') as stderr:
        result = subprocess.run(command, cwd=repo, env=dict(env, **(extra or {})),
                                stdout=stdout, stderr=stderr, timeout=timeout)
    report['commands'].append({'name': name, 'command': command, 'seconds': time.time()-started,
                               'exitCode': result.returncode, 'expectedExitCode': expected})
    (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    assert result.returncode == expected, name+' failed; inspect recorded output'


try:
    run('policy', ['python3', 'tools/check_task_policy.py'])
    run('format', ['cargo', 'fmt', '--all', '--check'])
    run('core-clippy', ['cargo', 'clippy', '-p', 'wasm-vm-core', '--tests', '--features',
                        'virgl-renderer,virgl-control-proof,gpu-trace,trace', '--', '-D', 'warnings'])
    run('wasm-clippy', ['cargo', 'clippy', '-p', 'wasm-vm-wasm', '--target', 'wasm32-unknown-unknown',
                        '--features', 'virgl-renderer', '--', '-D', 'warnings'])
    run('native-gpu', ['cargo', 'test', '-p', 'wasm-vm-core', '--features', 'virgl-renderer,trace',
                       '--test', 'production_virgl_critic', '--test', 'production_gpu_checkpoint_critic',
                       '--', '--nocapture', '--test-threads=1'])
    run('no-std-wasm', ['cargo', 'build', '-p', 'wasm-vm-core', '--no-default-features', '--target',
                       'wasm32-unknown-unknown', '--features', 'virgl-renderer,trace'])
    run('presentation-protocol', ['node', '--test', 'web/tests/e5-t06d-presentation.test.mjs',
                                  'web/tests/e5-t09c-present-scheduler.test.mjs',
                                  'web/tests/e4-t32-worker-protocol.test.mjs',
                                  'web/tests/virgl-interactive-clock.test.mjs',
                                  'web/tests/e6-t11d72-paced-policy-critic.test.mjs'])
    guest = repo/'guest/prebuilt/production-gpu-scanout.bin'
    pin = digest(guest)
    run('original-guest-build', ['node', 'tools/virgl-production/paired-guest/build-scanout.mjs'])
    assert digest(guest) == pin, 'MMIO guest is not reproducible'
    report['supervisorGuestSha256'] = pin
    run('web-build', ['make', 'web-build'])
    assert digest(repo/'web/pkg/wasm_vm_wasm_bg.wasm') == digest(repo/'web/dist/pkg/wasm_vm_wasm_bg.wasm')
    for relative in ['main.js', 'linux-worker-protocol.js', 'src/sink/presentation.js',
                     'src/sink/virgl-scanout-presenter.js', 'renderer/virgl-command/production.mjs',
                     'renderer/virgl-command/scanout.mjs', 'renderer/virgl-command/checkpoint.mjs']:
        assert digest(repo/'web'/relative) == digest(repo/'web/dist'/relative), 'dist drift '+relative
    run('actual-worker', ['node', 'tools/virgl-production/scanout-worker-browser.mjs', str(output/'actual-worker')])
    actual = json.loads((output/'actual-worker/report.json').read_text())
    assert actual['status'] == 'passed' and not actual['errors'] and not actual['sabotage']
    run('original-clear-negative', ['node', 'tools/virgl-production/scanout-worker-browser.mjs',
                                    str(output/'original-clear-negative'), 'old-clear'], expected=1)
    negative = json.loads((output/'original-clear-negative/report.json').read_text())
    assert negative['status'] == 'failed' and negative['sabotage'] and not negative['errors']
    assert negative['failure']['message'].startswith('no-blank: valid page flip retains displayed original green;')
    source = 'web/renderer/virgl-command/production.mjs'
    original = (output/'actual-worker/source'/source).read_bytes()
    modified = (output/'original-clear-negative/source'/source).read_bytes()
    needle = b"send({type:preserveDisplay?'invalidate':'clear'})"
    assert original.count(needle) == 1 and modified == original.replace(needle, b"send({type:'clear'})")
    healthy = {s['path']: s['sha256'] for s in actual['sources']}
    sabotaged = {s['path']: s['sha256'] for s in negative['sources']}
    assert set(healthy) == set(sabotaged) and [p for p in healthy if healthy[p] != sabotaged[p]] == [source]
    run('independent-state-attacks', ['node', 'tools/virgl-production/critic-scanout-continuity-verifier.mjs',
                                      str(output/'independent-state-attacks')])
    run('independent-physical-pixels', ['node', 'tools/virgl-production/critic-scanout-continuity-browser.mjs',
                                       str(output/'independent-physical-pixels')])
    run('software-fast-boots', ['node', 'tools/virgl-production/critic-fast-boots.mjs', str(output/'software-fast-boots')],
        extra={'CRITIC_FAST_BOOT_WEB_ROOT': str(repo/'web/dist'), 'CRITIC_FAST_BOOT_GPU': '0',
               'CRITIC_FAST_BOOT_GUESTS': 'busybox,alpine,node-alpine,omarchy', 'CRITIC_FAST_BOOT_SAVE_ON_REPEAT': '1'})
    run('default-browser', ['node', 'tools/verify-virgl-default-demo.mjs', '--output',
                            str(output/'default-browser'), '--task', 'E6-T11d74d1'])
    assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=repo), 'acceptance changed tracked files'
    report['status'] = 'passed'
except BaseException as error:
    report['status'] = 'failed'
    report['failure'] = str(error)
    raise
finally:
    report['finished'] = time.time()
    report['files'] = [{'path': str(file.relative_to(output)), 'bytes': file.stat().st_size, 'sha256': digest(file)}
                       for file in sorted(output.rglob('*')) if file.is_file() and file != output/'report.json']
    (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
