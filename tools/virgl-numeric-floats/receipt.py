#!/usr/bin/env python3
"""Bind ordinary numeric values and captured words to independent GPU oracles."""
import importlib.util
import json
from pathlib import Path
import re
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
HELD_HEAD = '59f1b924286af70096d9fb19fbdb35b9ec2ed7a1'
PROFILES = ['virgl-webgl2-straight-line-v5', 'virgl-webgl2-raw-bits-v1',
            'virgl-webgl2-raw-bits-v2', 'virgl-webgl2-raw-bits-v3', 'virgl-webgl2-raw-bits-v4']


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


base = module('numeric_constants_receipt', 'tools/virgl-constants/receipt.py')
ordered = module('numeric_ordered_receipt', 'tools/virgl-float-masks/receipt.py')
raw = module('numeric_raw_receipt', 'tools/virgl-raw-bits/receipt.py')
oracle = module('numeric_rational_oracle', 'tools/virgl-numeric-floats/oracle.py')
require, sha, read, binding, git = base.require, base.sha, base.read, base.binding, base.git
program, selector = raw.program, raw.selector
translations = ordered.translations


def rational_record(values):
    scaled = [value * (2 ** 24) for value in values]
    require(all(value.denominator == 1 for value in scaled), 'authored exact fixed-scale values')
    return {'scale': 2 ** 24, 'scaled': [str(int(value)) for value in scaled],
            'values': [float(value) for value in values], 'words': [oracle.word(value) for value in values],
            'doubledWords': [oracle.word(value * 2) for value in values]}


def attributes(entries, vector, vertex):
    positions = [[.25, .5, -.25, 1]] if vertex else [[-1, -1, 0, 1], [3, -1, 0, 1], [-1, 3, 0, 1]]
    expected = [positions] + [[vector[field]] * len(positions) for field in ('a', 'b', 'c')]
    require(len(entries) == 4, 'complete recorded attribute bindings')
    for index, (entry, values) in enumerate(zip(entries, expected)):
        require(entry['name'] == f'in_{index}' and entry['values'] == values
                and entry['active'] == (entry['location'] >= 0), 'actual authored attribute identity')
        if entry['active']:
            require(entry['uploadedWords'] == [oracle.word(value) for row in values for value in row],
                    'independently encoded actual attribute bytes')
        else:
            require('uploadedWords' not in entry, 'inactive attribute has no fabricated upload')
    require(entries[0]['active'] is True, 'position attribute actually bound')


def uniforms(probe, entry, vector, expected):
    reflection = probe['uniformReflection']
    count = reflection['activeCount']
    prefix = 'vs' if probe['vertex'].startswith('numeric-') else 'fs'
    require(reflection['name'] == prefix + 'const0[0]' and reflection['declaredCount'] == 46
            and 0 < count <= 46 and reflection['type'] == 36296 and reflection['index'] != 0xffffffff,
            'actual numeric raw uniform reflection')
    inputs = {0: vector['condition'], 1: vector.get('directCondition', [1] * 4),
              42: expected['doubledWords'], 43: expected['words'], 44: [0] * 4, 45: vector['raw']}
    words, slots = [0] * (count * 4), []
    for index, values in inputs.items():
        if index < count:
            words[index * 4:index * 4 + 4] = values
            slots.append({'index': index, 'words': values, 'observed': values})
    require(entry['upload'] == {'wordCount': len(words), 'words': words, 'slots': slots},
            'actual independently bound uniform uploads and readbacks')


