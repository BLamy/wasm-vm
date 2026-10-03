#!/usr/bin/env python3
"""Bind native/Wasm compiler results to independently reconstructed GPU words."""
import importlib.util
import json
from pathlib import Path
import re
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
HELD_HEAD = 'f643c50d3379e4e27a1daf1784f67287fe36d562'
LEGACY = 'virgl-webgl2-straight-line-v5'
RAW = 'virgl-webgl2-raw-bits-v1'
LIMITS = {'textBytes': 16384, 'tokens': 8192, 'glslBytes': 65536, 'instructions': 179,
          'registerIndex': 7, 'temporaryRegisterIndex': 117, 'constantRegisterIndex': 45}


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


base = module('constants_receipt', 'tools/virgl-constants/receipt.py')
require, sha, read, binding, git = base.require, base.sha, base.read, base.binding, base.git
verify_source, verify_records = base.verify_source, base.verify_records


def result_stage(result, stage, profile):
    require(set(result) == {'glsl', 'metadata'}, 'complete exact stage result')
    metadata = result['metadata']
    require(metadata['stage'] == stage and metadata['profile'] == profile, 'exact stage/backend')
    require(result['glsl'].startswith('#version 300 es') and len(result['glsl'].encode()) <= 65536,
            'bounded ESSL300')
    for uniform in metadata['uniforms']:
        require(uniform['type'] == 'uvec4[]' and uniform['encoding'] == 'float32-bits'
                and 1 <= uniform['count'] <= 47, 'unchanged uniform declaration ABI')
        require(re.search(r'\b' + re.escape(uniform['name']) + r'\[' + str(uniform['count']) + r'\]', result['glsl']),
                'uniform metadata agrees with GLSL')


def verify_native(output, head):
    native = read(output / 'native/native-report.json')
    require(native['schema'] == 'wasm-vm-raw-bits-native-v1' and native['status'] == 'passed', 'native schema/outcome')
    require(native['sanitizers'] == ['address', 'undefined'] and native['mutationsPerSeed'] == 1024
            and native['seeds'] == ['184c73b9', 'a9012d67', '526be80f', 'db740635'], 'sanitizer/mutation identity')
    for source in native['sources'] + native['fixtures'] + [native['legacyBaseline']] + native['originals']:
        verify_source(source, head)
    log = (output / 'native/native.log').read_bytes()
    require(sha(log) == native['logSha256'] and sha((output / 'native/native-input.bin').read_bytes()) == native['streamSha256'],
            'native full transcript/input digests')
    require(sha((ROOT / 'renderer/virgl-shader/build/raw-bit-sanitize/raw-bit-test').read_bytes()) == native['binarySha256'],
            'actual sanitizer binary digest')
    coverage = native['coverage']
    require(coverage['schema'] == 'wasm-vm-raw-bits-native-coverage-v1', 'native execution counter schema')
    verify_records(output / 'native', coverage)
    for source in coverage['sources']:
        verify_source(source, head)
    require({entry['path'] for entry in coverage['sources']} == {
        'renderer/virgl-shader/bridge.c', 'renderer/virgl-shader/raw_bits.c'}, 'both changed C files recorded')
    groups = {'ORIGINAL': native['originals'], 'CASE': native['cases'], 'PAIR': native['pairs']}
    seen = {key: set() for key in groups}
    for line in log.decode().splitlines():
        match = re.fullmatch(r'(ORIGINAL|CASE|PAIR) ([0-9]+) (.+)', line)
        if match:
            group, index, raw = match[1], int(match[2]), match[3].encode()
            require(index < len(groups[group]) and index not in seen[group], 'unique native transcript entry')
            seen[group].add(index)
            entry = groups[group][index]
            require(json.loads(raw) == entry['result'] and len(raw) == entry['resultBytes']
                    and sha(raw) == entry['resultSha256'], 'native full result bytes')
    require(all(len(seen[key]) == len(group) for key, group in groups.items()), 'complete native transcript')
    held = read(ROOT / native['legacyBaseline']['path'])
    old = {item['sha256']: item for item in held['originals']}
    originals = {item['sha256']: item for item in native['originals']}
    require(len(originals) == 19 and set(originals) == set(old), 'exact original corpus')
    for digest, entry in originals.items():
        require(entry['result'] == old[digest]['result'] and entry['stage'] == old[digest]['stage'],
                'legacy original full GLSL/metadata/error stability')
    require(sum(item['ok'] for item in originals.values()) == 12, 'twelve accepted/seven rejected originals')
    fixtures = read(ROOT / 'renderer/virgl-shader/tests/raw-bit-cases.json')
    hardware = read(ROOT / 'renderer/virgl-shader/tests/raw-bit-hardware.json')
    cases = {item['name']: item for item in native['cases']}
    require(len(cases) == len(fixtures) + len(hardware['shaders']) == len(native['cases']), 'unique complete shared inputs')
    for fixture in fixtures + hardware['shaders']:
        entry = cases[fixture['name']]
        require(entry['inputSha256'] == sha(fixture['text'].encode()) and entry['bytes'] == len(fixture['text'].encode())
                and entry['stage'] == fixture['stage'] and entry['ok'] is fixture.get('ok', True), 'shared native fixture identity')
        result = entry['result']
        require(result['ok'] is entry['ok'], 'literal native admission result')
        if result['ok']:
            require(set(result) == {'ok', 'glsl', 'metadata'}, 'complete native success')
            result_stage({k: result[k] for k in ('glsl', 'metadata')}, entry['stage'], entry['profile'])
        else:
            require(set(result) == {'ok', 'error'} and result['error']['code'] == fixture['expected']['errorCode'],
                    'literal structured rejection without partial output')
    pairs = {entry['name']: entry for entry in native['pairs']}
    require(len(pairs) == len(hardware['pairs']) + 4, 'positive pairs and both-stage parse/feature rollback')
    for entry in pairs.values():
        v, f = cases[entry['vertexCaseName']], cases[entry['fragmentCaseName']]
        require((entry['vertexSha256'], entry['fragmentSha256']) == (v['inputSha256'], f['inputSha256']), 'pair input identity')
        result = entry['result']
        require(result['ok'] is entry['ok'], 'native pair outcome')
        if result['ok']:
            require(set(result) == {'ok', 'vertex', 'fragment', 'interfaceKey'}
                    and result['interfaceKey'] == entry['expected']['interfaceKey'], 'derived exact pair interface')
            result_stage(result['vertex'], 'vertex', v['profile'])
            result_stage(result['fragment'], 'fragment', f['profile'])
            require(result['fragment'] == {k: f['result'][k] for k in ('glsl', 'metadata')}, 'standalone fragment exact identity')
        else:
            require(set(result) == {'ok', 'error'} and result['error']['code'] == entry['expected']['errorCode'], 'pair rollback')
    stats = native['stats']
    attacks = len(cases) + stats['truncations'] + stats['hostileCases'] + 4096
    require(stats['mutations'] == 4096 and stats['standaloneRecoveries'] == attacks * 4
            and stats['pairRecoveries'] == attacks * 2 and stats['calls'] == 19 + len(pairs) + 4 + attacks * 7,
            'deterministic recovery accounting')
    for seed in native['seeds']:
        require(log.decode().count(f'SEED {seed} mutations=1024 standalone_recoveries=4096 pair_recoveries=2048 passed') == 1,
                'recorded complete mutation seed')
    return native, fixtures, hardware, cases, pairs, originals


