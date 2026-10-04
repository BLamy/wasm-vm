#!/usr/bin/env python3
"""Critic source interpreter. No worker oracle or emitted GLSL supplies expectations."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
U = OUT / 'unpacked'
MASK = (1 << 32) - 1


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def word(value):
    return struct.unpack('<I', struct.pack('<f', value))[0]


def number(value):
    return struct.unpack('<f', struct.pack('<I', value))[0]


def conversion(op, value):
    if op == 'I2F':
        return word(struct.unpack('<i', struct.pack('<I', value))[0])
    f = number(value)
    assert math.isfinite(f) and -(1 << 31) <= f < (1 << 31), ('undefined F2I', hex(value), f)
    return math.trunc(f) & MASK


def lines(text):
    return [re.sub(r'^\d+:\s*', '', x.strip()) for x in text.splitlines() if x.strip()]


def run(text, banks=(), inputs=None):
    state = {'IN': inputs or {}, 'CONST': {i: list(banks[i*4:i*4+4]) for i in range(len(banks)//4)},
             'TEMP': {}, 'OUT': {}, 'IMM': {}}
    active = True
    branches = []

    def source(text):
        negate = text.startswith('-')
        if negate:
            text = text[1:]
        absolute = text.startswith('|')
        if absolute:
            assert text.endswith('|')
            text = text[1:-1]
        m = re.fullmatch(r'(IN|CONST|TEMP|OUT|IMM)\[(\d+)\](?:\.([xyzw]{4}))?', text)
        assert m, ('source syntax', text)
        data = state[m[1]][int(m[2])]
        assert len(data) == 4, ('absent source lanes', text, data)
        result = [data['xyzw'.index(x)] for x in (m[3] or 'xyzw')]
        if absolute:
            result = [x & 0x7fffffff for x in result]
        if negate:
            result = [x ^ 0x80000000 for x in result]
        return result

    for line in lines(text):
        if line in ['VERT', 'FRAG', 'END'] or line.startswith(('DCL ', 'PROPERTY ')):
            continue
        m = re.fullmatch(r'IMM\[(\d+)\] (UINT32|INT32|FLT32) \{([^}]+)\}', line)
        if m:
            values = [x.strip() for x in m[3].split(',')]
            state['IMM'][int(m[1])] = [int(x, 0) & MASK if m[2] != 'FLT32' or x.lower().startswith('0x') else word(float(x)) for x in values]
            continue
        if line.startswith('UIF '):
            condition = bool(source(line[4:])[0]) if active else False
            branches.append((active, condition))
            active = active and condition
            continue
        if line == 'ELSE':
            active = branches[-1][0] and not branches[-1][1]
            continue
        if line == 'ENDIF':
            active = branches.pop()[0]
            continue
        if not active:
            continue
        op, rest = line.split(' ', 1)
        dest, *operands = [x.strip() for x in rest.split(',')]
        d = re.fullmatch(r'(TEMP|OUT)\[(\d+)\](?:\.([xyzw]{1,4}))?', dest)
        assert d, ('destination syntax', dest)
        inputs = [source(x) for x in operands]  # Snapshot all sources before writes.
        result = []
        for lane in range(4):
            a = inputs[0][lane]
            b = inputs[1][lane] if len(inputs) > 1 else 0
            if op == 'MOV':
                answer = a
            elif op in ['I2F', 'F2I']:
                # Masked instructions must never evaluate unconsumed words.
                answer = conversion(op, a) if 'xyzw'[lane] in (d[3] or 'xyzw') else 0
            elif op == 'AND':
                answer = a & b
            elif op == 'OR':
                answer = a | b
            elif op == 'SHL':
                answer = a << (b & 31)
            elif op == 'USHR':
                answer = a >> (b & 31)
            elif op == 'UCMP':
                answer = b if a else inputs[2][lane]
            else:
                raise AssertionError(('unexpected instruction in physical source', op))
            result.append(answer & MASK)
        data = state[d[1]].setdefault(int(d[2]), [None] * 4)
        for x in d[3] or 'xyzw':
            data['xyzw'.index(x)] = result['xyzw'.index(x)]
    assert not branches
    return state['OUT']


def components(text):
    consumed = {}
    for line in lines(text):
        m = re.fullmatch(r'F2I (?:TEMP|OUT)\[\d+\](?:\.([xyzw]+))?, CONST\[(\d+)\](?:\.([xyzw]{4}))?', line)
        if not m:
            continue
        # Duplicate swizzles consume one component, so use bitwise union.
        mask = 0
        for x in m[1] or 'xyzw':
            mask |= 1 << 'xyzw'.index((m[3] or 'xyzw')['xyzw'.index(x)])
        index = int(m[2])
        consumed[index] = consumed.get(index, 0) | mask
    return [{'register': i, 'mask': m} for i, m in sorted(consumed.items())]


def authenticate_browser(path):
    raw = path.read_bytes()
    report = json.loads(raw)
    head = report['gitHead']
    assert not report['trackedChanges'] and report['browserErrors'] == {'console': [], 'page': [], 'requests': []}
    assert report['browser']['launch']['headless'] is False
    assert report['browser']['gpu']['featureStatus'][report['browser']['webglFeature']] == 'enabled'
    generated = {x['path']: x for x in json.loads((U / 'hot/receipt.json').read_bytes())['sources'] if '/build/' in x['path']}
    for row in report['sources']:
        if '/build/' in row['path']:
            data = (U / 'generated' / row['path'].split('/build/', 1)[1]).read_bytes()
        else:
            data = subprocess.check_output(['git', 'show', head + ':' + row['path']], cwd=ROOT)
        assert sha(data) == row['sha256'] and len(data) == row.get('size', row.get('bytes')), ('browser source binding', path, row)
    source_rows = {x['path']: x for x in report['sources']}
    for row in report['servedFiles']:
        assert row['sha256'] == source_rows[row['path']]['sha256']
    coverage = report['browserCoverage']
    assert sha((path.parent / coverage['path']).read_bytes()) == coverage['sha256']
    for row in json.loads((path.parent / coverage['path']).read_bytes())['scripts']:
        assert row['sha256'] == source_rows[row['source']]['sha256']
    shot = report.get('screenshot') or report.get('failureScreenshot')
    assert sha((path.parent / shot['path']).read_bytes()) == shot['sha256']
    a = report['acceptance']
    assert not a['guestExecution'] and not a['productionNegotiation'] and a['objects']['live'] == 0
    assert a['primaryFile']['sha256'] == generated['renderer/virgl-shader/build/signed-conversions-primary.json']['sha256']
    return report, sha(raw)


def audit_gpu(path):
    path = path.resolve()
    report, digest = authenticate_browser(path)
    assert report['status'] == 'passed'
    a = report['acceptance']
    assert not re.search('swiftshader|llvmpipe|softpipe|software', a['renderer']['renderer'], re.I)
    result = {'path': str(path.relative_to(OUT)), 'sha256': digest, 'seed': a['seed'], 'renderer': a['renderer'],
              'vertices': [], 'fragments': [], 'draws': [], 'guardedAttacks': 0, 'asyncWaits': 0}
    words = pixels = 0
    actual_sources = {x['source'] for x in a['events'] if x['call'] == 'shaderSource'}
    for index, vertex in enumerate(a['vertices']):
        assert vertex['textSha256'] == sha(vertex['text'].encode())
        emitted = vertex['primary']['glsl'] if vertex['backend'] == 'mesa' else vertex['pair']['vertex']['glsl']
        assert emitted in actual_sources, ('missing actual shaderSource', index)
        assert vertex['reflection'] == [{'name': n, 'type': 35666, 'size': 1} for n in ['gl_Position', 'vso_g0', 'vso_g1']]
        if vertex['uniformReflection']:
            r = vertex['uniformReflection']
            assert r['type'] == 36296 and 1 <= r['count'] <= r['declaredCount']
        if 'constantConversionDomains' in vertex['pair']['vertex']['metadata']:
            assert components(vertex['text']) == vertex['pair']['vertex']['metadata']['constantConversionDomains'][0]['components']
        for vi, vector in enumerate(vertex['vectors']):
            bank = vector['bankUpload']['words'] if vector['bankUpload'] else []
            attrs = {0: [word(x) for x in vector['position']]}
            if vertex['inputSource']:
                attrs[1] = vector['inputWords']
                assert attrs[1] == vector['input']['a']
            expected_out = run(vertex['text'], bank, attrs)
            expected = sum([expected_out[i] for i in range(3)], [])
            raw = bytes(vector['bytes'])
            actual = list(struct.unpack('<12I', raw))
            assert actual == expected and sha(raw) == vector['sha256'], ('vertex', index, vi, actual, expected)
            assert vector['observed'] == expected and vector['attributeWords'] == attrs[0]
            reconstructed = [((actual[8+i] & 511) << 23) | (actual[4+i] & 0x7fffff) for i in range(4)]
            assert reconstructed == vector['reconstructed'] == vector['selectedWords']
            result['vertices'].append({'program': index, 'vector': vi, 'sourceSha256': vertex['textSha256'], 'expectedWords': expected, 'resultSha256': sha(raw), 'all32bits': reconstructed})
            words += len(expected)
    for index, fragment in enumerate(a['fragments']):
        assert fragment['textSha256'] == sha(fragment['text'].encode())
        emitted = fragment['primary']['glsl'] if fragment['backend'] == 'mesa' else fragment['pair']['fragment']['glsl']
        assert emitted in actual_sources
        expected = [round(number(x) * 255) for x in run(fragment['text'])[0]]
        raw = bytes(fragment['rgbaBytes'])
        assert raw == bytes(expected * 16) and sha(raw) == fragment['sha256'], ('fragment', index, expected)
        result['fragments'].append({'program': index, 'plane': fragment['plane'], 'sourceSha256': fragment['textSha256'], 'expectedRGBA': expected, 'resultSha256': sha(raw)})
        pixels += 16
    for di, draw in enumerate(a['bankDraws']):
        stage = draw['stage']
        assert components(draw['sources']['vertex' if stage == 0 else 'fragment']) == [draw['components']]
        assert len(draw['draws']) == 5 and len(draw['attacks']) == 6
        for pi, observed in enumerate(draw['draws']):
            vo = run(draw['sources']['vertex'], observed['words'] if stage == 0 else (), {0: [word(x) for x in [-1, -1, 0, 1]]})
            fo = run(draw['sources']['fragment'], observed['words'] if stage == 1 else (), {0: vo[1]})
            expected = [round(number(x) * 255) for x in fo[0]]
            raw = bytes(observed['rgbaBytes'])
            assert raw == bytes(expected * 16) and sha(raw) == observed['sha256'], ('indexed draw', di, pi)
            assert observed['source'] == observed['uniformWords'] == observed['words'][draw['components']['register']*4:draw['components']['register']*4+4]
            assert observed['snapshot']['contexts'][0]['subContexts'][0]['bindings']['constants'][stage] == observed['words']
            result['draws'].append({'rig': di, 'draw': pi, 'stage': stage, 'async': draw['asynchronous'], 'expectedRGBA': expected, 'resultSha256': sha(raw)})
            pixels += 16
        for attack in draw['attacks'][:5]:
            assert not math.isfinite(number(attack['poison'])) or not -(1 << 31) <= number(attack['poison']) < (1 << 31)
            assert attack['before'] == attack['after'] and attack['pixelsBefore'] == attack['pixelsAfter']
            assert attack['result']['ok'] is False and attack['result']['appliedCommands'] == 0 and attack['result']['error']['code'] == 'constant-conversion-domain-error'
            assert not any(e['call'] in ['uniform4uiv', 'drawElements', 'getBufferSubData', 'copyBufferSubData'] for e in attack['events'])
            result['guardedAttacks'] += 1
        assert draw['attacks'][5]['result']['error']['code'] == 'incomplete-draw'
        for yield_attack in draw['yieldAttacks']:
            assert yield_attack['before'] == yield_attack['after']
            assert all(x['ok'] is False and x['error']['code'] == 'busy' for x in yield_attack['attempts'])
            assert yield_attack['before']['jobs']['status'] == 'waiting-index'
            result['asyncWaits'] += 1
        for submission in draw['submissions']:
            assert set(submission['after']) <= {255}
        assert not draw['oracleStops'] and all(x == 0 for x in draw['finalBudgets'].values()) and all(x == 0 for x in draw['finalResourceBudgets'].values())
    for consumer in a['consumers']:
        assert len(consumer['captures']) == 6 and consumer['rejection']['before'] == consumer['rejection']['after']
        assert consumer['rejection']['result']['ok'] is False and consumer['rejection']['result']['appliedCommands'] == 0
        for capture in consumer['captures']:
            banks = capture['snapshot']['contexts'][0]['subContexts'][0]['bindings']['constants']
            assert len(banks[0]) == len(banks[1]) == 184 and banks[0] == banks[1]
            for binding in capture['native']:
                assert binding['words'] == banks[0 if binding['name'] == 'vsconst0' else 1][binding['index']*4:binding['index']*4+4]
        assert all(x == 0 for x in consumer['finalBudgets'].values()) and all(x == 0 for x in consumer['finalResourceBudgets'].values())
    assert words == a['checkedWords'] and pixels == a['checkedPixels']
    result.update(checkedWords=words, checkedPixels=pixels, status='passed')
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--gpu', action='append', type=Path)
    parser.add_argument('--output', type=Path, default=OUT / 'source-semantics.json')
    args = parser.parse_args()
    files = args.gpu or [U / prefix / ('gpu-' + str(seed)) / 'report.json' for prefix in ['hot', 'cold/acceptance'] for seed in [1369979863, 2804203833, 3781791491]]
    report = {'schema': 'virgl-signed-conversions-source-critic-v1', 'task': 'E6-T12g6e', 'status': 'running', 'runs': []}
    try:
        for file in files:
            report['runs'].append(audit_gpu(file))
        report['status'] = 'passed'
    finally:
        args.output.write_text(json.dumps(report, indent=2) + '\n')
    print('Independent source interpretation:', sum(x['checkedWords'] for x in report['runs']), 'words,', sum(x['checkedPixels'] for x in report['runs']), 'pixels')


if __name__ == '__main__':
    main()