def vertex_captures(entry, expected, allow_failure=False):
    require(len(entry['captures']) == (len(entry['captures']) if allow_failure else 4)
            and 1 <= len(entry['captures']) <= 4, 'complete bounded vertex byte sequence')
    reconstructed = [0] * 4
    mismatches = 0
    for shift, capture in zip((0, 8, 16, 24), entry['captures']):
        selector(capture, shift)
        byte_values = [(word // 2 ** shift) % 256 for word in expected]
        bits = [0x3e800000, 0x3f000000, 0xbe800000, 0x3f800000] + expected
        bits += [0x3f000000 + value * 32768 for value in byte_values]
        data = bytes(capture['rawBytes'])
        require(len(data) == 64 and data[48:] == bytes([0xa5] * 16)
                and capture['guard'] == [0xa5] * 16 and capture['bytesSha256'] == sha(data),
                'complete actual feedback bytes and untouched range guard')
        actual = list(struct.unpack('<12I', data[:48]))
        require(capture['expectedBytes'] == byte_values and capture['expectedBits'] == bits
                and capture['observedBits'] == actual, 'independent numeric and raw capture expectations')
        if actual != bits:
            require(allow_failure and capture is entry['captures'][-1]
                    and capture['failure'] == {'expectedBits': bits, 'observedBits': actual},
                    'only final deliberate capture may contradict oracle')
            mismatches += 1
        else:
            require(capture['decodedBytes'] == byte_values, 'decoded actual finite carriers')
            for lane, value in enumerate(byte_values):
                reconstructed[lane] += value * (2 ** shift)
    if not allow_failure:
        require(reconstructed == entry['observedWords'] == expected, 'every captured numeric word reconstructed')
    return mismatches


def fragment_draws(entry, expected, cross=False):
    require(len(entry['draws']) == (1 if cross else 32), 'complete numeric fragment observations')
    reconstructed, pixels = [0] * 4, bytearray()
    for bit, draw in enumerate(entry['draws']):
        if cross:
            require(draw['selector'] is None and draw['selectorUpload'] is None, 'cross consumer uses no raw bit selector')
            expected_bytes = [255] * 4
        else:
            selector(draw, bit)
            expected_bytes = [255 * ((word // 2 ** bit) % 2) for word in expected]
        require(draw['expectedBytes'] == draw['observedBytes'] == expected_bytes,
                'actual raw bitplane or joint float/raw consumer output')
        pixels.extend(expected_bytes)
        if not cross:
            for lane, value in enumerate(expected_bytes):
                reconstructed[lane] += (value // 255) * (2 ** bit)
    if not cross:
        require(reconstructed == entry['observedWords'] == expected
                and entry['bitPlaneBytesSha256'] == sha(pixels), 'independent complete fragment word reconstruction')


def verify_numeric(proof, fixture, cases):
    definitions = {entry['name']: entry for entry in fixture['numericPrograms']}
    vectors = {entry['name']: entry for entry in fixture['numericVectors']}
    require(set(definitions) == {'chain', 'mov-snapshot', 'mov-alias', 'ucmp-before',
            'ucmp-alias-true', 'ucmp-alias-false', 'safe-raw', 'invalidation', 'maximal'}
            and len(vectors) == 4, 'complete bounded numeric operation/vector matrix')
    words_checked, cross_draws = 0, 0
    for key, stage, cross in [('vertexProbes', 'vertex', False), ('fragmentProbes', 'fragment', False),
                              ('crossConsumerProbes', 'fragment', True)]:
        probes = [entry for entry in proof[key] if entry['name'] in definitions]
        names = [name for name, definition in definitions.items() if not cross or 'cross' in definition]
        require([probe['name'] for probe in probes] == names, 'complete actual numeric program sequence')
        for probe in probes:
            definition = definitions[probe['name']]
            vertex = definition['vertex'] if stage == 'vertex' else 'legacy-vertex'
            fragment = 'legacy-fragment' if stage == 'vertex' else definition['cross' if cross else 'fragment']
            require(probe['vertex'] == vertex and probe['fragment'] == fragment
                    and probe['oracle'] == definition['oracle'], 'exact numeric program identity')
            program(probe, cases[vertex]['result'], cases[fragment]['result'])
            require([entry['name'] for entry in probe['vectors']] == definition['vectors'], 'all authored dynamic vectors')
            if stage == 'vertex':
                require(probe['varyings'] == ['gl_Position', 'vso_g5', 'vso_g6']
                        and probe['feedbackReflection'] == [{'name': name, 'size': 1, 'type': 35666}
                            for name in probe['varyings']], 'actual simultaneous float and carrier feedback ABI')
            for entry in probe['vectors']:
                source = vectors[entry['name']]
                require(all(entry[key] == value for key, value in source.items()), 'exact numeric fixture operands')
                expected = rational_record(oracle.numeric(definition['oracle'], source))
                require(entry['oracle'] == expected, 'independent rational arithmetic and exact binary32 words')
                attributes(entry['attributes'], source, stage == 'vertex')
                uniforms(probe, entry, source, expected)
                if stage == 'vertex':
                    vertex_captures(entry, expected['words'])
                else:
                    fragment_draws(entry, expected['words'], cross)
                if cross:
                    cross_draws += 1
                else:
                    words_checked += 4
    require(words_checked == 288 and cross_draws == 32, 'complete numeric words and joint-consumer draws')
    return words_checked, cross_draws


def verify_pairs(proof, fixture, pairs):
    names = [entry['name'] for entry in fixture['pairs'] if entry['name'].endswith(('-smooth', '-flat'))]
    require([draw['name'] for draw in proof['pairDraws']] == names and len(names) == 26,
            'all full mixed profiles and representative partial interfaces drawn')
    count = 0
    for draw in proof['pairDraws']:
        result = pairs[draw['name']]['result']
        program(draw, result['vertex'], result['fragment'])
        mode = 'flat' if draw['name'].endswith('flat') else 'smooth'
        require(draw['mode'] == mode and draw['interfaceKey'] == result['interfaceKey']
                and draw['inactiveUniforms'] == [], 'derived numeric pair interface')
        pixels = bytes(draw['rawBytes'])
        require(len(pixels) == 4096 and sha(pixels) == draw['bytesSha256'], 'complete interpolation framebuffer')
        for y in range(32):
            for x in range(32):
                if x + y == 31:
                    continue
                expected = ([0, 0, 255, 255] if x + y > 31 else [0, 255, 0, 255] if mode == 'flat'
                            else [((2 * v + 1) * 255 + 32) // 64 for v in (x, y)] + [0, 255])
                require(list(pixels[(y * 32 + x) * 4:(y * 32 + x + 1) * 4]) == expected,
                        f'independent {draw["name"]} framebuffer({x},{y})')
                count += 1
    return count


def texture_vector(definition, fixture, phase, texel_index):
    condition = [0, 1, 2, 0x80000000] if phase == 0 else [0xffffffff, 0, 0x80000000, 2]
    direct = [1, 0, 2, 0] if phase == 0 else [0, 0x80000000, 0, 0xffffffff]
    coordinate = [(texel_index % 2 + .5) / 2, (texel_index // 2 + .5) / 2, 0, 1]
    bindings = [{'index': index, 'texture': fixture['textures'][(0 if index == 7 else 1) ^ phase]}
                for index in definition['samplers']]
    primary = oracle.texel(fixture['textures'][phase], coordinate)
    alternate = oracle.texel(fixture['textures'][1 - phase], coordinate)
    values = oracle.texture_values(definition['oracle'], primary, alternate, condition)
    selected = [(value - oracle.Fraction(1, 4)) * 2 for value in values]
    return {'name': f'phase{phase}-texel{texel_index}', 'phase': phase, 'texel': texel_index,
            'a': coordinate, 'b': [.25, .5, .75, 1], 'c': [1, .75, .5, .25],
            'condition': condition, 'directCondition': direct, 'raw': [0] * 4,
            'sampleBindings': bindings, 'sampledBytes': [int(value * 255) for value in selected],
            'oracle': rational_record(values)}


def samplers(entries, source, result):
    definitions = [{'index': item['index'], 'name': f'fssamp{item["index"]}', 'type': 'sampler2D'}
                   for item in source['sampleBindings']]
    require(result['metadata']['samplers'] == definitions and len(entries) == len(definitions),
            'truthful owned used-sampler metadata')
    for entry, definition, bound in zip(entries, definitions, source['sampleBindings']):
        require(all(entry[key] == value for key, value in definition.items() if key != 'type'),
                'actual sampled identifier and slot')
        unit = 3 if bound['index'] == 7 else 5
        require(entry['unit'] == entry['observedUnit'] == unit and entry['uniformIndex'] != 0xffffffff
                and entry['type'] == 'sampler2D' and entry['reflectedType'] == 35678 and entry['size'] == 1
                and entry['parameters'] == {'min': 9728, 'mag': 9728, 's': 33071, 't': 33071}
                and entry['texture'] == bound['texture'] and entry['uploadedBytes'] == bound['texture']['bytes'],
                'actual hardware sampler reflection, units, parameters and complete texture readback')


def direct_attributes(entries):
    expected = [[[-1, -1, 0, 1], [3, -1, 0, 1], [-1, 3, 0, 1]],
                [[0, 0, 0, 1], [2, 0, 0, 1], [0, 2, 0, 1]]]
    require(len(entries) == 2, 'both direct textured triangle attributes')
    for index, (entry, values) in enumerate(zip(entries, expected)):
        require(entry['name'] == f'in_{index}' and entry['values'] == values
                and entry['active'] is True and entry['location'] >= 0
                and entry['uploadedWords'] == [oracle.word(value) for row in values for value in row],
                'actual full-screen position and interpolated texture coordinates')


def verify_textures(proof, fixture, cases):
    definitions = {entry['name']: entry for entry in fixture['texturePrograms']}
    require(set(definitions) == {'tex-chain', 'tex-select'} and len(fixture['textures']) == 2,
            'single and selected texture chains')
    words_checked, cross_draws = 0, 0
    for key, cross in [('fragmentProbes', False), ('crossConsumerProbes', True)]:
        probes = [probe for probe in proof[key] if probe['name'] in definitions]
        require([probe['name'] for probe in probes] == list(definitions), 'both actual texture programs')
        for probe in probes:
            definition = definitions[probe['name']]
            fragment = definition['cross' if cross else 'fragment']
            require(probe['vertex'] == 'legacy-vertex' and probe['fragment'] == fragment
                    and probe['oracle'] == definition['oracle'], 'exact sampled program identity')
            program(probe, cases['legacy-vertex']['result'], cases[fragment]['result'])
            require(len(probe['vectors']) == 8, 'both binding phases and every authored texel')
            for index, entry in enumerate(probe['vectors']):
                source = texture_vector(definition, fixture, index // 4, index % 4)
                require(all(entry[key] == value for key, value in source.items()), 'independent texture selection and arithmetic')
                attributes(entry['attributes'], source, False)
                uniforms(probe, entry, source, source['oracle'])
                samplers(entry['samplers'], source, cases[fragment]['result'])
                fragment_draws(entry, source['oracle']['words'], cross)
                if cross:
                    cross_draws += 1
                else:
                    words_checked += 4
    require([(draw['name'], draw['phase']) for draw in proof['textureDraws']] ==
            [(name, phase) for name in definitions for phase in (0, 1)], 'every direct texture phase')
    pixels_checked = 0
    for draw in proof['textureDraws']:
        definition = definitions[draw['name']]
        phase = draw['phase']
        source = texture_vector(definition, fixture, phase, 0)
        require(draw['vertex'] == 'legacy-vertex' and draw['fragment'] == definition['direct']
                and draw['width'] == draw['height'] == 32 and draw['condition'] == source['condition']
                and draw['directCondition'] == source['directCondition'], 'exact full-frame texture program/input')
        program(draw, cases['legacy-vertex']['result'], cases[definition['direct']]['result'])
        direct_attributes(draw['attributes'])
        uniforms(draw, draw, source, source['oracle'])
        samplers(draw['samplers'], source, cases[definition['direct']]['result'])
        pixels = bytes(draw['rawBytes'])
        require(len(pixels) == 4096 and sha(pixels) == draw['bytesSha256']
                and draw['checkedPixels'] == 1024, 'complete actual texture framebuffer')
        for y in range(32):
            for x in range(32):
                sample = texture_vector(definition, fixture, phase, (x // 16) + 2 * (y // 16))
                expected = [value if condition != 0 else 255 - value
                            for condition, value in zip(sample['directCondition'], sample['sampledBytes'])]
                require(list(pixels[(y * 32 + x) * 4:(y * 32 + x + 1) * 4]) == expected,
                        'independent full texture arithmetic and shadow selection output')
                pixels_checked += 1
    require(words_checked == 64 and cross_draws == 16 and pixels_checked == 4096,
            'complete texture words, joint-consumer draws and pixels')
    return words_checked, cross_draws, pixels_checked


def verify_source_contracts(proof, fixture, cases):
    shaders = [shader for shader in fixture['shaders'] if shader['profile'] == PROFILES[-1]]
    require([entry['name'] for entry in proof['sourceContracts']] == [shader['name'] for shader in shaders],
            'all mixed shader logical sampling contracts')
    for record, shader in zip(proof['sourceContracts'], shaders):
        glsl = cases[shader['name']]['result']['glsl']
        expected = sum(bool(re.match(r'^\s*(?:\d+:\s*)?TEX\b', line)) for line in shader['text'].splitlines())
        require(record['inputSha256'] == sha(shader['text'].encode()) and record['glslSha256'] == sha(glsl.encode())
                and record['textureInstructions'] == record['textureCalls'] == expected
                and len(re.findall(r'\btexture\s*\(', glsl)) == expected
                and record['meaning'] == 'Counts logical emitted texture calls, not driver physical fetches.',
                'one source-bound logical sample per authored TEX, no physical-fetch assertion')


def main():
    require(len(sys.argv) == 2, 'usage: receipt.py EVIDENCE_DIRECTORY')
    output = Path(sys.argv[1]).resolve()
    head = git('rev-parse', 'HEAD').decode().strip()
    contract = read(ROOT / 'docs/gpu-3d-contract.json')
    held = json.loads(git('show', f'{HELD_HEAD}:docs/gpu-3d-contract.json'))
    require(contract['production'] == held['production'] and
            [contract[key] for key in ('shaderProfile', 'rawShaderProfile', 'integerShaderProfile',
                'orderedShaderProfile', 'numericShaderProfile')] == PROFILES,
            'production and previous profiles unchanged; explicit ordinary numeric subprofile')
    native_gate = module('numeric_native_receipt', 'tools/virgl-numeric-floats/native_receipt.py')
    native, fixtures, hardware, cases, pairs, originals = native_gate.verify_native(output, head)
    browser = base.verify_browser(output / 'hardware', head, contract, task='E6-T12e4c2')
    modes = ['stale-shadow', 'numeric-decode', 'sampler-index']
    controls = [base.verify_browser(output / ('sabotage-' + mode), head, contract,
                                    passed=False, task='E6-T12e4c2') for mode in modes]
    extra = module('numeric_browser_receipt', 'tools/virgl-numeric-floats/browser_receipt.py')
    for report in [browser, *controls]:
        translations(report['acceptance'], fixtures, hardware, cases, pairs, originals)
        proof = report['acceptance']
        require(proof['operationDefinitions'] == hardware['operationDefinitions'],
                'recorded authored operation definitions')
        require([entry['name'] for entry in proof['cases']] == [entry['name'] for entry in fixtures]
                and [entry['name'] for entry in proof['anchors']] == [entry['name'] for entry in hardware['shaders']]
                and [entry['name'] for entry in proof['pairs']] == [entry['name'] for entry in hardware['pairs']]
                and [entry['sha256'] for entry in proof['corpus']] == list(originals)
                and [entry['name'] for entry in proof['rejectionPairs']] == [
                    f'rejected-{stage}-{code}-pair' for stage in ('vertex', 'fragment')
                    for code in ('parse-error', 'unsupported-feature')],
                'complete ordered workload without duplicate or substituted cases')
        require(proof['caseFixture'] == binding(ROOT / 'renderer/virgl-shader/tests/numeric-float-cases.json')
                and proof['hardwareFixture'] == binding(ROOT / 'renderer/virgl-shader/tests/numeric-float-hardware.json'),
                'both actual fixture source bindings')
        first = hardware['numericVectors'][0]
        require(proof['literalWitnesses'] == {'input': first, 'expected': {
            definition['name']: oracle.numeric_words(definition['oracle'], first)
            for definition in hardware['numericPrograms']}}, 'independent first-vector literal witnesses')
        extra.verify_orientation(proof, cases, helpers=globals())
    proof = browser['acceptance']
    verify_source_contracts(proof, hardware, cases)
    numeric_words, numeric_cross = verify_numeric(proof, hardware, cases)
    texture_words, texture_cross, texture_pixels = verify_textures(proof, hardware, cases)
    pair_pixels = verify_pairs(proof, hardware, pairs)
    require(proof['checkedWords'] == numeric_words + texture_words == 352
            and proof['checkedTexturePixels'] == texture_pixels == 4096
            and numeric_cross + texture_cross == 48 and pair_pixels == 25792,
            'derived complete numeric and texture proof counts')
    require(proof['status'] == 'passed' and proof['sabotage'] is None and proof['omissions'] == []
            and proof['objects']['live'] == 0 and proof['objects']['created'] == proof['objects']['deleted'],
            'complete hardware proof releases all GL objects')
    for mode in modes:
        extra.verify_sabotage(output / ('sabotage-' + mode), mode, browser, cases, hardware, helpers=globals())
    regressions = module('numeric_regressions', 'tools/virgl-numeric-floats/regressions.py').verify(output, head, contract)
    names = {item['path'] for report in [browser, *controls] for item in report['sources']}
    names.update(item['path'] for item in native['sources'] + native['fixtures'])
    names.update(item['path'] for item in regressions['sources'])
    names.update(str(p.relative_to(ROOT)) for p in (ROOT / 'tools/virgl-numeric-floats').glob('*.py'))
    names.update(('tools/verify-virgl-numeric-floats.sh', 'docs/gpu-3d-contract.json',
                  'docs/gpu-3d-decision.md', 'Makefile', 'tools/virgl-raw-bits/receipt.py',
                  'tools/virgl-float-masks/receipt.py', 'tools/virgl-constants/receipt.py'))
    sources = []
    for name in sorted(names):
        if '/build/' not in name:
            entry = binding(ROOT / name)
            base.verify_source(entry, head)
            sources.append(entry)
    records = [binding(path, output) for path in sorted(output.rglob('*'))
               if path.is_file() and path != output / 'receipt.json' and path.name != 'acceptance.log']
    receipt = {'schema': 1, 'task': 'E6-T12e4c2', 'status': 'passed', 'gitHead': head,
               'boundary': 'Bounded ordinary float shadows and captured raw words in owned numeric shader chains; unchanged guest constant transport and production negotiation.',
               'heldOrderedHead': HELD_HEAD, 'production': contract['production'],
               'profiles': PROFILES, 'sources': sources, 'records': records,
               'shaderOutcomes': {'translated': 12, 'unsupported-feature': 7},
               'numericWords': numeric_words, 'textureWords': texture_words,
               'crossConsumerDraws': numeric_cross + texture_cross, 'texturePixels': texture_pixels,
               'interpolationPixels': pair_pixels, 'orientationCaptures': 2,
               'regressions': {key: value for key, value in regressions.items() if key != 'sources'},
               'compilerSha256': {'nativeSanitizer': native['binarySha256'],
                   'wasm': sha((ROOT / 'renderer/virgl-shader/build/wasm/virgl-shader.wasm').read_bytes())}}
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'E6-T12e4c2 passed:352 reconstructed numeric/texture words,48 joint-consumer draws,{texture_pixels} texture pixels,{pair_pixels} interpolation pixels and exact prior results.')


if __name__ == '__main__':
    main()
