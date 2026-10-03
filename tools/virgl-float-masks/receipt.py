#!/usr/bin/env python3
"""Bind exact ordered binary32 comparisons to complete hardware output words."""
import importlib.util
import json
from pathlib import Path
import re
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
HELD_HEAD = '7be4e09748bc4acfcdf167bd66cd6f3d890132d5'
LEGACY = 'virgl-webgl2-straight-line-v5'
RAW = 'virgl-webgl2-raw-bits-v1'
INTEGER = 'virgl-webgl2-raw-bits-v2'
ORDERED = 'virgl-webgl2-raw-bits-v3'
LIMITS = {'textBytes': 16384, 'tokens': 8192, 'glslBytes': 65536, 'instructions': 179,
          'registerIndex': 7, 'temporaryRegisterIndex': 117, 'constantRegisterIndex': 45}


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


base = module('integer_constants_receipt', 'tools/virgl-constants/receipt.py')
raw = module('integer_raw_receipt', 'tools/virgl-raw-bits/receipt.py')
require, sha, read, binding, git = base.require, base.sha, base.read, base.binding, base.git
verify_source, verify_records = base.verify_source, base.verify_records
program, selector, padding_after_draw = raw.program, raw.selector, raw.padding_after_draw


def translations(proof, fixtures, hardware, cases, pairs, originals):
    require(proof['guestExecution'] is False and proof['productionVirgl'] is False
            and proof['guestConstantTransportUnchanged'] is True and proof['hostUniformInjectionOnly'] is True,
            'direct host probes cannot claim guest integer transport or acceleration')
    require(proof['limits'] == LIMITS, 'unchanged compiler limits')
    require(len(proof['corpus']) == 19 and len(proof['anchors']) == len(hardware['shaders'])
            and len(proof['cases']) == len(fixtures), 'complete browser translations')
    for entry in proof['corpus']:
        expected = originals[entry['sha256']]
        require(entry['result'] == expected['result'] and entry['stage'] == expected['stage'], 'native/Wasm original exact parity')
    for entries in (proof['cases'], proof['anchors']):
        for entry in entries:
            expected = cases[entry['name']]
            require(entry['stage'] == expected['stage'] and entry['inputSha256'] == expected['inputSha256']
                    and entry['result'] == expected['result'], 'native/Wasm authored exact parity')
    for entries in (proof['pairs'], proof['rejectionPairs']):
        for entry in entries:
            expected = pairs[entry['name']]
            require(entry['vertexSha256'] == expected['vertexSha256'] and entry['fragmentSha256'] == expected['fragmentSha256']
                    and entry['result'] == expected['result'], 'native/Wasm pair exact parity')
    require(len(proof['pairs']) == len(hardware['pairs']) and len(proof['rejectionPairs']) == 4, 'complete pair parity')
    require(proof['recovery'] == {'singleConversions': len(fixtures) * 4, 'pairConversions': len(fixtures) * 2},
            'Wasm recovery after every shared case')
    require(proof['memory']['initialBytes'] == proof['memory']['finalBytes'] == 16777216
            and proof['memory']['bufferIdentityStable'] is True, 'fixed non-growing Wasm')
    stress = proof['stress']
    require(stress['iterations'] == 32 and stress['nonEndInstructionsPerStage'] == 179, 'maximal pair repetitions')
    for stage in ('vertex', 'fragment'):
        source = next(item['text'] for item in hardware['shaders'] if item['name'] == f'raw-maximal-{stage}')
        padded = source + '\n' * (16384 - len(source))
        require(stress[stage + 'Bytes'] == 16384 and stress[stage + 'Sha256'] == sha(padded.encode()),
                'maximal padded shader source identity')
    require(stress['result'] == pairs['maximal-raw-pair']['result'], 'maximal native/Wasm pair identity')
    maxima = proof['measuredOutputMaxima']
    require(0 < maxima['singleJSON'] < 147456 and 0 < maxima['pairJSON'] < 295936 and 0 < maxima['glsl'] <= 65536,
            'unchanged output bounds under maximal pair stress')
    pressure = proof['allocationPressure']
    schedule = [0, 1, 4, 8, 12, 16, 24, 32, 40, 48, 64]
    require(pressure['chunkBytes'] == 4096 and pressure['releaseSchedule'] == schedule
            and pressure['ownedAllocations'] == [{'name': 'raw IR', 'bytes': 26232}, {'name': 'raw GLSL', 'bytes': 65537}],
            'actual bounded allocator pressure definition')
    require([item['name'] for item in pressure['targets']] == ['raw-vertex', 'raw-fragment', 'recovery-raw-pair'],
            'both single stages and both-stage owned allocation pressure')
    errors = {'Raw IR allocation failed.', 'Raw GLSL allocation or output bound failed.'}
    observed_errors = set()
    for target in pressure['targets']:
        baseline = (pairs if target['kind'] == 'pair' else cases)[target['name']]['result']
        require(target['heapBefore'] == target['heapAfter'] == 16777216 and target['reservedChunks'] > 64
                and target['releasedChunks'] == target['reservedChunks']
                and target['releasedRequestedBytes'] == target['reservedRequestedBytes'] == target['reservedChunks'] * 4096,
                'every pressure allocation released without memory growth')
        require(target['capacityBefore'] == target['capacityAfter'] and target['recoveredResult'] == baseline,
                'full malloc capacity and exact conversion restored')
        attempts = target['attempts']
        require(len(attempts) > 1 and attempts[-1]['result'] == baseline, 'pressure reaches exact successful result')
        for i, attempt in enumerate(attempts):
            require(attempt['releasedChunks'] == schedule[i] and attempt['releasedRequestedBytes'] == schedule[i] * 4096
                    and attempt['heldChunks'] + attempt['releasedChunks'] == target['reservedChunks'], 'bounded release accounting')
            require(attempt['capacityBefore'] == attempt['capacityAfter'], 'no owned allocation leak at4KiB granularity')
            for capacity in (attempt['capacityBefore'], attempt['capacityAfter']):
                require(capacity['chunkBytes'] == 4096 and capacity['availableRequestedBytes'] == capacity['availableChunks'] * 4096,
                        'actual measured allocator capacity')
            if i < len(attempts) - 1:
                result = attempt['result']
                require(set(result) == {'ok', 'error'} and result['ok'] is False, 'structured allocation failure without partial shader')
                error = result['error']
                require((error['code'] == 'translation-error' and error['message'] in errors)
                        or error == {'code': 'allocation-failed', 'message': 'Wasm input allocation failed.'},
                        'actual bounded allocation failure')
                observed_errors.add(error['message'])
        require([entry['name'] for entry in target['recoveryPairs']] == hardware['recoveryPairs']
                and all(entry['result'] == pairs[entry['name']]['result'] for entry in target['recoveryPairs']),
                'both mixed backend pairs recover after every exhausted target')
    require(errors <= observed_errors and pressure['failureMessages'] == sorted(observed_errors), 'both owned failure sites exercised')


