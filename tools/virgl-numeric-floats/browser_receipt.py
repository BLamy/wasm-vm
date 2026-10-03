"""Independent byte-level orientation and deliberate numeric-GPU fault checks.

Call with ``helpers=globals()`` from receipt.py. The optional lazy loader supports
standalone preview checks without an eager import cycle. ``verify_sabotage`` takes
the directory containing a failing report.json and the complete clean outer report;
its cases map is the native shared-case map, including the hardware shader entries.
Outer recording/source bindings and native/Wasm parity remain receipt.py's job.
"""
import importlib.util
from pathlib import Path
import re
import struct


def _helpers(helpers):
    if helpers is not None:
        return helpers
    spec = importlib.util.spec_from_file_location(
        'numeric_browser_receipt_helpers', Path(__file__).with_name('receipt.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return vars(result)


def _feedback(probe, require):
    names = ['gl_Position', 'vso_g5', 'vso_g6']
    require(probe['varyings'] == names and probe['feedbackReflection'] ==
            [{'name': name, 'size': 1, 'type': 35666} for name in names],
            'actual position, ordinary-result and byte-carrier FLOAT_VEC4 feedback')


def _cleanup(proof, require):
    objects = proof['objects']
    require(objects['live'] == 0 and objects['created'] == objects['deleted']
            and all(isinstance(count, int) and count > 0 for count in objects['created'].values()),
            'every actual GL object is released after the deliberate failure')


def verify_orientation(proof, cases, *, helpers=None):
    """Check two real 48-byte feedback captures against rational numeric values."""
    h = _helpers(helpers)
    require, sha, oracle = h['require'], h['sha'], h['oracle']
    path = h['ROOT'] / 'renderer/virgl-shader/tests/numeric-float-hardware.json'
    require(proof['hardwareFixture'] == h['binding'](path), 'orientation fixture source binding')
    fixture = h['read'](path)
    source = next(vector for vector in fixture['numericVectors'] if vector['name'] == 'eighths')
    probe = proof['orientation']
    require(probe['vertex'] == 'numeric-chain-vertex' and probe['fragment'] == 'legacy-fragment'
            and probe['vector'] == source, 'literal orientation program and dynamic inputs')
    h['program'](probe, cases[probe['vertex']]['result'], cases[probe['fragment']]['result'])
    _feedback(probe, require)
    expected = h['rational_record'](oracle.numeric('chain', source))
    require(probe['oracle'] == expected, 'independent orientation numeric result')
    h['attributes'](probe['attributes'], source, True)
    h['uniforms'](probe, probe, source, expected)
    h['selector']({'selector': 0, 'selectorUpload': probe['selectorUpload']}, 0)
    require([capture['adjust'] for capture in probe['captures']] == [-1, 1],
            'both actual system orientation settings')
    for capture in probe['captures']:
        adjust = capture['adjust']
        uniform_word = oracle.word(adjust)
        require(capture['uniformUpdate'] == {'offset': 640, 'expectedBits': [uniform_word],
                'observedBits': [uniform_word]}, 'actual UBO write/readback at the reflected member offset')
        words = [oracle.word(value) for value in [.25, .5 * adjust, -.25, 1]]
        words += expected['words'] + [0x3f000000 + (word % 256) * 32768 for word in expected['words']]
        data = bytes(capture['rawBytes'])
        require(len(data) == 48 and capture['bytesSha256'] == sha(data)
                and list(struct.unpack('<12I', data)) == words
                and capture['expectedBits'] == capture['observedBits'] == words,
                'actual orientation bytes flip only nonzero position Y and preserve both numeric representations')
    return 2


def _mutation(mode, original, require):
    definitions = {
        'stale-shadow': (r'float_temp\[9\]\.xyzw = float_rhs\.xyzw;',
                         'float_temp[9].xyzw = float_temp[117].xyzw;', 1),
        'numeric-decode': (r'uintBitsToFloat\(raw_temp\[9\]\.([xyzw])\)',
                           'float(raw_temp[9].$1)', 4),
        'sampler-index': (r'texture\(fssamp([07]),', 'swap sampler0 and sampler7', 2),
    }
    require(mode in definitions, 'known numeric source sabotage')
    expression, replacement, expected_count = definitions[mode]
    if mode == 'numeric-decode':
        action = lambda match: f'float(raw_temp[9].{match[1]})'
    elif mode == 'sampler-index':
        action = lambda match: f'texture(fssamp{7 - int(match[1])},'
    else:
        action = replacement
    mutated, count = re.subn(expression, action, original)
    require(count == expected_count and mutated != original, 'exact intended numeric mutation sites only')
    return expression, replacement, count, mutated


def verify_sabotage(root, mode, good, cases, fixture, *, helpers=None):
    """Bind an actual GPU mismatch to one exact shader mutation and its inputs."""
    h = _helpers(helpers)
    require, sha, oracle = h['require'], h['sha'], h['oracle']
    outer = h['read'](Path(root) / 'report.json')
    proof, baseline = outer['acceptance'], good['acceptance']
    require(outer['status'] == proof['status'] == 'failed' and proof['sabotage'] == mode
            and len(proof['omissions']) == 1, 'one intentional failing numeric shader lowering')
    require(good['status'] == baseline['status'] == 'passed' and baseline['sabotage'] is None
            and baseline['omissions'] == [], 'independently passing original shader control')
    require(proof['anchors'] == baseline['anchors'] and proof['sourceContracts'] == baseline['sourceContracts'],
            'all original TGSI, translations, metadata and logical sampling contracts remain unchanged')
    verify_orientation(proof, cases, helpers=h)
    _cleanup(proof, require)
    require(proof['pairDraws'] == [], 'intentional mismatch stops before later interface draws')
    if mode == 'sampler-index':
        definition = next(item for item in fixture['texturePrograms'] if item['name'] == 'tex-select')
        target = definition['fragment']
    else:
        name = {'stale-shadow': 'mov-snapshot', 'numeric-decode': 'safe-raw'}[mode]
        definition = next(item for item in fixture['numericPrograms'] if item['name'] == name)
        target = definition['vertex']
    original = cases[target]['result']
    shader = next(item for item in fixture['shaders'] if item['name'] == target)
    require(cases[target]['inputSha256'] == sha(shader['text'].encode()), 'native exact authored sabotage input')
    expression, replacement, count, mutated = _mutation(mode, original['glsl'], require)
    omission = proof['omissions'][0]
    require(omission['mode'] == mode and omission['originalExpression'] == expression
            and omission['replacement'] == replacement and omission['matches'] == count
            and omission['originalGlsl'] == original['glsl'] and omission['servedGlsl'] == mutated
            and omission['originalGlslSha256'] == sha(original['glsl'].encode())
            and omission['servedGlslSha256'] == sha(mutated.encode()),
            'byte-exact mutation binding excludes every input, raw encoder and unrelated source edit')
    if mode == 'sampler-index':
        _sampler_failure(proof, definition, fixture, cases, mutated, h)
    else:
        _vertex_failure(proof, mode, definition, fixture, cases, mutated, h)
    return {'mode': mode, 'program': target, 'mutationSites': count, 'actualMismatches': 1}


def _vertex_failure(proof, mode, definition, fixture, cases, mutated, h):
    require, oracle = h['require'], h['oracle']
    names = [item['name'] for item in fixture['numericPrograms']]
    stop = names.index(definition['name'])
    require([probe['name'] for probe in proof['vertexProbes']] == names[:stop + 1]
            and [probe['name'] for probe in proof['fragmentProbes']] == names[:stop]
            and [probe['name'] for probe in proof['crossConsumerProbes']] == names[:stop]
            and proof['textureDraws'] == [], 'intentional vertex failure reaches exactly its authored position')
    probe = proof['vertexProbes'][-1]
    require(probe['vertex'] == definition['vertex'] and probe['fragment'] == 'legacy-fragment'
            and probe['oracle'] == definition['oracle'], 'actual corrupted vertex program identity')
    h['program'](probe, {'glsl': mutated}, cases['legacy-fragment']['result'])
    _feedback(probe, require)
    require(len(probe['vectors']) == 1, 'first dynamic vertex witness detects the deliberate corruption')
    entry = probe['vectors'][0]
    source = next(item for item in fixture['numericVectors'] if item['name'] == definition['vectors'][0])
    require(all(entry[key] == value for key, value in source.items()), 'exact actual vertex sabotage inputs')
    expected = h['rational_record'](oracle.numeric(definition['oracle'], source))
    require(entry['oracle'] == expected, 'vertex sabotage retains independent unmodified numeric oracle')
    h['attributes'](entry['attributes'], source, True)
    h['uniforms'](probe, entry, source, expected)
    require(len(entry['captures']) == 1 and h['vertex_captures'](entry, expected['words'], True) == 1,
            'actual first feedback capture contradicts independent expectation with untouched guard')
    capture = entry['captures'][0]
    actual = capture['observedBits']
    require(actual[:4] == capture['expectedBits'][:4] and actual[4:8] != expected['words']
            and actual[8:] == [0x3f000000 + (word % 256) * 32768 for word in actual[4:8]],
            'ordinary-result corruption also has coherent unmodified byte-carrier output')
    require(all(0 < ((word // (2 ** 23)) % 256) < 255 for word in actual[4:8]),
            'observed fault result remains in finite normal capture domain')
    if mode == 'stale-shadow':
        require(actual[4:8] == oracle.numeric_words('chain', source),
                'actual stale copy has the independently derived unswizzled numeric values')
    else:
        require(all(word < 0x80000000 and (word // (2 ** 23)) % 256 >= 156 for word in actual[4:8]),
                'actual incorrect numeric uint conversion has large positive values, not a reflection failure')
    require(proof['failure']['message'].startswith(
        f"{definition['name']}/{source['name']} simultaneous numeric/raw byte0: expected "),
        'failure originates at actual feedback equality after compile/link and upload')


def _sampler_failure(proof, definition, fixture, cases, mutated, h):
    require, oracle = h['require'], h['oracle']
    numeric_names = [item['name'] for item in fixture['numericPrograms']]
    require([probe['name'] for probe in proof['vertexProbes']] == numeric_names
            and [probe['name'] for probe in proof['fragmentProbes']] == numeric_names + ['tex-chain', 'tex-select']
            and [probe['name'] for probe in proof['crossConsumerProbes']] == numeric_names[:-1] + ['tex-chain']
            and [(draw['name'], draw['phase']) for draw in proof['textureDraws']] == [('tex-chain', 0), ('tex-chain', 1)],
            'sampler corruption reaches only the intended sampled word probe')
    probe = proof['fragmentProbes'][-1]
    require(probe['vertex'] == 'legacy-vertex' and probe['fragment'] == definition['fragment']
            and probe['oracle'] == definition['oracle'] and probe['width'] == probe['height'] == 1,
            'actual corrupted sampled program identity')
    h['program'](probe, cases['legacy-vertex']['result'], {'glsl': mutated})
    require(len(probe['vectors']) == 1, 'first sampled witness detects swapped active samplers')
    entry, source = probe['vectors'][0], h['texture_vector'](definition, fixture, 0, 0)
    require(all(entry[key] == value for key, value in source.items()), 'exact actual sampled sabotage inputs')
    h['attributes'](entry['attributes'], source, False)
    h['uniforms'](probe, entry, source, source['oracle'])
    h['samplers'](entry['samplers'], source, cases[definition['fragment']]['result'])
    # The exact source substitution exchanges the two sampled values, while their
    # independently checked GL units, texture bytes and condition inputs stay fixed.
    textures = {binding['index']: binding['texture'] for binding in source['sampleBindings']}
    swapped = oracle.texture_values(definition['oracle'], oracle.texel(textures[0], source['a']),
                                    oracle.texel(textures[7], source['a']), source['condition'])
    wrong_words = [oracle.word(value) for value in swapped]
    words = source['oracle']['words']
    first = next(bit for bit in range(32) if any((a // 2 ** bit) % 2 != (b // 2 ** bit) % 2
                                               for a, b in zip(words, wrong_words)))
    require(len(entry['draws']) == first + 1, 'stop at the independently predicted first differing bitplane')
    for bit, draw in enumerate(entry['draws']):
        h['selector'](draw, bit)
        expected = [255 * ((word // 2 ** bit) % 2) for word in words]
        observed = [255 * ((word // 2 ** bit) % 2) for word in wrong_words]
        require(draw['expectedBytes'] == expected and draw['observedBytes'] == observed,
                'actual pixels equal independently derived swapped-texture arithmetic')
        if bit == first:
            require(observed != expected and draw['failure'] == {'expectedBytes': expected, 'observedBytes': observed},
                    'last real pixel readback contradicts original texture oracle')
        else:
            require(expected == observed and 'failure' not in draw, 'all earlier sampled bitplanes agree')
    require(proof['failure']['message'].startswith(f"tex-select/{source['name']} bit{first}: expected "),
            'failure originates at actual sampled pixel equality after successful compile/link and uploads')
