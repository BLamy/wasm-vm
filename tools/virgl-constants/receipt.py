#!/usr/bin/env python3
"""Bind raw constant commands to native translations and independent GPU pixels."""
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
PROFILE = 'virgl-webgl2-straight-line-v5'
HELD_HEAD = '5af5600c33c69e926c96a3dc82369c31da391565'
FIXTURE = 'renderer/virgl-command/tests/constant-shaders.json'


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path):
    return json.loads(path.read_bytes())


def binding(path, base=ROOT):
    raw = path.read_bytes()
    return {'path': str(path.relative_to(base)), 'bytes': len(raw), 'sha256': sha(raw)}


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def verify_source(item, head=None):
    raw = (ROOT / item['path']).read_bytes()
    require(sha(raw) == item['sha256'] and len(raw) == item.get('bytes', item.get('size')),
            f'source identity: {item["path"]}')
    if head is not None and '/build/' not in item['path']:
        require(git('show', f'{head}:{item["path"]}') == raw, f'unfrozen source: {item["path"]}')


def verify_records(directory, receipt):
    for item in receipt['records']:
        require(binding(directory / item['path'], directory) == item, f'evidence digest: {item["path"]}')


def verify_native(output, head):
    native = read(output / 'native/native-report.json')
    require(native['schema'] == 'wasm-vm-constants-native-v1' and native['status'] == 'passed'
            and native['profile'] == PROFILE, 'native identity')
    require(native['fixture'] == binding(ROOT / FIXTURE), 'exact shader fixture input')
    require(sha((output / 'native/native.log').read_bytes()) == native['logSha256'], 'native transcript digest')
    require(sha(Path(native['binary']).read_bytes()) == native['binarySha256'], 'native executable digest')
    for source in native['sources']:
        verify_source(source, head)
    fixtures = read(ROOT / FIXTURE)
    require(len(fixtures) == len(native['cases']) == 8, 'eight exact hardware stage inputs')
    held = json.loads(git('show', f'{HELD_HEAD}:evidence/virgl-banks/worker/native/native-report.json'))
    old_originals = {item['sha256']: item for item in held['originals']}
    require(len(native['originals']) == len(old_originals) == 19, 'nineteen original shader bodies')
    results = {}
    for original in native['originals']:
        verify_source(original, head)
        previous = old_originals[original['sha256']]
        require(original['result'] == previous['result'] and original['stage'] == previous['stage'],
                'full original compiler output remains unchanged')
        results[original['sha256']] = original['result']
    require(sum(result['ok'] for result in results.values()) == 12, 'unchanged twelve translated originals')
    cases = {}
    for fixture, case in zip(fixtures, native['cases']):
        raw = fixture['text'].encode('ascii')
        require(case['name'] == fixture['name'] and case['stage'] == fixture['stage']
                and case['bytes'] == len(raw) and case['inputSha256'] == sha(raw)
                and case['ok'] is True and case['expected'] == fixture['expected'], 'native fixture binding')
        result = case['result']
        require(result['ok'] is True and result['metadata']['stage'] == fixture['stage']
                and result['metadata']['profile'] == PROFILE, 'native stage identity')
        # Independently account for the pinned declaration ordering rule.
        count = 0
        for line in fixture['text'].splitlines():
            match = re.fullmatch(r'DCL CONST\[([0-9]+)(?:\.\.([0-9]+))?\]', line)
            if match:
                first, last = int(match[1]), int(match[2] or match[1])
                require(0 <= first <= last <= 45, 'guest address range')
                count = count + 1 if first == last == 0 else max(count, last + 1)
        uniforms = result['metadata']['uniforms']
        require(len(uniforms) == 1 and uniforms[0]['count'] == count == fixture['expected']['constantCount'],
                'declared extent stays truthful even for inactive arrays')
        require(re.search(r'\b' + re.escape(uniforms[0]['name']) + r'\[' + str(count) + r'\]', result['glsl']),
                'metadata extent equals actual GLSL declaration')
        cases[case['name']] = case
    transcript = [json.loads(line) for line in (output / 'native/native.log').read_text().splitlines()]
    require(len(transcript) == 27 and native['stats'] == {'originals': 19, 'acceptedOriginals': 12,
            'cases': 8, 'calls': 27}, 'complete native transcript')
    for record, entry in zip(transcript, native['originals'] + native['cases']):
        raw = record['stdout'].encode('ascii')
        require(record['returnCode'] == 0 and record['stderr'] == '' and raw.count(b'\n') == 1
                and sha(raw) == entry['stdoutSha256'] and len(raw) - 1 == entry['resultBytes']
                and json.loads(raw) == entry['result'], 'raw full native serialization')
        require(record['inputSha256'] == entry.get('inputSha256', entry.get('sha256')), 'native transcript input')
    # No frontend changes are hidden behind incremental verification.
    for source in held['sources']:
        if source['path'].startswith('renderer/virgl-shader/'):
            verify_source(source, head)
    require(git('show', f'{HELD_HEAD}:renderer/virgl-shader/bridge.c') == (ROOT / 'renderer/virgl-shader/bridge.c').read_bytes(),
            'held shader semantics boundary')
    return native, fixtures, cases, results


