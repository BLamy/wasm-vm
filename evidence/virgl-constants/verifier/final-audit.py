#!/usr/bin/env python3
"""Independent final ownership/reflection audit and reproducible evidence index."""
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
FROZEN = '81cd3a4c403176be4b0191fa00ed37f4fd1e1e35'
CLAIM = '68186f6edf63a6f3c0e2160892a2bc5b868ab8f8'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
read = lambda p: json.loads(p.read_text())
worker = ROOT / 'evidence/virgl-constants/worker'
hardware = read(worker / 'hardware/report.json')
actual = hardware['acceptance']
critic = read(HERE / 'normal/report.json')
control = read(HERE / 'alias-sabotage/report.json')
decoder = read(HERE / 'decoder-attacks.json')
coverage = read(HERE / 'coverage-audit.json')
assert hardware['gitHead'] == FROZEN
assert sha(worker / 'hardware/report.json') == '605e77cc268e735c2fb572b0a69c5b9e8dd41369753a45f5a7f32b25aa6856d4'
assert critic['head'] == control['head'] == CLAIM
assert actual['hostUniformComponents'] == [4096, 4096]
assert actual['status'] == critic['status'] == control['status'] == 'passed'
assert critic['acceptance']['status'] == decoder['status'] == coverage['status'] == 'passed'

for doc in (critic, control):
    assert doc['browserErrors'] == []
    for served in doc['served']:
        p = ROOT / served['path']
        assert sha(p) == served['originalSha256']
        if '/verifier/' not in served['path'] and '/build/' not in served['path']:
            assert hashlib.sha256(subprocess.check_output(['git', 'show', f'{FROZEN}:{served["path"]}'], cwd=ROOT)).hexdigest() == served['originalSha256']
        if served['path'] == 'renderer/virgl-command/state.mjs':
            if doc is critic:
                assert served['servedSha256'] == served['originalSha256']
            else:
                sabotage = doc['sabotage']
                assert served['servedSha256'] == sabotage['servedSha256']
                assert served['originalSha256'] == sabotage['originalSha256']
                text = p.read_text()
                assert text.count(sabotage['before']) == 1
                assert hashlib.sha256(text.replace(sabotage['before'], sabotage['after']).encode()).hexdigest() == served['servedSha256']

