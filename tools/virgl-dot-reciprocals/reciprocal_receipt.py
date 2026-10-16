"""Independent scalar reciprocal enclosures, replication and recorded observations.

RCP accuracy uses rational division bounds; RSQ uses integer-square-root bounds.
Only authored quantitative witnesses are range-limited. Undefined exceptional
results carry no payload, zero-sign, subnormal-retention or cross-stage promise.
"""
from fractions import Fraction
import importlib.util
from pathlib import Path


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


_capture_helpers = _load('scalar_prior_capture_helpers', Path(__file__).parents[1] / 'virgl-component-floats/division_receipt.py')


def _helpers(helpers):
    if helpers is None:
        return vars(_load('scalar_reciprocal_main_helpers', Path(__file__).with_name('receipt.py')))
    return helpers if isinstance(helpers, dict) else vars(helpers)


def _fraction(value):
    return Fraction(int(value['numerator']), int(value['denominator']))


def _groups(groups, h):
    h['require'](type(groups) is list and groups and all(type(group) is list and group
                 and all(type(lane) is int and 0 <= lane < 4 for lane in group) for group in groups)
                 and len({lane for group in groups for lane in group}) == sum(map(len, groups)),
                 'bounded disjoint nonempty scalar replication groups')


def _broadcast(words, groups, h):
    _groups(groups, h)
    h['require'](len(words) == 4 and all(all(words[lane] == words[group[0]] for lane in group) for group in groups),
                 'one scalar result is replicated identically in every written group')


def enclosure_oracle(inputs, broadcastGroups, *, helpers=None):
    """Build the same independently bounded lane record for attributes or texels."""
    h = _helpers(helpers)
    oracle, require = h['oracle'], h['require']
    require(len(inputs) == 4, 'four independently derived source/result lanes')
    _groups(broadcastGroups, h)
    lanes = []
    for entry in inputs:
        require(set(entry) == {'kind', 'value'}, 'explicit independently derived scalar lane kind/value')
        value = Fraction(entry['value'])
        if entry['kind'] == 'rcp':
            lane = oracle.rcp_bounds(value)
        elif entry['kind'] == 'rsq':
            lane = oracle.rsq_bounds(value)
        else:
            require(entry['kind'] == 'exact' and oracle.decode(oracle.word(value)) == value,
                    'untouched or exact-control lane is actual binary32')
            lane = {'kind': 'exact', 'value': oracle.rational(value), 'word': oracle.word(value)}
        lanes.append(lane)
    for group in broadcastGroups:
        require(all(lanes[index] == lanes[group[0]] for index in group), 'replicated lanes share the same independent scalar oracle')
    bounds = {}
    for name, upper, factor in (('lower', False, 1), ('upper', True, 1),
                                ('doubledLower', False, 2), ('doubledUpper', True, 2)):
        bounds[name] = [oracle.outward_word(factor * _fraction(lane['value'] if lane.get('kind') == 'exact'
                       else lane['upper' if upper else 'lower']), upper) for lane in lanes]
    return {'kind': 'reciprocal-enclosure', 'lanes': lanes,
            'broadcastGroups': broadcastGroups, 'boundWords': bounds}


expected_oracle = enclosure_oracle


def reciprocal_oracle(operation, vector, *, helpers=None):
    h = _helpers(helpers)
    groups = {'rcp-alias-w': [[3]], 'rsq-alias-xy': [[0, 1]]}.get(operation, [[0, 1, 2, 3]])
    return enclosure_oracle(h['oracle'].reciprocal_inputs(operation, vector), groups, helpers=h)