def packet_words(raw):
    """Independent little-endian framing; deliberately never import the decoder."""
    data = bytes(raw)
    require(len(data) % 4 == 0, 'recorded word alignment')
    offset, packets = 0, []
    while offset < len(data):
        header = struct.unpack_from('<I', data, offset)[0]
        opcode, object_type, count = header & 255, (header >> 8) & 255, header >> 16
        end = offset + 4 + count * 4
        require(end <= len(data), 'recorded complete packet framing')
        payload = list(struct.unpack_from(f'<{count}I', data, offset + 4))
        packets.append({'opcode': opcode, 'objectType': object_type, 'header': header,
                        'offset': offset, 'payload': payload})
        offset = end
    return packets


def float_bits(values):
    return [struct.unpack('<I', struct.pack('<f', value))[0] for value in values]


def expected_frame(mode):
    """Literal guest equations, independent of emitted GLSL or reported rectangles."""
    rectangle = [12, 4, 28, 20] if mode == 'B' else [0, 0, 32, 32]
    colors = {'A': [64, 191, 128, 191], 'B': [191, 128, 191, 191],
              'low': [128, 96, 64, 191], 'inactive-vertex': [64, 191, 128, 191],
              'inactive-fragment': [255, 0, 0, 255], 'both-inactive': [255, 0, 0, 255]}
    require(mode in colors, f'known independent geometry/color mode: {mode}')
    color, result = colors[mode], bytearray()
    for y in range(32):
        for x in range(32):
            result.extend(color if rectangle[0] <= x < rectangle[2] and rectangle[1] <= y < rectangle[3]
                          else [0, 0, 255, 255])
    return rectangle, color, bytes(result)


def verify_decoder(output):
    report = read(output / 'decoder/decoder-report.json')
    require(report['schema'] == 'wasm-vm-constants-decoder-v1' and report['status'] == 'passed', 'decoder identity')
    words = ([0x3f800000, 0xbf000000, 0x80000000, 1, 0x3f000000, 0] * 31)[:184]
    fixtures = []

    def add(name, header, stage, slot, data, error=None):
        raw = struct.pack(f'<{3 + len(data)}I', header, stage, slot, *data)
        fixtures.append([name, raw, error, 0])

    for stage in (0, 1):
        add(f'stage-{stage}-184-words', 0x00ba000c, stage, 0, words)
        add(f'stage-{stage}-180-words', 0x00b6000c, stage, 0, words[:180])
        add(f'stage-{stage}-empty-reset', 0x0002000c, stage, 0, [])
        add(f'stage-{stage}-188-words', 0x00be000c, stage, 0, words + [0] * 4, 'limit-exceeded')
        add(f'stage-{stage}-183-words', 0x00b9000c, stage, 0, words[:183], 'payload-length')
        add(f'stage-{stage}-active-slot-one', 0x00ba000c, stage, 1, words, 'unsupported-feature')
    add('legacy-inactive-stage-slot', 0x0002000c, 2, 14, [])
    add('unsupported-active-stage', 0x00ba000c, 2, 0, words, 'unsupported-feature')
    add('unknown-stage', 0x00ba000c, 6, 0, words, 'invalid-enum')
    add('slot-limit', 0x0002000c, 0, 15, [], 'limit-exceeded')
    for name, word in (('nan', 0x7fc00000), ('infinity', 0x7f800000)):
        add(f'last-word-{name}', 0x00ba000c, 1, 0, words[:183] + [word], 'invalid-value')
    add('truncated-184-payload', 0x00ba000c, 0, 0, words[:183], 'truncated-payload')
    add('nonzero-object-type', 0x00ba010c, 0, 0, words, 'invalid-object-type')
    for name, header, data, error in (('over-limit', 0x00be000c, words + [0] * 4, 'limit-exceeded'),
                                      ('non-vec4', 0x00b9000c, words[:183], 'payload-length')):
        add(f'invalid-tail-{name}', header, 0, 0, data, error)
        fixtures[-1][1] = struct.pack('<I', 44) + fixtures[-1][1]
        fixtures[-1][3] = 4
    add('unaligned-host-view-owned-copy', 0x00ba000c, 0, 0, words)
    require(len(fixtures) == len(report['cases']) == 23, 'complete literal packet boundary')
    for (name, raw, error, offset), case in zip(fixtures, report['cases']):
        require(case['name'] == name and case['requestHex'] == raw.hex(), f'literal raw input: {name}')
        result = case['result']
        require(result['ok'] is (error is None), f'independent wire outcome: {name}')
        if error:
            require(set(result) == {'ok', 'error'} and result['error']['code'] == error
                    and result['error']['byteOffset'] == offset, f'whole-submission rejection: {name}')
        else:
            packet = packet_words(raw)[0]
            fields = result['commands'][0]['fields']
            require(len(result['commands']) == 1 and result['commands'][0]['byteLength'] == len(raw)
                    and result['commands'][0]['opcode'] == 12, 'successful exact framing')
            require(fields['stage'] == packet['payload'][0] and fields['index'] == packet['payload'][1]
                    and fields['words'] == packet['payload'][2:], 'bit-preserving constant transport')
            values = [struct.unpack('<f', struct.pack('<I', word))[0] for word in fields['words']]
            require(fields['values'] == values, 'independent finite float decode')
    require(report['stats'] == {'cases': 23, 'accepted': 8, 'rejected': 15}
            and report['ownership'] == {'deeplyFrozen': True, 'sourceMutationPreserved': True, 'signedZeroPreserved': True},
            'bounded transport and input ownership')
    return report


