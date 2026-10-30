#!/usr/bin/env python3
"""Record the high-risk owned live HTTP boundary at one clean, frozen revision."""
import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path
import subprocess
import time

SOURCE = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--output', required=True, type=Path)
p.add_argument('--cold-clone', type=Path)
p.add_argument('--resume-from', type=Path, help='Carry passed gates after an acceptance-runner-only correction')
a = p.parse_args()
out = a.output.resolve()
out.mkdir(parents=True, exist_ok=False)
root = a.cold_clone.resolve() if a.cold_clone else SOURCE
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=SOURCE, text=True).strip()
env = {key: value for key, value in os.environ.items()
       if key not in ('RUSTFLAGS', 'RUSTDOCFLAGS', 'RUST_LOG') and not key.startswith('CARGO_')}
env.update(CARGO_TERM_COLOR='never', CARGO_INCREMENTAL='0', CARGO_BUILD_JOBS='4')
if a.cold_clone:
    env.update(CARGO_PROFILE_DEV_DEBUG='0', CARGO_PROFILE_TEST_DEBUG='0')
report = dict(task='E9-T22b', risk='high', status='running', head=head, commands=[], started=time.time(),
              clone=str(root) if a.cold_clone else None,
              scope='Fixed owned local HTTP over real Slirp/TCP, full Alpine OFF/ON ten bodies and exact closed-server zero-egress replay. Full T22c/d desktop/workload/performance remain separate.')


