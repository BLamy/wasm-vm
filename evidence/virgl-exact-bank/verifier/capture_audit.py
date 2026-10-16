#!/usr/bin/env python3
"""Independent literal audit of real packets, native events, banks and complete pixels."""
from pathlib import Path
import argparse
import hashlib
import json

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
UNPACKED = OUT / 'unpacked'
BLOCKED = {'drawElements', 'getBufferSubData', 'copyBufferSubData', 'createShader',
           'createProgram', 'linkProgram', 'createBuffer', 'createVertexArray', 'createFramebuffer'}

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def color(name):
    if 'inactive-47' in name:
        return [64, 191, 128, 191]
    if 'composed-conversion' in name or 'unwrapped conversion' in name:
        return [0, 0, 0, 255]
    if 'composed-raster' in name or 'unwrapped raster' in name:
        return [128, 128, 128, 128]
    if name in {'B domain2', 'B domain2 restored', 'subcontext7 domain2', 'new shader domain2'}:
        return [0, 255, 0, 255]
    return [64, 128, 128, 255]

def sub(snapshot, context):
    ctx = next(value for value in snapshot['contexts'] if value['id'] == context)
    return next(value for value in ctx['subContexts'] if value['id'] == ctx['currentSubContext'])

def set_packet(value):
    raw = bytes(value)
    assert len(raw) >= 12 and len(raw) % 4 == 0
    header = int.from_bytes(raw[:4], 'little')
    assert header & 0xffff == 12 and len(raw) == ((header >> 16) + 1) * 4
    stage = int.from_bytes(raw[4:8], 'little')
    assert stage in {0, 1} and int.from_bytes(raw[8:12], 'little') == 0
    return stage, [int.from_bytes(raw[i:i+4], 'little') for i in range(12, len(raw), 4)]