def reciprocal_observation(lane, word, *, helpers=None):
    """Derive actual class/error and success or failure without trusting claims."""
    h = _helpers(helpers)
    oracle = h['oracle']
    kind = oracle.classify(word)
    result = dict(lane, observedWord=word, classification=kind)
    if lane.get('kind') == 'exact':
        if kind not in ('nan', 'infinity'):
            value = oracle.decode(word)
            result.update(observedValue=oracle.rational(value), error=oracle.rational(value - _fraction(lane['value'])))
        result['withinEnclosure'] = word in oracle.exact_words(_fraction(lane['value']))
    elif kind != 'normal':
        result['withinEnclosure'] = False
    else:
        value = oracle.decode(word)
        result['observedValue'] = oracle.rational(value)
        if lane.get('kind') == 'rsq':
            result.update(errorLower=oracle.rational(value - _fraction(lane['rootUpper'])),
                          errorUpper=oracle.rational(value - _fraction(lane['rootLower'])))
        else:
            result['error'] = oracle.rational(value - _fraction(lane['quotient']))
        result['withinEnclosure'] = _fraction(lane['lower']) <= value <= _fraction(lane['upper'])
    return result


def verify_vertex(entry, expected, failure=False, *, helpers=None):
    """Check complete captures, or one final deliberately failing capture."""
    h = _helpers(helpers)
    require = h['require']
    require(1 <= len(entry['captures']) <= 4 and (failure or len(entry['captures']) == 4),
            'complete bounded actual reciprocal vertex capture sequence')
    reconstructed, mismatches = [0] * 4, 0
    for shift, capture in zip((0, 8, 16, 24), entry['captures']):
        h['selector'](capture, shift)
        numeric, decoded = _capture_helpers._capture(capture, h)
        _broadcast(numeric, expected['broadcastGroups'], h)
        observations = [reciprocal_observation(lane, word, helpers=h) for lane, word in zip(expected['lanes'], numeric)]
        failed = [index for index, observation in enumerate(observations) if not observation['withinEnclosure']]
        require(capture['guard'] == [0xa5] * 16 and capture['decodedBytes'] == decoded
                and capture['numericObservations'] == observations, 'actual reciprocal numeric/error records and exact raw carriers')
        if failed:
            require(failure and capture is entry['captures'][-1] and capture['failure'] == {'lanes': failed},
                    'only the final intentional capture contradicts independent reciprocal bounds')
            mismatches += 1
        else:
            require('failure' not in capture, 'successful reciprocal capture has no fabricated failure')
        for lane, value in enumerate(decoded):
            reconstructed[lane] += value * (2 ** shift)
    if failure:
        require(mismatches == 1 and 'observedWords' not in entry and 'rawObservations' not in entry,
                'deliberate failure records its actual stopping point before full word reconstruction')
    else:
        _broadcast(reconstructed, expected['broadcastGroups'], h)
        observations = [reciprocal_observation(lane, word, helpers=h) for lane, word in zip(expected['lanes'], reconstructed)]
        require(entry['observedWords'] == reconstructed and entry['rawObservations'] == observations
                and all(observation['withinEnclosure'] for observation in observations),
                'every reconstructed raw reciprocal word satisfies its independent bound or untouched exact value')
    return mismatches


