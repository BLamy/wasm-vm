#!/usr/bin/env python3
"""Reconstruct literal framebuffer/bank/packet expectations from original captures."""
from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[2]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(value, label):
    if not value:
        raise ValueError(label)


def color(name):
    if 'inactive-47' in name:
        return [64, 191, 128, 191]
    if 'composed-conversion' in name:
        return [0, 0, 0, 255]
    if 'composed-raster' in name:
        return [128, 128, 128, 128]
    if name in ['B domain2', 'B domain2 restored', 'subcontext7 domain2', 'new shader domain2']:
        return [0, 255, 0, 255]
    return [64, 128, 128, 255]


def words(packet):
    raw = bytes(packet)
    require(len(raw) % 4 == 0 and len(raw) >= 12, 'complete SET packet')
    header = int.from_bytes(raw[:4], 'little')
    require(header & 0xffff == 12 and len(raw) == ((header >> 16) + 1) * 4, 'literal SET opcode/extent')
    stage = int.from_bytes(raw[4:8], 'little')
    require(int.from_bytes(raw[8:12], 'little') == 0 and stage in [0, 1], 'stage-local slot zero')
    return stage, [int.from_bytes(raw[i:i + 4], 'little') for i in range(12, len(raw), 4)]


def sub(snapshot, context):
    ctx = next(c for c in snapshot['contexts'] if c['id'] == context)
    return next(s for s in ctx['subContexts'] if s['id'] == ctx['currentSubContext'])