def verify_browser(directory, head, contract, passed=True, task='E6-T12e3b'):
    report = read(directory / 'report.json')
    require(report['gitHead'] == head and report['task'] == task
            and report['status'] == ('passed' if passed else 'failed'), 'browser head/task/outcome')
    require(report['guestExecution'] is False and report['currentGuest3dAdvertisement'] is False,
            'isolated graphics proof cannot claim live guest acceleration')
    require(report['trackedChanges'] == [] and report['browserErrors'] == {'console': [], 'page': [], 'requests': []},
            'frozen error-free browser run')
    sources = {item['path']: item for item in report['sources']}
    served = {item['path']: item for item in report['servedFiles']}
    mutation = report.get('sabotage', {})
    for item in sources.values():
        verify_source(item, head)
    for name, item in served.items():
        require(name in sources, f'unbound served browser source: {name}')
        expected = mutation['servedSha256'] if name == mutation.get('source') else sources[name]['sha256']
        require(item['sha256'] == expected, f'served source differs: {name}')
    wasm = 'renderer/virgl-shader/build/wasm/virgl-shader.wasm'
    require(wasm in served and served[wasm]['sha256'] == sources[wasm]['sha256'], 'browser consumed exact Wasm compiler')
    require(report['browser']['gpu']['featureStatus'][report['browser']['webglFeature']] == 'enabled', 'hardware WebGL enabled')
    observed = {'browserVersion': report['browser']['version'],
                **{key: report['host'][key] for key in ('platform', 'architecture', 'release')},
                'renderer': report['acceptance']['renderer']['renderer']}
    require(observed in contract['browserMatrix']['qualified'], 'qualified actual GPU/browser')
    photo = report['screenshot'] if passed else report['failureScreenshot']
    require(sha((directory / photo['path']).read_bytes()) == photo['sha256'], 'recorded browser screenshot')
    coverage = report['browserCoverage']
    raw = (directory / coverage['path']).read_bytes()
    require(sha(raw) == coverage['sha256'], 'browser coverage digest')
    for script in json.loads(raw)['scripts']:
        require(script['source'] in served and script['sha256'] == served[script['source']]['sha256'],
                'coverage describes actual served runtime')
    return report


