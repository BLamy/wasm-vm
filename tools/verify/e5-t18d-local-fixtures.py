#!/usr/bin/env python3
"""Exercise the unchanged supervisor in isolated Linux; browser boots remain authoritative."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import time

ROOT = Path('/repo')
STATE = Path('/home/desktop/.local/state/wasm-vm')
RUNTIME = Path('/run/user/1000')
CONFIG = Path('/etc/xdg/weston/weston.ini')
CHILDREN = []

def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout

def wait_for(predicate, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(.05)
    raise AssertionError('bounded wait expired')

def text(name):
    file = STATE / name
    return file.read_text() if file.exists() else ''

def desktop_identity():
    os.setgid(1000)
    os.setuid(1000)

def launch(mode='', renderer='pixman'):
    output = open('/tmp/supervisor-output', 'a')
    child = subprocess.Popen(['/bin/sh', str(ROOT / 'tools/rootfs/start-desktop')],
        env={**os.environ, 'E5_T18D_FIXTURE': mode, 'WLR_RENDERER': renderer},
        preexec_fn=desktop_identity, stdout=output, stderr=output, start_new_session=True)
    output.close()
    CHILDREN.append(child)
    return child

def reset():
    for child in CHILDREN:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=8)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=2)
    CHILDREN.clear()
    Path('/run/seatd.sock').unlink(missing_ok=True)
    if STATE.exists():
        shutil.rmtree(STATE)
    STATE.mkdir(parents=True)
    for parent in [Path('/home/desktop'), Path('/home/desktop/.local'), STATE.parent, STATE]:
        os.chown(parent, 1000, 1000)
    if RUNTIME.exists():
        shutil.rmtree(RUNTIME)
    RUNTIME.mkdir(parents=True, mode=0o700)
    os.chown(RUNTIME, 1000, 1000)
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    CONFIG.write_text('[core]\n')
    Path('/dev/dri').mkdir(exist_ok=True)
    if not Path('/dev/dri/card0').exists():
        os.mknod('/dev/dri/card0', stat.S_IFCHR | 0o666, os.makedev(1, 3))

def start_seat():
    child = subprocess.Popen(['/tmp/seatd', 'seatd'], start_new_session=True)
    CHILDREN.append(child)
    wait_for(lambda: Path('/run/seatd.sock').is_socket())

def ready(attempt):
    return wait_for(lambda: text('desktop.ready').split() if
        text('desktop.ready').startswith(str(attempt) + ' ') else None)

def crashed(pid):
    os.kill(int(pid), signal.SIGKILL)

def failed(child, reason, timeout=15):
    child.wait(timeout=timeout)
    assert child.returncode == 0
    assert text('desktop.failed').strip() == reason, text('desktop.log')
    assert not text('desktop.ready') and not text('weston.pid')
    assert 'event=fallback reason=' + reason in text('desktop.log')

run('cc', '-Wall', '-Wextra', '-Werror', str(ROOT / 'tools/verify/fixtures/e5-t18d-process.c'), '-o', '/usr/bin/weston')
shutil.copy('/usr/bin/weston', '/tmp/seatd')
results = []
try:
    # Predict a single restart, distinct PIDs, then exactly three attempts and a persistent latch.
    reset(); start_seat(); supervisor = launch()
    pids = []
    for attempt in range(1, 4):
        _, pid = ready(attempt)
        pids.append(pid)
        crashed(pid)
    failed(supervisor, 'restart-budget-exhausted')
    assert len(set(pids)) == 3
    assert text('desktop.log').count('event=attempt ') == 3
    assert text('desktop.log').count('event=restart ') == 2
    assert text('desktop.attempts') == '3\n'
    reentry = launch(); reentry.wait(timeout=3)
    assert 'event=latched attempts=3' in text('desktop.log')
    assert text('desktop.log').count('event=attempt ') == 3
    results.append({'case': 'three-crashes-and-reentry', 'log': text('desktop.log')})

    reset(); supervisor = launch(); time.sleep(.5); start_seat()
    ready(1)
    results.append({'case': 'seatd-delay-500ms', 'log': text('desktop.log')})

    for fault, reason in [('video', 'video-device-missing'), ('runtime', 'runtime-directory-missing'),
                          ('renderer', 'unsupported-renderer'), ('config', 'compositor-config-missing')]:
        reset(); start_seat()
        if fault == 'video': Path('/dev/dri/card0').unlink()
        if fault == 'runtime': shutil.rmtree(RUNTIME)
        if fault == 'config': CONFIG.unlink()
        supervisor = launch(renderer='gles2' if fault == 'renderer' else 'pixman')
        failed(supervisor, reason)
        assert 'event=ready' not in text('desktop.log')
        assert 'event=started' not in text('desktop.log')
        results.append({'case': fault, 'log': text('desktop.log')})

    reset(); start_seat(); supervisor = launch()
    _, pid = ready(1); CONFIG.unlink(); crashed(pid)
    failed(supervisor, 'compositor-config-missing')
    assert text('desktop.log').count('event=started') == 1
    results.append({'case': 'config-removed-after-readiness', 'log': text('desktop.log')})

    reset(); start_seat(); supervisor = launch('exit')
    failed(supervisor, 'restart-budget-exhausted')
    assert text('desktop.log').count('reason=early-exit status=23') == 3
    assert 'event=ready' not in text('desktop.log')
    results.append({'case': 'early-exit', 'log': text('desktop.log')})

    reset(); start_seat(); supervisor = launch('stubborn')
    _, pid = ready(1); supervisor.terminate(); supervisor.wait(timeout=8)
    assert not Path('/proc/' + pid).exists()
    assert not text('desktop.ready') and not text('weston.pid')
    results.append({'case': 'bounded-shutdown-kill', 'log': text('desktop.log')})

    reset(); start_seat(); supervisor = launch('no-socket')
    failed(supervisor, 'restart-budget-exhausted', timeout=105)
    assert text('desktop.log').count('reason=startup-timeout') == 3
    assert 'event=ready' not in text('desktop.log')
    results.append({'case': 'startup-timeout', 'log': text('desktop.log')})

    print(json.dumps({'scope': 'Linux process-double precheck, not guest acceptance',
        'supervisorSha256': hashlib.sha256((ROOT / 'tools/rootfs/start-desktop').read_bytes()).hexdigest(),
        'passed': len(results), 'cases': results}, indent=2), flush=True)
except Exception:
    print(text('desktop.log'), flush=True)
    print(Path('/tmp/supervisor-output').read_text(), flush=True)
    raise
finally:
    reset()