def sha(file):
    digest = hashlib.sha256()
    with file.open('rb') as source:
        for block in iter(lambda: source.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def write():
    (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')


def clean(directory):
    status = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=directory, text=True)
    assert not status, 'clean frozen acceptance required: ' + status
    return status


def run(name, command, timeout=1800, cwd=None):
    carried = next((row for row in report.get('carriedCommands', []) if row['name'] == name), None)
    if carried is not None:
        assert carried['command'] == command, 'carried command differs: ' + name
        print(name + ' (carried unchanged runtime evidence)', flush=True)
        return
    report['active'] = name
    write()
    print(name, flush=True)
    started = time.time()
    with (out / (name + '.log')).open('wb') as log:
        result = subprocess.run(command, cwd=cwd or root, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
    report['commands'].append(dict(name=name, command=command, exit_code=result.returncode, seconds=time.time() - started))
    write()
    assert result.returncode == 0, name + ' failed; inspect its log'


def browser(name, tool, **extra):
    arguments = []
    for key, value in extra.items():
        arguments.extend(['--' + key.replace('_', '-'), str(value)])
    run(name, ['node', 'tools/verify/' + tool, '--output', str(out / name), *arguments], timeout=1800)
    data = json.loads((out / name / 'report.json').read_text())
    assert data['head'] == head and not data.get('dirty', ''), 'browser did not use frozen head: ' + name
    assert not data.get('errors'), 'console errors: ' + name
    assert data['status'] in ('passed', 'owned-http-full-alpine-off-on-replay'), 'browser failed: ' + name
    return data


try:
    clean(SOURCE)
    if a.resume_from:
        assert not a.cold_clone, 'cold proof always starts from its final pristine head'
        previous = a.resume_from.resolve()
        old = json.loads((previous / 'report.json').read_text())
        assert old['task'] == 'E9-T22b' and old['status'] == 'failed'
        assert old.get('failure') == "AssertionError('built app HTML differs')", 'unreviewed resume condition'
        changed = subprocess.check_output(['git','diff','--name-only',old['head'],head],cwd=root,text=True).splitlines()
        assert changed == ['tools/verify/e9-owned-http.py'], 'only a runner correction can carry these gates'
        for row in old['sources']:
            if row['path'] != 'tools/verify/e9-owned-http.py':
                assert sha(root / row['path']) == row['sha256'], 'changed dependency: ' + row['path']
        for row in old['files']:
            source = previous / row['path']
            assert source.is_relative_to(previous) and sha(source) == row['sha256']
            destination = out / row['path']; destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
        assert all(row['exit_code'] == 0 for row in old['commands'])
        report['carryForward'] = dict(report=str(previous / 'report.json'),sha256=sha(previous / 'report.json'),
            sourceHead=old['head'],targetHead=head,changed=changed,
            reason='Source/deployed HTML normalization was missing in the acceptance harness; runtime, dependencies and original evidence digests are unchanged.')
        report['carriedCommands'] = old['commands']
        report['commands'] = list(old['commands'])
        write()
    if a.cold_clone:
        assert not root.exists(), 'cold clone destination must not exist'
        run('clone', ['git', 'clone', '--quiet', '--no-hardlinks', '--no-checkout', str(SOURCE), str(root)], cwd=SOURCE)
        run('checkout', ['git', 'checkout', '--quiet', '--detach', head])
        assert not (root / 'target').exists() and not (root / 'web/node_modules').exists()
        report['wallPolicy'] = 'Fresh exact-head portability proof; the full local regression wall executes once in the primary submission.'
    clean(root)
    run('policy', ['python3', '-B', 'tools/check_task_policy.py'])
    run('format', ['cargo', 'fmt', '--check'])
    run('affected-native-clippy', ['cargo','clippy','--locked','-p','wasm-vm-core','-p','wasm-vm-slirp','-p','wasm-vm-wasm','--all-targets','--features','virgl-renderer','--','-D','warnings'])
    run('slirp-no-native-clippy',['cargo','clippy','--locked','-p','wasm-vm-slirp','--no-default-features','--lib','--','-D','warnings'])
    run('all-native-slirp',['cargo','test','--locked','-p','wasm-vm-slirp','--all-targets'])
    env['E9_OWNED_HTTP_GUEST_EVIDENCE']=str(out/'guest-trace')
    try:
        run('owned-guest-trace',['cargo','test','--locked','-p','wasm-vm-slirp','--features','wasm-vm-core/trace','--lib','session_http::tests::replay_original_send_receipts_has_no_provider_and_exact_state','--','--nocapture'])
    finally:
        env.pop('E9_OWNED_HTTP_GUEST_EVIDENCE',None)
    env['E9_NETWORK_EVIDENCE']=str(out/'core-network-traces')
    try:
        run('core-network-regression',['cargo','test','--locked','-p','wasm-vm-core','--features','trace,virgl-renderer','--test','e9_network_capture','--','--nocapture'])
    finally:
        env.pop('E9_NETWORK_EVIDENCE',None)
    integrations=['e9_event_clock','e9_time_entropy','e9_input_boundary','e9_device_completions','e9_session_checkpoint','e9_incremental_keyframes','e9_deterministic_replay','e9_seek']
    command=['cargo','test','--locked','-p','wasm-vm-core','--features','trace,virgl-renderer']
    for test in integrations: command.extend(['--test',test])
    run('record-replay-native-boundaries',command+['--','--nocapture'])
    run('wasm-input-and-checkpoint-unit',['cargo','test','--locked','-p','wasm-vm-wasm','--features','virgl-renderer','--lib','--test','software_checkpoint','--','--nocapture'])
    run('wasm-clippy',['cargo','clippy','--locked','-p','wasm-vm-wasm','--target','wasm32-unknown-unknown','--features','virgl-renderer','--','-D','warnings'])
    run('browser-build', ['make', 'web-build'])
    runtime=['pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm','session-pkg/wasm_vm_session_bg.wasm','gpu-checkpoint-build.js','main.js','roadmap.js','owned-http-probe.js','session-alpine-image.json','session-software-fixture.json']
    report['rebuiltRuntime']=[]
    for name in runtime:
        source,dist=root/'web'/name,root/'web/dist'/name
        assert source.read_bytes()==dist.read_bytes(),'rebuilt runtime differs from committed dist: '+name
        report['rebuiltRuntime'].append(dict(path=name,bytes=source.stat().st_size,sha256=sha(source)))
    expected_app = (root/'web/index.html').read_bytes()
    for before,after in [(b'./node_modules/@xterm/xterm/css/xterm.css',b'./vendor/xterm/xterm.css'),
                         (b'./node_modules/@xterm/xterm/lib/xterm.js',b'./vendor/xterm/xterm.js'),
                         (b'./node_modules/@xterm/addon-fit/lib/addon-fit.js',b'./vendor/xterm/addon-fit.js'),
                         (b'./landing.html',b'./')]:
        expected_app = expected_app.replace(before,after)
    assert expected_app == (root/'web/dist/app.html').read_bytes(),'built app HTML differs from the prescribed vendor/navigation mapping'
    report['appHtml'] = dict(source=sha(root/'web/index.html'),deployed=sha(root/'web/dist/app.html'),mapping='tools/build-web-dist.sh exact xterm vendoring and landing-to-root substitutions')
    for name in ['e9-owned-http-browser.mjs','e9-owned-http-page.mjs','e9-owned-http-wire.mjs','e9-owned-http-demo-browser.mjs']:
        run('syntax-'+Path(name).stem,['node','--check','tools/verify/'+name])
    run('syntax-product-probe',['node','--check','web/owned-http-probe.js'])
    run('docs', ['node', 'tools/check-docs.mjs'])
    run('immutable-full-Alpine-base', ['python3', '-B', 'tools/verify/e9-prepare-alpine.py', '--output', str(out / 'immutable-base')]
        + (['--require-fresh'] if a.cold_clone else []))
    report['browserReports']={}
    for name,tool in [('alpine-http','e9-owned-http-browser.mjs'),('demo','e9-owned-http-demo-browser.mjs')]:
        data=browser(name,tool)
        report['browserReports'][name]={'status':data['status'],'sha256':sha(out/name/'report.json')}
    run('independent-direct-artifact-reader',['python3','-B','tools/verify/e9-owned-http-files.py','--directory',str(out)])
    if not a.cold_clone:
        run('local-gauntlet', ['python3', '-B', 'tools/verify/e9-local-gauntlet.py', '--task', 'E9-T22b',
                               '--output', str(out / 'gauntlet')], timeout=21600)
    report['finalCheckoutStatus'] = clean(root)
    report['finalHead'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    assert report['finalHead'] == head, 'revision changed during acceptance'
    report['status'] = 'passed'
except BaseException as error:
    report['status'] = 'failed'
    report['failure'] = repr(error)
    raise
finally:
    report.pop('active', None)
    report['finished'] = time.time()
    report['sourceRoot'] = str(root)
    changed = subprocess.check_output(['git', 'diff', '--name-only', '615629bfa111e4b586d0a03337013ec53415f318', head], cwd=SOURCE, text=True).splitlines()
    report['sources'] = [dict(path=name, sha256=sha(root / name)) for name in changed if (root / name).is_file()]
    report['files'] = [dict(path=str(file.relative_to(out)), bytes=file.stat().st_size, sha256=sha(file))
                       for file in sorted(out.rglob('*')) if file.is_file() and file != out / 'report.json']
    write()