def main():
    path, node_path, output = map(Path, sys.argv[1:])
    raw = path.read_bytes()
    browser = json.loads(raw)
    node = json.loads(node_path.read_bytes())
    acceptance = browser['acceptance']
    fault = acceptance['fault']
    require(browser['task'] == acceptance['task'] == node['task'] == 'E6-T12g6m3a', 'task custody')
    require(browser['gitHead'] == node['gitHead'], 'one source head')
    require(browser['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'zero browser errors')
    require(not browser['browser']['launch']['headless'] and browser['browser']['gpu']['featureStatus'][browser['browser']['webglFeature']] == 'enabled', 'physical headed GPU')
    fixture_raw = (ROOT / 'tools/virgl-exact-bank/fixtures.json').read_bytes()
    require(sha(fixture_raw) == acceptance['fixture']['sha256'], 'complete literal fixture source')
    fixtures = json.loads(fixture_raw)
    checked_pixels = 0
    attacks = 0
    uploads = 0
    contradictions = []
    for item in acceptance['shaderFixtures']:
        fixture = item['fixture']
        require(fixture == next(c for c in fixtures if c['name'] == fixture['name']), 'unchanged full fixture')
        require(sha(fixture['text'].encode()) == item['textSha256'], 'full original TGSI hash')
        require(item['original'] == next(c['original'] for c in node['cases'] if c['name'] == fixture['name']), 'complete actual native/Wasm result')
    for rig in acceptance['rigs']:
        require(rig['geometry'] == {'positions': [-1, -1, 1, -1, 1, 1, -1, 1], 'components': 2, 'indices': [0, 1, 2, 0, 2, 3], 'width': 8, 'height': 8}, 'independent indexed quad')
        require(rig['glObjects']['live'] == 0 and all(v == 0 for v in rig['finalBudgets'].values()) and all(v == 0 for v in rig['finalResourceBudgets'].values()), 'complete native/state/resource disposal')
        require(rig.get('getterInvocations', 0) == 0, 'getters never invoked')
        originals = []
        for translation in rig['translations']:
            if translation['kind'] != 'single':
                continue
            original = translation['original']
            request = translation['request']
            if request['text'] in [f['text'] for f in fixtures]:
                expected = next(c['original'] for c in node['cases'] if c['stage'] == request['stage'] and c['original']['glsl'] == original['glsl'] and c['name'] in [f['name'] for f in fixtures if f['text'] == request['text']])
                require(original == expected, 'trusted wrapper uses actual unchanged compiler result')
            originals.append(original['glsl'])
            if translation['fault']:
                continue
            transformed = json.loads(json.dumps(original))
            plan = translation['plans'][request['stage']]
            if plan:
                m = transformed['metadata']
                m['exactBaseProfile'] = m['profile']
                m['profile'] = 'virgl-webgl2-raw-bits-v42'
                m['constantExactDomains'] = [{'kind': 'constant-bank-exact-u32-v1', 'stage': request['stage'], 'slot': 0, 'name': 'vsconst0' if request['stage'] == 'vertex' else 'fsconst0', 'count': m['uniforms'][0]['count'], 'components': plan['components']}]
            require(translation['result'] == transformed, 'only explicitly named host metadata changed')
        for event in rig['glEvents']:
            if event['call'] == 'shaderSource':
                require(event['source'] in originals, 'actual submitted native GLSL remains unchanged')
            if event['call'] == 'uniform4uiv':
                require(event['words'] == event['observed'] and len(event['words']) <= 184, 'actual native raw upload and C46 cap')
                uploads += len(event['words'])
        for frame in rig['draws']:
            expected = color(frame['name'])
            require(frame['expectedColor'] == expected, 'independent literal color')
            require(frame['rgbaBytes'] == expected * 64 and sha(bytes(frame['rgbaBytes'])) == frame['rgbaSha256'], 'complete framebuffer bytes/hash')
            require(len(frame['result']['draws']) == 1 and frame['result']['draws'][0]['count'] == 6, 'real indexed draw result')
            current = sub(frame['snapshot'], frame['contextId'])
            for uniform in frame['uniforms']:
                stage = 0 if uniform['stage'] == 'vertex' else 1
                count = min(uniform['activeCount'], 46) * 4
                require(uniform['words'][:count] == current['bindings']['constants'][stage][:count], 'selected immutable bank uploaded')
            require(frame['program']['vertexGeneration'] == current['bindings']['vertexShader']['generation'] and frame['program']['fragmentGeneration'] == current['bindings']['fragmentShader']['generation'], 'bound shader generations')
            checked_pixels += 64
        for attack in rig['attacks']:
            attacks += 1
            if 'prefix' in attack:
                require(attack['pixelsBefore'] == color(attack['name']) * 64 or attack['pixelsBefore'] == [64, 128, 128, 255] * 64, 'literal pre-attack frame')
                if fault:
                    require(attack['result']['ok'] and attack['result']['appliedCommands'] == 2 and len(attack['result']['draws']) == 1, 'actual fault reaches DRAW')
                    require(attack['pixelsBefore'] == [64, 128, 128, 255] * 64 and attack['pixelsAfter'] == [0, 255, 0, 255] * 64, 'independent real framebuffer contradiction')
                    wrong = [e for e in attack['events'] if e['call'] == 'uniform4uiv' and e['name'] == 'vsconst0[0]' and e['words'] == e['observed'] == [2, 0, 0, 0]]
                    require(wrong, 'independent bad native word upload')
                    contradictions.append({'point': 'acceptance.rigs[0].attacks[0]', 'expected': 'zero upload/draw and unchanged blue-gray framebuffer', 'observed': 'native raw2 upload, one actual DRAW and 64 green pixels'})
                    continue
                result = attack['result']
                require(not result['ok'] and result['error']['code'] in ['constant-exact-domain-error', 'incomplete-draw', 'constant-conversion-domain-error', 'constant-raster-domain-error'], 'real guard rejection')
                require(result['appliedCommands'] == (1 if attack['prefix'] is not None else 0), 'honest command prefix')
                require(attack['pixelsAfter'] == attack['pixelsBefore'] and attack['after']['budgets'] == attack['before']['budgets'], 'untouched framebuffer/budgets')
                require(not any(e['call'] in ['drawElements', 'getBufferSubData', 'copyBufferSubData', 'createShader', 'createProgram', 'linkProgram'] for e in attack['events']), 'no draw/index/link effects')
                stage = attack['stage']
                require(not any(e['call'] == 'uniform4uiv' and e['name'].startswith('vs' if stage == 0 else 'fs') for e in attack['events']), 'unsafe stage never uploads')
                if attack['prefix'] is not None:
                    encoded_stage, bank = words(attack['prefix'])
                    require(encoded_stage == stage and sub(attack['after'], 1)['bindings']['constants'][stage] == bank, 'independent decoded CPU SET prefix')
            elif attack['name'] == 'nonfinite wire':
                require(not attack['result']['ok'] and attack['result']['appliedCommands'] == 0 and attack['before'] == attack['after'], 'atomic actual nonfinite predecode')
            else:
                require(not attack['result']['ok'] and attack['result']['error']['code'] == 'shader-domain-error' and attack['result']['appliedCommands'] == 0 and not any(e['call'] == 'createShader' for e in attack['events']), 'malformed metadata before native allocation')
        if 'prunedReflection' in rig:
            stage = 'vertex' if rig['name'].startswith('vertex') else 'fragment'
            require(next(u for u in rig['prunedReflection']['uniforms'] if u['stage'] == stage)['activeCount'] == 0, 'actual completely pruned bank remains guarded')
        if 'padding' in rig:
            p = rig['padding']
            require(p['after'] == [{'name': e['name'], 'observed': e['values']} for e in p['padded']['entries']], 'C46 poison unchanged outside guest prefix')
        for held in rig['yieldAttacks']:
            require(held['before'] == held['after'] and all(not b['ok'] and b['error']['code'] == 'busy' for b in held['busy']), 'async proof identity held across actual yield')
    require((browser['status'] == acceptance['status'] == 'failed') if fault else (browser['status'] == acceptance['status'] == 'passed'), 'recorded outcome')
    if fault:
        f = browser['faultSources']
        source = (ROOT / 'renderer/virgl-command/constant-domain.mjs').read_text()
        require(source.count(f['needle']) == 1 and sha(source.encode()) == f['originalSha256'] and sha(source.replace(f['needle'], f['needle'] + ' && false').encode()) == f['alteredSha256'], 'only exact equality removed in actual served runtime')
        require(len(contradictions) == 1, 'fault sensitivity')
    result = {'schema': 1, 'task': 'E6-T12g6m3a', 'status': 'passed', 'gitHead': browser['gitHead'], 'sourceReportSha256': sha(raw), 'nodeReportSha256': sha(node_path.read_bytes()), 'checkedPixels': checked_pixels, 'checkedUploadWords': uploads, 'checkedAttacks': attacks, 'physicalContradictions': contradictions}
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(f'Independent capture: {checked_pixels} pixels, {attacks} inputs, {len(contradictions)} physical contradictions')


if __name__ == '__main__':
    main()
