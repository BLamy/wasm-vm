"""Real aplay/FIFO ordering only; null PCM is NOT device/browser acceptance."""
import array
import fcntl
import json
import os
from pathlib import Path
import subprocess
import termios
import time

root = Path('/work')
fifo = root / 'input.fifo'
os.mkfifo(fifo)
hold = os.open(fifo, os.O_RDWR | os.O_NONBLOCK)
env = dict(os.environ, ALSA_CONFIG_PATH='/usr/share/alsa/alsa.conf', ALSA_CONFIG_DIR='/usr/share/alsa')
# This is an actual ALSA file PCM over null: its output fd proves snd_pcm_open
# has happened, but no hardware ownership or device restoration is asserted.
env['HOME'] = '/work'
subprocess.run(['aplay', '--version'], check=True)
p = subprocess.Popen(['strace', '-f', '-o', '/work/syscalls.log', '-e',
    'trace=execve,openat,read,write,ioctl,close', 'aplay', '-Dprobe',
    '--period-size=480', '--buffer-size=960', '-f', 'S16_LE', '-t', 'raw',
    '-r48000', '-c2', '/work/input.fifo'], env=env,
    stdout=open('/work/aplay.stdout', 'wb'), stderr=open('/work/aplay.stderr', 'wb'))
deadline = time.monotonic() + 8
pid = None
while time.monotonic() < deadline:
    for path in Path('/proc').glob('[0-9]*/exe'):
        try:
            if path.readlink().name == 'aplay':
                pid = int(path.parent.name)
                break
        except (FileNotFoundError, PermissionError):
            pass
    if pid and Path('/work/pcm.raw').exists():
        break
    if p.poll() is not None:
        raise RuntimeError(Path('/work/aplay.stderr').read_text())
    time.sleep(.02)
assert pid and Path('/work/pcm.raw').exists(), 'aplay did not open the real ALSA file PCM before FIFO data'

def observe():
    proc = Path('/proc') / str(pid)
    stat = (proc / 'stat').read_text().split(') ', 1)[1].split()
    available = array.array('i', [0])
    fcntl.ioctl(hold, termios.FIONREAD, available, True)
    fds = {x.name: str(x.readlink()) for x in (proc / 'fd').iterdir()}
    return dict(pid=pid, starttime=stat[19], executable=str((proc / 'exe').readlink()),
                wait=(proc / 'wchan').read_text(), fds=fds,
                inputBytesAvailable=available[0], pcmBytes=Path('/work/pcm.raw').stat().st_size,
                io=(proc / 'io').read_text())

before = observe()
time.sleep(.15)
after = observe()
assert before['pid'] == after['pid'] and before['starttime'] == after['starttime']
assert before['executable'].endswith('/aplay')
assert '/work/pcm.raw' in before['fds'].values()
assert '/work/input.fifo' in before['fds'].values()
assert before['inputBytesAvailable'] == after['inputBytesAvailable'] == 0
assert before['pcmBytes'] == after['pcmBytes'] == 0
assert before['wait'] == after['wait'] == 'pipe_read'
assert before['io'] == after['io'], 'aplay progressed before feed'
# No snapshot or browser gesture is simulated: this is only the prospective
# post-gesture finite producer boundary, after the two empty/open observations.
payload = bytes([1, 0, 255, 127]) * 960
assert os.write(hold, payload) == len(payload)
os.close(hold)
code = p.wait(timeout=8)
pcm = Path('/work/pcm.raw').read_bytes()
assert code == 0
assert pcm[:len(payload)] == payload and len(pcm) >= len(payload)
print(json.dumps(dict(acceptance=False, backend='actual ALSA file over null',
    before=before, after=after, exitCode=code, fedBytes=len(payload), pcmBytes=len(pcm),
    payloadPrefixExact=True), indent=2))
