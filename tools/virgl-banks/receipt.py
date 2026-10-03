#!/usr/bin/env python3
"""Bind bounded register banks to unchanged originals and independent GPU oracles."""
import importlib.util
import json
from pathlib import Path
import re
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


pair_gate = load_module('pair_gate', 'tools/virgl-pairs/receipt.py')
inventory_gate = load_module('bank_inventory', 'tools/virgl-banks/inventory.py')
gate = pair_gate.gate
require, sha, read_json = gate.require, gate.sha, gate.read_json
binding, check_digest, check_records = pair_gate.binding, pair_gate.check_digest, pair_gate.check_records
PROFILE = 'virgl-webgl2-straight-line-v5'
LIMITS = {'textBytes': 16384, 'tokens': 8192, 'glslBytes': 65536, 'instructions': 179,
          'registerIndex': 7, 'temporaryRegisterIndex': 117, 'constantRegisterIndex': 45}
PAIR_CASES = [
    ('hardware-low-pair', 'hardware-low-vertex', 'hardware-low-fragment'),
    ('hardware-high-pair', 'hardware-high-vertex', 'hardware-high-fragment'),
    ('hardware-order-pair', 'hardware-high-vertex', 'hardware-order-fragment'),
    ('hardware-maximal-pair', 'hardware-maximal-vertex', 'hardware-maximal-fragment'),
]


def check_stage(result, stage):
    require(result['metadata']['profile'] == PROFILE and result['metadata']['stage'] == stage,
            'versioned bank stage metadata')
    require(result['glsl'].startswith('#version 300 es') and len(result['glsl'].encode()) <= 65536,
            'bounded ESSL300 output')
    for uniform in result['metadata']['uniforms']:
        require(uniform['type'] == 'uvec4[]' and uniform['encoding'] == 'float32-bits'
                and 1 <= uniform['count'] <= 47, 'bounded truthful declared constants')
        require(re.search(r'\b' + re.escape(uniform['name']) + r'\[' + str(uniform['count']) + r'\]', result['glsl']),
                'constant metadata must equal emitted declaration')


