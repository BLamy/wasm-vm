#!/usr/bin/env python3
"""Bounded capstone integration; never starts the waived original-cold desktop campaign."""
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
    raise RuntimeError('capstone assertions require the normal Python interpreter')
ROOT = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--recovery', type=Path, default=ROOT / 'target/evidence/e9-t23-exact-recovery-v1')
p.add_argument('--recorded-inputs', type=Path)
a = p.parse_args()
out = a.output.resolve()
out.mkdir(parents=True, exist_ok=False)
recovery = a.recovery.resolve()
env = {k: v for k, v in os.environ.items() if not k.startswith('CARGO_') and k not in
       ('RUSTFLAGS', 'RUSTDOCFLAGS', 'RUST_LOG', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER',
        'RUSTC_BOOTSTRAP', 'NODE_OPTIONS', 'NODE_PATH', 'PYTHONOPTIMIZE', 'PYTHONPATH', 'PYTHONSTARTUP')}
env.update(CARGO_BUILD_JOBS='4', CARGO_INCREMENTAL='0', CARGO_TERM_COLOR='never')
def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, env=env, text=True).strip()
def sha(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            h.update(block)
    return h.hexdigest()
report = dict(task='E9-T24', risk='high', status='running', head=git('rev-parse', 'HEAD'),
              started=time.time(), scope='Software Linux and bounded physical GPU integration; no full Omarchy, original-cold or performance claim',
              commands=[], evidence=[], carried=[], sources={})
def save():
    (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
def run(name, command, timeout=600):
    report['active'] = name
    save()
    print(name, flush=True)
    began = time.time()
    with (out / (name + '.log')).open('wb') as log:
        child = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = child.wait(timeout=timeout)
        except BaseException:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
            raise
    report['commands'].append(dict(name=name, command=command, exitCode=code, seconds=time.time()-began,
                                   logSha256=sha(out / (name + '.log'))))
    save()
    assert code == 0, name + ' failed; inspect preserved log'
def evidence(name, status='passed'):
    file = out / name / 'report.json'
    value = json.loads(file.read_text())
    assert value['status'] == status, name + ' failed'
    if 'head' in value:
        assert value['head'] == report['head'], name + ' head differs'
    assert not value.get('dirty', '') and not value.get('development', False), name + ' is development evidence'
    report['evidence'].append(dict(name=name, path=str(file), sha256=sha(file)))
    return value
try:
    assert not git('status', '--porcelain', '--untracked-files=all'), 'freeze source before acceptance'
    # Carry forward exact T23 recovery evidence only while all runtime/security boundaries are identical.
    receipt = recovery / 'report.json'
    assert sha(receipt) == '99b50fb454f89f6bceebbef386b42ef981615f5ce12b2a09eecbb395f446a9ff'
    prior = json.loads(receipt.read_text())
    assert prior['status'] == 'passed' and prior['head'] == 'd653efd8001fb0c9d9c61b860f2185e9488157c1'
    runtime_paths = ['crates', 'Cargo.toml', 'Cargo.lock', 'guest', 'web']
    allowed = lambda name: (name.startswith(('web/docs', 'web/dist/docs', 'web/dist/assets/docs-reader-', 'web/dist/assets/marketing-'))
                            or name in ['web/tests/omarchy-seeded-loader.test.mjs', 'web/README.md', 'web/roadmap.js', 'web/dist/roadmap.js', 'web/tasks.json', 'web/dist/tasks.json',
                                        'web/repo-activity.json', 'web/dist/repo-activity.json', 'web/dist/index.html', 'web/dist/sw.js'])
    changed = git('diff', '--name-only', prior['head'], report['head'], '--', *runtime_paths).splitlines()
    assert all(allowed(name) for name in changed), 'runtime boundary changed: ' + repr([n for n in changed if not allowed(n)])
    for row in prior['commands']:
        assert row['exitCode'] == 0 and sha(recovery / (row['name'] + '.log')) == row['logSha256']
    for row in prior['evidence']:
        file = recovery / row['name'] / 'report.json'
        assert sha(file) == row['sha256'] and json.loads(file.read_text())['status'] == 'passed'
    for name, digest in prior['recordedHarness'].items():
        assert sha(ROOT / name) == digest, 'carried recovery harness changed'
    report['carried'].append(dict(task='E9-T23', path=str(receipt), sha256=sha(receipt), runtimeChanges=changed,
                                  limitation='Prior critic clone browser loopback was EPERM; non-browser build proof only. Runtime evidence independently interrogated.'))
    names = git('diff', '--name-only', '1d3976142b6f8d488907bcbc037a21e8cf9535be', report['head']).splitlines()
    report['sources'] = {name: sha(ROOT / name) for name in names if (ROOT / name).is_file()}
    reused = {}
    if a.recorded_inputs:
        index_path = a.recorded_inputs.resolve()
        index = json.loads(index_path.read_text())
        prior_file = Path(index['sourceReport'])
        assert sha(prior_file) == index['sourceReportSha256']
        previous = json.loads(prior_file.read_text())
        assert previous['status'] == index['sourceStatus'] == 'failed'
        assert previous['active'] == 'capstone-session-UI' and previous['head'] == index['sourceHead']
        assert all(x['exitCode'] == 0 for x in previous['commands'] if x['name'] != 'capstone-session-UI')
        changed_since = git('diff', '--name-only', previous['head'], report['head']).splitlines()
        assert all(name in ['Makefile', 'tools/verify/e9-capstone.py', 'tools/verify/e9-capstone-session-ui.mjs'] or name.startswith('evidence/e9-t24-inputs-0e47542da/') for name in changed_since), 'recording boundary changed'
        for component in index['components']:
            directory = Path(component['root'])
            assert sha(directory / 'report.json') == component['reportSha256']
            actual = sorted(str(f.relative_to(directory)) for f in directory.rglob('*') if f.is_file())
            assert actual == sorted(row['path'] for row in component['files']), 'recorded inventory changed'
            for row in component['files']:
                file = directory / row['path']
                assert file.is_file() and not file.is_symlink() and file.stat().st_size == row['bytes'] and sha(file) == row['sha256'], 'recorded bytes changed'
            reused[component['name']] = directory
        assert set(reused) == {'demo', 'timeline', 'software-network', 'paged-gpu'}
        report['carried'].append(dict(task='E9-T24', index=str(index_path), sha256=sha(index_path), sourceHead=previous['head'], scope=index['scope']))
    run('task-policy', ['python3', '-B', 'tools/check_task_policy.py'])
    run('format', ['cargo', 'fmt', '--all', '--check'])
    run('docs', ['node', 'tools/check-docs.mjs'])
    run('docs-dist', ['python3', '-B', 'tools/check-docs-dist.py'])
    run('guest-fastboot-regressions', ['node', '--test', 'web/tests/boot-path.test.mjs', 'web/tests/boot-asset-cache.test.mjs',
        'web/tests/guest-rpc.test.mjs', 'web/tests/omarchy-seeded-loader.test.mjs', 'web/tests/overlay-seed-identity.test.mjs',
        'tools/virgl-production/critic-fast-boots-protocol.test.mjs', 'tools/virgl-production/critic-fast-boots-final.test.mjs',
        'tools/verify/e9-bundle-format.test.mjs', 'tools/verify/e9-session-witnesses.test.mjs', 'tools/verify/e9-replay-static-assets.test.mjs'])
    if not reused:
        run('demo', ['node', 'tools/verify/e9-gpu-results-browser.mjs', '--output', str(out / 'demo'),
            '--branch-status', 'verified', '--bundle-status', 'verified'])
        demo = evidence('demo')
        assert demo['suite'] == dict(passed=127, failed=0)
        run('timeline', ['node', 'tools/verify/e9-timeline-browser.mjs', '--probe-only', '--output', str(out / 'timeline')], timeout=600)
        evidence('timeline')
        run('software-network', ['node', 'tools/verify/e9-workload-software-browser.mjs', '--capstone', '--output', str(out / 'software-network')], timeout=1800)
        software = evidence('software-network', 'software-full-workload-replay-passed')
        assert software['task'] == 'E9-T24' and software['wire']['connections'] == 10
        assert software['result']['replayEgress'] == dict(fetch=0, sockets=0)
        run('software-literal-files', ['python3', '-B', 'tools/verify/e9-workload-software-files.py', '--capstone', '--directory', str(out / 'software-network')])
        run('paged-gpu', ['node', 'tools/verify/e9-capstone-paged-browser.mjs', '--output', str(out / 'paged-gpu')], timeout=300)
        evidence('paged-gpu')
        run('paged-byte-RAM-oracle', ['python3', '-B', 'tools/verify/e9-capstone-paged-files.py', '--directory', str(out / 'paged-gpu')])
    software_root, gpu_root = (reused.get(name, out / name) for name in ['software-network', 'paged-gpu'])
    run('capstone-session-UI', ['node', 'tools/verify/e9-capstone-session-ui.mjs', '--software', str(software_root),
        '--gpu', str(gpu_root), '--output', str(out / 'session-ui')], timeout=1200)
    evidence('session-ui')
    run('fresh-profile-UI', ['node', 'tools/verify/e9-bundle-browser.mjs', '--software', str(recovery / 'linux-branches'),
        '--gpu', str(recovery / 'gpu-branches'), '--output', str(out / 'bundles')], timeout=1200)
    evidence('bundles')
    run('archive-native-byte-oracle', ['python3', '-B', 'tools/verify/e9-bundle-files.py', '--directory', str(out / 'bundles')])
    assert git('rev-parse', 'HEAD') == report['head'] and not git('status', '--porcelain')
    assert all(sha(ROOT / name) == digest for name, digest in report['sources'].items())
    report['status'] = 'passed'
except BaseException as error:
    report.update(status='failed', failure=repr(error))
finally:
    report['finished'] = time.time()
    save()
    print(json.dumps(dict(status=report['status'], output=str(out), failure=report.get('failure'))), flush=True)
sys.exit(0 if report['status'] == 'passed' else 1)
