"""Independent original-wire, metadata, historical-byte and full-capture critic."""
import hashlib
import json
import re
import struct
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
ROOT = REPO / 'target/evidence/d65-critic-opened-01/worker/cold/recording'
sha = lambda b: hashlib.sha256(b).hexdigest()
citations = []
counts = dict(compiler=0, historical=0, faults=0, reflection=0, hardware=0, redirected=0, capturedBytes=0, nativeCalls=0, originalTokenWords=0)
selectors = ['signedMask', 'unsignedMask', 'packedSignedMask', 'packedNormalizedMask', 'bufferZeroMask', 'signedColorMask', 'unsignedColorMask']


def jsonl(path):
    for i, line in enumerate(path.read_bytes().splitlines(), 1):
        yield i, json.loads(line), sha(line)


def metadata(words, buffer):
    count = words[0] if words else 0
    outputs, varying, components = [], [], 0
    for i in range(count):
        v = words[5 + 2 * i]
        reg, start, size, target, dest = v & 255, (v >> 8) & 3, (v >> 10) & 7, (v >> 13) & 7, v >> 16
        outputs.append(dict(registerIndex=reg, startComponent=start, numComponents=size, outputBuffer=target, destinationOffset=dest, stream=words[6 + 2 * i]))
        if target == buffer:
            varying.append(dict(outputIndex=i, name='wv_so_' + str(i), type='uint' if size == 1 else 'uvec' + str(size), components=size, packedOffset=components * 4))
            components += size
    return dict(encoding='raw-32bit-words', captureBuffer=buffer, strides=words[1:5] if count else [0] * 4,
                outputs=outputs, varyings=varying, packedStrideBytes=components * 4)


def prediction(case):
    if case['kind'] not in [0, 1, 2]:
        return 'unsupported-stage'
    for stage, text in ([(0, case['a']), (1, case['b'])] if case['kind'] == 2 else [(case['kind'], case['a'])]):
        if '\0' in text:
            return 'invalid-input'
        if not text:
            return 'unsupported-feature'
        if not text.startswith('VERT\n' if stage == 0 else 'FRAG\n'):
            return 'unsupported-stage'
        if not re.search(r'\d+: END\n$', text):
            return 'unsupported-feature'
    words, buffer = case['words'], case['capture']
    if buffer > 3 or case['nullWords'] and words:
        return 'invalid-input'
    if not words:
        return None
    count = words[0]
    if count > 128:
        return 'limit-exceeded'
    if len(words) != (5 + 2 * count if count else 1):
        return 'invalid-input'
    if count and case['kind'] == 1:
        return 'unsupported-feature'
    if not count:
        return None
    strides = words[1:5]
    if any(s > 65535 for s in strides):
        return 'invalid-input'
    declared = {}
    for reg, mask in re.findall(r'DCL OUT\[(\d+)\](?:\.([xyzw]+))?', case['a']):
        declared[int(reg)] = set(mask or 'xyzw')
    occupied, totals = [set() for _ in range(4)], [0] * 4
    for i in range(count):
        value = words[5 + 2 * i]
        reg, first, size, target, dest = value & 255, (value >> 8) & 3, (value >> 10) & 7, (value >> 13) & 7, value >> 16
        if reg > 31 or not 1 <= size <= 4 or first + size > 4 or target > 3:
            return 'invalid-input'
        if words[6 + 2 * i]:
            return 'unsupported-feature'
        if reg not in declared or not set('xyzw'[first:first + size]).issubset(declared[reg]):
            return 'unsupported-feature'
        if not strides[target] or dest + size > strides[target]:
            return 'invalid-input'
        interval = set(range(dest, dest + size))
        if interval & occupied[target]:
            return 'invalid-input'
        if totals[target] + size > 64:
            return 'limit-exceeded'
        occupied[target] |= interval
        totals[target] += size
    return None