def verify_native(native, fixtures, corpus, output):
    require(native['schema'] == 'wasm-vm-banks-native-v1' and native['status'] == 'passed', 'native bank result')
    require(native['sanitizers'] == ['address', 'undefined'] and native['mutationsPerSeed'] == 1024
            and native['seeds'] == ['7c1209ad', '491be583', 'ea016f35', '265d8cb7'], 'native sanitizer and seed coverage')
    check_digest(output / 'native/native.log', native['logSha256'])
    check_digest(ROOT / 'renderer/virgl-shader/build/bank-sanitize/bank-test', native['binarySha256'])
    require(native['fixture'] == binding(ROOT / 'renderer/virgl-shader/tests/bank-cases.json'), 'bank fixture binding')
    require(len(fixtures) <= 512 and len(native['cases']) == len(fixtures), 'bounded native fixture count')
    require(len({fixture['name'] for fixture in fixtures}) == len(fixtures), 'unique native case names')
    require(len(native['originals']) == 19 and [item['sha256'] for item in native['originals']] == sorted(corpus)
            and {item['sha256']: item['result'] for item in native['originals']} == corpus, 'unchanged original parity')
    stream = bytearray(b'VGB1' + struct.pack('<I', 19))
    for original in native['originals']:
        require(binding(ROOT / original['path']) == {key: original[key] for key in ('path', 'bytes', 'sha256')},
                'native original identity')
        raw = (ROOT / original['path']).read_bytes()
        stream += struct.pack('<III', int(original['stage'] == 'fragment'), int(original['ok']), len(raw)) + raw
        require(original['ok'] is original['result']['ok'], 'original outcome')
        if original['ok']:
            check_stage(original['result'], original['stage'])
        else:
            require(original['result']['error']['code'] == 'unsupported-feature', 'seven precise originals stay rejected')
    stream += struct.pack('<I', len(fixtures))
    for case, fixture in zip(native['cases'], fixtures):
        name, text = fixture['name'].encode('ascii'), fixture['text'].encode('ascii')
        require(case['name'] == fixture['name'] and case['stage'] == fixture['stage']
                and case['inputSha256'] == sha(text) and case['ok'] is fixture['ok']
                and case['result']['ok'] is fixture['ok'] and case.get('expected') == fixture.get('expected'), 'exact native input and outcome')
        stream += struct.pack('<IIII', int(fixture['stage'] == 'fragment'), int(fixture['ok']), len(name), len(text)) + name + text
        if fixture['ok']:
            check_stage(case['result'], fixture['stage'])
            # Independent declaration accounting matches pinned upstream's
            # CONST0 special case, without invoking the translator under test.
            count = 0
            for line in fixture['text'].splitlines():
                declaration = re.fullmatch(r'\s*DCL CONST\[([0-9]+)(?:\.\.([0-9]+))?\]\s*', line)
                if declaration:
                    first, last = int(declaration[1]), int(declaration[2] or declaration[1])
                    count = count + 1 if first == last == 0 else max(count, last + 1)
            uniforms = case['result']['metadata']['uniforms']
            require(len(uniforms) == int(count > 0) and (not count or uniforms[0]['count'] == count),
                    'independent declared constant extent')
        else:
            require(set(case['result']) == {'ok', 'error'}, 'no partial output after rejection')
            if 'expected' in fixture:
                require(set(fixture['expected']) == {'errorCode'} and case['result']['error']['code'] == fixture['expected']['errorCode'],
                        'literal malformed versus valid-but-unsupported diagnostic')
    # Pair serialization is completed from the exact fixed hardware pair map.
    verify_native_pairs(native, fixtures, stream)
    require(sha(stream) == native['streamSha256'], 'independently reconstructed VGB1 input stream')
    for source in native['sources']:
        require(binding(ROOT / source['path']) == source, 'native source digest')
    positive = '\n'.join(fixture['text'] for fixture in fixtures if fixture['ok'])
    for index in range(10, 118):
        require(re.search(r'\b(?:MOV|ADD|MUL|MAD) TEMP\[' + str(index) + r'\]', positive),
                f'new TEMP{index} must actually be written')
        require(re.search(r',\s*TEMP\[' + str(index) + r'\]', positive), f'new TEMP{index} must actually be read')
    for index in range(8, 46):
        require(re.search(r',\s*CONST\[' + str(index) + r'\]', positive), f'new CONST{index} must actually be read')
    by_name = {fixture['name']: fixture for fixture in fixtures}
    for stage in ('vertex', 'fragment'):
        for instructions in (178, 179, 180):
            for labeled in (0, 1):
                fixture = by_name[f'{stage}-instructions-{instructions}-{labeled}']
                require(fixture['ok'] is (instructions <= 179), '179/180 labeled and unlabeled admission neighbors')
                require(len(re.findall(r'^\s*(?:\d+:\s*)?(?:MOV|ADD|MUL|MAD|TEX)\b', fixture['text'], re.MULTILINE)) == instructions,
                        'independent boundary fixture instruction count')
        for written in 'xyzw':
            for read in 'xyzw':
                require(by_name[f'{stage}-high-lanes-{written}-{read}']['ok'] is (written == read), 'all high-register initialized lane boundaries')
        for kind in ('high-self-read-uninitialized', 'high-uninitialized', 'undeclared-high',
                     'high-operand-one-past', 'constant-operand-one-past'):
            require(by_name[f'{stage}-{kind}']['ok'] is False, 'high bank rejection edge')
    for file in ('IN', 'OUT', 'IMM', 'SAMP', 'SVIEW', 'GENERIC'):
        for index in (8, 10, 45, 117):
            require(by_name[f'small-bank-{file}-{index}']['ok'] is False, 'independent small banks remain bounded')
    for name, expected in {'line-bytes-512': True, 'line-bytes-513': False,
                           'nonempty-lines-256': True, 'nonempty-lines-257': False,
                           'text-exact-16384': True}.items():
        require(by_name[name]['ok'] is expected, 'unchanged finite input capacities')
    verify_native_accounting(native, fixtures, output)


