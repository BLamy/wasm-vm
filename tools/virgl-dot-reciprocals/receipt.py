#!/usr/bin/env python3
"""Bind ordinary numeric values and captured words to independent GPU oracles."""
from fractions import Fraction
import importlib.util
import json
from pathlib import Path
import re
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
HELD_HEAD = '3adaa72f95fd88b8fefd5caa32d6407df22af1dd'
PROFILES = ['virgl-webgl2-straight-line-v5', 'virgl-webgl2-raw-bits-v1',
            'virgl-webgl2-raw-bits-v2', 'virgl-webgl2-raw-bits-v3', 'virgl-webgl2-raw-bits-v4', 'virgl-webgl2-raw-bits-v5', 'virgl-webgl2-raw-bits-v6']


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


base = module('numeric_constants_receipt', 'tools/virgl-constants/receipt.py')
ordered = module('numeric_ordered_receipt', 'tools/virgl-float-masks/receipt.py')
raw = module('numeric_raw_receipt', 'tools/virgl-raw-bits/receipt.py')
oracle = module('numeric_rational_oracle', 'tools/virgl-dot-reciprocals/oracle.py')
require, sha, read, binding, git = base.require, base.sha, base.read, base.binding, base.git
program, selector = raw.program, raw.selector
translations = ordered.translations


def rational_record(values):
    scaled = [value * (2 ** 24) for value in values]
    require(all(value.denominator == 1 for value in scaled), 'authored exact fixed-scale values')
    return {'scale': 2 ** 24, 'scaled': [str(int(value)) for value in scaled],
            'values': [float(value) for value in values], 'words': [oracle.word(value) for value in values],
            'doubledWords': [oracle.word(value * 2) for value in values], 'zeroSignFreedom': True}


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
    prefix = 'vs' if probe['vertex'].startswith('scalar-') else 'fs'
    require(reflection['name'] == prefix + 'const0[0]' and reflection['declaredCount'] == 46
            and 0 < count <= 46 and reflection['type'] == 36296 and reflection['index'] != 0xffffffff,
            'actual numeric raw uniform reflection')
    inputs = {0: vector['condition'], 1: vector.get('directCondition', [1] * 4),
              44: [0] * 4, 45: vector['raw']}
    if 'boundWords' in expected:
        bounds = expected['boundWords']
        inputs.update({40: bounds['doubledUpper'], 41: bounds['doubledLower'], 42: bounds['upper'], 43: bounds['lower']})
    else:
        inputs.update({42: expected['doubledWords'], 43: expected['words']})
    words, slots = [0] * (count * 4), []
    for index, values in sorted(inputs.items()):
        if index < count:
            words[index * 4:index * 4 + 4] = values
            slots.append({'index': index, 'words': values, 'observed': values})
    require(entry['upload'] == {'wordCount': len(words), 'words': words, 'slots': slots},
            'actual independently bound uniform uploads and readbacks')


def equivalent_word(actual, expected):
    return actual == expected or expected == 0 and actual == 0x80000000