def audit(path):
    raw = path.read_bytes()
    b = json.loads(raw)
    a = b['acceptance']
    fault = a.get('fault') is not None
    inherited = a.get('unwrappedInherited', False)
    assert b['task'] == a['task'] == 'E6-T12g6m3a'
    assert b['browserErrors'] == {'console': [], 'page': [], 'requests': []}
    assert not b['browser']['launch']['headless']
    assert b['browser']['gpu']['featureStatus'][b['browser']['webglFeature']] == 'enabled'
    assert 'metal' in a['renderer'].lower() and 'apple' in a['renderer'].lower()
    assert not any('swiftshader' in flag.lower() or '--disable-gpu' == flag for flag in b['browser']['actualCommandLine'])
    for entry in b['servedFiles']:
        if entry['path'] in {'renderer/virgl-command/state.mjs', 'renderer/virgl-command/constant-domain.mjs'}:
            assert entry['sha256'] == sha((ROOT / entry['path']).read_bytes())
    frames = pixels = rejections = uploaded = async_yields = 0
    points = []
    for index, rig in enumerate(a['rigs']):
        at = f'acceptance.rigs[{index}]'
        assert rig['geometry'] == {'positions': [-1,-1,1,-1,1,1,-1,1], 'components': 2,
                                   'indices': [0,1,2,0,2,3], 'width': 8, 'height': 8}
        assert rig['glObjects']['live'] == 0 and all(v == 0 for v in rig['finalBudgets'].values())
        assert all(v == 0 for v in rig['finalResourceBudgets'].values()) and rig.get('getterInvocations', 0) == 0
        originals = [t['original']['glsl'] for t in rig['translations'] if t['kind'] == 'single']
        if inherited:
            for t in rig['translations']:
                if t['kind'] == 'single':
                    assert t['original'] == t['result'] and t['result']['metadata']['profile'] != 'virgl-webgl2-raw-bits-v42'
        for event in rig['glEvents']:
            if event['call'] == 'shaderSource':
                assert event['source'] in originals
            if event['call'] == 'uniform4uiv':
                assert event['words'] == event['observed'] and len(event['words']) <= 184
                assert event['programId'] == event['currentProgramId']
                uploaded += len(event['words'])
        for number, frame in enumerate(rig['draws']):
            expected = color(frame['name'])
            assert frame['rgbaBytes'] == expected * 64 and frame['expectedColor'] == expected
            assert sha(bytes(frame['rgbaBytes'])) == frame['rgbaSha256']
            assert len(frame['result']['draws']) == 1 and frame['result']['draws'][0]['count'] == 6
            selected = sub(frame['snapshot'], frame['contextId'])
            assert frame['program']['vertexGeneration'] == selected['bindings']['vertexShader']['generation']
            assert frame['program']['fragmentGeneration'] == selected['bindings']['fragmentShader']['generation']
            for uniform in frame['uniforms']:
                stage = 0 if uniform['stage'] == 'vertex' else 1
                extent = min(46, uniform['activeCount']) * 4
                assert uniform['words'][:extent] == selected['bindings']['constants'][stage][:extent]
            frames += 1
            pixels += 64
        for number, attack in enumerate(rig['attacks']):
            point = at + f'.attacks[{number}]'
            if 'prefix' in attack:
                if fault:
                    assert attack['result']['ok'] and attack['result']['appliedCommands'] == 2
                    assert len(attack['result']['draws']) == 1
                    assert attack['pixelsBefore'] == [64,128,128,255] * 64
                    assert attack['pixelsAfter'] == [0,255,0,255] * 64
                    assert any(e['call'] == 'uniform4uiv' and e['name'] == 'vsconst0[0]' and
                               e['words'] == e['observed'] == [2,0,0,0] for e in attack['events'])
                    points.append({'point': point, 'verdict': 'exact-equality sabotage produced native raw2, one DRAW and64 green pixels'})
                    continue
                assert not attack['result']['ok'] and attack['result']['appliedCommands'] == (1 if attack['prefix'] is not None else 0)
                assert attack['pixelsBefore'] == attack['pixelsAfter']
                assert attack['before']['budgets'] == attack['after']['budgets']
                assert not any(e['call'] in BLOCKED for e in attack['events']), point
                stage = attack['stage']
                assert not any(e['call'] == 'uniform4uiv' and e['name'].startswith('vs' if stage == 0 else 'fs') for e in attack['events'])
                if attack['prefix'] is not None:
                    encoded_stage, bank = set_packet(attack['prefix'])
                    assert encoded_stage == stage and sub(attack['after'], 1)['bindings']['constants'][stage] == bank
            elif attack['name'] == 'nonfinite wire':
                assert not attack['result']['ok'] and attack['result']['appliedCommands'] == 0
                assert attack['before'] == attack['after']
            else:
                assert attack['result']['error']['code'] == 'shader-domain-error' and attack['result']['appliedCommands'] == 0
                assert not any(e['call'].startswith('create') for e in attack['events'])
            rejections += 1
        if 'prunedReflection' in rig:
            stage = 'vertex' if rig['name'].startswith('vertex') else 'fragment'
            assert next(u for u in rig['prunedReflection']['uniforms'] if u['stage'] == stage)['activeCount'] == 0
            assert any('finite mismatch' in t['name'] for t in rig['attacks'])
        if 'padding' in rig:
            padding = rig['padding']
            assert len(padding['after']) == 2
            assert padding['after'] == [{'name': entry['name'], 'observed': entry['values']} for entry in padding['padded']['entries']]
            assert all('[46]' in entry['name'] for entry in padding['after'])
        if 'schedule' in rig:
            scheduled = [e for e in rig['glEvents'] if e['call'] == 'fenceSchedule']
            assert scheduled and any(s['status'] == 'waiting-gpu' for t in rig['submissions'] for s in t.get('states', []))
            for t in rig['submissions']:
                if t.get('begin', {}).get('ok'):
                    assert t['inputAfter'] and all(x == 255 for x in t['inputAfter'])
            for attack in rig['yieldAttacks']:
                assert attack['before'] == attack['after']
                assert all(not r['ok'] and r['error']['code'] == 'busy' for r in attack['busy'])
            async_yields += sum(len(t.get('states', [])) for t in rig['submissions'])
        points.append({'point': at, 'name': rig['name'], 'frames': len(rig['draws']), 'attacks': len(rig['attacks']),
                       'allNativeObjectsDeleted': True})
    assert b['status'] == a['status'] == ('failed' if fault else 'passed')
    return {'path': str(path.relative_to(OUT)), 'sha256': sha(raw), 'frames': frames, 'literalPixels': pixels,
            'rejections': rejections, 'checkedUploadWords': uploaded, 'asyncStates': async_yields,
            'fault': fault, 'unwrappedInherited': inherited, 'seed': a['seed'], 'points': points}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path)
    parser.add_argument('--output', type=Path, default=OUT / 'capture-audit.json')
    args = parser.parse_args()
    paths = [args.browser.resolve()] if args.browser else sorted(UNPACKED.glob('**/gpu-*/report.json')) + sorted(UNPACKED.glob('**/fault/report.json')) + sorted(OUT.glob('gpu-*/report.json')) + [OUT / 'inherited-gpu/report.json']
    result = {'task': 'E6-T12g6m3a', 'status': 'HELD', 'predictions': ['P3','P4','P5','P6'], 'captures': [audit(p) for p in paths]}
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k:v for k,v in result.items() if k != 'captures'}), len(paths), 'captures authenticated')

if __name__ == '__main__':
    main()