def verify_native_pairs(native, fixtures, stream):
    require(len(native['pairs']) == len(PAIR_CASES), 'four fixed bank pairs')
    indexes = {fixture['name']: index for index, fixture in enumerate(fixtures)}
    cases = {case['name']: case for case in native['cases']}
    stream += struct.pack('<I', len(PAIR_CASES))
    for case, (name, vertex, fragment) in zip(native['pairs'], PAIR_CASES):
        require(case['name'] == name and case['vertexCaseName'] == vertex and case['fragmentCaseName'] == fragment,
                'fixed bank pair mapping')
        encoded = name.encode('ascii')
        stream += struct.pack('<III', indexes[vertex], indexes[fragment], len(encoded)) + encoded
        result = case['result']
        require(result['ok'] is True and result['interfaceKey'] == 'generic-interpolation-v1:', 'no-input bank pair identity')
        for stage, name in (('vertex', vertex), ('fragment', fragment)):
            require(case[stage + 'Sha256'] == cases[name]['inputSha256'], 'pair source identity')
            require(result[stage] == {key: cases[name]['result'][key] for key in ('glsl', 'metadata')},
                    'exact pair/standalone parity for smooth unused vertex outputs')
            check_stage(result[stage], stage)


def verify_native_accounting(native, fixtures, output):
    require([case['name'] for case in fixtures[:4]] == ['hardware-low-vertex', 'hardware-high-vertex',
            'hardware-low-fragment', 'hardware-high-fragment'], 'four bank recovery anchors')
    truncations = sum(len(fixture['text'].encode('ascii')) for fixture in fixtures[:4])
    hostile = 4 + 2 * sum((byte < 32 and byte not in (9, 10, 13)) or byte > 126 for byte in range(256))
    attacks = len(fixtures) + truncations + hostile + 4096
    stats = native['stats']
    for key, value in {'originals': 19, 'acceptedOriginals': 12, 'cases': len(fixtures), 'pairs': 4,
                       'truncations': truncations, 'hostileCases': hostile, 'mutations': 4096,
                       'standaloneRecoveries': attacks * 4, 'pairRecoveries': attacks * 2,
                       'calls': 27 + attacks * 7}.items():
        require(stats[key] == value, f'exact native bank accounting: {key}')
    groups = {'ORIGINAL': native['originals'], 'CASE': native['cases'], 'PAIR': native['pairs']}
    seen = set()
    for line in (output / 'native/native.log').read_text().splitlines():
        match = re.fullmatch(r'(ORIGINAL|CASE|PAIR) ([0-9]+) (.+)', line)
        if match:
            kind, index, raw = match[1], int(match[2]), match[3]
            require((kind, index) not in seen and index < len(groups[kind]), 'unique recorded native result')
            seen.add((kind, index))
            entry = groups[kind][index]
            require(json.loads(raw) == entry['result'] and len(raw.encode('ascii')) == entry['resultBytes'],
                    'raw native result and serialization size')
    require(len(seen) == 19 + len(fixtures) + 4, 'complete native raw records')
    log = (output / 'native/native.log').read_text()
    for seed in native['seeds']:
        require(f'SEED {seed} mutations=1024 standalone_recoveries=4096 pair_recoveries=2048 passed' in log,
                'complete native bank seed and recovery')
    require(f'STATS {json.dumps(stats, separators=(",", ":"))}' in log, 'native final raw statistics')
    maxima = {
        'singleResultBytes': max(entry['resultBytes'] for entry in native['originals'] + native['cases']),
        'pairResultBytes': max(entry['resultBytes'] for entry in native['pairs']),
        'stageGlslBytes': max(len(stage['glsl'].encode()) for entry in native['originals'] + native['cases'] + native['pairs']
                             if entry['result']['ok'] for stage in ([entry['result']['vertex'], entry['result']['fragment']]
                             if 'vertex' in entry['result'] else [entry['result']])),
    }
    require(native['recordedMaxima'] == maxima, 'independently measured recorded serialization sizes')
    require(maxima['singleResultBytes'] <= stats['maxSingleResultBytes'] < 147456
            and maxima['pairResultBytes'] <= stats['maxPairResultBytes'] < 295936
            and maxima['stageGlslBytes'] <= 65536, 'unchanged finite output capacities')


