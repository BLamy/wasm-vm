#!/usr/bin/env python3
"""E5-T18d critic regressions; disposable Linux fixtures, not guest acceptance.

Run with the repository mounted read-only in a fresh container:
  docker run --rm --network none --cap-add SYS_PTRACE -v "$PWD:/repo:ro" \
    wasm-vm-kernel-build:local python3 \
    /repo/tools/verify/e5-t18d-state-boundaries.py --disposable

The actual shell scripts execute unchanged. Only /proc/cmdline is supplied by a
PATH shim; head/date shims make post-validation file swaps deterministic. Fixture
accounts, files, and a sleeping /usr/bin/weston exist only inside the container.
Use --source-dir to test a saved source snapshot as a negative control.

Also run with Alpine's actual BusyBox shell/timeout (a Debian pass is insufficient):
  docker run --rm --cap-add SYS_PTRACE -v "$PWD:/repo:ro" alpine:3.20 sh -c \
    'apk add --no-cache python3 util-linux shadow && python3 \
    /repo/tools/verify/e5-t18d-state-boundaries.py --disposable'
SYS_PTRACE lets container root inspect /proc/<desktop-pid>/exe as guest root does.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest


STATE = Path('/home/desktop/.local/state/wasm-vm')
SOURCE = Path('/repo/tools/rootfs')
RESULTS = []
# Independent limits from the E5-T18d worker contract; never derive them from the implementation.
RUNTIME_INITIALIZATION_SECONDS = 30
STATE_READ_SECONDS = 2


def desktop_identity():
    os.setgroups([])
    os.setgid(1000)
    os.setuid(1000)


class StateBoundaries(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            account = pwd.getpwnam('desktop')
        except KeyError:
            subprocess.run(['groupadd', '-o', '-g', '1000', 'desktop'], check=True)
            subprocess.run(['useradd', '-o', '-u', '1000', '-g', '1000',
                            '-M', '-s', '/bin/sh', 'desktop'], check=True)
            account = pwd.getpwnam('desktop')
        if (account.pw_uid, account.pw_gid) != (1000, 1000):
            raise RuntimeError('fixture requires desktop uid/gid 1000')
        if STATE.exists() or STATE.is_symlink():
            raise RuntimeError('refusing to replace pre-existing desktop state; use a fresh container')
        cls.scratch = Path(tempfile.mkdtemp(prefix='e5-t18d-state-'))
        cls.scratch.chmod(0o755)
        cls.bin = cls.scratch / 'bin'
        cls.bin.mkdir()
        real_cat, real_head, real_date = (shutil.which(name) for name in ('cat', 'head', 'date'))
        if not all((real_cat, real_head, real_date)):
            raise RuntimeError('missing fixture utilities')
        shims = {
            'cat': f'''#!/bin/sh
if [ "$#" -eq 1 ] && [ "$1" = /proc/cmdline ]; then
  printf 'wasmvm.desktop_test=1\\n'
else exec {real_cat} "$@"; fi
''',
            'head': f'''#!/bin/sh
if [ "${{E5_T18D_SWAP:-}}" = head ] && [ "${{3:-}}" = "$E5_T18D_TARGET" ]; then
  rm -f "$E5_T18D_TARGET"
  mkfifo "$E5_T18D_TARGET"
  printf '%s %s\\n' "$$" "$PPID" >"$E5_T18D_MARKER"
fi
exec {real_head} "$@"
''',
            'date': f'''#!/bin/sh
if [ "${{E5_T18D_SWAP:-}}" = date ]; then
  rm -f "$E5_T18D_TARGET"
  mkfifo "$E5_T18D_TARGET"
  printf '%s %s\\n' "$$" "$PPID" >"$E5_T18D_MARKER"
fi
exec {real_date} "$@"
''',
        }
        for name, content in shims.items():
            executable = cls.bin / name
            executable.write_text(content)
            executable.chmod(0o755)
        cls.secret = cls.scratch / 'root-only'
        cls.secret.write_text('E5T18D_SYNTHETIC_ROOT_ONLY_DATA\n')
        cls.secret.chmod(0o600)
        cls.marker = cls.scratch / 'race-processes'
        # The hook validates this ELF path and UID; no compositor behavior is mocked here.
        if Path('/usr/bin/weston').exists():
            raise RuntimeError('refusing to replace an existing Weston; use the fixture image')
        # Copy a real ELF with portable sleep behavior, including on multicall BusyBox images.
        shutil.copyfile(sys.executable, '/usr/bin/weston')
        Path('/usr/bin/weston').chmod(0o755)
        cls.kill_fixture = not Path('/bin/kill').exists()
        if cls.kill_fixture:
            # The minimal Debian builder omits external kill. This adapter still exercises
            # the real kill syscall as the UID selected by the unmodified runuser command.
            Path('/bin/kill').write_text('#!/bin/sh\nkill "$@"\n')
            Path('/bin/kill').chmod(0o755)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.scratch)
        Path('/usr/bin/weston').unlink()
        if cls.kill_fixture:
            Path('/bin/kill').unlink()

    def setUp(self):
        STATE.mkdir(parents=True, mode=0o700)
        for directory in (Path('/home/desktop'), STATE.parent.parent, STATE.parent, STATE):
            os.chown(directory, 1000, 1000)
        self.marker.write_text('')
        os.chown(self.marker, 1000, 1000)
        self.processes = []

    def tearDown(self):
        # Exact PIDs written by the deterministic swap shim, within this disposable container.
        for value in self.marker.read_text().split():
            try:
                pid = int(value)
                status = Path(f'/proc/{pid}/status').read_text()
                uid = next(line.split()[1] for line in status.splitlines() if line.startswith('Uid:'))
                if uid == '1000':
                    os.kill(pid, signal.SIGKILL)
            except (ProcessLookupError, FileNotFoundError):
                pass
        for process in self.processes:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=2)
        shutil.rmtree(STATE)

    def state_file(self, name, contents):
        target = STATE / name
        target.write_text(contents)
        os.chown(target, 1000, 1000)
        return target

    def invoke(self, kind, commands='', swap=None):
        env = {**os.environ, 'PATH': f'{self.bin}:{os.environ["PATH"]}'}
        if swap:
            env.update(E5_T18D_SWAP=swap, E5_T18D_MARKER=str(self.marker),
                       E5_T18D_TARGET=str(STATE / ('desktop.log' if swap == 'date' else 'weston.pid')))
        if kind == 'runtime':
            command = ['/bin/sh', '-c', '. "$1"; start', 'sh', str(SOURCE / 'desktop-runtime.initd')]
        else:
            command = ['/bin/sh', str(SOURCE / 'desktop-test-console')]
        started = time.monotonic()
        # Files avoid confusing an inherited stdout pipe with a blocked calling shell.
        with tempfile.TemporaryFile(mode='w+') as output:
            process = subprocess.Popen(command, env=env, stdin=subprocess.PIPE,
                                       stdout=output, stderr=output, text=True, start_new_session=True)
            self.processes.append(process)
            timed_out = False
            try:
                process.communicate(commands, timeout=(RUNTIME_INITIALIZATION_SECONDS + 5
                                                        if kind == 'runtime' else STATE_READ_SECONDS + 3))
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
                timed_out = True
            elapsed = time.monotonic() - started
            output.seek(0)
            text = output.read()
        swap_processes = []
        for value in self.marker.read_text().split():
            process_dir = Path('/proc') / str(int(value))
            try:
                status = process_dir.joinpath('status').read_text()
                swap_processes.append({
                    'pid': int(value),
                    'status': [line for line in status.splitlines()
                               if line.startswith(('Name:', 'State:', 'PPid:', 'Uid:'))],
                    'waitChannel': process_dir.joinpath('wchan').read_text(),
                })
            except FileNotFoundError:
                pass
        RESULTS.append({'test': self.id().rsplit('.', 1)[-1], 'kind': kind,
                        'elapsedSeconds': round(elapsed, 3), 'exitCode': process.returncode,
                        'externalWatchdogExpired': timed_out,
                        'outputSha256': hashlib.sha256(text.encode()).hexdigest(),
                        'outputBytes': len(text.encode()),
                        'swapProcesses': swap_processes,
                        'output': text if len(text) <= 1024 else text[:768] + '\n[capture shortened]\n' + text[-128:]})
        self.assertFalse(timed_out, f'{kind} exceeded external watchdog; output={text!r}')
        self.assertEqual(process.returncode, 0, text)
        return text, elapsed

    def test_runtime_fifo_is_replaced(self):
        log = STATE / 'desktop.log'
        os.mkfifo(log)
        os.chown(log, 1000, 1000)
        _, elapsed = self.invoke('runtime')
        self.assertLess(elapsed, 2)
        self.assertTrue(log.is_file() and not log.is_symlink())
        self.assertEqual(log.stat().st_uid, 1000)
        self.assertIn('event=boot-runtime-ready', log.read_text())

    def test_runtime_symlink_preserves_target(self):
        before = self.secret.read_bytes()
        log = STATE / 'desktop.log'
        log.symlink_to(self.secret)
        self.invoke('runtime')
        self.assertEqual(self.secret.read_bytes(), before)
        self.assertFalse(log.is_symlink())
        self.assertIn('event=boot-runtime-ready', log.read_text())

    def test_runtime_unavailable_state_returns_control(self):
        (STATE / 'desktop.log').mkdir()
        text, elapsed = self.invoke('runtime')
        self.assertLess(elapsed, 2)
        self.assertIn('E5T18D_RUNTIME_STATE_UNAVAILABLE', text)

    def test_runtime_post_check_fifo_swap_is_bounded(self):
        self.state_file('desktop.log', 'prior diagnostics\n')
        text, elapsed = self.invoke('runtime', swap='date')
        self.assertTrue(self.marker.read_text().strip(), 'swap shim was not reached')
        self.assertLess(elapsed, RUNTIME_INITIALIZATION_SECONDS + 2)
        self.assertIn('E5T18D_RUNTIME_STATE_UNAVAILABLE', text)

    def test_hook_rejects_symlinks_and_fifos(self):
        denied = subprocess.run(['cat', str(self.secret)], preexec_fn=desktop_identity,
                                capture_output=True, timeout=2)
        self.assertNotEqual(denied.returncode, 0)
        for name in ('desktop.ready', 'desktop.log', 'weston.log'):
            (STATE / name).symlink_to(self.secret)
        os.mkfifo(STATE / 'weston.pid')
        os.chown(STATE / 'weston.pid', 1000, 1000)
        text, elapsed = self.invoke('hook', 'status\nlog\ncrash\nstatus\n')
        self.assertLess(elapsed, 2)
        self.assertNotIn('E5T18D_SYNTHETIC_ROOT_ONLY_DATA', text)
        self.assertEqual(text.count('E5T18D_STATUS_END'), 2)
        self.assertIn('E5T18D_LOG_END', text)
        self.assertIn('E5T18D_HOOK_ERROR=no-compositor', text)

    def test_hook_regular_root_file_still_has_no_read_authority(self):
        target = STATE / 'desktop.ready'
        shutil.copyfile(self.secret, target)
        target.chmod(0o600)
        text, _ = self.invoke('hook', 'status\n')
        self.assertNotIn('E5T18D_SYNTHETIC_ROOT_ONLY_DATA', text)
        self.assertIn('E5T18D_STATUS_END', text)

    def test_hook_preserves_normal_output_and_caps_logs(self):
        self.state_file('desktop.ready', '2 1234\n')
        self.state_file('weston.log', 'x' * 20000 + '\n')
        text, _ = self.invoke('hook', 'status\nlog\n')
        self.assertIn('desktop.ready=2 1234\n', text)
        payload = text.split('E5T18D_LOG_BEGIN\n', 1)[1].split('E5T18D_LOG_END', 1)[0]
        self.assertEqual(payload, 'x' * 16384)

    def test_hook_pid_post_check_fifo_swap_is_bounded(self):
        self.state_file('weston.pid', '1\n')
        text, elapsed = self.invoke('hook', 'crash\nstatus\n', swap='head')
        self.assertTrue(self.marker.read_text().strip(), 'swap shim was not reached')
        self.assertLess(elapsed, 4)
        self.assertIn('E5T18D_HOOK_ERROR=no-compositor', text)
        self.assertIn('E5T18D_STATUS_END', text)

    def test_hook_signals_desktop_weston_but_not_root_weston(self):
        command = ['/usr/bin/weston', '-c', 'import time; time.sleep(30)']
        root = subprocess.Popen(command)
        desktop = subprocess.Popen(command, preexec_fn=desktop_identity)
        self.processes.extend([root, desktop])
        self.state_file('weston.pid', f'{root.pid}\n')
        text, _ = self.invoke('hook', 'crash\n')
        self.assertIn('E5T18D_HOOK_ERROR=pid-identity', text)
        self.assertIsNone(root.poll())
        self.state_file('weston.pid', f'{desktop.pid}\n')
        text, _ = self.invoke('hook', 'crash\n')
        self.assertIn(f'E5T18D_HOOK_CRASH pid={desktop.pid} signal=KILL', text)
        self.assertEqual(desktop.wait(timeout=2), -signal.SIGKILL)
        self.assertIsNone(root.poll())


def main():
    global SOURCE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--disposable', action='store_true', help='allow fixture setup in a fresh Docker container')
    parser.add_argument('--source-dir', type=Path, default=SOURCE)
    parser.add_argument('tests', nargs='*', help='optional unittest method names')
    args = parser.parse_args()
    if not args.disposable or sys.platform != 'linux' or os.geteuid() != 0 or not Path('/.dockerenv').is_file():
        parser.error('requires --disposable and root inside a fresh Linux Docker container')
    SOURCE = args.source_dir.resolve()
    digests = {name: hashlib.sha256((SOURCE / name).read_bytes()).hexdigest()
               for name in ('desktop-runtime.initd', 'desktop-test-console')}
    names = [f'StateBoundaries.{name}' for name in args.tests]
    suite = (unittest.defaultTestLoader.loadTestsFromNames(names, sys.modules[__name__]) if names else
             unittest.defaultTestLoader.loadTestsFromTestCase(StateBoundaries))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    timeout_path = Path(shutil.which('timeout')).resolve()
    print(json.dumps({'scope': 'E5-T18d deterministic Linux state-boundary probes; not guest acceptance',
                      'sourceSha256': digests, 'tests': result.testsRun,
                      'failures': len(result.failures), 'errors': len(result.errors),
                      'timeoutExecutable': str(timeout_path),
                      'timeoutSha256': hashlib.sha256(timeout_path.read_bytes()).hexdigest(),
                      'externalKillFixture': getattr(StateBoundaries, 'kill_fixture', None),
                      'cases': RESULTS}, indent=2))
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    sys.exit(main())