def reference(operation, a, b):
    mask = 2 ** 32 - 1
    if operation == 'mov':
        return a
    if operation == 'and':
        return [x & y for x, y in zip(a, b)]
    if operation in ('or', 'maximal'):
        return [x | y for x, y in zip(a, b)]
    if operation == 'not':
        return [mask - x for x in a]
    if operation == 'shl':
        return [(x << (y % 32)) % (2 ** 32) for x, y in zip(a, b)]
    if operation == 'ushr':
        return [x // (2 ** (y % 32)) for x, y in zip(a, b)]
    if operation == 'immediate':
        return [x | y for x, y in zip(a, [0xffffffff, 0x7fc00001, 0x7f800000, 1])]
    if operation == 'alias':
        return [((mask - a[0]) << (b[1] % 32)) % (2 ** 32),
                ((mask - a[1]) << (b[0] % 32)) % (2 ** 32), a[2] | b[3], mask - a[3]]
    raise ValueError(f'unknown independent operation {operation}')


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
    require(len(proof['pairs']) == len(hardware['pairs']) == 18 and len(proof['rejectionPairs']) == 4, 'complete pair parity')
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


def uniforms(probe, vector):
    reflection = probe['uniformReflection']
    count = reflection['activeCount']
    declaration = 47 if probe['name'] == 'order' else 46
    require(reflection['declaredCount'] == declaration and 45 <= count <= declaration and reflection['uploadCount'] == min(count, 46)
            and reflection['type'] == 36296 and reflection['hostUniformInjectionOnly'] is True,
            'actual UNSIGNED_INT_VEC4 array reflection')
    if count == 47:
        padding = reflection['paddingPoison']
        require(padding['index'] == 46 and padding['words'] == padding['observed'] == [0xdeadbeef, 0x7f800001, 0xff800000, 1],
                'actual host-only padding poison')
    else:
        require(reflection['paddingPoison'] is None, 'no nonexistent padding claim')
    upload = vector['upload']
    words = [0] * (min(count, 46) * 4)
    words[:4] = vector['a']
    if count >= 46:
        words[180:184] = vector['b']
    require(upload['wordCount'] == len(words) and upload['words'] == words and upload['observedA'] == vector['a']
            and upload['observedB'] == (vector['b'] if count >= 46 else None), 'actual input uniform uploads/readback')


def padding_after_draw(probe, draw):
    padding = probe['uniformReflection']['paddingPoison']
    require(draw['paddingAfterDraw'] == (padding['words'] if padding else None),
            'host-only padding survives every actual selector draw')


def selector(record, value):
    upload = record['selectorUpload']
    require(record['selector'] == value and upload == {'index': 44, 'words': [value] * 4, 'observed': [value] * 4},
            'actual dynamic selector uniform/readback')


def program(probe, vertex, fragment):
    require(set(probe['programLogs']) == {'vertex', 'fragment', 'link'} and
            all(isinstance(v, str) for v in probe['programLogs'].values()), 'recorded actual compile/link logs')
    require(probe['vertexGlslSha256'] == sha(vertex['glsl'].encode())
            and probe['fragmentGlslSha256'] == sha(fragment['glsl'].encode()), 'hardware consumed exact generated GLSL')
    blocks = probe['uniformBlocks']
    require(len(blocks) == 1 and blocks[0]['name'] == 'VirglBlock' and blocks[0]['byteLength'] == 656,
            'actual unchanged vertex system-block layout')
    members = blocks[0]['members']
    require(len(members) == 1 and members[0]['name'] == 'winsys_adjust_y' and members[0]['offset'] == 640
            and members[0]['type'] == 5126 and members[0]['value'] == 1, 'actual system orientation uniform')


def verify_gpu(proof, fixture, cases, pairs):
    definitions = {item['name']: item for item in fixture['probes']}
    vectors = {item['name']: item for item in fixture['vectors']}
    orientation = proof['orientation']
    require(orientation['vertex'] == 'raw-mov-vertex' and orientation['fragment'] == 'legacy-fragment'
            and orientation['attribute']['values'] == [[.25, .5, -.25, 1]], 'literal nonzero-y vertex orientation input')
    program(orientation, cases['raw-mov-vertex']['result'], cases['legacy-fragment']['result'])
    source = vectors['zeros-edges']
    require(orientation['vector'] == source and orientation['selectorUpload'] == {'index': 44, 'words': [0] * 4, 'observed': [0] * 4},
            'actual orientation raw input and zero byte selector')
    uniforms(dict(orientation, name='orientation'), dict(source, upload=orientation['upload']))
    require(len(orientation['captures']) == 2, 'both coordinate-system signs actually executed')
    for adjust, capture in zip((-1, 1), orientation['captures']):
        uniform = 0xbf800000 if adjust == -1 else 0x3f800000
        require(capture['adjust'] == adjust and capture['uniformUpdate'] == {
            'offset': 640, 'expectedBits': [uniform], 'observedBits': [uniform]}, 'actual bound system UBO update/readback')
        bits = [0x3e800000, 0xbf000000 if adjust == -1 else 0x3f000000, 0xbe800000, 0x3f800000]
        bits += [0x3f000000 + (word % 256) * 32768 for word in source['a']]
        raw = struct.pack('<8I', *bits)
        require(capture['expectedBits'] == capture['observedBits'] == bits and capture['rawBytes'] == list(raw)
                and capture['bytesSha256'] == sha(raw), 'independent complete orientation feedback result')
    require(len(proof['vertexProbes']) == len(proof['fragmentProbes']) == len(definitions) == 10, 'all operations in both stages')
    for stage, key in [('vertex', 'vertexProbes'), ('fragment', 'fragmentProbes')]:
        for probe in proof[key]:
            definition = definitions[probe['name']]
            vertex = cases[definition['vertex'] if stage == 'vertex' else 'legacy-vertex']['result']
            fragment = cases['legacy-fragment' if stage == 'vertex' else definition['fragment']]['result']
            program(probe, vertex, fragment)
            require(probe['oracle'] == definition['oracle'] and [v['name'] for v in probe['vectors']] == definition['vectors'],
                    'exact independent operation and input vector sequence')
            if stage == 'vertex':
                require(probe['feedbackReflection'] == [{'name': n, 'size': 1, 'type': 35666} for n in ['gl_Position', 'vso_g0']],
                        'two FLOAT_VEC4 feedback values')
            for value in probe['vectors']:
                source = vectors[value['name']]
                require(value['a'] == source['a'] and value['b'] == source['b'], 'literal raw vector input')
                expected = reference(definition['oracle'], source['a'], source['b'])
                require(value['expectedWords'] == value['observedWords'] == expected, 'independent complete raw-u32 result')
                uniforms(probe, value)
                reconstructed = [0] * 4
                if stage == 'vertex':
                    require(len(value['captures']) == 4, 'four actual byte feedback captures')
                    for shift, capture in zip((0, 8, 16, 24), value['captures']):
                        selector(capture, shift)
                        padding_after_draw(probe, capture)
                        byte_values = [(word // 2 ** shift) % 256 for word in expected]
                        bits = [0, 0, 0, 0x3f800000] + [0x3f000000 + byte * 32768 for byte in byte_values]
                        raw = struct.pack('<8I', *bits)
                        require(capture['expectedBytes'] == capture['decodedBytes'] == byte_values
                                and capture['expectedBits'] == capture['observedBits'] == bits
                                and capture['rawBytes'] == list(raw) and capture['bytesSha256'] == sha(raw),
                                'independent normal finite carrier bits and all raw feedback bytes')
                        for lane, byte in enumerate(byte_values):
                            reconstructed[lane] += byte * 2 ** shift
                else:
                    require(len(value['draws']) == 32, 'thirty-two actual fragment bit planes')
                    raw = bytearray()
                    for bit, draw in enumerate(value['draws']):
                        selector(draw, bit)
                        padding_after_draw(probe, draw)
                        pixels = [255 * ((word // 2 ** bit) % 2) for word in expected]
                        require(draw['expectedBytes'] == draw['observedBytes'] == pixels, 'independent exact fragment bitplane bytes')
                        raw.extend(pixels)
                        for lane, byte in enumerate(pixels):
                            reconstructed[lane] += (byte // 255) * 2 ** bit
                    require(value['bitPlaneBytesSha256'] == sha(raw), 'complete fragment bitplanes digest')
                require(reconstructed == expected, 'independent reconstructed32-bit words')
    require(len(proof['pairDraws']) == 15, 'full and partial mixed interfaces plus inactive constants')
    checked_pixels = 0
    for draw in proof['pairDraws']:
        result = pairs[draw['name']]['result']
        program(draw, result['vertex'], result['fragment'])
        mode = 'flat' if draw['name'].endswith('flat') else 'smooth'
        require(draw['mode'] == mode and draw['interfaceKey'] == result['interfaceKey'], 'derived hardware pair mode')
        inactive = draw['inactiveUniforms']
        if draw['name'] == 'inactive-raw-smooth':
            require(len(inactive) == 2 and {item['stage'] for item in inactive} == {'vertex', 'fragment'}
                    and all(item['declaredCount'] == 46 and item['index'] == 0xffffffff
                            and item['locationPresent'] is False for item in inactive),
                    'both declared constant banks actually inactive')
        else:
            require(inactive == [], 'no unauthored inactive constant fixture')
        raw = bytes(draw['rawBytes'])
        require(len(raw) == 4096 and sha(raw) == draw['bytesSha256'], 'complete interpolation framebuffer')
        for y in range(32):
            for x in range(32):
                # Exclude only exact triangle-edge pixel centers: their fill rule
                # is not the interpolation claim. All other1024-32 pixels count.
                if x + y == 31:
                    continue
                if x + y > 31:
                    expected = [0, 0, 255, 255]
                elif mode == 'flat':
                    expected = [0, 255, 0, 255]
                else:
                    expected = [((2 * v + 1) * 255 + 32) // 64 for v in (x, y)] + [0, 255]
                observed = list(raw[(y * 32 + x) * 4:(y * 32 + x) * 4 + 4])
                require(observed == expected, f'independent {draw["name"]} framebuffer({x},{y})')
                checked_pixels += 1
    require(proof['status'] == 'passed' and proof['sabotage'] is None and not proof['omissions']
            and proof['checkedWords'] == 480 and proof['objects']['live'] == 0
            and proof['objects']['created'] == proof['objects']['deleted'], 'complete hardware proof and GL cleanup')
    return checked_pixels


def verify_sabotage(proof, cases, fixture):
    require(proof['status'] == 'failed' and proof['sabotage'] == 'shift-mask' and len(proof['omissions']) == 1,
            'one intentional failing lowering control')
    mutation = proof['omissions'][0]
    original = cases['raw-shl-vertex']['result']
    glsl, matches = re.subn(r'vsconst0\[45\]\.([xyzw]) & 31u', r'vsconst0[45].\1 & 30u', original['glsl'])
    require(mutation['mode'] == 'shift-mask' and mutation['original'] == 'vsconst0[45].lane & 31u'
            and mutation['replacement'] == 'vsconst0[45].lane & 30u' and mutation['matches'] == matches == 4
            and mutation['originalGlslSha256'] == sha(original['glsl'].encode())
            and mutation['servedGlslSha256'] == sha(glsl.encode()), 'exact GLSL shift-mask sabotage')
    probe = proof['vertexProbes'][-1]
    require(probe['name'] == 'shl' and 'independent vertex byte' in proof['failure']['message'], 'actual intended oracle failure')
    program(probe, {'glsl': glsl}, cases['legacy-fragment']['result'])
    value = probe['vectors'][-1]
    source = next(v for v in fixture['vectors'] if v['name'] == value['name'])
    expected = reference('shl', source['a'], source['b'])
    capture = value['captures'][-1]
    selector(capture, capture['selector'])
    bits = [0, 0, 0, 0x3f800000] + [0x3f000000 + ((word >> capture['selector']) & 255) * 32768 for word in expected]
    observed = list(struct.unpack('<8I', bytes(capture['rawBytes'])))
    require(capture['expectedBits'] == bits and capture['observedBits'] == observed and observed != bits
            and capture['bytesSha256'] == sha(bytes(capture['rawBytes'])), 'compiled sabotage contradicts independent real output')
    require(proof['objects']['live'] == 0 and proof['objects']['created'] == proof['objects']['deleted'], 'sabotage GL cleanup')


def main():
    require(len(sys.argv) == 2, 'usage: receipt.py EVIDENCE_DIRECTORY')
    output = Path(sys.argv[1]).resolve()
    head = git('rev-parse', 'HEAD').decode().strip()
    contract = read(ROOT / 'docs/gpu-3d-contract.json')
    held_contract = json.loads(git('show', f'{HELD_HEAD}:docs/gpu-3d-contract.json'))
    require(contract['production'] == held_contract['production'] and contract['shaderProfile'] == LEGACY,
            'production activation and legacy profile unchanged')
    native, fixtures, hardware, cases, pairs, originals = verify_native(output, head)
    browser = base.verify_browser(output / 'hardware', head, contract, task='E6-T12e4a')
    control = base.verify_browser(output / 'sabotage', head, contract, passed=False, task='E6-T12e4a')
    for report in (browser, control):
        translations(report['acceptance'], fixtures, hardware, cases, pairs, originals)
    pixels = verify_gpu(browser['acceptance'], hardware, cases, pairs)
    verify_sabotage(control['acceptance'], cases, hardware)
    regressions = module('raw_bits_regressions', 'tools/virgl-raw-bits/regressions.py').verify(output, head, contract)
    names = {item['path'] for report in (browser, control) for item in report['sources']}
    names.update(item['path'] for item in native['sources'] + native['fixtures'])
    names.update(item['path'] for item in regressions['sources'])
    names.update(str(p.relative_to(ROOT)) for p in (ROOT / 'tools/virgl-raw-bits').glob('*.py'))
    names.update(('tools/verify-virgl-raw-bits.sh', 'docs/gpu-3d-contract.json', 'docs/gpu-3d-decision.md', 'Makefile'))
    sources = []
    for name in sorted(names):
        if '/build/' not in name:
            entry = binding(ROOT / name)
            verify_source(entry, head)
            sources.append(entry)
    records = [binding(path, output) for path in sorted(output.rglob('*'))
               if path.is_file() and path != output / 'receipt.json' and path.name != 'acceptance.log']
    receipt = {'schema': 1, 'task': 'E6-T12e4a', 'status': 'passed', 'gitHead': head,
               'boundary': 'Private raw32 shader storage and masked bitwise operations; float ABI and finite guest command transport unchanged.',
               'heldLegacyHead': HELD_HEAD, 'production': contract['production'],
               'profiles': [LEGACY, RAW], 'sources': sources, 'records': records,
               'shaderOutcomes': {'translated': 12, 'unsupported-feature': 7},
               'rawWords': 480, 'interpolationPixels': pixels, 'regressions': {k: v for k, v in regressions.items() if k != 'sources'},
               'compilerSha256': {'nativeSanitizer': native['binarySha256'],
                   'wasm': sha((ROOT / 'renderer/virgl-shader/build/wasm/virgl-shader.wasm').read_bytes())}}
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'E6-T12e4a passed:480 independently reconstructed raw words, {pixels} interpolation pixels and unchanged legacy regressions.')


if __name__ == '__main__':
    main()