def verify_browser_sources(output, name, head, contract):
    report = read_json(output / name / 'report.json')
    require(report['task'] == 'E6-T12e3' and report['gitHead'] == head, 'bank browser identity')
    require(report['status'] == ('passed' if name == 'hardware' else 'failed'), 'bank browser outcome')
    require(report['guestExecution'] is False and report['currentGuest3dAdvertisement'] is False,
            'bank proof cannot activate guest GPU')
    require(report['browserErrors'] == {'console': [], 'page': [], 'requests': []} and report['trackedChanges'] == [],
            'bank browser errors or unfrozen sources')
    gate.verify_files(report['sources']); gate.verify_files(report['servedFiles'])
    observed = {'browserVersion': report['browser']['version'],
                **{key: report['host'][key] for key in ('platform', 'architecture', 'release')},
                'renderer': report['acceptance']['renderer']['renderer']}
    require(observed in contract['browserMatrix']['qualified'], 'qualified bank hardware/browser')
    require(report['browser']['gpu']['featureStatus'][report['browser']['webglFeature']] == 'enabled', 'hardware WebGL required')
    photo = report['screenshot'] if name == 'hardware' else report['failureScreenshot']
    require(photo['path'] == ('browser.png' if name == 'hardware' else 'failure.png'), 'bank screenshot path')
    check_digest(output / name / photo['path'], photo['sha256'])
    served = {item['path']: item for item in report['servedFiles']}
    sources = {item['path']: item for item in report['sources']}
    needed = ('renderer/virgl-shader/index.mjs', 'renderer/virgl-shader/build/wasm/virgl-shader.wasm',
              'renderer/virgl-shader/tests/banks.mjs', 'renderer/virgl-shader/tests/bank-cases.json')
    require(all(path in sources and path in served and sources[path]['sha256'] == served[path]['sha256'] for path in needed),
            'bank proof must consume exact compiler and shared fixture')
    return report


def float_bits(values):
    return [struct.unpack('<I', struct.pack('<f', value))[0] for value in values]


def constant_values(stage, maximal=False):
    values = [[0, 0, 0, 1 if maximal else 0] for _ in range(46)]
    if not maximal:
        if stage == 'fragment':
            selected = {0: [.125, .25, .25, .25], 5: [.75, .125, .5, 1],
                        7: [.375, .125, 0, .5], 45: [.125, .5, .25, .5]}
        else:
            selected = {0: [.125, -.125, -.25, 0], 5: [.75, .75, .75, .75],
                        7: [1, .5, .5, 1], 45: [.5, .25, 1, 1]}
        for index, value in selected.items():
            values[index] = value
    return values


