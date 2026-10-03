"""Independent raw packet, uniform and whole-frame oracles for renderer evidence."""
import copy
import json
import re
import struct

from common import ROOT, PROFILE, KIND, FIXTURE, require, sha, read, binding, source, artifact

SCHEDULES = [(0x7c1209ad, 1), (0x491be583, 2), (0xea016f35, 3), (0x265d8cb7, 8)]
RAW = [[0, 0x80000000, 1, 0x80000001], [0x007fffff, 0x807fffff, 0x3f800000, 0xbf800000]]
BAD = [0x7f800000, 0xff800000, 0x7fc12345, 0xff800001]
FAULTS = ['missing', 'profile', 'kind', 'stage', 'slot', 'name', 'duplicate', 'count-zero',
          'count-fraction', 'count-large', 'count-mismatch', 'domains-object', 'domain-null', 'unknown-field']
RUNTIME = ['renderer/virgl-command/state.mjs', 'renderer/virgl-command/constant-domain.mjs',
           'renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/resources.mjs',
           'renderer/virgl-command/tests/constant-domains.mjs']
MUTATIONS = [
    ('renderer/virgl-command/decoder.mjs',
     'this.require(Number.isFinite(value), "invalid-value", "Non-finite float field.");',
     'this.require(this.opcode === 12 || Number.isFinite(value), "invalid-value", "Non-finite float field.");'),
    ('renderer/virgl-command/constant-domain.mjs',
     'return Number.isInteger(word) && word >= 0 && word <= 0xffffffff && (word & 0x7f800000) !== 0x7f800000;',
     'return Number.isInteger(word) && word >= 0 && word <= 0xffffffff;'),
]


