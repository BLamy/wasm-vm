#!/usr/bin/env python3
"""Independent literal equations, full packets, compiler results and GPU custody."""
from pathlib import Path
import copy
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
TASK = 'E6-T12g6m3b'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(value, label):
    if not value:
        raise ValueError(label)


def color(name):
    # U32 equality with raw integer1, raw nonzero UIF and signed-negative ISLT.
    # SIN(+0) is +0; F2I(.25,1.5,-.5,1) then I2F is (0,1,0,1).
    if 'inherited-conversion' in name or 'count0' in name or name == 'B restored':
        return [0, 255, 0, 255]
    # CONST0.w copied to x, with the three literal .5 components unchanged.
    if 'inherited-raster' in name:
        return [64, 128, 128, 128]
    return [64, 128, 128, 255]


def sub(snapshot, context):
    ctx = next(c for c in snapshot['contexts'] if c['id'] == context)
    return next(s for s in ctx['subContexts'] if s['id'] == ctx['currentSubContext'])


def main():
    path, node_path, output = map(Path, sys.argv[1:])
    raw = path.read_bytes()
    browser, node = json.loads(raw), json.loads(node_path.read_bytes())
    a = browser['acceptance']
    fault = a['fault']
    require(browser['task'] == a['task'] == node['task'] == TASK, 'task custody')
    require(browser['gitHead'] == node['gitHead'], 'one exact source head')
    require(browser['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'zero browser errors')
    require(not browser['browser']['launch']['headless'] and
        browser['browser']['gpu']['featureStatus'][browser['browser']['webglFeature']] == 'enabled', 'headed physical GPU')
    require(a['trustedHostWrapper'] is False and browser['trustedHostWrapper'] is False, 'actual compiler producer')
    fixture_raw = (ROOT / 'tools/virgl-exact-producer/fixtures.json').read_bytes()
    require(sha(fixture_raw) == a['fixture']['sha256'], 'whole literal fixture bytes')
    fixtures = json.loads(fixture_raw)
    def expected(request):
        if 'components' not in request:
            return next(c['result'] for c in node['partners'] if c['stage'] == request['stage'] and c['text'] == request['text'])
        choices = [c for c in fixtures if c['stage'] == request['stage'] and c['text'] == request['text'] and c['components'] == request['components']]
        require(choices, 'complete source/owned assumption binding')
        return next(c['result'] for c in node['cases'] if c['name'] == choices[0]['name'])
    for item in a['shaderFixtures']:
        fixture = next(c for c in fixtures if c['name'] == item['fixture']['name'])
        require(fixture == item['fixture'] and sha(fixture['text'].encode()) == item['textSha256'], 'unchanged complete TGSI')
        if not fault:
            require(item['result'] == expected(item['request']), 'full actual native/Wasm compiler result')
    checked_pixels = checked_attacks = checked_words = 0
    contradictions = []
    for rig_index, rig in enumerate(a['rigs']):
        require(rig['geometry'] == {'positions': [-1,-1,1,-1,1,1,-1,1], 'components': 2,
            'indices': [0,1,2,0,2,3], 'width': 8, 'height': 8}, 'literal indexed fullscreen quad')
        require(rig['glObjects']['live'] == 0 and all(v == 0 for v in rig['finalBudgets'].values()) and
            all(v == 0 for v in rig['finalResourceBudgets'].values()), 'full GPU/renderer/resource disposal')
        compiled = []
        for translation in rig['translations']:
            require(translation['kind'] != 'pair', 'smooth fixtures use actual stage API; no fabricated qualified pair')
            request, result = translation['request'], translation['result']
            baseline = expected(request)
            if fault == 'metadata' and translation['kind'] == 'exact':
                stripped = copy.deepcopy(baseline)
                m = stripped['metadata']; m['profile'] = m.pop('exactBaseProfile'); del m['constantExactDomains']
                require(result == stripped, 'only actual compiler exact metadata removed')
            elif fault == 'derive' and translation['kind'] == 'exact':
                require(result['metadata']['constantExactDomains'] == baseline['metadata']['constantExactDomains'], 'raw1 precondition remains original under derived-bit fault')
                require(result['glsl'] != baseline['glsl'], 'wrong derived bit actually changes emission')
            else:
                require(result == baseline, 'adapter returns actual unchanged complete compiler result')
            require(result['ok'], 'native shader admission')
            compiled.append(result['glsl'])
        for event in rig['glEvents']:
            if event['call'] == 'shaderSource':
                require(event['source'] in compiled, 'actual native GLSL is compiler-produced')
            if event['call'] == 'uniform4uiv':
                require(event['words'] == event['observed'] and len(event['words']) <= 184, 'actual uploaded raw words, guest cap46')
                checked_words += len(event['words'])
        for frame_index, frame in enumerate(rig['draws']):
            predicted = color(frame['name'])
            require(frame['expectedColor'] == predicted, 'pre-readback handwritten equation')
            require(sha(bytes(frame['rgbaBytes'])) == frame['rgbaSha256'], 'complete frame digest')
            require(len(frame['result']['draws']) == 1 and frame['result']['draws'][0]['count'] == 6, 'actual indexed DRAW')
            if fault == 'derive':
                require(predicted == [64,128,128,255] and frame['rgbaBytes'] == [0,255,0,255] * 64, 'derived-bit fault produces independently wrong full framebuffer')
                contradictions.append(dict(point=f'acceptance.rigs[{rig_index}].draws[{frame_index}]',
                    expected='raw1 true branch blue-gray', observed='raw1 passes unchanged precondition but wrong derived bit draws 64 green pixels'))
            else:
                require(frame['rgbaBytes'] == predicted * 64, 'independent full framebuffer pixels')
            current = sub(frame['snapshot'], frame['contextId'])
            for uniform in frame['uniforms']:
                stage = 0 if uniform['stage'] == 'vertex' else 1
                size = min(uniform['activeCount'],46) * 4
                require(uniform['words'][:size] == current['bindings']['constants'][stage][:size], 'selected bank equals actual native uniform state')
            require(frame['program']['vertexGeneration'] == current['bindings']['vertexShader']['generation'] and
                frame['program']['fragmentGeneration'] == current['bindings']['fragmentShader']['generation'], 'actual shader generations')
            checked_pixels += 64
        for index, attack in enumerate(rig['attacks']):
            checked_attacks += 1
            if fault == 'metadata':
                require(attack['pixelsBefore'] == [255,0,0,255] * 64, 'independent red sentinel before forbidden DRAW')
                require(attack['result']['ok'] and attack['result']['appliedCommands'] == 2 and
                    len(attack['result']['draws']) == 1 and attack['pixelsAfter'] == [64,128,128,255] * 64, 'stripped compiler precondition permits actual forbidden draw')
                require(any(e['call'] == 'uniform4uiv' and e['words'][0] == e['observed'][0] == 2 for e in attack['events']), 'raw2 actually uploads after metadata stripping')
                contradictions.append(dict(point=f'acceptance.rigs[{rig_index}].attacks[{index}]',
                    expected='zero unsafe upload/DRAW, unchanged red sentinel', observed='native raw2 upload and actual DRAW replace 64 red pixels with blue-gray'))
                continue
            require(not attack['result']['ok'] and attack['result']['error']['code'] in ['constant-exact-domain-error',
                'constant-raster-domain-error', 'constant-conversion-domain-error', 'incomplete-draw'], 'actual scoped guard rejection')
            require(attack['result']['appliedCommands'] == (1 if attack['prefix'] is not None else 0), 'honest CPU prefix')
            require(attack['pixelsAfter'] == attack['pixelsBefore'] and attack['after']['budgets'] == attack['before']['budgets'], 'zero frame/budget mutation')
            require(not any(e['call'] in ['drawElements','getBufferSubData','copyBufferSubData','createShader','createProgram','linkProgram'] for e in attack['events']), 'zero DRAW/index/link effects')
            require(not any(e['call'] == 'uniform4uiv' and e['name'].startswith('vs' if attack['stage'] == 0 else 'fs') for e in attack['events']), 'unsafe stage never uploads')
            if attack['prefix'] is not None:
                packet = bytes(attack['prefix']); header = int.from_bytes(packet[:4],'little')
                require(header & 0xffff == 12 and len(packet) == ((header >> 16) + 1) * 4 and
                    int.from_bytes(packet[4:8],'little') == attack['stage'] and int.from_bytes(packet[8:12],'little') == 0, 'literal stage/slot/SET packet')
                words = [int.from_bytes(packet[i:i+4],'little') for i in range(12,len(packet),4)]
                require(sub(attack['after'],1)['bindings']['constants'][attack['stage']] == words, 'complete decoded CPU bank remains honest')
        if 'prunedReflection' in rig:
            stage = 'vertex' if rig['fixture'].startswith('vertex') else 'fragment'
            require(next(u for u in rig['prunedReflection']['uniforms'] if u['stage'] == stage)['activeCount'] == 0, 'actual fully pruned bank still guarded')
        for held in rig['yieldAttacks']:
            require(held['before'] == held['after'] and all(not b['ok'] and b['error']['code'] == 'busy' for b in held['busy']), 'actual async ownership and restore lock')
    require(browser['status'] == a['status'] == ('failed' if fault else 'passed'), 'recorded original exit outcome')
    if fault:
        source = browser['faultSources']
        normal = (ROOT / 'renderer/virgl-shader' / source['file']).read_bytes()
        altered = normal.decode().replace(source['needle'],source['replacement']).encode()
        require(normal.decode().count(source['needle']) == 1 and sha(normal) == source['originalSha256'] and sha(altered) == source['alteredSha256'], 'one actual compiler source fault')
        require(a['faultWasm']['sha256'] == next(c['sha256'] for c in source['artifacts'] if c['path'] == 'virgl-shader.wasm'), 'actual delivered faulty C Wasm binary')
        require(len(contradictions) == 1, 'one physical independently observed contradiction')
    result=dict(task=TASK,status='passed',gitHead=browser['gitHead'],reportSha256=sha(raw),nodeReportSha256=sha(node_path.read_bytes()),
        checkedPixels=checked_pixels,checkedAttacks=checked_attacks,checkedUploadWords=checked_words,contradictions=contradictions)
    output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))


if __name__ == '__main__':
    main()