summary = {'reflection': [], 'rollback': [], 'incomplete': [], 'padding': [], 'ownership': [], 'async': []}
object_count = 0
for rig in actual['rigs'] + actual['validationRigs']:
    assert rig['glObjects']['live'] == 0
    object_count += rig['glObjects']['created']
    for key in ['finalBudgets', 'finalResourceBudgets']:
        if key in rig:
            assert all(v == 0 for v in rig[key].values())
    uploads = [event for event in rig['glEvents'] if event['call'] == 'uniform4uiv']
    for event in uploads:
        assert len(event['words']) <= 184 and len(event['words']) % 4 == 0
        assert event['name'] in ['vsconst0[0]', 'fsconst0[0]']
        assert event['programId'] == event['currentProgramId']
    for draw in rig.get('draws', []):
        for uniform in draw['uniforms']:
            assert 0 <= uniform['activeCount'] <= uniform['count'] <= 47
            assert uniform['uploadCount'] == min(uniform['activeCount'], 46)
            stage = ['vertex', 'fragment'].index(uniform['stage'])
            assert uniform['activeCount'] * 4 <= draw['hostUniformComponents'][stage]
            assert len(draw['bindings']['constants'][stage]) >= uniform['uploadCount'] * 4
            assert uniform['words'][:uniform['uploadCount'] * 4] == draw['bindings']['constants'][stage][:uniform['uploadCount'] * 4]
        assert draw['storedConstantBytes'] <= 23552
    if rig['name'] in ['low', 'order', 'inactive-vertex', 'inactive-fragment', 'both-inactive']:
        first = rig['draws'][0]
        for uniform in first['uniforms']:
            inactive = rig['name'] in ['both-inactive', 'inactive-' + uniform['stage']]
            count = 47 if rig['name'] == 'order' else 46
            assert (uniform['count'], uniform['activeCount'], uniform['uploadCount']) == (count, 0 if inactive else count, 0 if inactive else 46)
            if inactive:
                prefix = 'vs' if uniform['stage'] == 'vertex' else 'fs'
                assert not any(event['name'].startswith(prefix) for event in uploads)
        summary['reflection'].append({'rig': rig['name'], 'extents': [{key: u[key] for key in ['stage', 'count', 'activeCount', 'uploadCount']} for u in first['uniforms']]})
    for attack in rig.get('attacks', []):
        assert not attack['result']['ok']
        assert attack['before']['budgets'] == attack['after']['budgets']
        assert not any(event['call'] in ['drawElements', 'getBufferSubData', 'copyBufferSubData'] for event in attack['events'])
        if attack['name'] == 'malformed-tail':
            assert attack['before'] == attack['after'] and attack['events'] == []
            assert attack['result']['appliedCommands'] == 0
        elif 'valid prefix' in attack['name']:
            assert attack['result']['appliedCommands'] == 1
        else:
            assert attack['result']['error']['code'] == 'incomplete-draw'
            assert attack['result']['appliedCommands'] == 0
        summary['incomplete'].append({'rig': rig['name'], 'attack': attack['name'], 'result': attack['result'], 'events': [e['call'] for e in attack['events']]})
    for entry in rig.get('padding', []):
        assert len(entry['poisoned']['entries']) == 2
        for before, after in zip(entry['poisoned']['entries'], entry['after']):
            assert before['name'] == after['name'] and before['name'].endswith('[46]')
            assert before['values'] == before['observed'] == after['observed']
        summary['padding'].append(entry)
    validation = rig.get('validation')
    if validation and isinstance(validation['result'], dict):
        assert validation['result']['error']['code'] == 'shader-reflection-error'
        assert validation['before'] == validation['after'] and validation['countsBefore'] == validation['countsAfter']
        assert any(e['call'] == 'linkProgram' and e['status'] for e in validation['events'])
        assert any(e['call'] == 'deleteProgram' for e in validation['events'])
        if rig['name'].startswith('fs-'):
            created = [e['id'] for e in validation['events'] if e['call'] == 'createBuffer']
            deleted = [e['id'] for e in validation['events'] if e['call'] == 'deleteBuffer']
            assert created and created == deleted
        summary['rollback'].append({'rig': rig['name'], 'code': validation['result']['error']['code'], 'unchanged': True})
    for lifecycle in rig.get('lifecycle', []):
        summary['ownership'].append({'rig': rig['name'], 'name': lifecycle['name']})
    if 'schedule' in rig:
        assert all(set(sub['inputAfter']) == {255} for sub in rig['submissions'])
        summary['async'].append({'rig': rig['name'], 'schedule': rig['schedule']})
assert len(summary['padding']) == 2 and len(summary['rollback']) == 15
assert len(summary['async']) == 4
assert decoder['stats'] == {'cases': 1046, 'accepted': 80, 'rejected': 966}
assert coverage['executableAddedLines'] == 20
assert critic['acceptance']['assertions'] == 19654 and critic['acceptance']['checkedPixels'] == 19456
assert control['acceptance']['rigs'][0]['criticFrames'][0]['failure'] == {'x': 4, 'y': 12, 'expected': [96, 128, 159, 159], 'actual': [191, 223, 255, 159]}
for rig in critic['acceptance']['rigs']:
    assert rig['glObjects']['live'] == 0
    if 'incomplete' in rig:
        assert rig['incomplete']['rejected']['error']['code'] == 'incomplete-draw'
        assert all(record['detachedLength'] == 0 for record in rig['detachedSubmissions'])

inputs = [p for p in HERE.rglob('*') if p.is_file() and p.name != 'final-audit.json' and p.suffix in ['.py', '.mjs', '.json', '.png']]
report = {'schema': 1, 'status': 'passed', 'frozenHead': FROZEN, 'claim': CLAIM,
          'workerHardwareSha256': sha(worker / 'hardware/report.json'), 'summary': summary,
          'workerNativeObjectsReleased': object_count, 'criticAssertions': 19654,
          'criticPixels': 19456, 'decoderCases': 1046, 'executableAddedLines': 20,
          'artifactDigests': [{'path': str(p.relative_to(ROOT)), 'bytes': p.stat().st_size, 'sha256': sha(p)} for p in sorted(inputs)]}
(HERE / 'final-audit.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': report['status'], 'workerNativeObjectsReleased': object_count, 'sha256': sha(HERE / 'final-audit.json')}))
