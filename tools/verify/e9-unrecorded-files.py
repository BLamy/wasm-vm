#!/usr/bin/env python3
"""Check retained OFF/record evidence without importing or executing emulator/recorder code."""
import argparse
import hashlib
import json
from pathlib import Path
import re

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--directory', required=True, type=Path)
a = p.parse_args()
root = a.directory.resolve()
report = {'task': 'E9-T22a', 'status': 'running', 'inputs': {}, 'checks': []}


def load(name):
    file = root / name / 'report.json'
    body = file.read_bytes()
    report['inputs'][name] = hashlib.sha256(body).hexdigest()
    return json.loads(body)


def off(value, gpu=False):
    assert value['mode'] == 'live-unrecorded' and value['version'] == 1
    assert value['ramBytes'] == ('1073741824' if gpu else '268435456')
    assert value['divider'] == ('64' if gpu else '10') and value['gpu'] is gpu
    for name in ['sessionClock', 'sourceCapture', 'inputCapture', 'durableRecording',
                 'legacyResumeIdentity', 'legacySnapshotNamespace', 'recorderDirtyTracking', 'pendingRamEpoch', 'gpuResultCapture']:
        assert value[name] is False, 'capture became active: ' + name
    assert value['pendingEvents'] == 0
    assert int(value['transition']) >= int(value['retired']) + int(value['idleTransitions'])
    uart = value['uart']
    assert int(uart['appliedBytes']) <= int(uart['offeredBytes'])
    assert int(uart['lastFeedTransition']) <= int(value['transition'])
    assert int(uart['lastOfferTransition']) <= int(value['transition'])