def envelope(directory, head, contract, mode):
    report = read(directory / 'report.json')
    status = 'failed' if mode == 'decoder-and-guard-bypass' else 'passed'
    require(report['task'] == 'E6-T12e6a' and report['schema'] == 1 and report['gitHead'] == head
            and report['status'] == status and report['mode'] == mode, 'browser task/head/mode/outcome')
    require(report['trackedChanges'] == [] and report['guestExecution'] is False
            and report['currentGuest3dAdvertisement'] is False and report['trustedHostMetadataWrapper'] is True,
            'frozen isolated host contract proof')
    require(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser has zero errors')
    sources = {}
    for item in report['sources']:
        source(item, head)
        require(item['path'] not in sources or item == sources[item['path']], 'consistent repeated source binding')
        sources[item['path']] = item
    mutations = {}
    for path, before, after in MUTATIONS[:0 if mode == 'normal' else 1 if mode == 'decoder-bypass' else 2]:
        raw = (ROOT / path).read_bytes()
        require(raw.count(before.encode()) == 1, 'unique exact source fault seam')
        mutations[path] = {'path': path, 'before': before, 'after': after, 'matches': 1,
                           'originalSha256': sha(raw), 'servedSha256': sha(raw.replace(before.encode(), after.encode()))}
    require(len(report['mutations']) == len(mutations)
            and {item['path']: item for item in report['mutations']} == mutations, 'complete exact source faults')
    served = {item['path']: item for item in report['servedFiles']}
    require(len(served) == len(report['servedFiles']), 'unique served files')
    for path, item in served.items():
        require(path in sources, f'every served input is source bound: {path}')
        raw = (ROOT / path).read_bytes()
        if path in mutations:
            mutation = mutations[path]
            raw = raw.replace(mutation['before'].encode(), mutation['after'].encode())
        require(item['sha256'] == sha(raw) and item['size'] == len(raw), 'exact served bytes')
    require(set(RUNTIME + [FIXTURE, 'renderer/virgl-shader/build/wasm/virgl-shader.wasm']) <= set(served),
            'actual runtime, fixture and built Wasm consumed')
    coverage = json.loads(artifact(directory, report['browserCoverage']))
    require({item['source'] for item in coverage['scripts']} == set(RUNTIME), 'complete browser coverage sources')
    for item in coverage['scripts']:
        require(item['sha256'] == served[item['source']]['sha256']
                and item['originalSha256'] == sources[item['source']]['sha256']
                and item['coverage']['url'].endswith('/' + item['source']), 'coverage of exact served implementation')
    artifact(directory, report['screenshot'] if status == 'passed' else report['failureScreenshot'])
    browser = report['browser']
    require(browser['launch']['headless'] is False
            and browser['gpu']['featureStatus'][browser['webglFeature']] == 'enabled'
            and not any(re.search(r'swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu', arg, re.I)
                        for arg in browser['actualCommandLine']), 'real hardware browser')
    qualified = {'browserVersion': browser['version'],
                 **{key: report['host'][key] for key in ('platform', 'architecture', 'release')},
                 'renderer': report['acceptance']['renderer']['renderer']}
    require(qualified in contract['browserMatrix']['qualified'], 'qualified GPU/browser tuple')
    return report


def words(raw):
    data = bytes(raw)
    require(len(data) % 4 == 0, 'raw packet word alignment')
    offset, result = 0, []
    while offset < len(data):
        header = struct.unpack_from('<I', data, offset)[0]
        end = offset + 4 + (header >> 16) * 4
        require(end <= len(data), 'complete raw packet')
        result.append({'opcode': header & 255, 'type': (header >> 8) & 255, 'offset': offset,
                       'payload': list(struct.unpack_from(f'<{header >> 16}I', data, offset + 4))})
        offset = end
    return result


def float_word(value):
    return struct.unpack('<I', struct.pack('<f', value))[0]


def bank(mode, stage):
    result = [[0, 0, 0, 0] for _ in range(46)]
    if stage == 0:
        result[0] = [.25, -.25, 0, 0] if mode == 'B' else [0, 0, 0, 0]
        result[5] = [.75] * 4
        result[7] = [1] * 4
        result[45] = [.5, .5, 1, 1] if mode == 'B' else [1] * 4
    else:
        result[0], result[5] = [.125, .25, .25, .25], [.75, .125, .5, 1]
        result[7] = [.375, .125, 0, .5]
        result[45] = [.625, .25, .5, .5] if mode == 'B' else [.125, .5, .25, .5]
    return [float_word(value) for vector in result for value in vector]


def raw_bank(phase, selector):
    result = [0] * 184
    result[:4], result[180:], result[176:180] = RAW[phase], RAW[1 - phase], [selector] * 4
    return result


def finite(word):
    return type(word) is int and 0 <= word <= 0xffffffff and (word // 0x800000) % 256 != 255


def frame(mode):
    rectangle = [12, 4, 16, 16] if mode == 'B' else [0, 0, 32, 32]
    colors = {'A': [64, 191, 128, 191], 'B': [191, 128, 191, 191], 'low': [128, 96, 64, 191],
              'both-inactive': [255, 0, 0, 255]}
    color = colors[mode]
    x0, y0, width, height = rectangle
    rgba = bytes(channel for y in range(32) for x in range(32)
                 for channel in (color if x0 <= x < x0 + width and y0 <= y < y0 + height else [0, 0, 255, 255]))
    return rectangle, color, rgba


def wrapped(original, stage, stages, fault=None, fault_stage='vertex'):
    result = copy.deepcopy(original)
    if stages in ('both', stage):
        metadata = result['metadata']
        metadata['profile'] = PROFILE
        metadata['constantDomains'] = [{'kind': KIND, 'stage': stage, 'slot': 0,
                                        'name': 'vsconst0' if stage == 'vertex' else 'fsconst0',
                                        'count': metadata['uniforms'][0]['count']}]
    if fault and stage == fault_stage:
        metadata = result['metadata']
        domain = metadata['constantDomains'][0]
        if fault == 'missing':
            del metadata['constantDomains']
        elif fault == 'profile':
            metadata['profile'] = original['metadata']['profile']
        elif fault == 'kind': domain['kind'] = 'constant-bank-finite-f32-v2'
        elif fault == 'stage': domain['stage'] = 'fragment' if stage == 'vertex' else 'vertex'
        elif fault == 'slot': domain['slot'] = 1
        elif fault == 'name': domain['name'] = 'otherconst0'
        elif fault == 'duplicate': metadata['constantDomains'].append(copy.deepcopy(domain))
        elif fault == 'count-zero': domain['count'] = 0
        elif fault == 'count-fraction': domain['count'] = 1.5
        elif fault == 'count-large': domain['count'] = 48
        elif fault == 'count-mismatch': domain['count'] = 45
        elif fault == 'domains-object': metadata['constantDomains'] = copy.deepcopy(domain)
        elif fault == 'domain-null': metadata['constantDomains'] = [None]
        elif fault == 'unknown-field': domain['optional'] = True
        else: require(False, 'unknown independent metadata fault')
    return result


def translations(proof, cases, originals):
    fixtures = read(ROOT / FIXTURE)
    require(proof['fixture'] == binding(ROOT / FIXTURE), 'exact browser fixture')
    require(len(proof['shaderFixtures']) == len(fixtures) == 14, 'complete browser fixture inventory')
    by_body = {}
    for fixture, observed in zip(fixtures, proof['shaderFixtures']):
        expected = {**fixture, 'inputSha256': sha(fixture['text'].encode()), 'original': cases[fixture['name']]['result']}
        require(observed == expected, 'full native/Wasm stage parity and unchanged fixture order')
        by_body[(fixture['stage'], fixture['text'])] = expected['original']
    require(len(proof['corpus']) == len(originals) == 19, 'complete unchanged original shader inventory')
    require({entry['sha256']: entry['result'] for entry in proof['corpus']} == originals,
            'full original browser results remain exact')
    for entry in proof['corpus']:
        source_bytes = (ROOT / entry['path']).read_bytes()
        require(sha(source_bytes) == entry['sha256'], 'original corpus input bytes')
    for rig in proof['rigs'] + proof['metadataRigs']:
        require(rig['translations'], 'actual shader compilation in every rig')
        for entry in rig['translations']:
            request, original = entry['request'], entry['original']
            if entry['kind'] == 'single':
                require(original == by_body[(request['stage'], request['text'])], 'host wrapper preserves real compiler result')
                want = wrapped(original, request['stage'], entry['contractStages'], entry['fault'], entry['faultStage'])
            else:
                require(entry['kind'] == 'pair' and original['ok'] is True, 'actual checked pair translation')
                vertex = copy.deepcopy(by_body[('vertex', request['vertexText'])])
                fragment = by_body[('fragment', request['fragmentText'])]
                require(original['fragment'] == {k: v for k, v in fragment.items() if k != 'ok'},
                        'flat pair retains full real fragment result')
                inputs = sorted(fragment['metadata']['inputs'], key=lambda value: value['semanticIndex'])
                key = 'generic-interpolation-v1:' + ';'.join(f'g{x["semanticIndex"]}/{x["componentMask"]}/{x["interpolation"]}' for x in inputs)
                for output in vertex['metadata']['outputs']:
                    if output['semantic'] == 'GENERIC':
                        match = next((value for value in inputs if value['semanticIndex'] == output['semanticIndex']), None)
                        output['interpolation'] = match['interpolation'] if match else 'smooth'
                        if output['interpolation'] == 'flat':
                            vertex['glsl'] = vertex['glsl'].replace(f'smooth out vec4 {output["name"]};', f'flat out vec4 {output["name"]};')
                require(original['interfaceKey'] == key and original['vertex'] == {k: v for k, v in vertex.items() if k != 'ok'},
                        'only declared flat interpolation specializes native vertex output')
                want = copy.deepcopy(original)
                for stage in ('vertex', 'fragment'):
                    want[stage] = wrapped(original[stage], stage, entry['contractStages'], entry['fault'], entry['faultStage'])
            require(entry['result'] == want, 'exact trusted metadata transformation without GLSL edits')
    return by_body


def native_events(rig, mode):
    events = rig['glEvents']
    require([event['sequence'] for event in events] == list(range(len(events))), 'complete native event order')
    created, deleted, shaders, compiled, programs, linked = {}, set(), {}, set(), {}, set()
    invalid = []
    for event in events:
        call = event['call']
        if call.startswith('create') or call == 'fenceSync':
            require(event['id'] not in created, 'unique native object identity')
            created[event['id']] = call
        elif call.startswith('delete'):
            require(event['id'] in created and event['id'] not in deleted, 'delete actual live owned object')
            deleted.add(event['id'])
        elif call == 'shaderSource':
            require(created[event['id']] == 'createShader', 'source belongs to actual shader')
            shaders[event['id']] = event['source']
        elif call == 'compileShader':
            require(event['id'] in shaders and event['status'] is True, 'real shader compilation succeeded')
            compiled.add(event['id'])
        elif call == 'attachShader':
            require(created[event['programId']] == 'createProgram' and event['shaderId'] in compiled,
                    'actual program attaches compiled shader')
            programs.setdefault(event['programId'], []).append(shaders[event['shaderId']])
        elif call == 'linkProgram':
            require(event['status'] is True and len(programs[event['id']]) == 2, 'real two-stage link succeeded')
            linked.add(event['id'])
        elif call == 'uniform4uiv':
            require(event['programId'] == event['currentProgramId'] and event['programId'] in linked
                    and event['name'] in ('vsconst0[0]', 'fsconst0[0]')
                    and 0 < len(event['words']) <= 184 and len(event['words']) % 4 == 0
                    and event['observed'] == event['words'], 'raw upload reached the selected native program unchanged')
            if not all(finite(word) for word in event['words']): invalid.append(event)
        elif call == 'drawElements':
            require(event['programId'] in linked and event['arguments'] == [4, 6, 5123, 0],
                    'actual bounded indexed triangle draw')
    require(set(created) == deleted and rig['glObjects'] == {'created': len(created), 'live': 0},
            'all real GL objects released exactly once')
    require(all(value == 0 for value in rig['finalBudgets'].values())
            and all(value == 0 for value in rig['finalResourceBudgets'].values()), 'all CPU resource charges released')
    require(bool(invalid) is (mode == 'decoder-and-guard-bypass'), 'independently detected invalid native uploads')
    expected_draws = len(rig['draws']) + sum(len(item['planes']) for item in rig['rawDraws'])
    require(sum(event['call'] == 'drawElements' for event in events) == expected_draws,
            'every real draw has a full framebuffer record, with no hidden dispatch')
    return programs, invalid


def draw_identity(rig, draw, expected_words, expected_sources, programs):
    submission = rig['submissions'][draw['submissionIndex']]
    result = submission['result']
    require(result['ok'] is True and result['draws'] == [draw['draw']], 'capture identifies the actual submission result')
    events = rig['glEvents'][submission['eventsStart']:submission['eventsEnd']]
    dispatches = [event for event in events if event['call'] == 'drawElements']
    require(len(dispatches) == 1 and dispatches[0]['programId'] == draw['nativeProgramId'],
            'captured framebuffer belongs to this native program dispatch')
    require(programs[draw['nativeProgramId']] == expected_sources, 'actual linked shaders match exact compiler stage outputs')
    program, bindings, issued = draw['program'], draw['bindings'], draw['draw']
    require(program['vertexGeneration'] == bindings['vertexShader']['generation']
            and program['fragmentGeneration'] == bindings['fragmentShader']['generation']
            and program['vertexHandle'] == bindings['vertexShader']['handle']
            and program['fragmentHandle'] == bindings['fragmentShader']['handle']
            and issued['vertexShader'] == bindings['vertexShader'] and issued['fragmentShader'] == bindings['fragmentShader']
            and issued['subContextId'] == draw['subContextId'] and issued['subContextGeneration'] == draw['subContextGeneration']
            and issued['contextId'] == draw['contextId'] == submission['contextId'], 'same selected identities through issue')
    require(program['key'] == f'{program["vertexGeneration"]}:{program["fragmentGeneration"]}:{program["interfaceKey"]}',
            'bounded linked-program identity')
    require(issued['count'] == 6 and issued['indexByteLength'] == 12 and issued['actualMinIndex'] == 0
            and issued['actualMaxIndex'] == 3 and issued['indexResourceId'] == 102
            and issued['framebuffer']['resourceId'] == 103
            and issued['framebuffer']['width'] == issued['framebuffer']['height'] == rig.get('width', 32),
            'literal geometry reaches the intended target')
    require(len(draw['uniforms']) == len(program['reflection']['uniforms']) == 2, 'both stage reflections retained')
    for index, (uniform, reflected) in enumerate(zip(draw['uniforms'], program['reflection']['uniforms'])):
        require({key: value for key, value in uniform.items() if key != 'words'} == reflected,
                'direct native uniform capture matches selected reflection')
        require(uniform['stage'] == ('vertex' if index == 0 else 'fragment')
                and uniform['name'] == ('vsconst0[0]' if index == 0 else 'fsconst0[0]')
                and uniform['type'] == 'uvec4[]' and uniform['encoding'] == 'float32-bits'
                and 0 <= uniform['activeCount'] <= uniform['count'] <= 47
                and uniform['uploadCount'] == min(uniform['activeCount'], 46), 'honest declared/active/upload extents')
        count = uniform['uploadCount'] * 4
        require(len(uniform['words']) == uniform['activeCount'] * 4
                and uniform['words'][:count] == expected_words[index][:count]
                and bindings['constants'][index][:count] == expected_words[index][:count], 'native words equal current immutable guest prefix')
        preceding = [event for event in events if event['call'] == 'uniform4uiv'
                     and event['name'] == uniform['name'] and event['sequence'] < dispatches[0]['sequence']]
        if count:
            require(preceding and preceding[-1]['programId'] == draw['nativeProgramId']
                    and preceding[-1]['words'] == expected_words[index][:count], 'final checked upload immediately precedes this draw')
        else:
            require(not preceding and uniform['words'] == [], 'inactive bank causes no upload')


def gpu(rig, mode, by_body):
    programs, invalid = native_events(rig, mode)
    require(rig['geometry'] == {'positions': [-1, -1, 1, -1, 1, 1, -1, 1], 'components': 2,
                               'indices': [0, 1, 2, 0, 2, 3], 'width': rig.get('width', 32),
                               'height': rig.get('width', 32)}, 'independently authored quad geometry')
    pixels = 0
    for draw in rig['draws']:
        rectangle, color, rgba = frame(draw['expectedMode'])
        require(draw['rectangle'] == rectangle and draw['color'] == color
                and bytes(draw['rgbaBytes']) == rgba and draw['rgbaSha256'] == sha(rgba) and draw['pixels'] == 1024,
                f'complete literal framebuffer: {rig["name"]}/{draw["name"]}')
        sources = [by_body[('vertex' if item['stage'] == 0 else 'fragment', item['text'])]['glsl']
                   for item in sorted(draw['selectedShaders'], key=lambda entry: entry['stage'])]
        require(len(sources) == 2, 'capture identifies both selected shader bodies')
        expected_words = [bank('B' if draw['expectedMode'] == 'B' else 'A', index) for index in (0, 1)]
        draw_identity(rig, draw, expected_words, sources, programs)
        pixels += 1024
    expected_raw = [(stage, index, phase) for stage in ('vertex', 'fragment') for index in (0, 45) for phase in (0, 1)]
    if rig['name'].startswith('raw-'):
        require([(item['stage'], item['index'], item['phase']) for item in rig['rawDraws']] == expected_raw,
                'both stages and both bank ends with both payload sets')
    else:
        require(rig['rawDraws'] == [], 'raw matrix occurs only in its named rigs')
    fixtures = {item['name']: item for item in read(ROOT / FIXTURE)}
    for item in rig['rawDraws']:
        stage, index, phase = item['stage'], item['index'], item['phase']
        expected = RAW[phase if index == 0 else 1 - phase]
        require(item['expectedWords'] == expected and [plane['selector'] for plane in item['planes']] == list(range(32)),
                'all independently authored raw bit-plane inputs')
        reconstructed = [0] * 4
        vertex = fixtures[f'raw-c{index}-vertex' if stage == 'vertex' else 'raw-pass-vertex']
        fragment = fixtures[f'raw-c{index}-fragment' if stage == 'fragment' else 'raw-pass-fragment']
        vertex_source = by_body[('vertex', vertex['text'])]['glsl']
        if stage == 'vertex': vertex_source = vertex_source.replace('smooth out vec4 vso_g0;', 'flat out vec4 vso_g0;')
        expected_sources = [vertex_source, by_body[('fragment', fragment['text'])]['glsl']]
        for selector, plane in enumerate(item['planes']):
            endpoints = [((word >> selector) & 1) * 255 for word in expected]
            rgba = bytes(endpoints * 16)
            expected_bank = raw_bank(phase, selector)
            require(plane['expectedBytes'] == endpoints and plane['words'] == expected_bank
                    and bytes(plane['rgbaBytes']) == rgba and plane['rgbaSha256'] == sha(rgba),
                    'independent integer bit extraction across all 16 native pixels')
            draw_identity(rig, plane, [expected_bank, expected_bank], expected_sources, programs)
            packets = words(rig['submissions'][plane['submissionIndex']]['bytes'])
            require([packet['opcode'] for packet in packets] == [12, 12, 8]
                    and all(packet['payload'] == [index, 0, *expected_bank] for index, packet in enumerate(packets[:2])),
                    'literal finite raw word packet reached each stage')
            for lane, value in enumerate(plane['rgbaBytes'][:4]):
                reconstructed[lane] |= (value // 255) << selector
            pixels += 16
        require(item['observedWords'] == reconstructed == expected, 'all signed-zero/subnormal/normal words reconstructed from GPU pixels')
    if rig['name'] == 'order-both':
        require(len(rig['padding']) == 2, 'both unaddressable padding poison controls')
        for record, values in zip(rig['padding'], ([16, -8, 4, -2], [-1, 32, -16, 8])):
            expected = [float_word(value) for value in values]
            require(record['poisoned']['entries'] and all(entry['name'] in ('vsconst0[46]', 'fsconst0[46]')
                    and entry['values'] == entry['observed'] == expected for entry in record['poisoned']['entries'])
                    and record['after'] == [{'name': entry['name'], 'observed': expected}
                                            for entry in record['poisoned']['entries']], 'host-only C46 remains outside every guest upload')
    if invalid:
        witness = rig['attacks'][0]
        require(witness['stage'] == witness['position'] == 0 and witness['word'] == 0x7f800000
                and witness['invalidUploads'] == invalid and witness['guardContradiction'] == {
                    'expectedInvalidUploads': 0, 'actualInvalidUploads': len(invalid), 'first': invalid[0]},
                'sabotage is refuted by actual uniform payload, not printed failure')
        require(all(event['words'] == event['observed'] and event['observed'][0] == 0x7f800000
                    for event in invalid), 'native getUniform independently observed the offending u32')
        require(witness['pixelsBefore'] == witness['pixelsAfter']
                and not any(event['call'] == 'drawElements' for event in witness['events']),
                'fault witness is honestly upload-only with no exceptional pixel claim')
    return {'pixels': pixels, 'rawWords': len(rig['rawDraws']) * 4, 'invalidUploads': len(invalid)}