def expected_bank(mode, stage):
    values = [[0, 0, 0, 0] for _ in range(46)]
    if stage == 0:
        values[0] = [.25, -.25, 0, 0] if mode == 'B' else [0, 0, 0, 0]
        values[5] = [.75] * 4
        values[7] = [1] * 4
        values[45] = [.5, .5, 1, 1] if mode == 'B' else [1] * 4
    else:
        values[0] = [.125, .25, .25, .25]
        values[5] = [.75, .125, .5, 1]
        values[7] = [.375, .125, 0, .5]
        values[45] = [.625, .25, .5, .5] if mode == 'B' else [.125, .5, .25, .5]
    return float_bits([value for vector in values for value in vector])


def verify_translations(proof, fixtures, cases, originals, decoder):
    require(proof['schema'] == 'wasm-vm-constant-browser-v1' and proof['guestExecution'] is False
            and proof['productionVirgl'] is False, 'browser acceptance boundary')
    require(len(proof['shaderFixtures']) == 8 and len(proof['corpus']) == 19, 'full browser shader inputs')
    for fixture, actual in zip(fixtures, proof['shaderFixtures']):
        require(all(actual[key] == value for key, value in fixture.items())
                and actual['inputSha256'] == sha(fixture['text'].encode())
                and actual['result'] == cases[fixture['name']]['result'], 'complete native/Wasm stage parity')
    require({entry['sha256']: entry['result'] for entry in proof['corpus']} == originals,
            'complete unchanged native/Wasm original parity')
    for entry in proof['corpus']:
        verify_source(entry)
    require(proof['decoder'] == decoder, 'exact Node/browser raw packet parity')
    owned = proof['decodedOwnership']
    require(owned['mutatedInput'] == [255] * 748
            and owned['decoded']['commands'][0]['fields']['words'] == expected_bank('A', 1),
            'browser decode owns constant packet independently of caller mutation')


def verify_draw(draw, rig, cases, failure=False):
    mode = draw['expectedMode']
    rectangle, color, expected = expected_frame(mode)
    require(draw['rectangle'] == [rectangle[0], rectangle[1], rectangle[2] - rectangle[0], rectangle[3] - rectangle[1]]
            and draw['color'] == color, 'literal raster geometry and color')
    actual = bytes(draw['rgbaBytes'])
    require(len(actual) == 4096 and sha(actual) == draw['rgbaSha256'], 'full GPU framebuffer digest')
    if failure:
        require(mode == 'A' and actual == bytes([0, 0, 255, 255]) * 1024 and draw['pixels'] == 0
                and draw['failure'] == {'pixel': [0, 0], 'expected': color, 'observed': [0, 0, 255, 255]},
                'truncated high VS upload degenerates the quad and leaves exact blue clear')
    else:
        require(actual == expected and draw['pixels'] == 1024 and 'failure' not in draw,
                f'independently reconstructed full framebuffer: {draw["name"]}')
    require(rig['geometry'] == {'positions': [-1, -1, 1, -1, 1, 1, -1, 1], 'components': 2,
            'indices': [0, 1, 2, 0, 2, 3], 'width': 32, 'height': 32}, 'literal source geometry')
    submission = rig['submissions'][draw['submissionIndex']]
    require(submission['contextId'] == draw['contextId'] and submission['result']['ok'] is True,
            'draw belongs to a successful exact submission')
    packets = packet_words(submission['bytes'])
    require(any(packet['opcode'] == 8 and packet['payload'] == [0, 6, 4, 1, 1, 0, 0, 0, 0, 0, 3, 0]
                for packet in packets), 'recorded indexed triangle draw bytes')
    require(len(draw['selectedShaders']) == 2 and len(draw['uniforms']) == 2, 'both selected stages recorded')
    for selected in draw['selectedShaders']:
        stage = 'vertex' if selected['stage'] == 0 else 'fragment'
        matches = [case for case in cases.values() if case['stage'] == stage
                   and next(f['text'] for f in read(ROOT / FIXTURE) if f['name'] == case['name']) == selected['text']]
        require(len(matches) == 1, 'selected original shader input equals native fixture')
        case = matches[0]
        uniform = next(value for value in draw['uniforms'] if value['stage'] == stage)
        require(uniform['count'] == case['expected']['constantCount'], 'draw declared extent')
        require(0 <= uniform['activeCount'] <= uniform['count']
                and uniform['uploadCount'] == min(uniform['activeCount'], 46), 'actual bounded active upload extent')
        require(uniform['activeCount'] * 4 <= draw['hostUniformComponents'][selected['stage']], 'actual stage component budget')
        count = uniform['uploadCount'] * 4
        bank = draw['bindings']['constants'][selected['stage']]
        inactive = 'inactive' in case['name']
        require((uniform['activeCount'] == 0) is inactive, 'actual wholly unused declaration reflection')
        if inactive:
            require(bank == [] and uniform['words'] == [], 'inactive stage needs/uploads no guest input')
        else:
            require(len(bank) >= count and bank == expected_bank(mode, selected['stage'])[:len(bank)],
                    'logical guest prefix equals independent literal constants')
            if not failure:
                require(uniform['words'][:count] == bank[:count], 'actual restored raw uniform words equal guest input')
            else:
                require(uniform['words'][:180] == bank[:180] and uniform['words'][180:184] == [0] * 4,
                        'sabotaged upload leaves high element uninitialized')
    return len(actual) // 4


