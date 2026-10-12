#!/usr/bin/env python3
"""Interrogate recorded queue/owner/GL results and V8 changed-byte coverage."""
import difflib
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

repo = Path(__file__).resolve().parents[2]
root = Path(sys.argv[1]).resolve()
base = '0660eebf08a1b047109ed4e2e508132b68d103ba'
report = json.loads((root / 'hardware/report.json').read_bytes())
assert report['status'] == 'passed' and not report['trackedChanges']
assert report['browserErrors'] == {'console': [], 'page': [], 'requests': []}
result = report['browserResult']['result']
assert result['guestExecution'] is False and result['productionNegotiation'] is False
assert 'Metal' in result['gpu']
assert [(v['name'], len(v['steps']), v['peak'], v['refusal']) for v in result['lifetimes']] == [
    ('compositor', 56, 24, None), ('kmscube', 8, 4, None), ('glmark2-es2', 34, 25, 3025)]
for row in result['lifetimes']:
    for step in row['steps']:
        record = step['record']
        assert bytes.fromhex(record['response'])[:4] == step['expected'].to_bytes(4, 'little')
        assert len(record['ring']['descriptors']) == 64
        for state in [step['before'], step['after']]:
            assert len(state['machineDigest']) == 64
            assert state['native']['logicalBytes'] == state['modeledBytes']
            assert state['native']['gpuBytes'] == state['modeledGpuBytes'] == state['host']['store']['budgets']['gpuBytes']
assert len(result['owners']['accepted']['resources']) == 64
assert result['owners']['completions'][0]['args'][3:5] == [0, True]
assert len(result['schedules']) == 3 and len({v['seed'] for v in result['schedules']}) == 3
planes = []
colors = [bytes(v) for v in [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255]]]
for schedule in result['schedules']:
    original = schedule['original']
    assert original['gpuDraws'] == 3 and original['packetCount'] == 210
    full = bytes.fromhex(next(e['bytes'] for e in original['exchanges'] if e['kind'] == 'output' and len(e['bytes']) == 8192))
    expected = b''.join(colors[(y >= 16) * 2 + (x >= 16)] for y in range(32) for x in range(32))
    assert full == expected
    planes.append({'seed': schedule['seed'], 'pixels': 1024, 'sha256': hashlib.sha256(full).hexdigest()})
names = [v['name'] for v in result['nativeCalls']]
for name in ['createBuffer', 'createTexture', 'texStorage2D', 'shaderSource', 'compileShader', 'linkProgram',
             'drawElements', 'readPixels', 'fenceSync', 'clientWaitSync', 'getBufferSubData', 'deleteSync']:
    assert name in names, name
assert 'finish' not in names
native = (root / 'native-submit.stderr').read_text()
records = [json.loads(l.removeprefix('SUBMIT3D_PORTABLE_RECORD ')) for l in native.splitlines() if l.startswith('SUBMIT3D_PORTABLE_RECORD ')]
selected = [v for v in records if v['case'].startswith('desktop-')]
assert len(selected) == 132
assert bytes.fromhex(next(v['response'] for v in selected if v['case'] == 'desktop-refuse65'))[:4] == (0x1201).to_bytes(4, 'little')
points = [json.loads(l.removeprefix('DESKTOP_SUBMIT_POINT ')) for l in native.splitlines() if l.startswith('DESKTOP_SUBMIT_POINT ')]
assert len(points) == 132 and all(v['guard'] == 'a5' * 40 and len(v['machineDigest']) == 64 for v in points)
traces = [l for l in native.splitlines() if l.startswith('SUBMIT3D_GUEST_TRACE ')]
assert len(traces) >= 133

path = 'renderer/virgl-command/control-bridge.mjs'
coverage = json.loads((root / 'hardware/browser-coverage.json').read_bytes())
script = next(s for s in coverage['scripts'] if s['source'] == path)
current = (repo / path).read_text()
assert script['sha256'] == hashlib.sha256(current.encode()).hexdigest()
previous = subprocess.check_output(['git', 'show', f'{base}:{path}'], cwd=repo).decode()
ranges = [r for f in script['coverage']['functions'] for r in f['ranges']]
changed = [(j1, j2) for tag, _, _, j1, j2 in difflib.SequenceMatcher(None, previous, current, autojunk=False).get_opcodes()
           if tag in ['replace', 'insert']]
checks, waivers = [], []
for match in re.finditer(r'[A-Za-z_$][\w$]*|\d+', current):
    if not any(match.start() < b and match.end() > a for a, b in changed):
        continue
    line = current.count('\n', 0, match.start()) + 1
    start = current.rfind('\n', 0, match.start()) + 1
    line_text = current[start:current.find('\n', match.start())]
    if line_text.strip().startswith(('import ', '//', '/**', '*')):
        waivers.append({'line': line, 'token': match.group(), 'reason': 'import or documentation has no dynamic operand'})
        continue
    enclosing = [r for r in ranges if r['startOffset'] <= match.start() < r['endOffset']]
    assert enclosing, (line, match.group())
    smallest = min(enclosing, key=lambda r: r['endOffset'] - r['startOffset'])
    assert smallest['count'] > 0, (line, match.group(), smallest)
    checks.append({'line': line, 'token': match.group(), 'offset': match.start(), 'range': smallest})
assert checks
audit = {'schema': 'desktop-submit-integration-audit-v1', 'base': base, 'nativeSelectedRecords': len(selected),
    'nativeGuardPoints': len(points), 'retiredGuestTraceLines': len(traces), 'hardwareNativeCalls': len(names),
    'fullPlanes': planes, 'changedJsOperands': checks, 'staticJsWaivers': waivers,
    'unchangedEnclosingJsBytes': 'byte-equal substrings of the previous head carry their prior proof; inserted/replaced tokens above must execute',
    'wasmBranchEvidence': {'selected': 'original packed-depth controls and actual64-resource callback',
        'historical': 'new(callback,true) retains16/17 count and packed-depth refusal',
        'disabled': 'new(callback,false) exposes no control/submit snapshot and rejects context in protocol recording'},
    'guestExecution': False, 'productionAuthority': False}
(root / 'integration-audit.json').write_text(json.dumps(audit, indent=2) + '\n')
print(json.dumps({k: audit[k] for k in ['nativeSelectedRecords', 'retiredGuestTraceLines', 'hardwareNativeCalls']}))
