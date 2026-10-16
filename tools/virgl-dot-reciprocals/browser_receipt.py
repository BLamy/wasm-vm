"""Independent byte-bound orientation, scalar replication and GPU fault receipts.

Call with ``helpers=globals()`` from receipt.py. The parent binds each outer
recording to sources and native/Wasm translations. These checks reconstruct the
actual feedback and validate authored inputs, exact source mutations and the
numerical contradiction; an error message alone never establishes a failure.
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
    return helpers if helpers is not None else vars(_load('scalar_browser_helpers', 'receipt.py'))


def _feedback(probe, require):
    names = ['gl_Position', 'vso_g5', 'vso_g6']
    require(probe['varyings'] == names and probe['feedbackReflection'] ==
            [{'name': name, 'size': 1, 'type': 35666} for name in names],
            'actual position, ordinary-result and byte-carrier FLOAT_VEC4 feedback')


def _groups(name):
    if name.startswith('dp3-partial-'):
        return [['xyzw'.index(lane) for lane in name.removeprefix('dp3-partial-')]]
    if name == 'dp3-alias-xy':
        return [[0, 1]]
    if name in ('dp3', 'dp3-swizzle', 'dp3-safe', 'dp3-shadow', 'maximal', 'tex-dp3', 'tex-rcp', 'tex-rsq'):
        return [[0, 1, 2, 3]]
    raise ValueError(f'unknown exact scalar replication definition: {name}')


def verify_broadcast(probe, definition, *, helpers=None):
    """Check exact DP3 written lanes, with no sign constraint on computed zero.

    The main receipt first validates each numerical value and capture. This
    extra relation checks ordinary feedback and raw reconstruction separately;
    no cross-stage equality or exceptional-payload guarantee is introduced.
    """
    h = _helpers(helpers)
    require, oracle = h['require'], h['oracle']
    groups = _groups(definition['name'])
    require(definition['broadcastGroups'] == probe['broadcastGroups'] == groups,
            'replication groups derive independently from the written destination mask')
    checks = 0
    for entry in probe['vectors']:
        if probe['fragment'] == definition.get('cross'):
            require(all(key not in entry for key in ('captures', 'observedWords', 'rawObservations')),
                    'cross-consumer pixels cannot claim uncaptured numerical words')
        observations = []
        for capture in entry.get('captures', []):
            data = bytes(capture['rawBytes'])
            require(len(data) == 64 and capture['observedBits'] == list(struct.unpack('<12I', data[:48])),
                    'broadcast words come from actual captured bytes')
            observations.append(capture['observedBits'][4:8])
        if 'observedWords' in entry:
            observations.append(entry['observedWords'])
        for words in observations:
            require(len(words) == 4, 'four ordinary or reconstructed scalar result lanes')
            for group in groups:
                first = words[group[0]]
                require(all(words[lane] == first or oracle.classify(words[lane]) ==
                            oracle.classify(first) == 'zero' for lane in group),
                        'written scalar lanes repeat one value with ordinary zero-sign latitude')
                checks += 1
    return checks


def verify_orientation(proof, cases, *, helpers=None):
    """Validate both complete 48-byte orientation captures against exact DP3."""
    h = _helpers(helpers)
    require, sha, oracle = h['require'], h['sha'], h['oracle']
    path = h['ROOT'] / 'renderer/virgl-shader/tests/dot-reciprocal-hardware.json'
    require(proof['hardwareFixture'] == h['binding'](path), 'orientation fixture source binding')
    fixture = h['read'](path)
    source = next(vector for vector in fixture['numericVectors'] if vector['name'] == 'basis')
    probe = proof['orientation']
    require(probe['vertex'] == 'scalar-dp3-vertex' and probe['fragment'] == 'legacy-fragment'
            and probe['vector'] == source, 'exact orientation program and authored dynamic inputs')
    h['program'](probe, cases[probe['vertex']]['result'], cases[probe['fragment']]['result'])
    _feedback(probe, require)
    values = oracle.numeric('dp3', source)
    expected = h['rational_record'](values)
    require(probe['oracle'] == expected, 'independent orientation DP3 values and reference words')
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
                'actual orientation changes nonzero position Y and preserves ordinary arithmetic values')
    return 2


def _mutation(mode, original, require):
    definitions = {
        'dp3-lane': (r'dot\(vec3\(in_1\.x, in_1\.y, in_1\.z\),',
                     'dot(vec3(in_1.x, in_1.y, in_1.w),'),
        'rcp-source': (r'1\.0 \/ \(in_1\.y\)', '1.0 / (in_1.x)'),
        'rsq-operation': (r'inversesqrt\(in_1\.z\)', 'sqrt(in_1.z)'),
        'numeric-negate': (r'-\(in_2\.y\)', 'in_2.y'),
    }
    require(mode in definitions, 'known scalar source sabotage')
    expression, replacement = definitions[mode]
    mutated, count = re.subn(expression, replacement, original)
    require(count == 1 and mutated != original, 'one exact intended scalar source mutation')
    return expression, replacement, count, mutated


def _exact_prefix(proof, fixture, cases, count, h):
    """Validate complete exact workloads preceding the faulty shader."""
    require, oracle = h['require'], h['oracle']
    definitions = fixture['numericPrograms'][:count]
    vectors = {entry['name']: entry for entry in fixture['numericVectors']}
    for field, vertex, cross in [('vertexProbes', True, False), ('fragmentProbes', False, False),
                                  ('crossConsumerProbes', False, True)]:
        expected_definitions = [entry for entry in definitions if not cross or 'cross' in entry]
        for probe, definition in zip(proof[field], expected_definitions):
            v = definition['vertex'] if vertex else 'legacy-vertex'
            f = 'legacy-fragment' if vertex else definition['cross' if cross else 'fragment']
            require(probe['name'] == definition['name'] and probe['oracle'] == definition['oracle']
                    and probe['vertex'] == v and probe['fragment'] == f, 'complete preceding exact program identity')
            h['program'](probe, cases[v]['result'], cases[f]['result'])
            if vertex:
                _feedback(probe, require)
            require([entry['name'] for entry in probe['vectors']] == definition['vectors'],
                    'complete preceding exact dynamic input sequence')
            for entry in probe['vectors']:
                source = vectors[entry['name']]
                require(all(entry[key] == value for key, value in source.items()), 'preceding exact actual inputs')
                expected = h['rational_record'](oracle.numeric(definition['oracle'], source))
                require(entry['oracle'] == expected, 'preceding exact independent rational oracle')
                h['attributes'](entry['attributes'], source, vertex)
                h['uniforms'](probe, entry, source, expected)
                if vertex:
                    require(h['vertex_captures'](entry, expected['words']) == 0, 'preceding actual exact captures')
                else:
                    h['fragment_draws'](entry, expected['words'], cross)
            verify_broadcast(probe, definition, helpers=h)


def verify_sabotage(root, mode, good, cases, fixture, *, helpers=None):
    """Require actual GPU contradiction after the exact source-bound mutation."""
    h = _helpers(helpers)
    require, sha = h['require'], h['sha']
    outer = h['read'](Path(root) / 'report.json')
    proof, baseline = outer['acceptance'], good['acceptance']
    require(outer['status'] == proof['status'] == 'failed' and proof['sabotage'] == mode
            and len(proof['omissions']) == 1, 'one intentional failing scalar lowering')
    require(good['status'] == baseline['status'] == 'passed' and baseline['sabotage'] is None
            and baseline['omissions'] == [], 'passing original shader control')
    require(outer['browserErrors'] == {'console': [], 'page': [], 'requests': []},
            'source sabotage causes a numerical failure without browser or resource errors')
    require(proof['anchors'] == baseline['anchors'] and proof['sourceContracts'] == baseline['sourceContracts'],
            'original TGSI, translated GLSL, metadata and scalar/source-use contracts remain unchanged')
    verify_orientation(proof, cases, helpers=h)
    objects = proof['objects']
    require(objects['live'] == 0 and objects['created'] == objects['deleted']
            and all(type(count) is int and count > 0 for count in objects['created'].values()),
            'every actual GL object is released after the intentional mismatch')
    require(all(proof[key] == [] for key in ('textureDraws', 'observationProbes', 'pairDraws')),
            'failure stops before later texture, observation and interface workloads')
    operation = {'dp3-lane': 'dp3', 'numeric-negate': 'dp3-swizzle',
                 'rcp-source': 'rcp', 'rsq-operation': 'rsq'}
    require(mode in operation, 'known deliberate scalar operation failure')
    quantitative = mode in ('rcp-source', 'rsq-operation')
    definitions = fixture['reciprocalPrograms' if quantitative else 'numericPrograms']
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
            'exact source mutation excludes encoder, metadata and unrelated GLSL changes')
    if quantitative:
        _reciprocal_failure(proof, mode, definition, fixture, cases, mutated, h)
    else:
        _exact_failure(proof, mode, definition, fixture, cases, mutated, h)
    return {'mode': mode, 'program': target, 'mutationSites': count, 'actualMismatches': 1}


def _mutated_values(mode, vector, oracle):
    a, b = [[Fraction(value) for value in vector[field]] for field in ('a', 'b')]
    if mode == 'dp3-lane':
        value = oracle.exact_dot([a[0], a[1], a[3]], b[:3])
    else:
        value = oracle.exact_dot([a[2], a[0], a[1]], [b[1], -b[2], -b[0]])
    return [value] * 4


def _exact_failure(proof, mode, definition, fixture, cases, mutated, h):
    require, oracle = h['require'], h['oracle']
    names = [item['name'] for item in fixture['numericPrograms']]
    stop = names.index(definition['name'])
    require([probe['name'] for probe in proof['vertexProbes']] == names[:stop + 1]
            and [probe['name'] for probe in proof['fragmentProbes']] == names[:stop]
            and [probe['name'] for probe in proof['crossConsumerProbes']] == names[:stop]
            and all(proof[key] == [] for key in ('reciprocalVertexProbes', 'reciprocalFragmentProbes',
                                                'reciprocalCrossProbes')),
            'exact scalar failure reaches precisely its authored workload position')
    _exact_prefix(proof, fixture, cases, stop, h)
    probe = proof['vertexProbes'][-1]
    require(probe['vertex'] == definition['vertex'] and probe['fragment'] == 'legacy-fragment'
            and probe['oracle'] == definition['oracle'], 'actual corrupted scalar vertex identity')
    h['program'](probe, {'glsl': mutated}, cases['legacy-fragment']['result'])
    _feedback(probe, require)
    sources = {item['name']: item for item in fixture['numericVectors']}
    first = next(index for index, name in enumerate(definition['vectors'])
                 if _mutated_values(mode, sources[name], oracle) != oracle.numeric(definition['oracle'], sources[name]))
    require([entry['name'] for entry in probe['vectors']] == definition['vectors'][:first + 1],
            'independently predicted first counterexample and complete preceding vectors')
    for index, entry in enumerate(probe['vectors']):
        source = sources[entry['name']]
        require(all(entry[key] == value for key, value in source.items()), 'exact actual scalar sabotage inputs')
        expected = h['rational_record'](oracle.numeric(definition['oracle'], source))
        require(entry['oracle'] == expected, 'independent unmodified scalar arithmetic oracle')
        h['attributes'](entry['attributes'], source, True)
        h['uniforms'](probe, entry, source, expected)
        if index < first:
            require(h['vertex_captures'](entry, expected['words']) == 0, 'complete unchanged leading captures')
            continue
        require(len(entry['captures']) == 1 and h['vertex_captures'](entry, expected['words'], True) == 1,
                'first actual feedback capture contradicts the original oracle with untouched guard')
        capture = entry['captures'][0]
        actual, wrong = capture['observedBits'], _mutated_values(mode, source, oracle)
        require(all(word in oracle.exact_words(value) for word, value in zip(actual[4:8], wrong))
                and any(word not in oracle.exact_words(value) for word, value in
                        zip(actual[4:8], oracle.numeric(definition['oracle'], source)))
                and actual[8:] == [0x3f000000 + (word % 256) * 32768 for word in actual[4:8]],
                'actual mismatch equals independently derived changed arithmetic and coherent byte carriers')
        require('observedWords' not in entry and 'decodedBytes' not in capture,
                'fault stops before claiming unexecuted raw-word reconstruction')
        require(proof['failure']['message'].startswith(
            f"{definition['name']}/{source['name']} simultaneous numeric/raw byte0: expected "),
            'reported failure is the actual post-draw value comparison')
    verify_broadcast(probe, definition, helpers=h)


def _reciprocal_prefix(proof, fixture, cases, stop, reciprocal, h):
    require = h['require']
    vectors = {entry['name']: entry for entry in fixture['reciprocalVectors']}
    for field, vertex, cross in [('reciprocalVertexProbes', True, False),
                                ('reciprocalFragmentProbes', False, False), ('reciprocalCrossProbes', False, True)]:
        for probe, definition in zip(proof[field], fixture['reciprocalPrograms'][:stop]):
            v = definition['vertex'] if vertex else 'legacy-vertex'
            f = 'legacy-fragment' if vertex else definition['cross' if cross else 'fragment']
            require(probe['vertex'] == v and probe['fragment'] == f and probe['oracle'] == definition['oracle']
                    and probe['broadcastGroups'] == definition['broadcastGroups'], 'preceding reciprocal program identity')
            h['program'](probe, cases[v]['result'], cases[f]['result'])
            if vertex:
                _feedback(probe, require)
            require([entry['name'] for entry in probe['vectors']] == definition['vectors'],
                    'complete preceding reciprocal dynamic vectors')
            for entry in probe['vectors']:
                source = vectors[entry['name']]
                require(all(entry[key] == value for key, value in source.items()), 'actual preceding reciprocal inputs')
                expected = reciprocal.reciprocal_oracle(definition['oracle'], source, helpers=h)
                require(entry['oracle'] == expected, 'independent preceding reciprocal numerical enclosure')
                h['attributes'](entry['attributes'], source, vertex)
                h['uniforms'](probe, entry, source, expected)
                if vertex:
                    reciprocal.verify_vertex(entry, expected, helpers=h)
                else:
                    reciprocal.verify_fragment(entry, expected, cross=cross, helpers=h)


def _reciprocal_failure(proof, mode, definition, fixture, cases, mutated, h):
    require, oracle = h['require'], h['oracle']
    reciprocal = _load('scalar_browser_reciprocal', 'reciprocal_receipt.py')
    names = [item['name'] for item in fixture['numericPrograms']]
    reciprocal_names = [item['name'] for item in fixture['reciprocalPrograms']]
    stop = reciprocal_names.index(definition['name'])
    require([probe['name'] for probe in proof['vertexProbes']] == names
            and [probe['name'] for probe in proof['fragmentProbes']] == names
            and [probe['name'] for probe in proof['crossConsumerProbes']] == names[:-1]
            and [probe['name'] for probe in proof['reciprocalVertexProbes']] == reciprocal_names[:stop + 1]
            and [probe['name'] for probe in proof['reciprocalFragmentProbes']] == reciprocal_names[:stop]
            and [probe['name'] for probe in proof['reciprocalCrossProbes']] == reciprocal_names[:stop],
            'reciprocal mutation reaches only the intended quantitative workload')
    _exact_prefix(proof, fixture, cases, len(names), h)
    _reciprocal_prefix(proof, fixture, cases, stop, reciprocal, h)
    probe = proof['reciprocalVertexProbes'][-1]
    require(probe['vertex'] == definition['vertex'] and probe['fragment'] == 'legacy-fragment'
            and probe['oracle'] == definition['oracle'] and probe['broadcastGroups'] == definition['broadcastGroups'],
            'actual corrupted reciprocal vertex identity')
    h['program'](probe, {'glsl': mutated}, cases['legacy-fragment']['result'])
    _feedback(probe, require)
    source = next(item for item in fixture['reciprocalVectors'] if item['name'] == definition['vectors'][0])
    require(len(probe['vectors']) == 1, 'first authored reciprocal input detects the altered operation')
    entry = probe['vectors'][0]
    require(all(entry[key] == value for key, value in source.items()), 'actual reciprocal sabotage operands')
    expected = reciprocal.reciprocal_oracle(definition['oracle'], source, helpers=h)
    require(entry['oracle'] == expected, 'independent original reciprocal enclosures and outward upload bounds')
    h['attributes'](entry['attributes'], source, True)
    h['uniforms'](probe, entry, source, expected)
    require(len(entry['captures']) == 1, 'failure follows the first actual feedback capture')
    reciprocal.verify_vertex(entry, expected, failure=True, helpers=h)
    words = entry['captures'][0]['observedBits'][4:8]
    # Independent source witnesses explain the mutation without asserting an
    # exact reciprocal/root word merely because its mathematical value is known.
    if mode == 'rcp-source':
        wrong = oracle.rcp_bounds(Fraction(source['a'][0]))
        require(all(reciprocal.reciprocal_observation(wrong, word, helpers=h)['withinEnclosure']
                    for word in words), 'captured altered reciprocal uses the independently identified source x')
    else:
        require(Fraction(source['a'][2]) == 5 and all(2 < oracle.decode(word) < 3 for word in words),
                'captured substituted sqrt lies between 2 and 3, disjoint from the inverse-root enclosure')
    require('observedWords' not in entry and 'rawObservations' not in entry,
            'failed first capture cannot claim a full raw reconstruction')
    require(proof['failure']['message'] ==
            f"{definition['name']}/{source['name']} ordinary reciprocal feedback outside rational enclosure",
            'reported reciprocal failure is the actual post-draw rational comparison')