def reference(operation, a, b, c):
    """Independent sign/exponent/significand ordering, without a monotone bit key."""
    mask = 2 ** 32 - 1

    def compare(x, y, greater_equal=False):
        def fields(word):
            magnitude = word % (2 ** 31)
            return word // (2 ** 31), magnitude // (2 ** 23), magnitude % (2 ** 23)
        sx, ex, mx = fields(x)
        sy, ey, my = fields(y)
        if (ex == 255 and mx != 0) or (ey == 255 and my != 0):
            return 0
        if ex == mx == ey == my == 0:
            less = False
        elif sx != sy:
            less = sx > sy
        elif sx == 0:
            less = (ex, mx) < (ey, my)
        else:
            less = (ex, mx) > (ey, my)
        return mask if (not less if greater_equal else less) else 0

    if operation in ('fslt', 'maximal'):
        return [compare(x, y) for x, y in zip(a, b)]
    if operation in ('fsge', 'order'):
        return [compare(x, y, True) for x, y in zip(a, b)]
    if operation == 'integer-contrast':
        return [mask if x == y else 0 for x, y in zip(a, b)]
    if operation == 'mask-pipeline':
        return [z if (compare(x, y) + compare(x, y, True) + 1) % (2 ** 32) else 0
                for x, y, z in zip(a, b, c)]
    if operation == 'alias-left':
        return [compare(a[1], b[3]), compare(a[0], b[2]),
                compare(a[3], b[2], True), (a[3] + c[0]) % (2 ** 32)]
    if operation == 'alias-right':
        return [compare(a[3], b[1], True), compare(a[2], b[0], True), b[2], compare(a[2], b[2])]
    raise ValueError(f'unknown independent ordered operation: {operation}')