def source_and_metadata(response, words, buffer, stage):
    wanted = metadata(words, buffer)
    if stage == 1:
        wanted = metadata([], buffer)
    assert response['metadata']['streamOutput'] == wanted
    assert response['metadata']['profile'] == 'virgl-webgl2-standard-stream-output-gles3-v1'
    glsl = response['glsl']
    declarations = re.findall(r'flat out highp (uint|uvec[234]) (wv_so_\d+);', glsl)
    assert declarations == [(v['type'], v['name']) for v in wanted['varyings']]
    assignments = re.findall(r'(wv_so_\d+) = o(\d+)\.([xyzw]+);', glsl)
    selected = [e for e in wanted['outputs'] if e['outputBuffer'] == buffer]
    assert assignments == [(v['name'], str(e['registerIndex']), 'xyzw'[e['startComponent']:e['startComponent'] + e['numComponents']]) for v, e in zip(wanted['varyings'], selected)]
    for entry in wanted['outputs']:
        assert 'uvec4 o' + str(entry['registerIndex']) + ' = uvec4(0u);' in glsl
    if assignments and 'gl_Position = ' in glsl:
        assert max(glsl.index(name + ' = ') for name, _, _ in assignments) < glsl.index('gl_Position = ')
    assert response['metadata']['standardSemantics']['exactAuthority'] is False
    assert response['metadata']['standardSemantics']['gpuExecutionBound'] is False
    return wanted


cases = json.loads((ROOT / 'native/cases.json').read_bytes())
wire = (ROOT / 'native/cases.bin').read_bytes()
at = 0


def number():
    global at
    result = struct.unpack_from('<I', wire, at)[0]
    at += 4
    return result


def string():
    global at
    count = number()
    result = wire[at:at + count].decode()
    at += count
    return result


assert number() == len(cases) == 400
for case in cases:
    kind, capture, word_count, null_words = number(), number(), number(), number()
    selected = {name: number() for name in selectors}
    a, b = string(), string()
    words = [number() for _ in range(word_count)]
    assert (kind, capture, words, bool(null_words), selected, a, b) == (case['kind'], case['capture'], case['words'], case['nullWords'], case['selectors'], case['a'], case['b'])
assert at == len(wire)
native = list(jsonl(ROOT / 'native/native.jsonl'))
sanitized = list(jsonl(ROOT / 'native/sanitize.jsonl'))
wasm = list(jsonl(ROOT / 'native/wasm.jsonl'))
assert len(native) == len(sanitized) == len(wasm) == 400
for i, (case, (_, observed, digest), (_, checked, _), (_, actual, _)) in enumerate(zip(cases, native, sanitized, wasm)):
    assert observed == checked and observed['response'] == actual['response']
    assert observed['index'] == actual['index'] == i
    expected_error = prediction(case)
    response = observed['response']
    assert response['ok'] == (expected_error is None), case['name']
    if expected_error:
        assert response['error']['code'] == expected_error, case['name']
        assert set(response) == {'ok', 'error'} and observed['originalTokens'] == []
    else:
        if case['kind'] == 2:
            source_and_metadata(response['vertex'], case['words'], case['capture'], 0)
            source_and_metadata(response['fragment'], [], case['capture'], 1)
        else:
            source_and_metadata(response, case['words'], case['capture'], case['kind'])
        assert len(observed['originalTokens']) == (2 if case['kind'] == 2 else 1)
        for tokens, stage in zip(observed['originalTokens'], [0, 1] if case['kind'] == 2 else [case['kind']]):
            assert len(tokens) == (tokens[0] & 255) + (tokens[0] >> 8)
            assert tokens[1] == (1 if stage == 0 else 0)
            counts['originalTokenWords'] += len(tokens)
    counts['compiler'] += 1
    citations.append(dict(prediction='P1/P2/P4', member='cold/recording/native/native.jsonl', line=i + 1, sha256=digest, name=case['name'], expectedError=expected_error))

historical_cases = json.loads((ROOT / 'historical/cases.json').read_bytes())['cases']
historical_native = list(jsonl(ROOT / 'historical/current-native.jsonl'))
assert (ROOT / 'historical/current-native.jsonl').read_bytes() == (ROOT / 'historical/baseline-native.jsonl').read_bytes() == (ROOT / 'historical/sanitize.jsonl').read_bytes()
for (line, row, digest), case, (_, n, _) in zip(jsonl(ROOT / 'historical/wasm.jsonl'), historical_cases, historical_native):
    assert row['index'] == line - 1 and row['name'] == case['name']
    assert row['before'].encode() == row['after'].encode()
    assert json.loads(row['after']) == n['result']
    counts['historical'] += 1
assert counts['historical'] == len(historical_cases) == len(historical_native) == 20927
citations.append(dict(prediction='P6', member='cold/recording/historical/wasm.jsonl', lines=20927,
                      sha256=sha((ROOT / 'historical/wasm.jsonl').read_bytes()), allCompleteResponseBytesIdentical=True))

