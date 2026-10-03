"""Byte-bound orientation and four deliberate component-arithmetic GPU faults.

Use ``helpers=globals()`` from receipt.py. ``root`` in verify_sabotage is the
specific sabotage directory containing report.json; ``good`` is the clean outer
report. Native shared-case maps include the hardware shader entries. The parent
receipt validates outer recording/source identity and native/Wasm parity.
"""
from fractions import Fraction
import importlib.util
from pathlib import Path
import re
import struct


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def _helpers(helpers):
    return helpers if helpers is not None else vars(_load('component_browser_helpers', 'receipt.py'))


def _feedback(probe, require):
    names = ['gl_Position', 'vso_g5', 'vso_g6']
    require(probe['varyings'] == names and probe['feedbackReflection'] ==
            [{'name': name, 'size': 1, 'type': 35666} for name in names],
            'actual position, ordinary-result and byte-carrier FLOAT_VEC4 feedback')


def verify_orientation(proof, cases, *, helpers=None):
    """Validate both 48-byte captures; computed zero signs remain unconstrained."""
    h = _helpers(helpers)
    require, sha, oracle = h['require'], h['sha'], h['oracle']
    path = h['ROOT'] / 'renderer/virgl-shader/tests/component-float-hardware.json'
    require(proof['hardwareFixture'] == h['binding'](path), 'orientation fixture source binding')
    fixture = h['read'](path)
    source = next(vector for vector in fixture['numericVectors'] if vector['name'] == 'weights')
    probe = proof['orientation']
    require(probe['vertex'] == 'component-lrp-vertex' and probe['fragment'] == 'legacy-fragment'
            and probe['vector'] == source, 'exact orientation program and authored dynamic inputs')
    h['program'](probe, cases[probe['vertex']]['result'], cases[probe['fragment']]['result'])
    _feedback(probe, require)
    values = oracle.numeric('lrp', source)
    expected = h['rational_record'](values)
    require(probe['oracle'] == expected, 'independent orientation LRP values and canonical reference words')
    h['attributes'](probe['attributes'], source, True)
    h['uniforms'](probe, probe, source, expected)
    h['selector']({'selector': 0, 'selectorUpload': probe['selectorUpload']}, 0)
    require([capture['adjust'] for capture in probe['captures']] == [-1, 1], 'both actual orientation settings')
    for capture in probe['captures']:
        adjust = capture['adjust']
        uniform_word = oracle.word(adjust)
        require(capture['uniformUpdate'] == {'offset': 640, 'expectedBits': [uniform_word],
                'observedBits': [uniform_word]}, 'actual UBO write/readback at reflected orientation offset')
        position = [oracle.word(value) for value in [.25, .5 * adjust, -.25, 1]]
        carriers = [0x3f000000 + (word % 256) * 32768 for word in expected['words']]
        data = bytes(capture['rawBytes'])
        require(len(data) == 48 and capture['bytesSha256'] == sha(data), 'complete actual orientation feedback bytes')
        words = list(struct.unpack('<12I', data))
        require(capture['expectedBits'] == position + expected['words'] + carriers
                and capture['observedBits'] == words and words[:4] == position and words[8:] == carriers
                and all(word in oracle.exact_words(value) for word, value in zip(words[4:8], values)),
                'byte-level orientation changes nonzero position Y and preserves ordinary values with either zero sign')
    return 2


def _mutation(mode, original, require):
    definitions = {
        'lrp-order': (r'\(mix\((in_3\.[xyzw]), (in_2\.[xyzw]), (in_1\.[xyzw])\)\)',
                      '(mix($2, $1, $3))', 4, lambda m: f'(mix({m[2]}, {m[1]}, {m[3]}))'),
        'frc-floor': (r'\(fract\((in_1\.[xyzw])\)\)',
                      '($1 - trunc($1))', 4, lambda m: f'({m[1]} - trunc({m[1]}))'),
        'div-operands': (r'\((in_1\.[xyzw]) \/ (in_2\.[xyzw])\)',
                         '($2 / $1)', 4, lambda m: f'({m[2]} / {m[1]})'),
        'numeric-negate': (r'-\(in_3\.z\)', 'in_3.z', 1, 'in_3.z'),
    }
    require(mode in definitions, 'known component source sabotage')
    expression, replacement, expected_count, action = definitions[mode]
    mutated, count = re.subn(expression, action, original)
    require(count == expected_count and mutated != original, 'exact intended component mutation sites only')
    return expression, replacement, count, mutated