def verify_fragment(entry, expected, cross=False, *, helpers=None):
    """Check full raw bitplanes or one ordinary/raw bound-mask draw."""
    h = _helpers(helpers)
    require = h['require']
    if cross:
        require(entry['draws'] == [{'selector': None, 'selectorUpload': None,
                'observedBytes': [255] * 4, 'expectedBytes': [255] * 4}],
                'all lanes satisfy the actual raw and doubled ordinary bound-mask consumers')
        require(not {'captures', 'observedWords', 'rawObservations'} & set(entry),
                'cross consumer cannot claim uncaptured numeric feedback or raw words')
        return
    require(len(entry['draws']) == 32, 'every actual reciprocal fragment bitplane')
    reconstructed, pixels = [0] * 4, bytearray()
    for bit, draw in enumerate(entry['draws']):
        h['selector'](draw, bit)
        values = draw['observedBytes']
        require(len(values) == 4 and all(type(value) is int and value in (0, 255) for value in values),
                'reciprocal fragment output is four actual bitplane endpoints')
        pixels.extend(values)
        for lane, value in enumerate(values):
            reconstructed[lane] += (value // 255) * (2 ** bit)
    _broadcast(reconstructed, expected['broadcastGroups'], h)
    observations = [reciprocal_observation(lane, word, helpers=h) for lane, word in zip(expected['lanes'], reconstructed)]
    require(entry['bitPlaneBytesSha256'] == h['sha'](pixels) and entry['observedWords'] == reconstructed
            and entry['rawObservations'] == observations and all(record['withinEnclosure'] for record in observations),
            'complete raw reciprocal fragment word reconstruction and independently derived rational errors')


def verify_reciprocals(proof, fixture, cases, *, helpers=None):
    h = _helpers(helpers)
    require, oracle = h['require'], h['oracle']
    definitions = {entry['name']: entry for entry in fixture['reciprocalPrograms']}
    vectors = {entry['name']: entry for entry in fixture['reciprocalVectors']}
    require(list(definitions) == ['rcp', 'rcp-alias-w', 'rcp-negate-shadow', 'rsq', 'rsq-alias-xy', 'rsq-safe']
            and list(vectors) == ['distinct', 'squares', 'powers'], 'complete scalar reciprocal program/input inventory')
    counts = {'exactWords': 0, 'boundedWords': 0, 'crossDraws': 0}
    for key, vertex, cross in [('reciprocalVertexProbes', True, False), ('reciprocalFragmentProbes', False, False),
                               ('reciprocalCrossProbes', False, True)]:
        probes = [entry for entry in proof[key] if entry['name'] in definitions]
        require([entry['name'] for entry in probes] == list(definitions), 'complete ordered quantitative reciprocal workload')
        for probe in probes:
            definition = definitions[probe['name']]
            v = definition['vertex'] if vertex else 'legacy-vertex'
            f = 'legacy-fragment' if vertex else definition['cross' if cross else 'fragment']
            operation = definition['oracle']
            groups = {'rcp-alias-w': [[3]], 'rsq-alias-xy': [[0, 1]]}.get(operation, [[0, 1, 2, 3]])
            require(operation == definition['name'] and probe['oracle'] == operation and probe['vertex'] == v
                    and probe['fragment'] == f and probe['broadcastGroups'] == definition['broadcastGroups'] == groups,
                    'exact scalar operation, source program and independently derived written-lane groups')
            h['program'](probe, cases[v]['result'], cases[f]['result'])
            if vertex:
                _capture_helpers._feedback(probe, h)
            else:
                require(probe['width'] == probe['height'] == 1, 'actual reciprocal one-pixel framebuffer')
            require([entry['name'] for entry in probe['vectors']] == definition['vectors'] == list(vectors),
                    'all three authored lane-distinguishing reciprocal inputs')
            for entry in probe['vectors']:
                source = vectors[entry['name']]
                require(all(entry[key] == value for key, value in source.items()), 'exact authored reciprocal source operands')
                require(all(Fraction(value) == oracle.decode(oracle.word(value))
                            for field in ('a', 'b', 'c') for value in source[field]),
                        'rational witness values equal actual binary32 attribute operands')
                expected = reciprocal_oracle(operation, source, helpers=h)
                require(entry['oracle'] == expected, 'independent RCP/RSQ root or division enclosures and directed uniform endpoints')
                h['attributes'](entry['attributes'], source, vertex)
                h['uniforms'](probe, entry, source, expected)
                if vertex:
                    verify_vertex(entry, expected, helpers=h)
                else:
                    verify_fragment(entry, expected, cross, helpers=h)
                if cross:
                    counts['crossDraws'] += 1
                else:
                    for lane in expected['lanes']:
                        counts['exactWords' if lane.get('kind') == 'exact' else 'boundedWords'] += 1
    require(counts == {'exactWords': 30, 'boundedWords': 114, 'crossDraws': 18}, 'derived complete reciprocal lane/draw counts')
    return counts


def verify_observations(proof, fixture, cases, *, helpers=None):
    h = _helpers(helpers)
    require, oracle = h['require'], h['oracle']
    definitions = fixture['observationPrograms']
    vectors = {entry['name']: entry for entry in fixture['observationVectors']}
    require([entry['name'] for entry in definitions] == ['dp3', 'rcp', 'rsq'] and
            list(vectors) == ['zero-boundaries', 'exceptional-negative', 'subnormal-nonpositive'],
            'complete scalar exceptional operation/input inventory')
    sequence = [(definition, stage) for definition in definitions for stage in ('vertex', 'fragment')]
    require([(probe['name'], probe['stage']) for probe in proof['observationProbes']] ==
            [(definition['name'], stage) for definition, stage in sequence], 'complete scalar special observation program sequence')
    counts = {'words': 0, 'probes': 0, 'vectors': 0, 'requiredRawClassChecks': 0, 'requiredNumericClassChecks': 0}
    for probe, (definition, stage) in zip(proof['observationProbes'], sequence):
        vertex = stage == 'vertex'
        v, f = (definition['vertex'], 'legacy-fragment') if vertex else ('legacy-vertex', definition['fragment'])
        require(probe['vertex'] == v and probe['fragment'] == f and probe['claim'] ==
                'Ordinary ESSL observations; no NaN payload, computed zero sign or subnormal retention promise.',
                'actual scalar exceptional program identity and explicitly bounded claim')
        h['program'](probe, cases[v]['result'], cases[f]['result'])
        if vertex:
            _capture_helpers._feedback(probe, h)
        require([entry['name'] for entry in probe['vectors']] == definition['vectors'] == list(vectors),
                'complete scalar exceptional dynamic vector sequence')
        counts['probes'] += 1
        for entry in probe['vectors']:
            source = vectors[entry['name']]
            require(all(entry[key] == value for key, value in source.items()), 'exact authored scalar exceptional input words')
            _capture_helpers._word_attributes(entry['attributes'], source, vertex, h)
            h['uniforms'](probe, entry, {'condition': [0] * 4, 'raw': [0] * 4},
                          {'words': [0] * 4, 'doubledWords': [0] * 4})
            # The authored RCP is scalar 1 / IN[1].y. Signed zero may lose its
            # sign, but the specified highp nonzero/zero class is infinity.
            required = ['infinity' if definition['name'] == 'rcp' and oracle.classify(source['aWords'][1]) == 'zero'
                        else None] * 4
            shifts = (0, 8, 16, 24) if vertex else tuple(range(32))
            require(len(entry['observations']) == len(shifts), 'complete scalar exceptional byte/bit capture sequence')
            reconstructed = [0] * 4
            for shift, capture in zip(shifts, entry['observations']):
                h['selector'](capture, shift)
                if vertex:
                    numeric, decoded = _capture_helpers._capture(capture, h)
                    classes = [oracle.classify(word) for word in numeric]
                    require(capture['numericClasses'] == classes, 'ordinary exceptional numeric words independently classified')
                    for actual, expected in zip(classes, required):
                        if expected is not None:
                            require(actual == expected, 'specified ordinary scalar RCP zero-divisor infinity class')
                            counts['requiredNumericClassChecks'] += 1
                else:
                    data = bytes(capture['rawBytes'])
                    require(len(data) == 4 and all(value in (0, 255) for value in data)
                            and capture['bytesSha256'] == h['sha'](data), 'actual exceptional fragment bitplanes and digest')
                    require('observedBits' not in capture and 'numericClasses' not in capture,
                            'fragment bitplanes do not invent ordinary feedback')
                    decoded = [value // 255 for value in data]
                require(capture['decoded'] == decoded, 'actual exceptional carriers independently decoded')
                for lane, value in enumerate(decoded):
                    reconstructed[lane] += value * (2 ** shift)
            classes = [oracle.classify(word) for word in reconstructed]
            require(entry['observedWords'] == reconstructed and entry['classifications'] == classes
                    and entry['requiredClasses'] == required, 'all raw scalar exceptional words and justified class requirements')
            for actual, expected in zip(classes, required):
                if expected is not None:
                    require(actual == expected, 'specified captured scalar RCP zero-divisor infinity class')
                    counts['requiredRawClassChecks'] += 1
            counts['words'] += 4
            counts['vectors'] += 1
    require(counts == {'words': 72, 'probes': 6, 'vectors': 18,
                      'requiredRawClassChecks': 8, 'requiredNumericClassChecks': 16}, 'derived complete scalar exceptional observation counts')
    return counts