def verify_rig(rig, cases, sabotage=False):
    require(rig['glObjects']['live'] == 0, 'actual native objects all released')
    for group in ('finalBudgets', 'finalResourceBudgets'):
        require(all(value == 0 for value in rig.get(group, {}).values()), 'zero final owned budgets')
    events = rig['glEvents']
    require([event['sequence'] for event in events] == list(range(len(events))), 'complete ordered GL event ledger')
    live = {}
    compiled, linked, input_mutations = set(), set(), 0
    for event in events:
        call = event['call']
        if call.startswith('create'):
            require(event['id'] not in live, 'unique native object creation')
            live[event['id']] = call[6:]
        elif call.startswith('delete'):
            require(live.pop(event['id'], None) == call[6:], 'delete exact native object generation')
        elif call == 'fenceSync' and 'id' in event:
            require(event['id'] not in live, 'unique fence ownership')
            live[event['id']] = 'Sync'
        elif call == 'compileShader':
            require(event['status'] is True, 'actual shader compile succeeded')
            compiled.add(event['id'])
        elif call == 'linkProgram':
            require(event['status'] is True, 'actual program linked before validation')
            linked.add(event['id'])
        elif call == 'uniform4uiv':
            require(event['programId'] == event['currentProgramId'] and event['programId'] in linked,
                    'upload belongs to actual selected linked program')
            require(event['name'] in ('vsconst0[0]', 'fsconst0[0]') and len(event['words']) <= 184
                    and len(event['words']) % 4 == 0, 'renderer never uploads host-only index46')
        elif call == 'input-mutation':
            input_mutations += 1
    require(not live, 'balanced actual GL object lifetime ledger')
    if rig['draws']:
        require(len(compiled) >= 2 and linked, 'draw evidence has successful actual compilation and linking')
    if rig['name'] == 'primary' and not sabotage:
        require(input_mutations == 1, 'synchronous caller mutation occurs after predecode')
    shader_by_text = {fixture['text']: cases[fixture['name']]['result'] for fixture in read(ROOT / FIXTURE)}
    for translation in rig['translations']:
        require(translation['result'] == shader_by_text[translation['request']['text']], 'actual renderer consumed native-proven shader input')
    for event in events:
        if event['call'] == 'shaderSource':
            require(event['source'] in [result['glsl'] for result in shader_by_text.values()], 'actual GL source equals unchanged compiler output')
    raw_high, raw_short, raw_empty = 0, 0, 0
    for submission in rig['submissions']:
        packets = packet_words(submission['bytes'])
        result = submission['result']
        if result['ok']:
            require(result['appliedCommands'] == len(packets), 'all successful raw packets applied exactly once')
        if 'inputAfter' in submission:
            require(submission['inputAfter'] == [255] * len(submission['bytes']), 'caller bytes actually overwritten')
        for packet in packets:
            if packet['opcode'] == 12:
                stage, slot, *words = packet['payload']
                require(stage in (0, 1) and slot == 0, 'authored stage/slot constant boundary')
                require(len(words) in (0, 32, 180, 184, 188), 'explicit bounded authored packet lengths')
                if len(words) == 188:
                    require(not result['ok'] and result['appliedCommands'] == 0, 'over-limit tail has no effects')
                raw_high += len(words) == 184
                raw_short += len(words) == 180
                raw_empty += not words
    for attack in rig['attacks']:
        before, after, result = attack['before'], attack['after'], attack['result']
        require(result['ok'] is False and before['budgets'] == after['budgets'], 'rejected draw preserves owned budgets')
        require(not any(event['call'] in ('drawElements', 'getBufferSubData', 'copyBufferSubData') for event in attack['events']),
                'incomplete constants reject before index reading/staging/drawing')
        prefix = 'valid prefix' in attack['name']
        require(result['appliedCommands'] == int(prefix), 'semantic applied prefix reported truthfully')
        if not prefix:
            require(before == after, 'rejected draw alone preserves complete logical state')
        if attack['name'] == 'malformed-tail':
            require(result['error']['code'] == 'limit-exceeded' and attack['events'] == [], 'whole malformed submission has no effects')
        else:
            require(result['error']['code'] == 'incomplete-draw', 'missing legal prefix is a draw completeness error')
    return {'highPackets': raw_high, 'shortPackets': raw_short, 'emptyPackets': raw_empty,
            'pixels': sum(verify_draw(draw, rig, cases, sabotage) for draw in rig['draws'])}