allocations = list(jsonl(ROOT / 'native/allocations.jsonl'))
baselines = {r['mode']: r for _, r, _ in allocations if r['kind'] == 'baseline'}
assert set(baselines) == set(range(5)) and all(r['result']['ok'] for r in baselines.values())
for mode in range(5):
    for kind, length in [('upstream-fault', baselines[mode]['allocations']), ('calloc-fault', baselines[mode]['callocs'])]:
        rows = [(line, r, digest) for line, r, digest in allocations if r['kind'] == kind and r['mode'] == mode]
        assert [r['site'] for _, r, _ in rows] == list(range(1, length + 1))
        for line, row, digest in rows:
            assert row['result']['ok'] is False and set(row['result']) == {'ok', 'error'}
            counts['faults'] += 1
            citations.append(dict(prediction='P5', member='cold/recording/native/allocations.jsonl', line=line, sha256=digest, mode=mode, kind=kind, site=row['site']))
summary = allocations[-1][1]
assert summary['kind'] == 'summary' and summary['faults'] == summary['recoveries'] == counts['faults'] == 181
assert summary['callerMutation'] and not summary['partialResults']
assert all(r['mutatedBeforeAllocation'] and r['recovered'] for _, r, _ in allocations if r['kind'] == 'caller-custody')
facade = json.loads((ROOT / 'native/facade.json').read_bytes())
assert facade['status'] == 'passed' and facade['cases'] == len(facade['observed']) == 386
for row in facade['observed']:
    expected = native[row['index']][1]['response']
    assert row['response'] == expected if expected['ok'] else row['response']['error']['code'] == expected['error']['code']
assert facade['reflectionCases'] == len(facade['reflection']) == 123
assert all(r['response']['ok'] is False for r in facade['reflection'])
assert facade['snapshotReads'] == 1 and facade['pressure']['recovered'] and facade['fixedMemoryBytes'] == 16777216
counts['reflection'] = 123


def output_model(f, constants):
    result = {0: constants[0][:]}
    if f['kind'] == 'wide':
        result.update({i + 1: constants[i][:] for i in range(16)})
        return result
    reg, mode = f['register'], f['mode']
    if reg == 0 and mode == 'copy':
        return result
    value, source = constants[0][:] if reg == 0 else [0] * 4, constants[1]
    if mode == 'copy':
        value = source[:]
    elif mode == 'alias':
        value = [source[1], source[0], source[2], source[3]]
    elif mode == 'partial':
        value[0], value[2] = source[3], source[1]
    elif mode == 'conditional' and source[0]:
        value[2:] = source[2:]
    result[reg] = value
    return result


