#!/usr/bin/env python3
"""Interrogate retained HTTP/guest artifacts without executing the emulator."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--directory', required=True, type=Path)
a = p.parse_args()
root = a.directory.resolve()
report = dict(task='E9-T22b', status='running', inputs={}, checks=[])


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load(name):
    data = (root / name / 'report.json').read_bytes()
    report['inputs'][name] = sha(data)
    return json.loads(data)


try:
    guest = root / 'guest-trace'
    program = (Path(__file__).resolve().parents[2] / 'web/assets/e9-network-capture.bin').read_bytes()
    trace = (guest / 'record.trace').read_text().splitlines()
    assert len(trace) == 8192
    for line in trace:
        match = re.match(r'core 0: 0x([0-9a-f]{16}) \(0x([0-9a-f]{8})\)', line)
        assert match, 'canonical guest instruction trace'
        pc, instruction = (int(value, 16) for value in match.groups())
        offset = pc - 0x80000000
        assert offset >= 0 and offset % 4 == 0 and offset + 4 <= len(program)
        assert struct.unpack_from('<I', program, offset)[0] == instruction
    assert (guest / 'architectural-digest.txt').read_text() == '5c3e63ca60877913f09f9580588421053a412ffae4cd56695df354e4814adfd9'
    assert len((guest / 'network.tsv').read_text().splitlines()) == 3
    report['checks'].append(dict(prediction='8192 actual native guest instructions match the fixed program; three owned network events and stable complete architectural state', result='HELD', traceSha256=sha((guest / 'record.trace').read_bytes())))

    http = load('alpine-http')
    assert http['status'] == 'owned-http-full-alpine-off-on-replay'
    assert not http['errors'] and not http['missing'] and not http['external']
    assert http['inputs']['rawImage'] == 'ebcd6b7a3569f6280f901b9697f3b8f06a11dd800b2410b540fb6bbdea8c60f8'
    for name in ['tools/verify/e9-owned-http-browser.mjs', 'tools/verify/e9-owned-http-page.mjs', 'tools/verify/e9-owned-http-wire.mjs', 'web/owned-http-probe.js', 'docs/design/session-replay-contract.json']:
        assert sha((root / 'alpine-http/executed-source' / name).read_bytes()) == http['inputs'][name]
    result = http['result']
    assert [mode['mode'] for mode in result['modes']] == ['off', 'on']
    assert len(result['refusals']) == 15  # Two opens + twelve old callbacks + replay factory.
    assert all(row.get('message', row.get('error')) for row in result['refusals'])
    for mode in result['modes']:
        assert mode['status'] == 'all-ten-real-bodies' and len(mode['inputs']) == 11 and mode['blocks'] >= 20
        assert mode['jit']['hasExecutor'] and mode['jit']['executedBlocks'] > 0 and mode['jit']['retiredViaJit'] > 0
        server = mode['server']
        assert server['closed'] and server['server']['closed'] and server['server']['failure'] is None
        assert server['server']['connections'] == 10
        assert server['server']['requests'] == server['server']['responsesQueued'] == [1] * 10
        assert server['server']['bodyBytesQueued'] == [1024] * 10
        assert int(server['txInjected']) == int(server['txCommitted']) and int(server['txInjected']) >= 30
        assert int(server['rxDequeued']) == int(server['rxCommitted']) and int(server['rxCommitted']) >= 20
        assert [body['index'] for body in mode['bodies']] == list(range(1, 11))
        for body in mode['bodies']:
            expected = bytes([17 + body['index']]) * 1024
            assert body['length'] == 1024 and body['hex'] == expected.hex() and body['sha256'] == sha(expected)
    off = result['modes'][0]
    for key in ['sessionClock', 'sourceCapture', 'inputCapture', 'durableRecording', 'legacyResumeIdentity', 'legacySnapshotNamespace', 'audioOutputAttached', 'audioCaptureAttached', 'recorderDirtyTracking', 'pendingRamEpoch', 'gpuResultCapture']:
        assert off['final'][key] is False, key
    assert off['final']['pendingEvents'] == 0
    uart = off['final']['uart']
    assert uart['offeredFrames'] == '11' and uart['pendingBytes'] == 0 and uart['offeredBytes'] == uart['appliedBytes']
    assert int(uart['offeredBytes']) == sum(row['bytes'] for row in off['inputs'])
    assert result['initialDatabases'] == result['databases'] == []
    report['checks'].append(dict(prediction='ten literal bodies and actual independent per-index server counts in both modes; OFF retains no event/observation history', result='HELD'))

    expected_raw = {'initial.resume', 'final.resume', 'replay.resume', 'receipts.json', 'witnesses.json'}
    assert {row['file'] for row in http['raw']} == expected_raw
    for row in http['raw']:
        data = (root / 'alpine-http' / row['file']).read_bytes()
        assert len(data) == row['bytes'] and sha(data) == row['sha256']
    initial = (root / 'alpine-http/initial.resume').read_bytes()
    final = (root / 'alpine-http/final.resume').read_bytes()
    replay = (root / 'alpine-http/replay.resume').read_bytes()
    assert final == replay
    assert result['initial']['digest'] == sha(initial) and result['final']['digest'] == sha(final)
    assert len(final) == result['replays'][0]['rawBytes'] and result['replays'][0]['exactNativeBytes']
    assert result['replays'][0]['digest'] == sha(replay) and result['replays'][0]['raw']['sha256'] == sha(replay)
    receipts = json.loads((root / 'alpine-http/receipts.json').read_text())
    witnesses = json.loads((root / 'alpine-http/witnesses.json').read_text())
    assert len(receipts) == result['receipts'] == int(result['final']['sequence']) == result['replays'][0]['events']
    assert [row['sequence'] for row in receipts] == [str(i) for i in range(1, len(receipts) + 1)]
    assert len(witnesses) == result['replays'][0]['witnesses'] == 12
    assert bytes(witnesses[0]['digest']).hex() == sha(initial) and bytes(witnesses[-1]['digest']).hex() == sha(final)
    network = [row for row in receipts if row['channel'] == 20]
    assert len(network) == http['wire']['networkEvents'] == int(result['modes'][1]['server']['events'])
    assert http['wire']['connections'] == 10
    for index, stream in enumerate(http['wire']['streams'], 1):
        assert stream['index'] == index and stream['bodyBytes'] == 1024 and stream['bodySha256'] == sha(bytes([17 + index]) * 1024)
    assert result['replayEgress'] == 0 and result['originalServerUnchanged']
    report['checks'].append(dict(prediction='original/replay complete native bytes are identical; all 12 witnesses accepted; all owned network frames are retained and ten TCP streams independently reconstruct exact bodies; zero live replay', result='HELD', nativeSha256=sha(final), receiptSha256=sha((root / 'alpine-http/receipts.json').read_bytes())))

    demo = load('demo')
    assert demo['status'] == 'passed' and demo['suite'] == dict(passed=127, failed=0)
    assert not demo['errors'] and not demo['missing'] and not demo['external']
    probe = demo['probe']
    assert probe['status'] == 'passed' and probe['originalServerUnchanged'] and probe['replays'][0]['exactNativeBytes']
    assert all(len(mode['bodies']) == 10 and mode['server']['server']['requests'] == [1] * 10 for mode in probe['modes'])
    assert demo['immutableChunks'] and len(demo['immutableRequests']) == len(demo['immutableChunks'])
    report['checks'].append(dict(prediction='built visible UI passes 127/0, exercises the same full-guest HTTP probe and lights its panel and roadmap live', result='HELD'))
    report['status'] = 'passed'
except BaseException as error:
    report['status'] = 'failed'
    report['failure'] = repr(error)
    raise
finally:
    with (root / 'direct-artifact-reader.json').open('x') as file:
        file.write(json.dumps(report, indent=2) + '\n')