def verify_hardware(proof, cases):
    require(proof['status'] == 'passed' and len(proof['rigs']) == 10 and len(proof['validationRigs']) == 25,
            'complete actual and explicitly controlled validation rigs')
    rigs = {rig['name']: rig for rig in proof['rigs']}
    require(len(rigs) == 10 and all(rig['classification'] == 'actual-hardware' for rig in rigs.values()),
            'actual reflection separated from injected validation')
    totals = [verify_rig(rig, cases) for rig in proof['rigs'] + proof['validationRigs']]
    require(sum(result['pixels'] for result in totals) == proof['checkedPixels'] == 45056, '44 complete exact GPU framebuffers')
    require(all(value > 0 for value in (sum(item[key] for item in totals) for key in ('highPackets', 'shortPackets', 'emptyPackets'))),
            'full, short and empty raw uploads exercised')
    primary = rigs['primary']
    expected_modes = ['A', 'A', 'B', 'A', 'B', 'B', 'A', 'B', 'B', 'B', 'A']
    require([draw['expectedMode'] for draw in primary['draws']] == expected_modes and len(primary['attacks']) == 9,
            'full context/subcontext switch and replacement sequence')
    programs = [draw['nativeProgramId'] for draw in primary['draws']]
    require(len({programs[index] for index in (0, 1, 3, 6, 10)}) == 1
            and programs[2] == programs[4] and programs[5] == programs[7]
            and len({programs[index] for index in (0, 2, 5, 8, 9)}) == 5,
            'A/B/A program ownership and new objects after numeric-ID reuse')
    require(len(primary['lifecycle']) == 2 and len(primary['poison']) == 3, 'recreation and explicit native uniform poisons')
    poisons = [float_bits([16, -8, 4, -2]), float_bits([-1, 32, -16, 8])]
    for poison, words in zip(primary['poison'], [poisons[0], poisons[1], poisons[0]]):
        require(len(poison['entries']) == 8 and all(entry['values'] == entry['observed'] == words for entry in poison['entries']),
                'actual low and high uniform poison applied to both stages')
    require(rigs['low']['retainedExtent'] == [{'stage': stage, 'count': 46, 'activeCount': 46, 'uploadCount': 46}
            for stage in ('vertex', 'fragment')] and len(rigs['low']['attacks']) == 1,
            'qualified driver retains full low-read declaration; short low-prefix draw rejected')
    order = rigs['order']
    require(len(order['padding']) == 2, 'two distinct retained-padding poisons')
    for item, words in zip(order['padding'], poisons):
        require([entry['name'] for entry in item['poisoned']['entries']] == ['vsconst0[46]', 'fsconst0[46]'],
                'both actual stages retain host-only padding')
        require(all(entry['values'] == entry['observed'] == words for entry in item['poisoned']['entries'])
                and item['after'] == [{'name': name, 'observed': words} for name in ('vsconst0[46]', 'fsconst0[46]')],
                'neither stage overwrites host-only padding')
    for draw in order['draws']:
        require(all((uniform['count'], uniform['activeCount'], uniform['uploadCount']) == (47, 47, 46)
                    for uniform in draw['uniforms']), 'declared47/reflected47/addressable46 in both stages')
    require(not any(event['call'] == 'uniform4uiv' for event in rigs['both-inactive']['glEvents']), 'no uploads for wholly unused arrays')
    for seed, step in zip(('7c1209ad', '491be583', 'ea016f35', '265d8cb7'), (1, 2, 3, 8)):
        rig = rigs[f'async-{seed}']
        require(rig['schedule'] == {'seed': int(seed, 16), 'commandsPerStep': step}
                and [draw['expectedMode'] for draw in rig['draws']] == ['A', 'B', 'A']
                and [attack['name'] for attack in rig['attacks']] == ['async-short180', 'async-empty'],
                'varied deterministic asynchronous schedule, missing input and recovery')
        require(all('states' in submission and submission['inputAfter'] == [255] * len(submission['bytes'])
                    for submission in rig['submissions']), 'every asynchronous begin owns its submission snapshot')
        require(any(state['status'] == 'waiting-gpu' for submission in rig['submissions'] for state in submission['states']),
                'asynchronous proof actually crossed GPU wait boundaries')
    verify_validation(proof['validationRigs'])


