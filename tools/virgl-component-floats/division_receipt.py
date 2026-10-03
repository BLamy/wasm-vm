"""Independent rational DIV enclosures and byte-bound special-value observations.

The quantitative ranges apply to these authored accuracy witnesses only. Special
values are recorded and classified without inventing payload, zero-sign,
subnormal-retention, or cross-stage equality requirements.
"""
from fractions import Fraction
import importlib.util
from pathlib import Path
import struct


def _helpers(helpers):
    if helpers is not None:
        return helpers
    spec = importlib.util.spec_from_file_location(
        'component_division_helpers', Path(__file__).with_name('receipt.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return vars(result)


def _fraction(record):
    return Fraction(int(record['numerator']), int(record['denominator']))


def division_oracle(operation, vector, *, helpers=None):
    """Rebuild all four source lanes and directed upload endpoints."""
    h = _helpers(helpers)
    oracle = h['oracle']
    lanes = []
    for source in oracle.division_inputs(operation, vector):
        if source['kind'] == 'exact':
            value = source['value']
            lanes.append({'kind': 'exact', 'value': oracle.rational(value), 'word': oracle.word(value)})
        else:
            lanes.append(oracle.division_bounds(source['a'], source['b']))
    bounds = {}
    for name, upper, factor in (('lower', False, 1), ('upper', True, 1),
                                ('doubledLower', False, 2), ('doubledUpper', True, 2)):
        bounds[name] = [oracle.outward_word(factor * _fraction(lane['value'] if lane.get('kind') == 'exact'
                       else lane['upper' if upper else 'lower']), upper) for lane in lanes]
    return {'kind': 'division-enclosure', 'lanes': lanes, 'boundWords': bounds}


def division_observation(lane, word, *, helpers=None):
    """Derive the actual error and class, including a false enclosure outcome."""
    h = _helpers(helpers)
    oracle = h['oracle']
    kind = oracle.classify(word)
    result = dict(lane, observedWord=word, classification=kind)
    if lane.get('kind') == 'exact':
        if kind not in ('nan', 'infinity'):
            value = oracle.decode(word)
            result.update(observedValue=oracle.rational(value),
                          error=oracle.rational(value - _fraction(lane['value'])))
        result['withinEnclosure'] = word in oracle.exact_words(_fraction(lane['value']))
    elif kind == 'normal':
        value = oracle.decode(word)
        result.update(observedValue=oracle.rational(value),
                      error=oracle.rational(value - _fraction(lane['quotient'])),
                      withinEnclosure=_fraction(lane['lower']) <= value <= _fraction(lane['upper']))
    else:
        result['withinEnclosure'] = False
    return result


def _uniforms(probe, entry, vector, expected, vertex, result, h):
    require = h['require']
    prefix = 'vs' if vertex else 'fs'
    uniforms = result['metadata']['uniforms']
    require(len(uniforms) == 1 and uniforms[0]['name'] == prefix + 'const0'
            and uniforms[0]['count'] == 46 and uniforms[0]['type'] == 'uvec4[]'
            and uniforms[0]['encoding'] == 'float32-bits', 'exact DIV/observation raw constant ABI')
    reflection = probe['uniformReflection']
    count = reflection['activeCount']
    require(reflection['name'] == prefix + 'const0[0]' and reflection['declaredCount'] == 46
            and type(count) is int and 0 < count <= 46 and reflection['type'] == 36296
            and type(reflection['index']) is int and 0 <= reflection['index'] < 0xffffffff,
            'actual bounded unsigned-vector uniform reflection')
    inputs = {0: vector['condition'], 1: vector.get('directCondition', [1] * 4)}
    if 'boundWords' in expected:
        bounds = expected['boundWords']
        inputs.update({40: bounds['doubledUpper'], 41: bounds['doubledLower'],
                       42: bounds['upper'], 43: bounds['lower']})
    else:
        inputs.update({42: expected['doubledWords'], 43: expected['words']})
    inputs.update({44: [0] * 4, 45: vector['raw']})
    words, slots = [0] * (count * 4), []
    for index, values in inputs.items():
        if index < count:
            words[index * 4:index * 4 + 4] = values
            slots.append({'index': index, 'words': values, 'observed': values})
    require(entry['upload'] == {'wordCount': len(words), 'words': words, 'slots': slots},
            'every actual uniform upload/readback equals independently derived endpoint or input words')


def _feedback(probe, h):
    names = ['gl_Position', 'vso_g5', 'vso_g6']
    h['require'](probe['varyings'] == names and probe['feedbackReflection'] ==
                 [{'name': name, 'size': 1, 'type': 35666} for name in names],
                 'actual position, ordinary-result and raw-carrier feedback ABI')


def _capture(capture, h):
    require = h['require']
    data = bytes(capture['rawBytes'])
    require(len(data) == 64 and data[48:] == bytes([0xa5] * 16)
            and capture['bytesSha256'] == h['sha'](data), 'complete feedback bytes and untouched range guard')
    words = list(struct.unpack('<12I', data[:48]))
    require(capture['observedBits'] == words
            and words[:4] == [0x3e800000, 0x3f000000, 0xbe800000, 0x3f800000],
            'actual feedback words and exact position')
    carriers = words[8:]
    require(all(0x3f000000 <= word <= 0x3f7f8000 and (word - 0x3f000000) % 32768 == 0
                for word in carriers), 'all four raw-byte carriers are exact finite encodings')
    return words[4:8], [(word - 0x3f000000) // 32768 for word in carriers]


def verify_division(proof, fixture, cases, *, helpers=None):
    h = _helpers(helpers)
    require = h['require']
    definitions = fixture['divisionPrograms']
    vectors = {entry['name']: entry for entry in fixture['divisionVectors']}
    require([entry['name'] for entry in definitions] == ['div', 'div-alias'] and
            list(vectors) == ['interior', 'powers', 'wide-division'], 'complete authored quantitative DIV families')
    counts = {'exactWords': 0, 'boundedWords': 0, 'crossDraws': 0}
    for key, vertex, cross in (('divisionVertexProbes', True, False),
                               ('divisionFragmentProbes', False, False), ('divisionCrossProbes', False, True)):
        probes = proof[key]
        require([probe['name'] for probe in probes] == [entry['name'] for entry in definitions],
                'complete quantitative DIV program sequence')
        for probe, definition in zip(probes, definitions):
            v = definition['vertex'] if vertex else 'legacy-vertex'
            f = 'legacy-fragment' if vertex else definition['cross' if cross else 'fragment']
            require(probe['vertex'] == v and probe['fragment'] == f and probe['oracle'] == definition['oracle']
                    and definition['oracle'] == definition['name'], 'source-bound DIV program and oracle identity')
            h['program'](probe, cases[v]['result'], cases[f]['result'])
            if vertex:
                _feedback(probe, h)
            else:
                require(probe['width'] == probe['height'] == 1, 'actual DIV one-pixel framebuffer')
            require([entry['name'] for entry in probe['vectors']] == definition['vectors'] == list(vectors),
                    'every quantitative dynamic DIV vector in exact order')
            for entry in probe['vectors']:
                source = vectors[entry['name']]
                require(all(entry[key] == value for key, value in source.items()), 'exact authored quantitative DIV inputs')
                require(all(Fraction(value) == h['oracle'].decode(h['oracle'].word(value))
                            for field in ('a', 'b', 'c') for value in source[field]),
                        'quantitative rational inputs equal the actual uploaded binary32 values')
                expected = division_oracle(definition['oracle'], source, helpers=h)
                require(entry['oracle'] == expected, 'independent rational DIV lanes and outward-rounded upload bounds')
                h['attributes'](entry['attributes'], source, vertex)
                _uniforms(probe, entry, source, expected, vertex, cases[v if vertex else f]['result'], h)
                reconstructed = [0] * 4
                if vertex:
                    require(len(entry['captures']) == 4, 'all four actual DIV byte captures')
                    for shift, capture in zip((0, 8, 16, 24), entry['captures']):
                        h['selector'](capture, shift)
                        numeric_words, decoded = _capture(capture, h)
                        observations = [division_observation(lane, word, helpers=h)
                                        for lane, word in zip(expected['lanes'], numeric_words)]
                        require(capture['guard'] == [0xa5] * 16 and capture['decodedBytes'] == decoded
                                and capture['numericObservations'] == observations
                                and all(record['withinEnclosure'] for record in observations)
                                and 'failure' not in capture, 'actual ordinary DIV captures satisfy independent rational enclosures')
                        for lane, value in enumerate(decoded):
                            reconstructed[lane] += value * (2 ** shift)
                elif cross:
                    require(entry['draws'] == [{'selector': None, 'selectorUpload': None,
                            'observedBytes': [255] * 4, 'expectedBytes': [255] * 4}],
                            'all four same-lane raw and doubled ordinary bound masks select white')
                    counts['crossDraws'] += 1
                    continue
                else:
                    require(len(entry['draws']) == 32, 'all32 actual DIV fragment bitplanes')
                    pixels = bytearray()
                    for bit, draw in enumerate(entry['draws']):
                        h['selector'](draw, bit)
                        values = draw['observedBytes']
                        require(len(values) == 4 and all(type(value) is int and value in (0, 255) for value in values),
                                'actual DIV fragment bitplane endpoints')
                        pixels.extend(values)
                        for lane, value in enumerate(values):
                            reconstructed[lane] += (value // 255) * (2 ** bit)
                    require(entry['bitPlaneBytesSha256'] == h['sha'](pixels), 'complete DIV bitplane byte digest')
                observations = [division_observation(lane, word, helpers=h)
                                for lane, word in zip(expected['lanes'], reconstructed)]
                require(entry['observedWords'] == reconstructed and entry['rawObservations'] == observations
                        and all(record['withinEnclosure'] for record in observations),
                        'all reconstructed raw DIV words satisfy independently computed errors and enclosures')
                for lane in expected['lanes']:
                    counts['exactWords' if lane.get('kind') == 'exact' else 'boundedWords'] += 1
    require(counts == {'exactWords': 6, 'boundedWords': 42, 'crossDraws': 6}, 'derived complete DIV evidence counts')
    return counts


def _word_attributes(entries, vector, vertex, h):
    require = h['require']
    positions = [.25, .5, -.25, 1] if vertex else [-1, -1, 0, 1, 3, -1, 0, 1, -1, 3, 0, 1]
    expected = [[h['oracle'].word(value) for value in positions]]
    expected += [vector[key] * (1 if vertex else 3) for key in ('aWords', 'bWords', 'cWords')]
    require(len(entries) == 4, 'every special-value input attribute')
    for index, (entry, words) in enumerate(zip(entries, expected)):
        require(entry['name'] == f'in_{index}' and entry['inputWords'] == words
                and type(entry['location']) is int and entry['active'] is (entry['location'] >= 0),
                'actual special-value attribute identity and complete raw input words')
        if entry['active']:
            require(entry['uploadedWords'] == words, 'actual upload preserves authored signed zeros and exceptional payload bytes')
        else:
            require('uploadedWords' not in entry, 'inactive attribute cannot claim an upload')
    require(entries[0]['active'], 'actual position attribute binding')


def verify_observations(proof, fixture, cases, *, helpers=None):
    h = _helpers(helpers)
    require, oracle = h['require'], h['oracle']
    definitions = fixture['observationPrograms']
    vectors = {entry['name']: entry for entry in fixture['observationVectors']}
    require([entry['name'] for entry in definitions] == ['div', 'max', 'frc', 'lrp']
            and list(vectors) == ['zero-boundaries', 'exceptional', 'subnormal-negative-denominator'],
            'complete authored special-value operation and input inventory')
    sequence = [(definition, stage) for definition in definitions for stage in ('vertex', 'fragment')]
    require([(entry['name'], entry['stage']) for entry in proof['observationProbes']] ==
            [(definition['name'], stage) for definition, stage in sequence], 'every special-value program and stage recorded')
    counts = {'words': 0, 'probes': 0, 'vectors': 0, 'requiredRawClassChecks': 0, 'requiredNumericClassChecks': 0}
    for probe, (definition, stage) in zip(proof['observationProbes'], sequence):
        vertex = stage == 'vertex'
        v, f = (definition['vertex'], 'legacy-fragment') if vertex else ('legacy-vertex', definition['fragment'])
        require(probe['vertex'] == v and probe['fragment'] == f and probe['claim'] ==
                'Ordinary ESSL observations; no NaN payload, computed zero sign or subnormal retention promise.',
                'exact special-value program identity and explicit observation boundary')
        h['program'](probe, cases[v]['result'], cases[f]['result'])
        if vertex:
            _feedback(probe, h)
        require([entry['name'] for entry in probe['vectors']] == definition['vectors'] == list(vectors),
                'complete special-value dynamic input sequence')
        counts['probes'] += 1
        for entry in probe['vectors']:
            source = vectors[entry['name']]
            require(all(entry[key] == value for key, value in source.items()), 'exact authored special-value input words')
            _word_attributes(entry['attributes'], source, vertex, h)
            _uniforms(probe, entry, {'condition': [0] * 4, 'raw': [0] * 4},
                      {'words': [0] * 4, 'doubledWords': [0] * 4}, vertex, cases[v if vertex else f]['result'], h)
            # Only highp finite normal nonzero / zero has a required class here.
            # No sign assertion is justified when an implementation may ignore
            # zero's sign; the other exceptional cases are observations only.
            required = ['infinity' if definition['name'] == 'div' and oracle.classify(a) == 'normal'
                        and oracle.classify(b) == 'zero' else None
                        for a, b in zip(source['aWords'], source['bWords'])]
            shifts = (0, 8, 16, 24) if vertex else tuple(range(32))
            require(len(entry['observations']) == len(shifts), 'complete special-value byte or bitplane sequence')
            reconstructed = [0] * 4
            for shift, capture in zip(shifts, entry['observations']):
                h['selector'](capture, shift)
                if vertex:
                    numeric_words, decoded = _capture(capture, h)
                    classes = [oracle.classify(word) for word in numeric_words]
                    require(capture['numericClasses'] == classes, 'actual ordinary exceptional words independently classified')
                    for actual, expected in zip(classes, required):
                        if expected is not None:
                            require(actual == expected, 'specified highp nonzero/zero ordinary DIV infinity class')
                            counts['requiredNumericClassChecks'] += 1
                else:
                    data = bytes(capture['rawBytes'])
                    require(len(data) == 4 and all(value in (0, 255) for value in data)
                            and capture['bytesSha256'] == h['sha'](data), 'actual exceptional fragment bitplane and digest')
                    require('observedBits' not in capture and 'numericClasses' not in capture,
                            'fragment bitplanes cannot claim uncaptured ordinary feedback')
                    decoded = [value // 255 for value in data]
                require(capture['decoded'] == decoded, 'independently decoded actual special-value carriers')
                for lane, value in enumerate(decoded):
                    reconstructed[lane] += value * (2 ** shift)
            classes = [oracle.classify(word) for word in reconstructed]
            require(entry['observedWords'] == reconstructed and entry['classifications'] == classes
                    and entry['requiredClasses'] == required, 'complete raw exceptional words and justified class requirements')
            for actual, expected in zip(classes, required):
                if expected is not None:
                    require(actual == expected, 'specified highp nonzero/zero captured raw DIV infinity class')
                    counts['requiredRawClassChecks'] += 1
            counts['words'] += len(reconstructed)
            counts['vectors'] += 1
    require(counts == {'words': 96, 'probes': 8, 'vectors': 24,
                      'requiredRawClassChecks': 4, 'requiredNumericClassChecks': 8}, 'derived complete special observation counts')
    return counts
