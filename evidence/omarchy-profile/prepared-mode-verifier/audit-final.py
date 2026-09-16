#!/usr/bin/env python3
"""Independent seal, negative-mode transaction, output and PNG audit. No guest."""
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import zlib

ROOT = Path(__file__).resolve().parents[3]
GATES = ROOT / 'evidence/omarchy-profile/prepared-mode-gates-r2'
RUN = ROOT / 'evidence/omarchy-profile/prepared-mode-r2'
HEAD = '545f22ad618fe8f9bd6dea3c4fe4cb6c54cc006e'
CAPTURE_HEAD = '4d3aef8ec125aefe9c00a162619bd9aa0591de36'
ENV = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
sha = lambda data: hashlib.sha256(data).hexdigest()


def committed(ref, path):
    return subprocess.check_output(['git', 'show', ref + ':' + path], cwd=ROOT, env=ENV)


index = (GATES / 'sha256.txt').read_bytes()
assert sha(index) == 'b3fd0051965f62799c41bd7a283b2ce48a1aa20094c81ca48a7670e880c86708'
sealed = []
for line in index.decode().splitlines():
    digest, name = line.split('  ', 1)
    assert sha((GATES / name).read_bytes()) == digest, name
    sealed.append(name)
assert len(sealed) == 21
preserved = json.loads((GATES / 'r1-preserved.json').read_text())
for row in preserved:
    data = (ROOT / row['path']).read_bytes()
    assert len(data) == row['bytes'] and sha(data) == row['sha256']

capture = json.loads((GATES / 'capture-paths.json').read_text())
assert capture['head'] == CAPTURE_HEAD and capture['guestHead'] == HEAD and capture['code'] == 0
recorder = 'tools/verify/omarchy-desktop-live.mjs'
assert sha(committed(HEAD, recorder)) == sha(committed(CAPTURE_HEAD, recorder)) == capture['captureBodySourceSha256']
fixture = 'tools/verify/omarchy-mode-capture.test.mjs'
assert sha(committed(CAPTURE_HEAD, fixture)) == sha((ROOT / fixture).read_bytes()) == capture['testSha256']
assert subprocess.check_output(['git', 'diff', '--name-only', CAPTURE_HEAD+'^', CAPTURE_HEAD], cwd=ROOT, env=ENV).decode().splitlines() == [fixture]

report = json.loads((RUN / 'desktop/report.json').read_text())
for path, receipt in report['trial']['helpers'].items():
    assert sha((ROOT / path).read_bytes()) == receipt['sha256']
assert report['result'] == 'failed' and 'pair' not in report
prep = report['modePreparation']
assert prep['status'] == 'preparation-failed-input-untested'
assert 'focus: deadline exceeded' in prep['error']
assert all(key not in prep for key in ['active', 'lastPixels', 'readyMode', 'visibleAt', 'exportStartedAt', 'exportFinishedAt'])
assert 'capturePersistence' not in report and 'captureOverlayStore' not in report
traffic = report['workerTraffic']
displays = [(i, row) for i, row in enumerate(traffic) if row['type'] == 'worker-call' and row['method'] == 'setDisplay']
assert len(displays) == 2
assert displays[0][1]['args'] == [1280, 800]
assert displays[1][1]['args'] == [640, 400]
mode_index, mode = displays[1]
replies = [(i, row) for i, row in enumerate(traffic) if row['type'] == 'input-result' and row.get('id') == mode['id']]
assert len(replies) == 1
reply_index, reply = replies[0]
assert reply_index > mode_index and reply['result'] is True and reply['error'] is None
serial = json.loads((ROOT / 'evidence/omarchy-profile/prepared-mode-verifier/r2-run-audit.json').read_text())['serial']
assert len(serial) == 4
command = serial[1]
assert 'mode = "640x400@60"' in command['command']
assert command['workerIndex'] > reply_index
assert command['exit'] == 0 and command['stdout'].strip() == 'ok'
assert serial[2]['exit'] == 0 and serial[3]['command'].endswith('-j activewindow')
assert 'completedAt' not in serial[3]
foot, = json.loads(serial[2]['stdout'])
assert foot == prep['foot'] and foot['mapped'] and foot['visible'] and not foot['hidden']
assert foot['at'] == [12, 38] and foot['size'] == [616, 350]
after = report['renderBudget']['after']
assert after['gpu']['scanoutResource'] == 7
assert (after['gpu']['advertisedWidth'], after['gpu']['advertisedHeight']) == (640, 400)
assert (after['gpu']['scanoutWidth'], after['gpu']['scanoutHeight']) == (640, 448)
assert after['presentation']['latest'] == dict(rect=dict(x=0, y=0, width=640, height=400), resourceWidth=640, resourceHeight=448)
assert after['presentation']['framesReceived'] == after['presentation']['successfulPresents'] == 6
before = report['renderBudget']['before']['presentation']
assert before['framesReceived'] == before['successfulPresents'] == 3