def verify_validation(rigs):
    failures = ['vs-wrong-type', 'fs-wrong-type', 'vs-size48', 'vs-exceeds-declared', 'vs-size-zero', 'vs-size-negative',
                'vs-size-fraction', 'vs-size-nan', 'vs-missing-index', 'vs-missing-location', 'fs-missing-index',
                'fs-missing-location', 'vs-limit', 'fs-limit', 'order-limit']
    accepted = ['vs-shorter', 'fs-shorter', 'vs-absent', 'fs-absent']
    host = ['host-invalid-zero', 'host-invalid-negative', 'host-invalid-fraction', 'host-invalid-string',
            'host-invalid-nan', 'host-invalid-infinity']
    require([rig['name'] for rig in rigs] == failures + accepted + host, 'bounded reflection/host fault matrix')
    for rig in rigs:
        mode = rig['name']
        require(rig['classification'].startswith('real-GL-pass-through-'), 'faults explicitly classified as controlled validation')
        if mode in host:
            require(rig['constructorResult']['ok'] is False and rig['constructorResult']['error']['code'] == 'unsupported-host'
                    and rig['glObjects'] == {'created': 2, 'live': 0}
                    and [event['call'] for event in rig['glEvents'] if event['call'].startswith('create')]
                    == ['createVertexArray', 'createFramebuffer'],
                    'invalid renderer host capability rejects; preexisting transfer backend helpers released')
            continue
        record = rig['validation']
        if mode in failures:
            require(record['result']['ok'] is False and record['result']['error']['code'] == 'shader-reflection-error'
                    and record['result']['appliedCommands'] == 0, 'bad reflection rejects unpublished program')
            require(record['before'] == record['after'] and record['countsBefore'] == record['countsAfter'],
                    'reflection failure releases exact state, system buffer and native charges')
            require(any(event['call'] == 'linkProgram' and event['status'] for event in record['events']),
                    'controlled reflection failure follows successful actual driver link')
            if mode.startswith('fs-'):
                created = [event['id'] for event in record['events'] if event['call'] == 'createBuffer']
                deleted = [event['id'] for event in record['events'] if event['call'] == 'deleteBuffer']
                require(created and created == deleted, 'late fragment failure releases preceding vertex system UBO')
            if mode.endswith('limit'):
                require(record['before']['hostUniformComponents'] == ([183, 4096] if mode == 'vs-limit'
                        else [4096, 183] if mode == 'fs-limit' else [187, 4096]), 'stage-specific component bound includes retained padding')
            else:
                require(len(rig['draws']) == 1, 'same-context true-hardware recovery after fault')
        else:
            stage = 'vertex' if mode.startswith('vs-') else 'fragment'
            target = next(uniform for uniform in record['reflection'] if uniform['stage'] == stage)
            count = 8 if mode.endswith('shorter') else 0
            require((target['count'], target['activeCount'], target['uploadCount']) == (46, count, count),
                    'simulated pruned reflection does not rewrite compiler declaration')
            require(record['actualDrawClaim'] is False if not count else record['actualDrawClaim'].endswith('supplied by wrapper'),
                    'simulated absence/pruning is not represented as actual optimization evidence')