def verify_sabotage(root, mode, good, cases, fixture, *, helpers=None):
    """Require an input-bound actual GPU contradiction after the exact mutation."""
    h = _helpers(helpers)
    require, sha = h['require'], h['sha']
    outer = h['read'](Path(root) / 'report.json')
    proof, baseline = outer['acceptance'], good['acceptance']
    require(outer['status'] == proof['status'] == 'failed' and proof['sabotage'] == mode
            and len(proof['omissions']) == 1, 'one intentional failing component lowering')
    require(good['status'] == baseline['status'] == 'passed' and baseline['sabotage'] is None
            and baseline['omissions'] == [], 'passing original shader control')
    require(proof['anchors'] == baseline['anchors'] and proof['sourceContracts'] == baseline['sourceContracts'],
            'all original TGSI, translated GLSL, metadata and sampling contracts remain unchanged')
    verify_orientation(proof, cases, helpers=h)
    objects = proof['objects']
    require(objects['live'] == 0 and objects['created'] == objects['deleted']
            and all(type(count) is int and count > 0 for count in objects['created'].values()),
            'every actual GL object is released after the intentional mismatch')
    require(all(proof[key] == [] for key in ('divisionFragmentProbes', 'divisionCrossProbes',
            'textureDraws', 'observationProbes', 'pairDraws')), 'failure stops before later workloads')
    operation = {'lrp-order': 'lrp', 'frc-floor': 'frc', 'numeric-negate': 'negate-mad', 'div-operands': 'div'}
    require(mode in operation, 'known deliberate component operation failure')
    definitions = fixture['divisionPrograms'] if mode == 'div-operands' else fixture['numericPrograms']
    definition = next(item for item in definitions if item['name'] == operation[mode])
    target = definition['vertex']
    original = cases[target]['result']
    shader = next(item for item in fixture['shaders'] if item['name'] == target)
    require(cases[target]['inputSha256'] == sha(shader['text'].encode()), 'native exact authored sabotage source')
    expression, replacement, count, mutated = _mutation(mode, original['glsl'], require)
    omission = proof['omissions'][0]
    require(omission['mode'] == mode and omission['originalExpression'] == expression
            and omission['replacement'] == replacement and omission['matches'] == count
            and omission['originalGlsl'] == original['glsl'] and omission['servedGlsl'] == mutated
            and omission['originalGlslSha256'] == sha(original['glsl'].encode())
            and omission['servedGlslSha256'] == sha(mutated.encode()),
            'exact source-bound mutation excludes encoder, metadata and unrelated GLSL changes')
    if mode == 'div-operands':
        _division_failure(proof, definition, fixture, cases, mutated, h)
    else:
        _exact_failure(proof, mode, definition, fixture, cases, mutated, h)
    return {'mode': mode, 'program': target, 'mutationSites': count, 'actualMismatches': 1}


def _mutated_values(mode, vector, oracle):
    a, b, c = [[Fraction(value) for value in vector[field]] for field in ('a', 'b', 'c')]
    if mode == 'lrp-order':
        return [weight * other + (1 - weight) * first for weight, first, other in zip(a, b, c)]
    if mode == 'frc-floor':
        return [value - int(value) for value in a]  # int truncates toward zero, unlike floor.
    result = oracle.numeric('negate-mad', vector)
    result[0] += 2 * c[2]  # Only the third-source z modifier of result x was removed.
    return result


def _exact_failure(proof, mode, definition, fixture, cases, mutated, h):
    require, oracle = h['require'], h['oracle']
    names = [item['name'] for item in fixture['numericPrograms']]
    stop = names.index(definition['name'])
    require([probe['name'] for probe in proof['vertexProbes']] == names[:stop + 1]
            and [probe['name'] for probe in proof['fragmentProbes']] == names[:stop]
            and [probe['name'] for probe in proof['crossConsumerProbes']] == names[:stop]
            and proof['divisionVertexProbes'] == [], 'exact component failure reaches its authored workload position')
    probe = proof['vertexProbes'][-1]
    require(probe['vertex'] == definition['vertex'] and probe['fragment'] == 'legacy-fragment'
            and probe['oracle'] == definition['oracle'], 'actual corrupted component vertex identity')
    h['program'](probe, {'glsl': mutated}, cases['legacy-fragment']['result'])
    _feedback(probe, require)
    sources = {item['name']: item for item in fixture['numericVectors']}
    # Predict the first failing vector from the authored rational inputs and the
    # exact source alteration, not from the browser's error string or observed GPU.
    first = next(index for index, name in enumerate(definition['vectors'])
                 if _mutated_values(mode, sources[name], oracle) != oracle.numeric(definition['oracle'], sources[name]))
    require([entry['name'] for entry in probe['vectors']] == definition['vectors'][:first + 1],
            'independently predicted first counterexample and complete preceding vectors')
    for index, entry in enumerate(probe['vectors']):
        source = sources[entry['name']]
        require(all(entry[key] == value for key, value in source.items()), 'exact actual component sabotage inputs')
        expected = h['rational_record'](oracle.numeric(definition['oracle'], source))
        require(entry['oracle'] == expected, 'independent unmodified component arithmetic oracle')
        h['attributes'](entry['attributes'], source, True)
        h['uniforms'](probe, entry, source, expected)
        if index < first:
            require(h['vertex_captures'](entry, expected['words']) == 0, 'complete unchanged leading vector captures')
            continue
        require(len(entry['captures']) == 1 and h['vertex_captures'](entry, expected['words'], True) == 1,
                'first actual feedback capture contradicts the original oracle with untouched guard')
        capture = entry['captures'][0]
        actual, wrong = capture['observedBits'], _mutated_values(mode, source, oracle)
        require(all(word in oracle.exact_words(value) for word, value in zip(actual[4:8], wrong))
                and any(word not in oracle.exact_words(value) for word, value in
                        zip(actual[4:8], oracle.numeric(definition['oracle'], source)))
                and actual[8:] == [0x3f000000 + (word % 256) * 32768 for word in actual[4:8]],
                'real mismatch equals independently derived altered arithmetic and coherent byte-carrier values')
        require(proof['failure']['message'].startswith(
            f"{definition['name']}/{source['name']} simultaneous numeric/raw byte0: expected "),
            'reported failure is the actual post-draw value comparison')