try:
    # This oracle decodes the three literal instructions independently, without the Rust decoder.
    x1 = x2 = 0
    expected = []
    rolling = 0xcbf29ce484222325

    def fold(value):
        global rolling
        rolling = ((rolling ^ value) * 0x100000001b3) & ((1 << 64) - 1)

    for index in range(4096):
        position = index % 3
        pc = 0x80000000 + 4 * position
        instruction = [0x00108093, 0x00210113, 0xff9ff06f][position]
        suffix = ''
        fold(pc)
        fold(instruction)
        if position < 2:
            if position == 0:
                x1 += 1
                register, value = 1, x1
            else:
                x2 += 2
                register, value = 2, x2
            suffix = f' x{register} 0x{value:016x}'
            fold(0x0100000000000000 | register)
            fold(value)
        else:
            fold(0x0200000000000000)
        fold(0x0400000000000000)
        expected.append(f'core 0: 0x{pc:016x} (0x{instruction:08x}){suffix}\n')
    text = ''.join(expected).encode()
    for name in ['off.trace', 'record.trace']:
        body = (root / 'guest-trace' / name).read_bytes()
        assert body == text, 'independent instruction/value prediction failed: ' + name
        report['inputs'][name] = hashlib.sha256(body).hexdigest()
    assert rolling == 0xf571979c4a3bed0a
    state = (root / 'guest-trace/architectural-digest.txt').read_text()
    assert state == '2f46d4f0185cd2e94327082dc107b2c75c94b0637dfa678113789184de6d779f'
    report['checks'].append({'prediction': '4096 literal retirements, x1=1366, x2=2730, equal OFF/record guest trace',
                              'result': 'HELD', 'traceSha256': hashlib.sha256(text).hexdigest(), 'stateDigest': state})
    history = load('history-off')
    assert history['status'] == 'passed' and not history['errors'] and not history['missing']
    legacy = history['result']
    assert len(legacy['attempts']) == 9 and all(row['error'] for row in legacy['attempts'])
    assert legacy['before'] == legacy['after'] and legacy['initialDatabases'] == legacy['finalDatabases'] == []
    report['checks'].append({'prediction': 'legacy identity, generation and async snapshot APIs refuse OFF without creating persistence', 'result': 'HELD'})
    demo, alpine, gpu = [load(name) for name in ['demo', 'alpine-off', 'gpu-off']]
    for data in [demo, alpine, gpu]:
        assert not data['errors'] and not data['missing'] and not data['external']
    assert demo['status'] == gpu['status'] == 'passed'
    assert alpine['status'] == 'unrecorded-alpine-setup-only'
    assert demo['suite'] == {'passed': 127, 'failed': 0}
    for data, physical in [(demo['probe'], False), (alpine['result'], False), (gpu['result'], True)]:
        off(data['initial'], physical)
        off(data['final'], physical)
        assert data['jit']['hasExecutor'] is True and data['jit']['executedBlocks'] > 0
        assert data['jit']['retiredViaJit'] > 0
    assert demo['probe']['final']['transition'] == '1000000'
    assert len(demo['probe']['refusals']) >= 10
    result = alpine['result']
    for phase in result['phases']:
        off(phase)
    assert len(result['inputs']) == 3 and len(result['blocks']) >= 20
    uart = result['final']['uart']
    assert uart['offeredFrames'] == '3' and uart['pendingBytes'] == 0
    assert int(uart['offeredBytes']) == int(uart['appliedBytes']) == sum(row['bytes'] for row in result['inputs'])
    assert uart['lastOfferTransition'] == result['inputs'][-1]['transition']
    assert all(int(left['transition']) < int(right['transition']) for left, right in zip(result['inputs'], result['inputs'][1:]))
    contract = json.loads((root / 'alpine-off/executed-source/docs/design/session-replay-contract.json').read_text())
    lines = result['files']['stdout'].strip().splitlines()
    assert re.sub(r'\s', '', lines[0]) == contract['workload']['after_hex']
    entropy = bytes.fromhex(re.sub(r'\s', '', ''.join(lines[1:3])))
    assert len(entropy) == 32 and hashlib.sha256(entropy).hexdigest() == alpine['guestEntropy']['sha256']
    for data in [result, gpu['result']]:
        assert data['initialDatabases'] == data['finalDatabases'] == []
    report['checks'].append({'prediction': 'literal full-Alpine file bytes, fresh guest entropy and all 3 offered UART frames delivered with capture absent', 'result': 'HELD'})
    result = gpu['result']
    assert not re.search('software|SwiftShader|llvmpipe', result['gpuInitial']['profile']['identity'], re.I)
    assert result['pixel'] == [0, 255, 0, 255] and len(result['owners']) >= 10
    for marker in ['SESSION_QUERY_VISIBLE_1', 'SESSION_QUERY_EMPTY_0', 'SESSION_READBACK_GREEN_16384',
                   'SESSION_FRAME_AND_DISK_OK', 'SESSION_EXPECTED_GPU_ERROR_1205', 'SESSION_DONE']:
        assert marker in result['console']
    assert any(row['name'].startswith('gather') for row in result['typedDma'])
    assert any(row['name'].startswith('scatter') for row in result['typedDma'])
    assert result['checkpointDrainAttack']['error']
    assert result['checkpointDrainAttack']['before'] == result['checkpointDrainAttack']['after']
    counts = {'initialNumericRefusals': 5, 'pendingNumericRefusals': 5,
              'softwareConfusion': 6, 'refusals': 5, 'retiredOwnerRefusals': 3}
    for collection, count in counts.items():
        assert len(result[collection]) == count, collection
        for refusal in result[collection]:
            assert refusal['error'] and refusal['before'] == refusal['after'], refusal['name']
    report['checks'].append({'prediction': 'physical typed GPU DMA works; profile/numeric/history/stale-owner attacks refuse before state or RAM changes', 'result': 'HELD'})
    software_replay, gpu_replay = [load(name) for name in ['software-record-replay', 'gpu-record-replay']]
    assert software_replay['status'] == gpu_replay['status'] == 'passed'
    probe = software_replay['probe']
    assert probe['events'] == 47 and probe['blockCompletions'] == 1 and len(probe['replays']) == 2
    assert len({row['digest'] for row in probe['replays']}) == 1
    assert all(row['ordinaryIngressBlocked'] and row['adapterIngressBlocked'] for row in probe['replays'])
    assert gpu_replay['replay']['digest'] == bytes(gpu_replay['run']['end']['digest']).hex()
    assert not gpu_replay['replayExternalRequests'] and not gpu_replay['replaySockets']
    assert not software_replay['errors'] and not gpu_replay['errors']
    report['checks'].append({'prediction': 'existing software interpreter/JIT and original physical GPU recording replay retain their full witnesses and zero-egress fence', 'result': 'HELD'})
    report['status'] = 'passed'
except BaseException as error:
    report['status'] = 'failed'
    report['failure'] = repr(error)
    raise
finally:
    destination = root / 'direct-artifact-reader.json'
    with destination.open('x') as stream:
        stream.write(json.dumps(report, indent=2) + '\n')