def main():
    require(len(sys.argv) == 2, 'usage: receipt.py EVIDENCE_DIRECTORY')
    output = Path(sys.argv[1]).resolve()
    head = git('rev-parse', 'HEAD').decode().strip()
    contract = read(ROOT / 'docs/gpu-3d-contract.json')
    held_contract = json.loads(git('show', f'{HELD_HEAD}:docs/gpu-3d-contract.json'))
    require(contract['production'] == held_contract['production'] and contract['shaderProfile'] == PROFILE,
            'production activation and compiler profile remain unchanged')
    native, fixtures, cases, originals = verify_native(output, head)
    decoder = verify_decoder(output)
    hardware = verify_browser(output / 'hardware', head, contract)
    sabotage = verify_browser(output / 'sabotage', head, contract, passed=False)
    for report in (hardware, sabotage):
        verify_translations(report['acceptance'], fixtures, cases, originals, decoder)
    verify_hardware(hardware['acceptance'], cases)
    control = sabotage['acceptance']
    require(control['status'] == 'failed' and len(control['rigs']) == 1 and not control['validationRigs']
            and len(control['rigs'][0]['draws']) == 1, 'source sabotage stops on first intended draw')
    verify_rig(control['rigs'][0], cases, sabotage=True)
    mutation = sabotage['sabotage']
    source = ROOT / 'renderer/virgl-command/state.mjs'
    before = 'gl.uniform4uiv(uniform.location, words);'
    after = 'gl.uniform4uiv(uniform.location, words.subarray(0, Math.min(words.length, 180)));'
    require(source.read_text().count(before) == 1 and mutation['mode'] == 'high-upload'
            and mutation['source'] == str(source.relative_to(ROOT)) and mutation['before'] == before
            and mutation['after'] == after and mutation['originalSha256'] == sha(source.read_bytes())
            and mutation['servedSha256'] == sha(source.read_text().replace(before, after).encode()),
            'exact served-source high upload sabotage')
    require('A first high-bank draw independent pixel (0,0)' in control['failure']['message'], 'sabotage fails intended independent oracle')
    require(hardware['sources'] == sabotage['sources'], 'identical hardware/control source identities')
    regression = read(output / 'regression/receipt.json')
    require(regression['task'] == 'E6-T11b1' and regression['status'] == 'passed' and regression['gitHead'] == head,
            'current shared decoder/resource/state/draw/async regression proof')
    require(regression['synchronousRegressions'] == ['decoder', 'resources', 'state', 'draw']
            and regression['sourceControlsRejected'] == ['early-collect', 'index-class'], 'original replay and asynchronous controls')
    verify_records(output / 'regression', regression)
    for item in regression['sources'] + regression['inputs']:
        verify_source(item, head)
    flat = verify_browser(output / 'flat-regression', head, contract, task='E6-T12e2')
    proof = flat['acceptance']
    require(proof['status'] == proof['shaderPairs']['status'] == proof['rendererPairs']['status'] == 'passed'
            and proof['sabotage'] is None and len(proof['shaderPairs']['cases']) == 114
            and len(proof['shaderPairs']['draws']) == 8 and len(proof['rendererPairs']['draws']) == 44
            and len(proof['rendererPairs']['faults']) == 12 and len(proof['rendererPairs']['quota']) == 2,
            'flat shader interface and variant ownership regressions')
    names = {entry['path'] for report in (hardware, flat, regression) for entry in report['sources']}
    names.update(entry['path'] for entry in native['sources'])
    names.update(str(path.relative_to(ROOT)) for path in (ROOT / 'tools/virgl-constants').glob('*') if path.is_file())
    names.update(('tools/verify-virgl-constants.sh', 'docs/gpu-3d-contract.json', 'docs/gpu-3d-decision.md', 'Makefile'))
    sources = []
    for name in sorted(names):
        if '/build/' not in name:
            item = binding(ROOT / name)
            verify_source(item, head)
            sources.append(item)
    records = [binding(path, output) for path in sorted(output.rglob('*')) if path.is_file()
               and path != output / 'receipt.json' and path.name != 'acceptance.log']
    receipt = {'schema': 1, 'task': 'E6-T12e3b', 'status': 'passed', 'gitHead': head,
               'boundary': 'Bounded finite float-bit constant uploads and actual renderer reflection/restoration; no guest acceleration activation.',
               'heldShaderHead': HELD_HEAD, 'production': contract['production'],
               'shaderOutcomes': {'translated': 12, 'unsupported-feature': 7},
               'decoderCases': 23, 'hardwarePixels': 45056, 'actualRigs': 10, 'validationRigs': 25,
               'sources': sources, 'records': records, 'compilerSha256': {
                   'renderer/virgl-shader/build/native/virgl-shader': native['binarySha256'],
                   'renderer/virgl-shader/build/wasm/virgl-shader.wasm': sha((ROOT / 'renderer/virgl-shader/build/wasm/virgl-shader.wasm').read_bytes())}}
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('E6-T12e3b passed: 184-word transport, true reflection, isolated sync/async constants and 45,056 independent pixels.')


if __name__ == '__main__':
    main()