def _division_failure(proof, definition, fixture, cases, mutated, h):
    require, sha, oracle = h['require'], h['sha'], h['oracle']
    division = _load('component_browser_division', 'division_receipt.py')
    names = [item['name'] for item in fixture['numericPrograms']]
    require([probe['name'] for probe in proof['vertexProbes']] == names
            and [probe['name'] for probe in proof['fragmentProbes']] == names
            and [probe['name'] for probe in proof['crossConsumerProbes']] == names[:-1]
            and [probe['name'] for probe in proof['divisionVertexProbes']] == ['div'],
            'DIV reversal reaches only the intended first quantitative workload')
    probe = proof['divisionVertexProbes'][0]
    require(probe['vertex'] == definition['vertex'] and probe['fragment'] == 'legacy-fragment'
            and probe['oracle'] == 'div', 'actual corrupted DIV vertex identity')
    h['program'](probe, {'glsl': mutated}, cases['legacy-fragment']['result'])
    _feedback(probe, require)
    source = next(item for item in fixture['divisionVectors'] if item['name'] == definition['vectors'][0])
    require(len(probe['vectors']) == 1, 'first dynamic DIV input detects the reversal')
    entry = probe['vectors'][0]
    require(all(entry[key] == value for key, value in source.items()), 'exact actual DIV sabotage input operands')
    expected = division.division_oracle('div', source, helpers=h)
    require(entry['oracle'] == expected, 'independent original DIV rational enclosures and outward upload bounds')
    h['attributes'](entry['attributes'], source, True)
    h['uniforms'](probe, entry, source, expected)
    require(len(entry['captures']) == 1, 'DIV fails after its first actual feedback capture')
    capture = entry['captures'][0]
    h['selector'](capture, 0)
    data = bytes(capture['rawBytes'])
    require(len(data) == 64 and data[48:] == bytes([0xa5] * 16)
            and capture['guard'] == [0xa5] * 16 and capture['bytesSha256'] == sha(data),
            'complete DIV feedback bytes and untouched range guard')
    words = list(struct.unpack('<12I', data[:48]))
    require(capture['observedBits'] == words and words[:4] == [0x3e800000, 0x3f000000, 0xbe800000, 0x3f800000],
            'actual DIV words and unchanged nonzero position')
    require(all(0x3f000000 <= word <= 0x3f7f8000 and (word - 0x3f000000) % 32768 == 0 for word in words[8:])
            and capture['decodedBytes'] == [(word - 0x3f000000) // 32768 for word in words[8:]],
            'actual DIV raw carriers remain on the exact finite byte grid')
    observations = [division.division_observation(lane, word, helpers=h)
                    for lane, word in zip(expected['lanes'], words[4:8])]
    failures = [index for index, observation in enumerate(observations) if not observation['withinEnclosure']]
    require(capture['numericObservations'] == observations and failures
            and capture['failure'] == {'lanes': failures},
            'actual decoded ordinary DIV values contradict the independent original rational bounds')
    # Positive original numerators become positive reversed denominators, so the
    # same stated accuracy theorem independently identifies those actual results.
    # Do not extend that positive-denominator theorem to the other reversed lanes.
    checked_reciprocals = 0
    for a, b, word in zip(source['a'], source['b'], words[4:8]):
        if a > 0:
            wrong_bound = oracle.division_bounds(Fraction(b), Fraction(a))
            require(division.division_observation(wrong_bound, word, helpers=h)['withinEnclosure'],
                    'actual positive-denominator reversed quotient lies in its independently derived enclosure')
            checked_reciprocals += 1
    require(checked_reciprocals == 2 and 'observedWords' not in entry and 'rawObservations' not in entry,
            'two justified reversed-order witnesses; no unexecuted full raw reconstruction claimed')
    require(proof['failure']['message'] == 'div/interior ordinary DIV feedback outside rational enclosure',
            'reported DIV failure is the actual post-draw rational comparison')