def check_bindings(record, expected):
    require(len(record['uniforms']) == len(expected), 'all actual stage uniform bindings')
    for binding_record, (stage, declared, required, maximal) in zip(record['uniforms'], expected):
        active = binding_record['activeCount']
        require(type(active) is int and required <= active <= declared <= 47, 'reflected extent covers required addresses; retained suffix is permitted')
        uploaded = min(active, 46)
        values = constant_values(stage, maximal)[:uploaded]
        prefix = 'vs' if stage == 'vertex' else 'fs'
        padding = ({'name': prefix + 'const0[46]', 'index': 46, 'values': [16, -8, 4, -2],
                    'bits': [1098907648, 3238002688, 1082130432, 3221225472]} if active == 47 else None)
        require(binding_record == {'name': prefix + 'const0[0]',
                                   'stage': stage, 'requiredCount': required, 'declaredCount': declared, 'activeCount': active,
                                   'uploadedCount': uploaded, 'paddingUpload': padding,
                                   'values': values, 'bits': float_bits([lane for value in values for lane in value])},
                'literal active/declared extents and uploaded raw constant words')
    blocks = record['uniformBlocks']
    require(len(blocks) == 1 and blocks[0]['name'] == 'VirglBlock' and blocks[0]['byteLength'] == 656,
            'actual coordinate-system block')
    require(len(blocks[0]['members']) == 1 and blocks[0]['members'][0]['name'] == 'winsys_adjust_y'
            and blocks[0]['members'][0]['offset'] == 640 and blocks[0]['members'][0]['value'] == 1
            and blocks[0]['members'][0]['type'] == 5126, 'literal coordinate-system uniform')
    require(set(record['programLogs']) == {'vertex', 'fragment', 'link'}, 'actual compile/link diagnostics')


def verify_shared_browser(proof, native, fixtures, corpus):
    require(proof['guestExecution'] is False and proof['productionVirgl'] is False
            and proof['commandRendererWidened'] is False and proof['limits'] == LIMITS, 'frontend-only browser scope')
    require(len(proof['corpus']) == 19 and {entry['sha256']: entry['result'] for entry in proof['corpus']} == corpus,
            'full native/Wasm original output and metadata parity')
    for entry in proof['corpus']:
        require(binding(ROOT / entry['path']) == {key: entry[key] for key in ('path', 'bytes', 'sha256')}, 'browser original identity')
    require(proof['fixtureSha256'] == native['fixture']['sha256'] and len(proof['cases']) == len(fixtures),
            'browser shared fixture identity and coverage')
    for browser, expected in zip(proof['cases'], native['cases']):
        require(browser == {key: value for key, value in expected.items() if key != 'resultBytes'}, 'complete native/Wasm bank case parity')
    cases = {fixture['name']: fixture for fixture in fixtures}
    native_cases = {case['name']: case for case in native['cases']}
    anchors = {anchor['name']: anchor for anchor in proof['anchors']}
    required = {'hardware-simple-vertex', 'hardware-simple-fragment', 'hardware-low-vertex', 'hardware-high-vertex',
                'hardware-low-fragment', 'hardware-high-fragment', 'hardware-order-fragment',
                'hardware-maximal-vertex', 'hardware-maximal-fragment'}
    require(len(proof['anchors']) == 9 and set(anchors) == required, 'nine exact hardware anchors')
    for name, anchor in anchors.items():
        require({key: anchor[key] for key in cases[name]} == cases[name] and anchor['inputSha256'] == sha(anchor['text'].encode())
                and anchor['result'] == native_cases[name]['result'], 'exact hardware text and native translation binding')
    require(len(proof['pairs']) == 4, 'all bank pairs in Wasm')
    for browser, expected in zip(proof['pairs'], native['pairs']):
        require(browser == {key: expected[key] for key in ('name', 'vertexSha256', 'fragmentSha256', 'result')}, 'complete native/Wasm bank pair parity')
    require(proof['recovery'] == {'rounds': 2, 'singleConversions': len(fixtures) * 8, 'pairConversions': len(fixtures) * 4},
            'exact low/high single and full-bank pair recoveries')
    require(proof['memory'] == {'initialBytes': 16777216, 'observations': 55 + len(fixtures) * 15,
                              'bufferIdentityStable': True, 'finalBytes': 16777216}, 'fixed-memory identity across every recorded conversion')
    stress = proof['stress']
    for field, value in {'iterations': 32, 'nonEndInstructionsPerStage': 179, 'temporaryIndices': 118,
                         'constantIndices': 46, 'vertexBytes': 16384, 'fragmentBytes': 16384}.items():
        require(stress[field] == value, f'maximal bank stress boundary: {field}')
    for stage in ('vertex', 'fragment'):
        text = cases[f'hardware-maximal-{stage}']['text']
        require(stress[stage + 'Sha256'] == sha((text + '\n' * (16384 - len(text))).encode()), 'exact padded stress input')
        require(len(re.findall(r'^\s*(?:\d+:\s*)?(?:MOV|ADD|MUL|MAD|TEX)\b', text, re.MULTILINE)) == 179,
                'independent maximal non-END instruction count')
    require(stress['result'] == native['pairs'][3]['result'], 'padded pair exact output recovery')
    maxima = {'singleJSON': {'bytes': 0, 'name': None}, 'pairJSON': {'bytes': 0, 'name': None}, 'glsl': {'bytes': 0, 'name': None}}
    observed = [(entry['result'], entry['sha256'], False) for entry in proof['corpus']]
    observed += [(entry['result'], entry['name'], False) for entry in proof['cases']]
    observed += [(entry['result'], entry['name'], True) for entry in proof['pairs']]
    for result, name, pair in observed:
        length = len(json.dumps(result, separators=(',', ':'), ensure_ascii=False).encode())
        kind = 'pairJSON' if pair else 'singleJSON'
        if length > maxima[kind]['bytes']:
            maxima[kind] = {'bytes': length, 'name': name}
        if result['ok']:
            for stage in ([result['vertex'], result['fragment']] if pair else [result]):
                length = len(stage['glsl'].encode())
                if length > maxima['glsl']['bytes']:
                    maxima['glsl'] = {'bytes': length, 'name': name}
    require(proof['measuredOutputMaxima'] == maxima, 'independently measured observed browser maxima')
    return anchors


