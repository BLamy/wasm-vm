#!/usr/bin/env python3
"""Recompute independent full planes, canonical hashes and native queue boundaries."""
import hashlib
import json
from pathlib import Path
import struct
import sys

root = Path(sys.argv[1]).resolve()
sha = lambda b: hashlib.sha256(b).hexdigest()
report = json.loads((root / 'hardware/report.json').read_bytes())
assert report['status'] == 'passed' and not report['trackedChanges']
assert report['browserErrors'] == {'console': [], 'page': [], 'requests': []}
result = report['browserResult']['result']
assert not result['guestExecution'] and not result['productionNegotiation'] and 'Metal' in result['gpu']
hints = [0, 16, 32, 48, 64, 80, 96, 112]
seeds = sorted({v['seed'] for v in result['runs']})
assert len(seeds) == 3 and len(result['runs']) == 24
assert {(v['seed'], v['hint']) for v in result['runs']} == {(s, h) for s in seeds for h in hints}
planes = []
for run in result['runs']:
    raw = bytes.fromhex(next(v['bytes'] for v in run['originalData'] if v['id'] == 201))
    commands = bytes.fromhex(run['commands'])
    packets, at = [], 0
    while at < len(commands):
        header = struct.unpack_from('<I', commands, at)[0]
        count = header >> 16
        words = list(struct.unpack_from('<' + 'I' * count, commands, at + 4))
        packets.append((header & 255, words))
        at += 4 + count * 4
    ubos = [w for op, w in packets if op == 27]
    assert len(ubos) == 2 and [w[0:2] for w in ubos] == [[0, 1], [1, 1]]
    assert all(w[4] == 201 and w[3] == 16384 for w in ubos)
    offset = ubos[0][2] + 1023 * 16
    words = struct.unpack_from('<IIII', raw, offset)
    expected = bytes((((word * 2) & 0xffffffff) >> ((run['seed'] % 4) * 8)) & 255 for word in words)
    assert list(expected) == run['expected']
    assert bytes.fromhex(run['plane']['bytes']) == expected * 256
    assert run['plane']['pixels'] == 256
    assert next(w for op, w in reversed(packets) if op == 6) == [16, 0, 201]
    assert next(w for op, w in reversed(packets) if op == 11) == [201, 2, 48]
    assert struct.unpack_from('<HHH', raw, 48) == (0, 1, 2)
    assert struct.unpack_from('<12f', raw) == (-1, -1, 0, 1, 3, -1, 0, 1, -1, 3, 0, 1)
    owner = next(r for r in run['accepted']['resources'] if r['identity']['id'] == 201)
    assert owner['metadata']['bind'] == run['hint'] and owner['metadata']['width'] == len(raw)
    assert any(e['kind'] == 'input' and bytes.fromhex(e['bytes']) == raw for e in run['exchanges'])
    assert any(e['kind'] == 'output' and bytes.fromhex(e['bytes']) == expected * 256 for e in run['exchanges'])
    assert run['snapshot']['gpuDraws'] == 1 and run['snapshot']['liveSyncs'] == 0
    assert any(e['type'] == 'cancelJob' for e in run['events'])
    for point in run['states']:
        assert point['native']['gpuBytes'] == point['host']['store']['budgets']['gpuBytes'] == point['modeledGpuBytes']
        assert len(point['machineDigest']) == 64
    planes.append({'seed': run['seed'], 'hint': run['hint'], 'inputSha256': sha(raw),
                   'expected': list(expected), 'outputSha256': sha(expected * 256), 'pixels': 256})
names = [v['name'] for v in result['nativeCalls']]
for name in ['bindBufferRange', 'copyBufferSubData', 'shaderSource', 'compileShader', 'linkProgram',
             'drawElements', 'readPixels', 'fenceSync', 'clientWaitSync', 'getBufferSubData', 'deleteSync']:
    assert name in names, name
assert names.count('drawElements') >= 24 and 'finish' not in names
assert len(result['owners']['accepted']['resources']) == 64
assert len(result['owners']['historical']['events'][-1]['resources']) == 16
assert len(result['refusals']['rows']) == 67
native = (root / 'native-submit.stderr').read_text()
records = [json.loads(l.removeprefix('SUBMIT3D_PORTABLE_RECORD ')) for l in native.splitlines() if l.startswith('SUBMIT3D_PORTABLE_RECORD ')]
guards = [json.loads(l.removeprefix('DESKTOP_SUBMIT_POINT ')) for l in native.splitlines() if l.startswith('DESKTOP_SUBMIT_POINT ')]
selected = [v for v in records if v['case'].startswith('desktop-')]
assert len(guards) == len(selected) and all(v['guard'] == 'a5' * 40 and len(v['machineDigest']) == 64 for v in guards)
for v in records + [record for run in result['runs'] for record in run['records']]:
    for kind in ['transport', 'submit']:
        assert sha(bytes.fromhex(v[kind + 'Canonical'])) == v[kind + 'Digest']
assert sorted(struct.unpack_from('<I', bytes.fromhex(v['request']), 36)[0] for v in selected if v['case'] == 'desktop-buffer-create') == hints
assert len([v for v in selected if v['case'] == 'desktop-buffer-invalid']) == 95
traces = [l for l in native.splitlines() if l.startswith('SUBMIT3D_GUEST_TRACE ')]
assert len(traces) >= len(selected)
audit = {'schema': 'native-buffer-integration-audit-v1', 'planes': planes, 'pixels': 6144,
         'nativeCanonicalRecords': len(records), 'nativeGuardPoints': len(guards), 'nativeRetiredLoopTraces': len(traces),
         'hardwareCalls': len(names), 'hints': hints, 'seeds': seeds,
         'guestExecution': False, 'productionAuthority': False,
         'changedJsRuntime': 'none; existing host storage and shader semantics are authenticated by held source/evidence hashes',
         'testToolingWaiver': 'new literal queue fixture, independent audit, runner selection and metadata do not add runtime product semantics'}
(root / 'integration-audit.json').write_text(json.dumps(audit, indent=2) + '\n')
print(json.dumps({k: audit[k] for k in ['pixels', 'nativeCanonicalRecords', 'nativeGuardPoints', 'hardwareCalls']}))