def uniforms(probe, vector):
    reflection = probe['uniformReflection']
    count = reflection['activeCount']
    declaration = 47 if probe['name'] == 'order' else 46
    require(reflection['declaredCount'] == declaration and 45 <= count <= declaration
            and reflection['uploadCount'] == min(count, 46) and reflection['type'] == 36296
            and reflection['hostUniformInjectionOnly'] is True, 'actual raw uniform reflection')
    if count == 47:
        padding = reflection['paddingPoison']
        require(padding['index'] == 46 and padding['words'] == padding['observed'] ==
                [0xdeadbeef, 0x7f800001, 0xff800000, 1], 'actual host-only padding poison')
    else:
        require(reflection['paddingPoison'] is None, 'no nonexistent padding claim')
    upload = vector['upload']
    words = [0] * (min(count, 46) * 4)
    words[:4], words[172:176] = vector['a'], vector['c']
    if count >= 46:
        words[180:184] = vector['b']
    require(upload['wordCount'] == len(words) and upload['words'] == words
            and upload['observedA'] == vector['a']
            and upload['observedB'] == (vector['b'] if count >= 46 else None)
            and upload['observedC'] == vector['c'], 'actual A/B/C raw uploads and readbacks')


def verify_gpu(proof, fixture, cases, pairs):
    definitions = {item['name']: item for item in fixture['probes']}
    vectors = {item['name']: item for item in fixture['vectors']}
    expected_operations = {'fslt', 'fsge', 'integer-contrast', 'mask-pipeline',
                           'alias-left', 'alias-right', 'maximal', 'order'}
    require(set(definitions) == expected_operations and len(vectors) == 12, 'complete ordered operation/vector set')
    words_checked = 0
    for stage, key in [('vertex', 'vertexProbes'), ('fragment', 'fragmentProbes')]:
        require([probe['name'] for probe in proof[key]] == list(definitions), 'each operation executes in both stages')
        for probe in proof[key]:
            definition = definitions[probe['name']]
            vertex = cases[definition['vertex'] if stage == 'vertex' else 'legacy-vertex']['result']
            fragment = cases['legacy-fragment' if stage == 'vertex' else definition['fragment']]['result']
            program(probe, vertex, fragment)
            require(probe['oracle'] == definition['oracle']
                    and [v['name'] for v in probe['vectors']] == definition['vectors']
                    and len(probe['vectors']) == 12, 'exact dynamic vector sequence')
            if stage == 'vertex':
                require(probe['feedbackReflection'] == [{'name': n, 'size': 1, 'type': 35666}
                    for n in ['gl_Position', 'vso_g0']], 'two FLOAT_VEC4 feedback values')
            for value in probe['vectors']:
                source = vectors[value['name']]
                require(all(value[k] == source[k] for k in ('a', 'b', 'c')), 'authored raw vector values')
                expected = reference(definition['oracle'], source['a'], source['b'], source['c'])
                require(value['expectedWords'] == value['observedWords'] == expected,
                        'independent complete32-bit ordered comparison result')
                uniforms(probe, value)
                reconstructed = [0] * 4
                if stage == 'vertex':
                    require(len(value['captures']) == 4, 'four real byte feedback captures')
                    for shift, capture in zip((0, 8, 16, 24), value['captures']):
                        selector(capture, shift)
                        padding_after_draw(probe, capture)
                        byte_values = [(word // 2 ** shift) % 256 for word in expected]
                        bits = [0, 0, 0, 0x3f800000] + [0x3f000000 + byte * 32768 for byte in byte_values]
                        observed_bytes = struct.pack('<8I', *bits)
                        require(capture['expectedBytes'] == capture['decodedBytes'] == byte_values
                                and capture['expectedBits'] == capture['observedBits'] == bits
                                and capture['rawBytes'] == list(observed_bytes)
                                and capture['bytesSha256'] == sha(observed_bytes), 'all normal carrier feedback bytes')
                        for lane, byte in enumerate(byte_values):
                            reconstructed[lane] += byte * 2 ** shift
                else:
                    require(len(value['draws']) == 32, 'thirty-two real fragment bitplanes')
                    observed_bytes = bytearray()
                    for bit, draw in enumerate(value['draws']):
                        selector(draw, bit)
                        padding_after_draw(probe, draw)
                        pixels = [255 * ((word // 2 ** bit) % 2) for word in expected]
                        require(draw['expectedBytes'] == draw['observedBytes'] == pixels, 'all fragment bitplane bytes')
                        observed_bytes.extend(pixels)
                        for lane, byte in enumerate(pixels):
                            reconstructed[lane] += (byte // 255) * 2 ** bit
                    require(value['bitPlaneBytesSha256'] == sha(observed_bytes), 'complete bitplane digest')
                require(reconstructed == expected, 'independent reconstruction of all32 output bits')
                words_checked += 4
    draw_names = [item['name'] for item in fixture['pairs'] if item['name'].endswith(('-smooth', '-flat'))]
    require([draw['name'] for draw in proof['pairDraws']] == draw_names and len(draw_names) == 38,
            'all full and partial v5/v1/v2/v3 mixed interfaces drawn')
    checked_pixels = 0
    for draw in proof['pairDraws']:
        result = pairs[draw['name']]['result']
        program(draw, result['vertex'], result['fragment'])
        mode = 'flat' if draw['name'].endswith('flat') else 'smooth'
        require(draw['mode'] == mode and draw['interfaceKey'] == result['interfaceKey'], 'derived hardware pair mode')
        require(draw['inactiveUniforms'] == [], 'no unauthored inactive uniform claim')
        pixels = bytes(draw['rawBytes'])
        require(len(pixels) == 4096 and sha(pixels) == draw['bytesSha256'], 'complete interpolation framebuffer')
        for y in range(32):
            for x in range(32):
                if x + y == 31:  # Exact edge fill rule is outside interpolation claim.
                    continue
                if x + y > 31:
                    expected = [0, 0, 255, 255]
                elif mode == 'flat':
                    expected = [0, 255, 0, 255]
                else:
                    expected = [((2 * v + 1) * 255 + 32) // 64 for v in (x, y)] + [0, 255]
                observed = list(pixels[(y * 32 + x) * 4:(y * 32 + x) * 4 + 4])
                require(observed == expected, f'independent {draw["name"]} framebuffer({x},{y})')
                checked_pixels += 1
    require(words_checked == proof['checkedWords'] == 768, 'complete768 hardware words')
    require(proof['status'] == 'passed' and proof['sabotage'] is None and not proof['omissions']
            and proof['objects']['live'] == 0 and proof['objects']['created'] == proof['objects']['deleted'],
            'complete hardware proof and cleanup')
    return checked_pixels

def verify_sabotage(proof, cases, fixture, mode):
    require(proof['status'] == 'failed' and proof['sabotage'] == mode and len(proof['omissions']) == 1,
            'one intentional failing ordered comparison lowering')
    operation = {'unordered-guard': 'fslt', 'signed-zero': 'fslt', 'negative-order': 'fsge'}[mode]
    definition = next(item for item in fixture['probes'] if item['name'] == operation)
    original = cases[definition['vertex']]['result']
    if mode == 'unordered-guard':
        glsl, matches = re.subn(r'if \(magnitude_a > 2139095040u \|\| magnitude_b > 2139095040u\) return 0u;',
                               'if (false) return 0u;', original['glsl'])
        require(matches == 1, 'disable exactly one NaN guard')
    elif mode == 'signed-zero':
        glsl, matches = re.subn(r'bool both_zero = magnitude_a == 0u && magnitude_b == 0u;',
                               'bool both_zero = false;', original['glsl'])
        require(matches == 1, 'disable exactly one signed-zero equivalence')
    else:
        glsl, matches = re.subn(r'\? ~(a|b) :', r'? \1 :', original['glsl'])
        require(matches == 2, 'remove exactly two negative-operand inversions')
    mutation = proof['omissions'][0]
    require(mutation['mode'] == mode and mutation['matches'] == matches
            and mutation['originalGlsl'] == original['glsl'] and mutation['servedGlsl'] == glsl
            and mutation['originalGlslSha256'] == sha(original['glsl'].encode())
            and mutation['servedGlslSha256'] == sha(glsl.encode()), 'exact source-bound ordered comparison sabotage')
    probe = proof['vertexProbes'][-1]
    require(probe['name'] == operation and 'independent vertex byte' in proof['failure']['message'],
            'compiled/linking sabotage reached intended actual output failure')
    program(probe, {'glsl': glsl}, cases['legacy-fragment']['result'])
    value = probe['vectors'][-1]
    source = next(v for v in fixture['vectors'] if v['name'] == value['name'])
    require(all(value[key] == source[key] for key in ('a', 'b', 'c')), 'sabotage actual authored inputs')
    uniforms(probe, value)
    expected = reference(operation, source['a'], source['b'], source['c'])
    capture = value['captures'][-1]
    selector(capture, capture['selector'])
    padding_after_draw(probe, capture)
    bits = [0, 0, 0, 0x3f800000] + [0x3f000000 + ((word // 2 ** capture['selector']) % 256) * 32768
                                  for word in expected]
    observed = list(struct.unpack('<8I', bytes(capture['rawBytes'])))
    require(capture['expectedBits'] == bits and capture['observedBits'] == observed and observed != bits
            and capture['bytesSha256'] == sha(bytes(capture['rawBytes'])),
            'actual sabotage contradicts independently reconstructed raw hardware output')
    require(proof['objects']['live'] == 0 and proof['objects']['created'] == proof['objects']['deleted'],
            'sabotage releases every GL object')


def verify_finite(proof, fixture, cases):
    vectors = {entry['name']: entry for entry in fixture['vectors']}
    require(set(proof['finiteSelections']) == {'vertex', 'fragment'}, 'both direct finite selection stages')
    for stage in ('vertex', 'fragment'):
        probe = proof['finiteSelections'][stage]
        vertex = 'finite-vertex' if stage == 'vertex' else 'legacy-vertex'
        fragment = 'finite-fragment' if stage == 'fragment' else 'legacy-fragment'
        require(probe['stage'] == stage and probe['vertex'] == vertex and probe['fragment'] == fragment
                and probe['oracle'] == ('fslt' if stage == 'vertex' else 'fsge'),
                'exact finite selection program identity')
        program(probe, cases[vertex]['result'], cases[fragment]['result'])
        uniform = probe['uniformReflection']
        require(uniform['declaredCount'] == uniform['activeCount'] == 46 and uniform['type'] == 36296
                and uniform['index'] != 0xffffffff, 'actual finite comparison uniform reflection')
        entries = probe['captures' if stage == 'vertex' else 'draws']
        require([entry['name'] for entry in entries] == list(vectors), 'all twelve finite input vectors')
        if stage == 'vertex':
            require(probe['feedbackReflection'] == [{'name': n, 'size': 1, 'type': 35666}
                for n in ['gl_Position', 'vso_g0']], 'direct finite FLOAT_VEC4 feedback values')
        for entry in entries:
            source = vectors[entry['name']]
            masks = reference(probe['oracle'], source['a'], source['b'], source['c'])
            words = [0] * 184
            words[:4], words[180:184] = source['a'], source['b']
            require(entry['operands'] == {'a': source['a'], 'b': source['b']}
                    and entry['expectedMaskWords'] == masks
                    and entry['upload'] == {'words': words, 'observedA': source['a'], 'observedB': source['b']},
                    'direct finite selection actual comparison operands and masks')
            if stage == 'vertex':
                bits = [0, 0, 0, 0x3f800000] + [0 if word == 0 else 0x3f800000 for word in masks]
                data = struct.pack('<8I', *bits)
                require(entry['expectedBits'] == entry['observedBits'] == bits and entry['rawBytes'] == list(data),
                        'independent direct finite VS selection')
            else:
                expected = [0 if word == 0 else 255 for word in masks]
                data = bytes(expected)
                require(entry['expectedBytes'] == entry['observedBytes'] == expected, 'independent direct finite FS selection')
            require(entry['bytesSha256'] == sha(data), 'complete finite selection readback digest')
    orientation = proof['orientation']
    require(orientation['vertex'] == 'raw-fslt-vertex' and orientation['fragment'] == 'legacy-fragment'
            and orientation['attribute']['values'] == [[.25, .5, -.25, 1]], 'nonzero-y ordered comparison vertex input')
    program(orientation, cases['raw-fslt-vertex']['result'], cases['legacy-fragment']['result'])
    source = vectors['positive-normal']
    require(orientation['vector'] == source and orientation['selectorUpload'] ==
            {'index': 44, 'words': [0] * 4, 'observed': [0] * 4}, 'actual orientation input and zero byte selector')
    uniforms(dict(orientation, name='orientation'), dict(source, upload=orientation['upload']))
    require(len(orientation['captures']) == 2, 'both coordinate-system signs executed')
    for adjust, capture in zip((-1, 1), orientation['captures']):
        uniform = 0xbf800000 if adjust == -1 else 0x3f800000
        require(capture['adjust'] == adjust and capture['uniformUpdate'] == {
            'offset': 640, 'expectedBits': [uniform], 'observedBits': [uniform]}, 'actual system UBO update/readback')
        bits = [0x3e800000, 0xbf000000 if adjust == -1 else 0x3f000000, 0xbe800000, 0x3f800000]
        bits += [0x3f000000 + (word % 256) * 32768 for word in reference('fslt', source['a'], source['b'], source['c'])]
        data = struct.pack('<8I', *bits)
        require(capture['expectedBits'] == capture['observedBits'] == bits and capture['rawBytes'] == list(data)
                and capture['bytesSha256'] == sha(data), 'independent complete orientation feedback')


def main():
    require(len(sys.argv) == 2, 'usage: receipt.py EVIDENCE_DIRECTORY')
    output = Path(sys.argv[1]).resolve()
    head = git('rev-parse', 'HEAD').decode().strip()
    contract = read(ROOT / 'docs/gpu-3d-contract.json')
    held_contract = json.loads(git('show', f'{HELD_HEAD}:docs/gpu-3d-contract.json'))
    require(contract['production'] == held_contract['production'] and contract['shaderProfile'] == LEGACY
            and contract['rawShaderProfile'] == RAW and contract['integerShaderProfile'] == INTEGER
            and contract['orderedShaderProfile'] == ORDERED,
            'production and prior profiles unchanged; explicit ordered subprofile')
    native_receipt = module('integer_native_receipt', 'tools/virgl-float-masks/native_receipt.py')
    native, fixtures, hardware, cases, pairs, originals = native_receipt.verify_native(output, head)
    browser = base.verify_browser(output / 'hardware', head, contract, task='E6-T12e4c1')
    modes = ['unordered-guard', 'signed-zero', 'negative-order']
    controls = [base.verify_browser(output / ('sabotage-' + mode), head, contract,
                                    passed=False, task='E6-T12e4c1') for mode in modes]
    for report in [browser, *controls]:
        translations(report['acceptance'], fixtures, hardware, cases, pairs, originals)
        require(report['acceptance']['operationDefinitions'] == hardware['operationDefinitions'],
                'recorded authored operation definitions')
        verify_finite(report['acceptance'], hardware, cases)
    pixels = verify_gpu(browser['acceptance'], hardware, cases, pairs)
    for mode, report in zip(modes, controls):
        verify_sabotage(report['acceptance'], cases, hardware, mode)
    regressions = module('integer_regressions', 'tools/virgl-float-masks/regressions.py').verify(output, head, contract)
    names = {item['path'] for report in [browser, *controls] for item in report['sources']}
    names.update(item['path'] for item in native['sources'] + native['fixtures'])
    names.update(item['path'] for item in regressions['sources'])
    names.update(str(p.relative_to(ROOT)) for p in (ROOT / 'tools/virgl-float-masks').glob('*.py'))
    names.update(('tools/verify-virgl-float-masks.sh', 'docs/gpu-3d-contract.json', 'docs/gpu-3d-decision.md', 'Makefile',
                  'tools/virgl-raw-bits/receipt.py', 'tools/virgl-constants/receipt.py'))
    sources = []
    for name in sorted(names):
        if '/build/' not in name:
            entry = binding(ROOT / name)
            verify_source(entry, head)
            sources.append(entry)
    records = [binding(path, output) for path in sorted(output.rglob('*'))
               if path.is_file() and path != output / 'receipt.json' and path.name != 'acceptance.log']
    receipt = {'schema': 1, 'task': 'E6-T12e4c1', 'status': 'passed', 'gitHead': head,
               'boundary': 'Exact ordered binary32 comparisons over private raw words; float ABI and finite guest transport unchanged.',
               'heldIntegerHead': HELD_HEAD, 'production': contract['production'],
               'profiles': [LEGACY, RAW, INTEGER, ORDERED], 'sources': sources, 'records': records,
               'shaderOutcomes': {'translated': 12, 'unsupported-feature': 7},
               'orderedWords': 768, 'finiteSelections': 24, 'interpolationPixels': pixels,
               'regressions': {k: v for k, v in regressions.items() if k != 'sources'},
               'compilerSha256': {'nativeSanitizer': native['binarySha256'],
                   'wasm': sha((ROOT / 'renderer/virgl-shader/build/wasm/virgl-shader.wasm').read_bytes())}}
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'E6-T12e4c1 passed:768 reconstructed ordered comparison words,24 finite selections,{pixels} interpolation pixels and exact prior results.')


if __name__ == '__main__':
    main()