def vertex_captures(entry, expected, allow_failure=False):
    require(1 <= len(entry['captures']) <= 4 and (allow_failure or len(entry['captures']) == 4),
            'complete bounded vertex byte sequence')
    reconstructed, mismatches = [0] * 4, 0
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
        okay = actual[:4] == bits[:4] and all(equivalent_word(value, reference)
                    for value, reference in zip(actual[4:8], expected))
        okay = okay and all(value == reference or expected[lane] == 0 and shift == 24 and value == 0x3f400000
                    for lane, (value, reference) in enumerate(zip(actual[8:], bits[8:])))
        if not okay:
            require(allow_failure and capture is entry['captures'][-1]
                    and capture['failure'] == {'expectedBits': bits, 'observedBits': actual},
                    'only final deliberate capture may contradict ordinary-value oracle')
            mismatches += 1
        else:
            decoded = []
            for value in actual[8:]:
                require(0x3f000000 <= value <= 0x3f7f8000 and (value - 0x3f000000) % 32768 == 0,
                        'independent finite byte-carrier grid')
                decoded.append((value - 0x3f000000) // 32768)
            require(capture['decodedBytes'] == decoded, 'decoded actual finite carriers')
            for lane, value in enumerate(decoded):
                reconstructed[lane] += value * (2 ** shift)
    if not allow_failure:
        require(reconstructed == entry['observedWords'] and all(equivalent_word(value, reference)
                    for value, reference in zip(reconstructed, expected)), 'every captured word reconstructed with ordinary zero-sign freedom')
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
        require(len(draw['observedBytes']) == 4 and draw['expectedBytes'] == expected_bytes and all(value == reference or
                not cross and expected[lane] == 0 and bit == 31 and value == 255
                for lane, (value, reference) in enumerate(zip(draw['observedBytes'], expected_bytes))),
                'actual raw bitplane or joint float/raw consumer output')
        pixels.extend(draw['observedBytes'])
        if not cross:
            for lane, value in enumerate(draw['observedBytes']):
                reconstructed[lane] += (value // 255) * (2 ** bit)
    if not cross:
        require(reconstructed == entry['observedWords'] and all(equivalent_word(value, reference)
                    for value, reference in zip(reconstructed, expected))
                and entry['bitPlaneBytesSha256'] == sha(pixels), 'independent complete fragment reconstruction with permitted zero signs')


def verify_numeric(proof, fixture, cases):
    definitions = {entry['name']: entry for entry in fixture['numericPrograms']}
    vectors = {entry['name']: entry for entry in fixture['numericVectors']}
    require(set(definitions) == {'dp3', 'dp3-swizzle', 'dp3-safe', 'dp3-shadow', 'dp3-partial-x', 'dp3-partial-y',
            'dp3-partial-z', 'dp3-partial-w', 'dp3-partial-xyz', 'dp3-alias-xy', 'maximal'} and len(vectors) == 3, 'complete bounded numeric operation/vector matrix')
    words_checked, cross_draws = 0, 0
    for key, stage, cross in [('vertexProbes', 'vertex', False), ('fragmentProbes', 'fragment', False),
                              ('crossConsumerProbes', 'fragment', True)]:
        probes = [entry for entry in proof[key] if entry['name'] in definitions]
        names = [name for name, definition in definitions.items() if not cross or 'cross' in definition]
        require([probe['name'] for probe in probes] == names, 'complete actual numeric program sequence')
        for probe in probes:
            definition = definitions[probe['name']]
            module('scalar_broadcast_receipt', 'tools/virgl-dot-reciprocals/browser_receipt.py').verify_broadcast(probe, definition, helpers=globals())
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
    require(words_checked == 248 and cross_draws == 30, 'complete numeric words and joint-consumer draws')
    return words_checked, cross_draws


def verify_pairs(proof, fixture, pairs):
    names = [entry['name'] for entry in fixture['pairs'] if entry['name'].endswith(('-smooth', '-flat'))]
    require([draw['name'] for draw in proof['pairDraws']] == names and len(names) == 34,
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


def direct_attributes(entries, negated=False):
    expected = [[[-1, -1, 0, 1], [3, -1, 0, 1], [-1, 3, 0, 1]],
                [[0, 0, 0, 1], [2, 0, 0, 1], [0, 2, 0, 1]]]
    if negated:
        expected[1] = [[-value if value != 0 else value for value in row] for row in expected[1]]
    require(len(entries) == 2, 'both direct textured triangle attributes')
    for index, (entry, values) in enumerate(zip(entries, expected)):
        require(entry['name'] == f'in_{index}' and entry['values'] == values
                and entry['active'] is True and entry['location'] >= 0
                and entry['uploadedWords'] == [oracle.word(value) for row in values for value in row],
                'actual full-screen position and interpolated texture coordinates')



def texture_vector(definition, fixture, phase, texel_index):
    condition = [0, 1, 2, 0x80000000] if phase == 0 else [0xffffffff, 0, 0x80000000, 2]
    direct = [1, 0, 2, 0] if phase == 0 else [0, 0x80000000, 0, 0xffffffff]
    coordinate = [(texel_index % 2 + .5) / 2, (texel_index // 2 + .5) / 2, 0, 1]
    require(definition['samplers'] == [7] and definition['thresholds'] == [.375, .625, .875, 1.125]
            and definition['broadcastGroups'] == [[0, 1, 2, 3]], 'authored sampled scalar contract')
    sampled = oracle._prior._prior.texel(fixture['textures'][phase], coordinate)
    inputs = oracle.texture_inputs(definition['oracle'], sampled)
    if definition['approximate']:
        gate = module('scalar_texture_reciprocal', 'tools/virgl-dot-reciprocals/reciprocal_receipt.py')
        expected = gate.enclosure_oracle(inputs, [[0, 1, 2, 3]], helpers=globals())
        bounds = [(Fraction(int(lane['lower']['numerator']), int(lane['lower']['denominator'])),
                   Fraction(int(lane['upper']['numerator']), int(lane['upper']['denominator'])))
                  for lane in expected['lanes']]
    else:
        expected = rational_record([entry['value'] for entry in inputs])
        bounds = [(entry['value'], entry['value']) for entry in inputs]
    direct_bytes = []
    for (lower, upper), threshold in zip(bounds, definition['thresholds']):
        require(lower >= Fraction(threshold) or upper < Fraction(threshold),
                'whole independent scalar enclosure remains on one side of direct pixel threshold')
        direct_bytes.append(255 if lower >= Fraction(threshold) else 0)
    return {'name': f'phase{phase}-texel{texel_index}', 'phase': phase, 'texel': texel_index,
            'a': coordinate, 'b': [.25, .5, .75, 1], 'c': [1, .75, .5, .25],
            'condition': condition, 'directCondition': direct, 'raw': [0] * 4,
            'sampleBindings': [{'index': 7, 'texture': fixture['textures'][phase]}],
            'sampledBytes': [int(value * 255) for value in sampled],
            'directBytes': direct_bytes, 'oracle': expected}


def verify_textures(proof, fixture, cases):
    definitions = {entry['name']: entry for entry in fixture['texturePrograms']}
    require(list(definitions) == ['tex-dp3', 'tex-rcp', 'tex-rsq'] and len(fixture['textures']) == 2,
            'complete scalar sampled chains')
    gate = module('scalar_texture_reciprocal', 'tools/virgl-dot-reciprocals/reciprocal_receipt.py')
    extra = module('scalar_texture_broadcast', 'tools/virgl-dot-reciprocals/browser_receipt.py')
    counts = {'exactWords': 0, 'boundedWords': 0, 'crossDraws': 0, 'pixels': 0}
    for approximate in (False, True):
        for cross in (False, True):
            key = ('reciprocalCrossProbes' if cross else 'reciprocalFragmentProbes') if approximate else ('crossConsumerProbes' if cross else 'fragmentProbes')
            probes = [probe for probe in proof[key] if probe['name'] in definitions]
            require([probe['name'] for probe in probes] == [name for name, item in definitions.items()
                    if item['approximate'] == approximate], 'complete sampled exact and quantitative sequences')
            for probe in probes:
                definition = definitions[probe['name']]
                fragment = definition['cross' if cross else 'fragment']
                require(probe['vertex'] == 'legacy-vertex' and probe['fragment'] == fragment
                        and probe['oracle'] == definition['oracle'] and probe['width'] == probe['height'] == 1,
                        'exact sampled scalar program identity')
                program(probe, cases['legacy-vertex']['result'], cases[fragment]['result'])
                extra.verify_broadcast(probe, definition, helpers=globals())
                require(len(probe['vectors']) == 8, 'both binding phases and every authored texel')
                for index, entry in enumerate(probe['vectors']):
                    source = texture_vector(definition, fixture, index // 4, index % 4)
                    require(all(entry[key] == value for key, value in source.items()),
                            'independent texture selection, scalar arithmetic and enclosures')
                    attributes(entry['attributes'], source, False)
                    uniforms(probe, entry, source, source['oracle'])
                    samplers(entry['samplers'], source, cases[fragment]['result'])
                    if approximate:
                        gate.verify_fragment(entry, source['oracle'], cross=cross, helpers=globals())
                    else:
                        fragment_draws(entry, source['oracle']['words'], cross)
                    if cross:
                        counts['crossDraws'] += 1
                    else:
                        counts['boundedWords' if approximate else 'exactWords'] += 4
    require([(draw['name'], draw['phase']) for draw in proof['textureDraws']] ==
            [(name, phase) for name in definitions for phase in (0, 1)], 'every direct texture phase')
    for draw in proof['textureDraws']:
        definition, phase = definitions[draw['name']], draw['phase']
        source = texture_vector(definition, fixture, phase, 0)
        require(draw['vertex'] == 'legacy-vertex' and draw['fragment'] == definition['direct']
                and draw['width'] == draw['height'] == 32 and draw['condition'] == source['condition']
                and draw['directCondition'] == source['directCondition'], 'exact full-frame texture inputs')
        program(draw, cases['legacy-vertex']['result'], cases[definition['direct']]['result'])
        direct_attributes(draw['attributes'])
        uniforms(draw, draw, source, source['oracle'])
        samplers(draw['samplers'], source, cases[definition['direct']]['result'])
        pixels = bytes(draw['rawBytes'])
        require(len(pixels) == 4096 and sha(pixels) == draw['bytesSha256']
                and draw['checkedPixels'] == 1024, 'complete actual scalar texture framebuffer')
        samples = [texture_vector(definition, fixture, phase, index) for index in range(4)]
        for y in range(32):
            for x in range(32):
                sample = samples[(x // 16) + 2 * (y // 16)]
                expected = [value if condition != 0 else 255 - value
                            for condition, value in zip(sample['directCondition'], sample['directBytes'])]
                require(list(pixels[(y * 32 + x) * 4:(y * 32 + x + 1) * 4]) == expected,
                        'actual texture pixels satisfy independent whole-enclosure comparisons')
                counts['pixels'] += 1
    require(counts == {'exactWords': 32, 'boundedWords': 64, 'crossDraws': 24, 'pixels': 6144},
            'complete sampled scalar counts')
    return counts



def verify_sequences(proof, fixture):
    numeric, reciprocal, textures = (fixture[key] for key in ('numericPrograms', 'reciprocalPrograms', 'texturePrograms'))
    exact_textures = [entry for entry in textures if not entry['approximate']]
    bounded_textures = [entry for entry in textures if entry['approximate']]
    sequences = {'vertexProbes': numeric, 'fragmentProbes': numeric + exact_textures,
                 'crossConsumerProbes': [entry for entry in numeric if 'cross' in entry] + exact_textures,
                 'reciprocalVertexProbes': reciprocal, 'reciprocalFragmentProbes': reciprocal + bounded_textures,
                 'reciprocalCrossProbes': reciprocal + bounded_textures}
    for key, definitions in sequences.items():
        require([entry['name'] for entry in proof[key]] == [entry['name'] for entry in definitions],
                'complete scalar proof sequences without substituted, duplicate or unexamined probes')

def verify_source_contracts(proof, fixture, cases):
    shaders = [shader for shader in fixture['shaders'] if shader['profile'] == PROFILES[-1]]
    require([entry['name'] for entry in proof['sourceContracts']] == [shader['name'] for shader in shaders],
            'every v6 scalar shader source contract')
    for record, shader in zip(proof['sourceContracts'], shaders):
        glsl = cases[shader['name']]['result']['glsl']
        def instructions(opcode):
            return sum(bool(re.match(r'^\s*(?:\d+:\s*)?' + opcode + r'\b', line))
                       for line in shader['text'].splitlines())
        scalar = []
        for opcode, pattern in [('DP3', r'\bdot\('), ('RCP', r'vec4\(1\.0 / \('), ('RSQ', r'\binversesqrt\(')]:
            count, emitted = instructions(opcode), len(re.findall(pattern, glsl))
            require(count == emitted, 'exactly one logical expression per scalar instruction')
            scalar.append({'opcode': opcode, 'instructions': count, 'expressions': emitted})
        require(record == {'name': shader['name'], 'inputSha256': sha(shader['text'].encode()),
                'glslSha256': sha(glsl.encode()), 'textureInstructions': instructions('TEX'),
                'textureCalls': len(re.findall(r'\btexture\s*\(', glsl)), 'scalarEvaluations': scalar,
                'consumedLanes': {'DP3': [0, 1, 2], 'RCP': [0], 'RSQ': [0]},
                'meaning': 'Counts logical emitted scalar and texture expressions, not driver physical evaluations.'}
                and record['textureInstructions'] == record['textureCalls'],
                'complete source-bound scalar and sampling expression contract')

def main():
    require(len(sys.argv) == 2, 'usage: receipt.py EVIDENCE_DIRECTORY')
    output = Path(sys.argv[1]).resolve()
    head = git('rev-parse', 'HEAD').decode().strip()
    contract = read(ROOT / 'docs/gpu-3d-contract.json')
    held = json.loads(git('show', f'{HELD_HEAD}:docs/gpu-3d-contract.json'))
    require(contract['production'] == held['production'] and
            [contract[key] for key in ('shaderProfile', 'rawShaderProfile', 'integerShaderProfile',
                'orderedShaderProfile', 'numericShaderProfile', 'componentShaderProfile', 'scalarShaderProfile')] == PROFILES,
            'production and previous profiles unchanged; explicit ordinary scalar subprofile')
    native_gate = module('component_native_receipt', 'tools/virgl-dot-reciprocals/native_receipt.py')
    native, fixtures, hardware, cases, pairs, originals = native_gate.verify_native(output, head)
    browser = base.verify_browser(output / 'hardware', head, contract, task='E6-T12e6')
    modes = ['dp3-lane', 'rcp-source', 'rsq-operation', 'numeric-negate']
    controls = [base.verify_browser(output / ('sabotage-' + mode), head, contract,
                                    passed=False, task='E6-T12e6') for mode in modes]
    extra = module('component_browser_receipt', 'tools/virgl-dot-reciprocals/browser_receipt.py')
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
        require(proof['caseFixture'] == binding(ROOT / 'renderer/virgl-shader/tests/dot-reciprocal-cases.json')
                and proof['hardwareFixture'] == binding(ROOT / 'renderer/virgl-shader/tests/dot-reciprocal-hardware.json'),
                'both actual fixture source bindings')
        first = hardware['numericVectors'][0]
        require(proof['literalWitnesses'] == {'input': first, 'expected': {
            name: [oracle.word(value) for value in oracle.numeric(name, first)]
            for name in ('dp3', 'dp3-swizzle', 'dp3-safe')}}, 'independent first-vector literal witnesses')
        extra.verify_orientation(proof, cases, helpers=globals())
    proof = browser['acceptance']
    verify_sequences(proof, hardware)
    verify_source_contracts(proof, hardware, cases)
    numeric_words, numeric_cross = verify_numeric(proof, hardware, cases)
    textures = verify_textures(proof, hardware, cases)
    reciprocal_gate = module('scalar_reciprocal_receipt', 'tools/virgl-dot-reciprocals/reciprocal_receipt.py')
    reciprocals = reciprocal_gate.verify_reciprocals(proof, hardware, cases, helpers=globals())
    observations = reciprocal_gate.verify_observations(proof, hardware, cases, helpers=globals())
    pair_pixels = verify_pairs(proof, hardware, pairs)
    require(proof['exactWords'] == numeric_words + textures['exactWords'] + reciprocals['exactWords'] == 310
            and proof['boundedReciprocalWords'] == textures['boundedWords'] + reciprocals['boundedWords'] == 178
            and proof['checkedWords'] == proof['exactWords'] + proof['boundedReciprocalWords'] == 488
            and proof['observedSpecialWords'] == observations['words'] == 72
            and proof['checkedTexturePixels'] == textures['pixels'] == 6144
            and numeric_cross + textures['crossDraws'] + reciprocals['crossDraws'] == 72 and pair_pixels == 33728,
            'derived complete scalar and texture proof counts')
    require(proof['status'] == 'passed' and proof['sabotage'] is None and proof['omissions'] == []
            and proof['objects']['live'] == 0 and proof['objects']['created'] == proof['objects']['deleted'],
            'complete hardware proof releases all GL objects')
    for mode in modes:
        extra.verify_sabotage(output / ('sabotage-' + mode), mode, browser, cases, hardware, helpers=globals())
    regressions = module('component_regressions', 'tools/virgl-dot-reciprocals/regressions.py').verify(output, head, contract)
    names = {item['path'] for report in [browser, *controls] for item in report['sources']}
    names.update(item['path'] for item in native['sources'] + native['fixtures'])
    names.update(item['path'] for item in regressions['sources'])
    names.update(str(p.relative_to(ROOT)) for p in (ROOT / 'tools/virgl-dot-reciprocals').glob('*.py'))
    names.update(('tools/verify-virgl-dot-reciprocals.sh', 'docs/gpu-3d-contract.json',
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
    receipt = {'schema': 1, 'task': 'E6-T12e6', 'status': 'passed', 'gitHead': head,
               'boundary': 'Ordinary DP3, RCP and RSQ with scalar consumed-lane semantics and independent GPU oracles; unchanged guest constant transport and production negotiation.',
               'heldComponentHead': HELD_HEAD, 'production': contract['production'],
               'profiles': PROFILES, 'sources': sources, 'records': records,
               'shaderOutcomes': {'translated': 12, 'unsupported-feature': 7},
               'numericWords': numeric_words, 'textures': textures,
               'reciprocals': reciprocals, 'specialObservations': observations,
               'migrations': native['migrations'], 'migrationSource': native['migrationsSource'],
               'crossConsumerDraws': numeric_cross + textures['crossDraws'] + reciprocals['crossDraws'], 'texturePixels': textures['pixels'],
               'interpolationPixels': pair_pixels, 'orientationCaptures': 2,
               'regressions': {key: value for key, value in regressions.items() if key != 'sources'},
               'compilerSha256': {'nativeSanitizer': native['binarySha256'],
                   'wasm': sha((ROOT / 'renderer/virgl-shader/build/wasm/virgl-shader.wasm').read_bytes())}}
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'E6-T12e6 passed: 310 exact words, 178 bounded reciprocal words, 72 special observations, 72 joint-consumer draws, 6144 texture pixels, {pair_pixels} interpolation pixels and source-bound prior results.')


if __name__ == '__main__':
    main()