directories = []
for suffix in ['r1', 'r2']:
    directory = ROOT / ('target/omarchy-mode640-' + suffix)
    assert directory.is_dir() and not directory.is_symlink()
    children = [str(p.relative_to(directory)) for p in directory.rglob('*')]
    assert children == []
    directories.append(dict(path=str(directory), entries=children, mode=oct(directory.stat().st_mode & 0o777)))

# Decode this PNG directly, including CRCs and all five standard PNG filters.
png = (RUN / 'desktop/failure.png').read_bytes()
assert png[:8] == b'\x89PNG\r\n\x1a\n'
offset, compressed, ihdr, ended = 8, bytearray(), None, False
while offset < len(png):
    size = struct.unpack('>I', png[offset:offset+4])[0]
    kind = png[offset+4:offset+8]
    data = png[offset+8:offset+8+size]
    crc = struct.unpack('>I', png[offset+8+size:offset+12+size])[0]
    assert zlib.crc32(kind + data) & 0xffffffff == crc
    if kind == b'IHDR': ihdr = struct.unpack('>IIBBBBB', data)
    if kind == b'IDAT': compressed.extend(data)
    offset += 12 + size
    if kind == b'IEND':
        ended = True
        break
assert ended and offset == len(png)
width, height, depth, color, compression, filtering, interlace = ihdr
assert (width, height, depth, compression, filtering, interlace) == (1280, 800, 8, 0, 0, 0)
assert color in [2, 6]
bpp = 3 if color == 2 else 4
stride = width*bpp
raw = zlib.decompress(compressed)
assert len(raw) == height*(stride+1)
previous = bytearray(stride)
maximum, alpha_minimum = 0, 255
for y in range(height):
    filtering = raw[y*(stride+1)]
    row = bytearray(raw[y*(stride+1)+1:(y+1)*(stride+1)])
    assert filtering <= 4
    for x in range(stride):
        left, above, upper_left = row[x-bpp] if x >= bpp else 0, previous[x], previous[x-bpp] if x >= bpp else 0
        if filtering == 1: predictor = left
        elif filtering == 2: predictor = above
        elif filtering == 3: predictor = (left+above)//2
        elif filtering == 4:
            p = left + above - upper_left
            a, b, c = abs(p-left), abs(p-above), abs(p-upper_left)
            predictor = left if a <= b and a <= c else above if b <= c else upper_left
        else: predictor = 0
        row[x] = (row[x]+predictor) & 255
    for x in range(0, stride, bpp):
        maximum = max(maximum, *row[x:x+3])
        if bpp == 4: alpha_minimum = min(alpha_minimum, row[x+3])
    previous = row
assert maximum == 0 and alpha_minimum == 255

print(json.dumps(dict(
    guestHead=HEAD, captureFixtureHead=CAPTURE_HEAD,
    sealSha256=sha(index), sealedArtifacts=len(sealed), preservedR1Artifacts=len(preserved),
    unchangedCurrentHelpers=len(report['trial']['helpers']),
    modeWire=dict(requestIndex=mode_index, requestId=mode['id'], replyIndex=reply_index,
        commandIndex=command['workerIndex'], commandReplyIndex=command['replyWorkerIndex'],
        requests640x400=1, accepted=True, smallerModeObserved=True, beforeCounters=3, afterCounters=6),
    focusQueryCompleted=False, pixelQualificationReached=False, exportStarted=False,
    privatePairDirectories=directories,
    png=dict(path=str(RUN / 'desktop/failure.png'), sha256=sha(png), width=width, height=height,
        pixels=width*height, maximumRGBChannel=maximum, minimumAlpha=alpha_minimum, entirelyBlack=True),
    cleanup=report['cleanup'],
    processTableCheck='Unavailable under verifier sandbox (ps EPERM); cleanup proof uses the recorded owned-browser/client close and normally closed child.',
    result='negative-preparation-only', usablePair=False, keyboardTested=False
), indent=2))