def verify_feedback(proof, anchors):
    records = proof['transformFeedback']
    require([record['mode'] for record in records] == ['low', 'high', 'low', 'maximal'], 'vertex low/high/low and179-instruction hardware paths')
    inputs = [[-.5, -.25, .25, 1], [.75, .5, -.25, 1], [-.125, .875, .5, 1]]
    # Independently calculated exact dyadic vectors, not derived from readback or GLSL.
    positions = {'low': [[-.375, -.25, -.125, 1], [.875, .125, -.375, 1], [0, .3125, 0, 1]],
                 'high': [[-.125, -.1875, 0, 1], [.5, 0, -.5, 1], [.0625, .09375, .25, 1]]}
    for record in records:
        mode = record['mode']
        require(record['inputs'] == inputs and record['attribute']['values'] == inputs
                and record['attribute']['name'] == 'in_0', 'literal unequal vertex inputs')
        require(record['varyings'] == ['gl_Position', 'vso_g0'] and record['reflection'] == [
            {'name': 'gl_Position', 'size': 1, 'type': 35666}, {'name': 'vso_g0', 'size': 1, 'type': 35666}], 'actual vector feedback reflection')
        values = []
        for position in inputs if mode == 'maximal' else positions[mode]:
            values.extend(position)
            values.extend([0, 0, 0, 59] if mode == 'maximal' else position[:3] + [.75])
        bits = float_bits(values)
        require(record['expectedFloats'] == record['observedFloats'] == values
                and record['expectedBits'] == record['observedBits'] == bits, 'independent raw binary32 position and preserved low-TEMP sentinel')
        require(record['bytesSha256'] == sha(struct.pack('<24I', *bits)), 'literal transform-feedback bytes digest')
        vertex = anchors[f'hardware-{mode}-vertex']['result']
        fragment = anchors['hardware-maximal-fragment' if mode == 'maximal' else 'hardware-simple-fragment']['result']
        require(record['vertexGlslSha256'] == sha(vertex['glsl'].encode())
                and record['fragmentGlslSha256'] == sha(fragment['glsl'].encode()), 'actual feedback stages equal native translation')
        expected = [('vertex', 46, 8 if mode == 'low' else 46, mode == 'maximal')]
        if mode == 'maximal':
            expected.append(('fragment', 46, 46, True))
        check_bindings(record, expected)
        require('failure' not in record, 'successful feedback cannot retain failure')