for name in ['hardware-54831', 'hardware-90107', 'hardware-171281', 'fault-varying-order']:
    directory = ROOT / name
    raw = (directory / 'report.json').read_bytes()
    report = json.loads(raw)
    negative = name.startswith('fault-')
    assert report['head'] == '31bf0781db74fea94f51c9d6fa3217d16227bc99' and not report['trackedChanges']
    assert report['status'] == ('failed' if negative else 'passed') and report['errors'] == []
    assert report['hardware']['gpu']['featureStatus'].get('webgl2', report['hardware']['gpu']['featureStatus'].get('webgl')) == 'enabled'
    payload = report['partial'] if negative else report['result']
    seen = set()
    for row_index, row in enumerate(payload['rows']):
        fixture = row['fixture']
        seen.add(fixture['name'])
        assert row['request']['streamOutputWords'] == fixture['words'] and row['request']['captureBuffer'] == fixture['buffer']
        assert row['request']['vertexText'] == fixture['vertexText']
        wanted = source_and_metadata(row['result']['vertex'], fixture['words'], fixture['buffer'], 0)
        source_and_metadata(row['result']['fragment'], [], fixture['buffer'], 1)
        constants = [[0, 0x80000000, 0, 0x3f800000] if i == 0 else [(0x7fa12345 + i + (report['seed'] & 65535)) & 0xffffffff, 0x80000000, 0xffffffff, (0x3f800000 + i + (report['seed'] & 255)) & 0xffffffff] for i in range(16)]
        assert row['constants'] == constants
        original = output_model(fixture, constants)
        assert dict(row['original']) == original
        packed = [original[e['registerIndex']][c] for e in wanted['outputs'] if e['outputBuffer'] == fixture['buffer'] for c in range(e['startComponent'], e['startComponent'] + e['numComponents'])]
        expected = bytes([0xa3] * 16) + struct.pack('<' + 'I' * (len(packed) * 3), *(packed * 3)) + bytes([0xa3] * 16)
        actual = bytes(row['actual'])
        assert bytes(row['expected']) == expected and len(actual) == len(expected)
        different = [i for i, (a, b) in enumerate(zip(actual, expected)) if a != b]
        assert row['mismatches'] == [dict(offset=i, expected=expected[i], actual=actual[i]) for i in different]
        calls = [(i, c) for i, c in enumerate(payload['nativeCalls']) if c['fixture'] == fixture['name']]
        methods = [c['method'] for _, c in calls]
        for required in ['shaderSource', 'transformFeedbackVaryings', 'linkProgram', 'beginTransformFeedback', 'drawArrays', 'endTransformFeedback', 'fenceSync', 'clientWaitSync', 'getBufferSubData', 'deleteSync', 'deleteTransformFeedback']:
            assert required in methods
        shader_sources = [c['args'][1] for _, c in calls if c['method'] == 'shaderSource']
        assert shader_sources == [row['result']['vertex']['glsl'], row['result']['fragment']['glsl']]
        selected = next(c['args'][1] for _, c in calls if c['method'] == 'transformFeedbackVaryings')
        assert selected == row['nativeVaryingNames']
        original_names = [v['name'] for v in wanted['varyings']]
        assert selected == (list(reversed(original_names)) if negative and fixture['name'] == 'floor64/3' else original_names)
        types = {'uint': 0x1405, 'uvec2': 0x8dc6, 'uvec3': 0x8dc7, 'uvec4': 0x8dc8}
        by_name = {v['name']: v for v in wanted['varyings']}
        assert row['nativeVaryings'] == [dict(name=n, type=types[by_name[n]['type']], size=1) for n in selected]
        assert row['fence'] in [0x911a, 0x911c]
        assert all(c['result'] == 0 for _, c in calls if c['method'] == 'getError')
        begin = next(i for i, c in calls if c['method'] == 'beginTransformFeedback')
        draw = next(i for i, c in calls if c['method'] == 'drawArrays')
        end = next(i for i, c in calls if c['method'] == 'endTransformFeedback')
        fence = next(i for i, c in calls if c['method'] == 'fenceSync')
        read = next(i for i, c in calls if c['method'] == 'getBufferSubData')
        assert begin < draw < end < fence < read
        if not negative:
            assert actual == expected
            counts['hardware'] += 1
        elif different:
            assert fixture['name'] == 'floor64/3' and payload['completedNativeReadback']
            counts['redirected'] += 1
        counts['capturedBytes'] += len(actual)
        citations.append(dict(prediction='P2/P3/P4' if not different else 'S1 physical control', member='cold/recording/' + name + '/report.json',
                              pointer='/partial/rows/' + str(row_index) if negative else '/result/rows/' + str(row_index),
                              sha256=sha(raw), fixture=fixture['name'], seed=report['seed'], nativeSequences=[begin, draw, end, fence, read],
                              expectedSha256=sha(expected), actualSha256=sha(actual), capturedBytes=len(actual), matches=actual == expected))
    counts['nativeCalls'] += len(payload['nativeCalls'])
    if not negative:
        expected_names = {f'components/{r}/{b}/{s}/{n}' for r in [0, 1, 31] for b in range(4) for s in range(4) for n in range(1, 5 - s)}
        expected_names |= {f'register/{r}/{m}/{b}' for r in [1, 31] for m in ['partial', 'alias', 'conditional', 'unwritten'] for b in range(4)}
        expected_names |= {f'floor64/{b}' for b in range(4)} | {f'outputs128/{b}' for b in range(4)}
        assert seen == expected_names and len(payload['rows']) == 160
assert counts['hardware'] == 480 and counts['redirected'] == 1
(OUT / 'citations.jsonl').write_text(''.join(json.dumps(c) + '\n' for c in citations))
result = dict(schema='stream-output-shaders-full-independent-interrogation-v1', status='passed',
              counts=counts, predictions={p: 'HELD' for p in ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']},
              citationsSha256=sha((OUT / 'citations.jsonl').read_bytes()))
(OUT / 'interrogation.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