def verify_pixels(record, anchors, failure=False):
    mode = record['mode']
    colors = {'low': [128, 96, 64, 191], 'high': [64, 191, 128, 191],
              'order': [64, 191, 128, 191], 'maximal': [0, 0, 0, 255]}
    expected = colors[mode]
    require(record['width'] == record['height'] == 32 and record['expected'] == expected, 'literal pixel target and expected color')
    positions = [[-1, -1, 0, 1], [1, -1, 0, 1], [-1, 1, 0, 1], [-1, 1, 0, 1], [1, -1, 0, 1], [1, 1, 0, 1]]
    require(record['attribute']['values'] == positions and record['attribute']['name'] == 'in_0', 'literal full-viewport vertices')
    vertex = anchors['hardware-maximal-vertex' if mode == 'maximal' else 'hardware-simple-vertex']['result']
    fragment = anchors[f'hardware-{mode}-fragment']['result']
    require(record['vertexGlslSha256'] == sha(vertex['glsl'].encode()), 'actual pixel vertex equals native output')
    bindings = []
    if mode == 'maximal':
        bindings.append(('vertex', 46, 46, True))
    bindings.append(('fragment', 47 if mode == 'order' else 46, 6 if failure else 8 if mode == 'low' else 46, mode == 'maximal'))
    check_bindings(record, bindings)
    if failure:
        require(mode == 'high' and record['checkedPixels'] == 0 and len(record['checks']) == 1, 'alias must fail first high pixel')
        expected_failure = {'pixel': [8, 8], 'expected': colors['high'], 'observed': [223, 96, 191, 191]}
        require(record['failure'] == expected_failure and record['checks'][0] == expected_failure, 'specific independently predicted alias failure')
        changed = fragment['glsl'].replace('fsconst0[45]', 'fsconst0[5]')
        require(fragment['glsl'].count('fsconst0[45]') == 1 and record['fragmentGlslSha256'] == sha(changed.encode()), 'exact high-index alias source mutation')
    else:
        require(record['fragmentGlslSha256'] == sha(fragment['glsl'].encode()), 'actual pixel fragment equals native output')
        require(record['checkedPixels'] == 256 and len(record['checks']) == 256 and 'failure' not in record, 'complete256 independent pixel samples')
        for check, point in zip(record['checks'], ([x, y] for y in range(8, 24) for x in range(8, 24))):
            require(check == {'pixel': point, 'expected': expected, 'observed': expected}, 'independent pixel coordinate/color oracle')


def verify_execution(reports, native, fixtures, corpus):
    hardware, sabotage = (reports[name]['acceptance'] for name in ('hardware', 'sabotage'))
    for proof in (hardware, sabotage):
        anchors = verify_shared_browser(proof, native, fixtures, corpus)
        verify_feedback(proof, anchors)
    require(hardware['status'] == 'passed' and hardware['sabotage'] is None and hardware['omissions'] == [], 'complete bank hardware proof')
    require([record['mode'] for record in hardware['draws']] == ['low', 'high', 'low', 'order', 'maximal']
            and hardware['checkedPixels'] == 1280, 'five hardware pixel phases')
    for record in hardware['draws']:
        verify_pixels(record, anchors)
    require(sabotage['status'] == 'failed' and sabotage['sabotage'] == 'high-alias'
            and [record['mode'] for record in sabotage['draws']] == ['low', 'high'], 'alias control reaches intended high pixel')
    verify_pixels(sabotage['draws'][0], anchors)
    verify_pixels(sabotage['draws'][1], anchors, failure=True)
    original = anchors['hardware-high-fragment']['result']['glsl']
    require(len(sabotage['omissions']) == 1, 'one source-bound alias control')
    omission = sabotage['omissions'][0]
    require(omission['mode'] == 'high-alias' and omission['original'] == 'fsconst0[45]' and omission['replacement'] == 'fsconst0[5]'
            and omission['originalGlslSha256'] == sha(original.encode())
            and omission['servedGlslSha256'] == sha(original.replace('fsconst0[45]', 'fsconst0[5]').encode()), 'exact alias control digest')
    require('independent pixel (8,8)' in sabotage['failure']['message'], 'alias failed wrong oracle')


def main():
    require(len(sys.argv) == 2, 'usage: receipt.py EVIDENCE_DIRECTORY')
    output = Path(sys.argv[1]).resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    contract = read_json(ROOT / 'docs/gpu-3d-contract.json')
    require(contract['production'] == gate.PRODUCTION and contract['shaderProfile'] == PROFILE,
            'v5 frontend only; production stays disabled')
    require(read_json(output / 'inventory.json') == inventory_gate.inventory(), 'fresh independently reconstructed original inventory')
    regression = read_json(output / 'regression/receipt.json')
    require(regression['task'] == 'E6-T12e2' and regression['status'] == 'passed' and regression['gitHead'] == head,
            'prior pair/shader/renderer acceptance head')
    for source in regression['sources']:
        require(binding(ROOT / source['path']) == source, 'regression source identity')
    check_records(output / 'regression', regression)
    require(regression['shaderOutcomes'] == {'translated': 12, 'unsupported-feature': 7}, 'original acceptance preserved')
    corpus = read_json(output / 'regression/components/regression/contract/receipt.json')['capturedShaderResults']
    fixtures = read_json(ROOT / 'renderer/virgl-shader/tests/bank-cases.json')
    native = read_json(output / 'native/native-report.json')
    verify_native(native, fixtures, corpus, output)
    reports = {name: verify_browser_sources(output, name, head, contract) for name in ('hardware', 'sabotage')}
    verify_execution(reports, native, fixtures, corpus)
    names = {entry['path'] for entry in regression['sources'] + reports['hardware']['sources']}
    names.update(str(path.relative_to(ROOT)) for path in (ROOT / 'tools/virgl-banks').glob('*.py'))
    names.update(('tools/verify-virgl-banks.sh', 'tools/verify-virgl-banks.mjs'))
    sources = []
    for name in sorted(names):
        if '/build/' in name:
            continue
        entry = binding(ROOT / name)
        frozen = subprocess.check_output(['git', 'show', f'{head}:{name}'], cwd=ROOT)
        require(sha(frozen) == entry['sha256'], f'bank source differs from frozen head: {name}')
        sources.append(entry)
    for filename, digest in regression['compilerSha256'].items():
        check_digest(Path(filename), digest)
    records = [binding(path, output) for path in sorted(output.rglob('*'))
               if path.is_file() and path != output / 'receipt.json' and path.name != 'acceptance.log']
    receipt = {'schema': 1, 'task': 'E6-T12e3', 'status': 'passed', 'gitHead': head,
               'boundary': 'Canonical file-specific register banks and static budget through native/Wasm and direct hardware; no constant-command widening or guest GPU activation.',
               'production': contract['production'], 'shaderOutcomes': regression['shaderOutcomes'], 'limits': LIMITS,
               'nativeCases': len(fixtures), 'sources': sources, 'records': records,
               'compilerSha256': regression['compilerSha256']}
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('E6-T12e3 passed: bounded TEMP117/CONST45 and 179 non-END instructions; unchanged12/19 originals; native/Wasm and hardware oracles.')


if __name__ == '__main__':
    main()
