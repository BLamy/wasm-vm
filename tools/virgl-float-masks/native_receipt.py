#!/usr/bin/env python3
"""Independently bind ordered-float native transcripts and retained exact outputs."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[2]
HELD_HEAD = '7be4e09748bc4acfcdf167bd66cd6f3d890132d5'
INTEGER_BASELINE = 'evidence/virgl-integer-masks/worker/native/native-report.json'
INTEGER_SHA = 'a61a45c7f3a4eadb09d535acca247edc515d3bdb644ab37ff8bf5919e48ca0b4'
LEGACY_BASELINE = 'evidence/virgl-constants/worker/native/native-report.json'
LEGACY_SHA = '1ecee077496f3eea591ff4ac3a14afef91a33700d69d92b174d82bad3881ffef'
LEGACY = 'virgl-webgl2-straight-line-v5'
RAW = 'virgl-webgl2-raw-bits-v1'
MASK = 'virgl-webgl2-raw-bits-v2'
FLOAT = 'virgl-webgl2-raw-bits-v3'
SEEDS = ['6bd2c931', 'f1037a85', '2e849d67', 'a75c1b09']


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


base = module('integer_native_base', 'tools/virgl-constants/receipt.py')
raw_gate = module('integer_native_raw_stage', 'tools/virgl-raw-bits/receipt.py')
require, sha, read, binding, git = base.require, base.sha, base.read, base.binding, base.git
verify_source, verify_records = base.verify_source, base.verify_records
result_stage = raw_gate.result_stage


def fields(entry):
    return {key: entry[key] for key in ('path', 'bytes', 'sha256')}


def verify_coverage(native, directory, head):
    coverage = native['coverage']
    require(coverage['schema'] == 'wasm-vm-float-masks-native-coverage-v1', 'native execution counter schema')
    verify_records(directory, coverage)
    for source in coverage['sources']:
        verify_source(source, head)
    expected = {'renderer/virgl-shader/bridge.c', 'renderer/virgl-shader/raw_bits.c'}
    require({entry['path'] for entry in coverage['sources']} == expected, 'both changed C files recorded')
    exported = read(directory / 'coverage.json')
    require(exported['type'] == 'llvm.coverage.json.export' and len(exported['data']) == 1,
            'complete LLVM coverage export')
    files = exported['data'][0]['files']
    require({str(Path(item['filename']).resolve().relative_to(ROOT)) for item in files} == expected,
            'LLVM counters cover exact bound implementations')
    recorded = {item['path']: item for item in coverage['sources']}
    for item in files:
        path = str(Path(item['filename']).resolve().relative_to(ROOT))
        require(item['summary'] == recorded[path]['summary'] and item['segments'] and
                item['summary']['lines']['covered'] > 0, 'recorded source counters and summary agree')
    for tool in coverage['tools']:
        require(sha(Path(tool['path']).read_bytes()) == tool['sha256'] and tool['version'], 'coverage tool identity')
    stack = coverage['nativeStack']
    require(stack['boundary'] == 'Instrumented native per-function observations only; dynamic sanitizer frames do not establish total or Wasm stack usage.',
            'native stack measurements cannot claim Wasm or total stack')
    require([item['path'] for item in stack['files']] == ['bridge.su', 'raw_bits.su'], 'both compiler stack observations')
    for record in stack['files']:
        decoded = []
        for line in (directory / record['path']).read_text().splitlines():
            function, size, kind = line.split('\t')
            require(size.isdecimal() and kind in ('static', 'dynamic', 'dynamic,bounded'), 'literal stack record')
            decoded.append({'function': function, 'bytes': int(size), 'kind': kind})
        require(decoded == record['functions'] and record['source'] == 'renderer/virgl-shader/' + record['path'][:-3] + '.c',
                'compiler stack transcript exactly represented')


def verify_workload(cases, pairs, fixtures, hardware):
    """Validate authored outcomes independently of native.py's stream builder."""
    expected = fixtures + [dict(f, ok=True) for f in hardware['shaders']]
    require(len(cases) == len(expected) and len({e['name'] for e in cases}) == len(cases), 'complete unique shared inputs')
    by_name = {}
    for i, (entry, fixture) in enumerate(zip(cases, expected)):
        raw = fixture['text'].encode('ascii')
        profile = fixture.get('profile', fixture.get('expected', {}).get('profile'))
        require(entry['name'] == fixture['name'] and entry['inputSha256'] == sha(raw) and entry['text'] == fixture['text'] and
                entry['bytes'] == len(raw) and entry['stage'] == fixture['stage'] and entry['ok'] is fixture['ok'] and
                entry['origin'] == ('shared' if i < len(fixtures) else 'hardware'), 'exact input/outcome binding')
        expected_fields = fixture.get('expected', {'profile': profile, 'instructions': fixture.get('instructions')})
        require(entry.get('expected') == expected_fields and entry.get('profile') == profile, 'literal fixture metadata expectations')
        result = entry['result']
        require(result['ok'] is entry['ok'], 'literal native admission outcome')
        if result['ok']:
            require(set(result) == {'ok', 'glsl', 'metadata'} and profile in (LEGACY, RAW, MASK, FLOAT), 'complete exact-profile native success')
            result_stage({k: result[k] for k in ('glsl', 'metadata')}, entry['stage'], profile)
            if 'constantCount' in expected_fields:
                uniforms = result['metadata']['uniforms']
                require(len(uniforms) == 1 and uniforms[0]['count'] == expected_fields['constantCount'], 'literal constant extent')
            if 'instructions' in expected_fields:
                count = sum(bool(re.match(r'^\s*(?:[0-9]+:\s*)?(?:MOV|ADD|MUL|MAD|TEX|AND|OR|NOT|SHL|USHR|UADD|ISGE|USEQ|USNE|UCMP|FSLT|FSGE)\b', line))
                            for line in fixture['text'].splitlines())
                require(count == expected_fields['instructions'] and count <= 179, 'authored instruction count')
        else:
            require(set(result) == {'ok', 'error'} and set(result['error']) == {'code', 'message'} and
                    result['error']['code'] == fixture['expected']['errorCode'], 'exact rejection without partial output')
        by_name[entry['name']] = entry
    expected_pairs = [{'name': item['name'], 'vertex': item['vertex'], 'fragment': item['fragment'], 'ok': True,
                       'expected': {'interfaceKey': item['interfaceKey']}} for item in hardware['pairs']]
    for stage in ('vertex', 'fragment'):
        for code in ('parse-error', 'unsupported-feature'):
            rejected = next(f for f in expected if f['stage'] == stage and not f['ok'] and f['expected'] == {'errorCode': code})
            vertex, fragment = hardware['recoverySingles'][2:]
            if stage == 'vertex':
                vertex = rejected['name']
            else:
                fragment = rejected['name']
            expected_pairs.append({'name': f'rejected-{stage}-{code}-pair', 'vertex': vertex, 'fragment': fragment,
                                   'ok': False, 'expected': {'errorCode': code}})
    require(len(pairs) == len(expected_pairs) and len({e['name'] for e in pairs}) == len(pairs), 'complete unique pair workload')
    pair_map = {}
    for entry, fixture in zip(pairs, expected_pairs):
        v, f = by_name[fixture['vertex']], by_name[fixture['fragment']]
        require(entry['name'] == fixture['name'] and entry['vertexCaseName'] == v['name'] and entry['fragmentCaseName'] == f['name'] and
                entry['ok'] is fixture['ok'] and entry['expected'] == fixture['expected'] and
                (entry['vertexSha256'], entry['fragmentSha256']) == (v['inputSha256'], f['inputSha256']), 'exact pair input binding')
        result = entry['result']
        require(result['ok'] is entry['ok'], 'literal pair admission')
        if result['ok']:
            require(set(result) == {'ok', 'vertex', 'fragment', 'interfaceKey'} and
                    result['interfaceKey'] == fixture['expected']['interfaceKey'], 'derived exact pair interface')
            result_stage(result['vertex'], 'vertex', v['profile'])
            result_stage(result['fragment'], 'fragment', f['profile'])
            require(result['fragment'] == {k: f['result'][k] for k in ('glsl', 'metadata')}, 'standalone fragment exact identity')
        else:
            require(set(result) == {'ok', 'error'} and set(result['error']) == {'code', 'message'} and
                    result['error']['code'] == entry['expected']['errorCode'], 'literal pair rollback')
        pair_map[entry['name']] = entry
    return by_name, pair_map


MIGRATED = {'raw': {f'reject-mixed-FSLT-{stage}': ('FSLT', 'FSEQ') for stage in ('vertex', 'fragment')},
            'integer': {f'still-unsupported-{op}-{stage}': (op, 'FSEQ' if op == 'FSLT' else 'FSNE')
                        for op in ('FSLT', 'FSGE') for stage in ('vertex', 'fragment')}}


def retained_case(entry, group):
    expected = dict(entry)
    if entry['name'] in MIGRATED[group]:
        old, new = MIGRATED[group][entry['name']]
        require(entry['text'].count(old + ' ') == 1, 'one exact historical comparison opcode')
        expected['name'] = entry['name'].replace(old, new)
        expected['text'] = entry['text'].replace(old + ' ', new + ' ')
        expected['inputSha256'] = sha(expected['text'].encode('ascii'))
        expected['bytes'] = len(expected['text'].encode('ascii'))
    return expected


def verify_migrations(held, fixtures):
    migrations = []
    for group, filename, held_key in (('raw', 'raw-bit-cases.json', 'rawCases'), ('integer', 'integer-mask-cases.json', 'cases')):
        name = 'renderer/virgl-shader/tests/' + filename
        old = json.loads(git('show', f'{HELD_HEAD}:{name}'))
        current = read(ROOT / name)
        expected = []
        for entry in old:
            replacement = dict(entry)
            if entry['name'] in MIGRATED[group]:
                previous, opcode = MIGRATED[group][entry['name']]
                require(entry['text'].count(previous + ' ') == 1, 'one exact comparison migration')
                replacement['name'] = entry['name'].replace(previous, opcode)
                replacement['text'] = entry['text'].replace(previous + ' ', opcode + ' ')
                promoted = [fixture for fixture in fixtures if fixture['stage'] == entry['stage'] and fixture['text'] == entry['text']]
                require(len(promoted) == 1 and promoted[0]['ok'] is True and promoted[0]['expected'] == {'profile': FLOAT},
                        'old exact body promoted once to literal raw-v3 success')
                migrations.append({'source': name, 'oldName': entry['name'], 'replacementName': replacement['name'],
                                   'oldInputSha256': sha(entry['text'].encode('ascii')), 'replacementInputSha256': sha(replacement['text'].encode('ascii')),
                                   'promotedCase': promoted[0]['name'], 'expected': {'profile': FLOAT}})
            expected.append(replacement)
        require(current == expected and len(current) == len(old), 'only six exact historical substitutions')
        baseline = [entry for entry in held[held_key] if entry['origin'] == 'shared']
        require([(entry['name'], entry['text']) for entry in baseline] == [(entry['name'], entry['text']) for entry in old],
                'held report contains exact historical texts')
    require(len(migrations) == 6, 'all six historical migrations accounted')
    for filename in ('raw-bit-hardware.json', 'integer-mask-hardware.json', 'captured-invalid.json', 'component-cases.json', 'bank-cases.json'):
        name = 'renderer/virgl-shader/tests/' + filename
        require((ROOT / name).read_bytes() == git('show', f'{HELD_HEAD}:{name}'), 'unaffected prior fixture unchanged')
    return migrations


def verify_native(output, head):
    output = Path(output)
    directory = output / 'native'
    native = read(directory / 'native-report.json')
    require(native['schema'] == 'wasm-vm-float-masks-native-v1' and native['status'] == 'passed', 'native schema/outcome')
    require(native['sanitizers'] == ['address', 'undefined'] and native['mutationsPerSeed'] == 1024 and
            native['seeds'] == SEEDS, 'sanitizer/mutation identity')
    for source in native['sources'] + native['fixtures'] + native['rawFixtures'] + native['integerFixtures'] + [native['legacyBaseline'], native['integerBaseline']] + native['originals']:
        verify_source(source, head)
    require(native['integerBaseline'] == binding(ROOT / INTEGER_BASELINE) and native['integerBaseline']['sha256'] == INTEGER_SHA and
            git('show', f'{HELD_HEAD}:{INTEGER_BASELINE}') == (ROOT / INTEGER_BASELINE).read_bytes(), 'independently verified E4b baseline identity')
    require(native['legacyBaseline'] == binding(ROOT / LEGACY_BASELINE) and native['legacyBaseline']['sha256'] == LEGACY_SHA,
            'independently verified E3b baseline identity')
    held = read(ROOT / INTEGER_BASELINE)
    old = {entry['sha256']: entry for entry in read(ROOT / LEGACY_BASELINE)['originals']}
    for key, filenames in (('rawFixtures', ('raw-bit-cases.json', 'raw-bit-hardware.json')),
                           ('integerFixtures', ('integer-mask-cases.json', 'integer-mask-hardware.json')),
                           ('fixtures', ('float-mask-cases.json', 'float-mask-hardware.json'))):
        require(native[key] == [binding(ROOT / ('renderer/virgl-shader/tests/' + filename)) for filename in filenames], 'exact input identities')
    fixtures = read(ROOT / native['fixtures'][0]['path'])
    hardware = read(ROOT / native['fixtures'][1]['path'])
    raw_fixtures = read(ROOT / native['rawFixtures'][0]['path'])
    raw_hardware = read(ROOT / native['rawFixtures'][1]['path'])
    integer_fixtures = read(ROOT / native['integerFixtures'][0]['path'])
    integer_hardware = read(ROOT / native['integerFixtures'][1]['path'])
    require(hardware['schema'] == 'wasm-vm-float-mask-hardware-v1' and raw_hardware['schema'] == 'wasm-vm-raw-bit-hardware-v1' and
            integer_hardware['schema'] == 'wasm-vm-integer-mask-hardware-v1', 'hardware fixture schema identity')
    cases, pairs = verify_workload(native['cases'], native['pairs'], fixtures, hardware)
    raw_cases, raw_pairs = verify_workload(native['rawCases'], native['rawPairs'], raw_fixtures, raw_hardware)
    integer_cases, integer_pairs = verify_workload(native['integerCases'], native['integerPairs'], integer_fixtures, integer_hardware)
    require((len(raw_cases), len(raw_pairs), len(integer_cases), len(integer_pairs)) == (279, 22, 426, 25), 'complete retained workloads')
    require(native['migrations'] == verify_migrations(held, fixtures), 'independently checked exact six historical migrations')
    for key, held_key, group in (('rawCases', 'rawCases', 'raw'), ('integerCases', 'cases', 'integer')):
        for current, previous in zip(native[key], held[held_key]):
            require(current == retained_case(previous, group), 'retained results/source bindings exact except six named replacements')
    for key, held_key in (('rawPairs', 'rawPairs'), ('integerPairs', 'pairs')):
        require(native[key] == held[held_key], 'all retained pair full result bytes unchanged')
    originals = {entry['sha256']: entry for entry in native['originals']}
    require(len(originals) == 19 and list(originals) == sorted(old), 'exact ordered nineteen originals')
    for digest, entry in originals.items():
        require(entry['result'] == old[digest]['result'] and entry['stage'] == old[digest]['stage'] and entry['ok'] is old[digest]['ok'] and
                entry['resultBytes'] == old[digest]['resultBytes'], 'all original result fields unchanged')
    require(sum(entry['ok'] for entry in originals.values()) == 12, 'twelve accepted/seven rejected originals')
    log = (directory / 'native.log').read_bytes()
    require(sha(log) == native['logSha256'], 'complete native transcript digest')
    binary = ROOT / 'renderer/virgl-shader/build/float-mask-sanitize/float-mask-test'
    require(native['command'] == [str(binary)] and sha(binary.read_bytes()) == native['binarySha256'], 'actual sanitizer binary identity')
    groups = {'ORIGINAL': native['originals'], 'CASE': native['rawCases'] + native['integerCases'] + native['cases'], 'PAIR': native['rawPairs'] + native['integerPairs'] + native['pairs']}
    seen = {key: set() for key in groups}
    observed = {}
    for line in log.decode('ascii').splitlines():
        match = re.fullmatch(r'(ORIGINAL|CASE|PAIR) ([0-9]+) (.+)', line)
        if match:
            kind, index, value = match[1], int(match[2]), match[3].encode('ascii')
            require(index < len(groups[kind]) and index not in seen[kind], 'unique bounded native transcript index')
            seen[kind].add(index)
            entry = groups[kind][index]
            require(json.loads(value) == entry['result'] and len(value) == entry['resultBytes'] and sha(value) == entry['resultSha256'],
                    'native full serialized result bytes')
            if kind == 'ORIGINAL':
                require(sha(value + b'\n') == old[entry['sha256']]['stdoutSha256'], 'original exact serialized result bytes')
        elif line.startswith(('LAYOUT ', 'STATS ')):
            key, value = line.split(' ', 1)
            require(key not in observed, 'unique native layout/statistics record')
            observed[key] = json.loads(value)
        else:
            require(line in [f'SEED {seed} mutations=1024 standalone_recoveries=8192 pair_recoveries=6144 passed' for seed in SEEDS],
                    'native transcript contains no diagnostic or unexplained output')
    require(all(len(seen[key]) == len(value) for key, value in groups.items()), 'complete native result transcript')
    require(observed == {'LAYOUT': native['layout'], 'STATS': native['stats']}, 'layout/accounting bound to executed binary')
    expected_layout = {'pointerBytes': 8, 'rawIrBytes': 26232, 'rawInstructionBytes': 112, 'rawLaneBytes': 12,
                       'registerBytes': 36, 'rawSourceBytes': 24, 'profileBytes': 7608, 'rawIrBoundBytes': 32768,
                       'profileBoundBytes': 8192, 'fixedWasmMemoryBytes': 16777216, 'fixedWasmStackBytes': 262144}
    require(native['layout'] == expected_layout, 'exact compact native layout and declared unchanged Wasm limits')
    # Rebuild every byte consumed by the C harness. This binds input ordering,
    # case profiles and all six/four recovery indices, not just a printed hash.
    stream = bytearray(b'VGF3' + struct.pack('<I', 19))
    for entry in native['originals']:
        data = (ROOT / entry['path']).read_bytes()
        stream += struct.pack('<III', int(entry['stage'] == 'fragment'), int(entry['ok']), len(data)) + data
    combined_cases = [(prefix + entry['name'], entry) for prefix, key in (('raw::', 'rawCases'), ('integer::', 'integerCases'), ('', 'cases'))
                      for entry in native[key]]
    combined_pairs = [(prefix + entry['name'], prefix, entry) for prefix, key in (('raw::', 'rawPairs'), ('integer::', 'integerPairs'), ('', 'pairs'))
                      for entry in native[key]]
    index = {name: i for i, (name, _) in enumerate(combined_cases)}
    pair_index = {name: i for i, (name, _, _) in enumerate(combined_pairs)}
    stream += struct.pack('<I', len(combined_cases))
    for name, entry in combined_cases:
        data, encoded_name = entry['text'].encode('ascii'), name.encode('ascii')
        profile = {None: 0, LEGACY: 0, RAW: 1, MASK: 2, FLOAT: 3}[entry.get('profile')]
        stream += struct.pack('<IIIII', int(entry['stage'] == 'fragment'), int(entry['ok']), profile, len(encoded_name), len(data)) + encoded_name + data
    stream += struct.pack('<I', len(combined_pairs))
    for name, prefix, entry in combined_pairs:
        encoded_name = name.encode('ascii')
        stream += struct.pack('<IIII', index[prefix + entry['vertexCaseName']], index[prefix + entry['fragmentCaseName']],
                              int(entry['ok']), len(encoded_name)) + encoded_name
    singles = hardware['recoverySingles'][:2] + ['raw::' + name for name in raw_hardware['recoverySingles'][2:]] + [
        'integer::' + name for name in integer_hardware['recoverySingles'][2:]] + hardware['recoverySingles'][2:]
    pair_names = ['raw::' + name for name in raw_hardware['recoveryPairs']] + ['integer::' + name for name in integer_hardware['recoveryPairs']] + hardware['recoveryPairs']
    require(native['recoverySingles'] == singles and native['recoveryPairs'] == pair_names, 'eight standalone/six mixed pair recovery identities')
    anchor_cases = [combined_cases[index[name]][1] for name in singles]
    require([(e['stage'], e['profile']) for e in anchor_cases] == [(stage, profile) for profile in (LEGACY, RAW, MASK, FLOAT)
            for stage in ('vertex', 'fragment')], 'v5/v1/v2/v3 recovery coverage')
    stream += struct.pack('<8I', *[index[name] for name in singles]) + struct.pack('<6I', *[pair_index[name] for name in pair_names])
    require(bytes(stream) == (directory / 'native-input.bin').read_bytes() and sha(stream) == native['streamSha256'],
            'complete independently reconstructed C input stream')
    stats = native['stats']
    truncations = sum(len(entry['text'].encode('ascii')) for entry in anchor_cases)
    attacks = len(combined_cases) + truncations + 324 + 4096
    expected_stats = {'originals': 19, 'acceptedOriginals': 12, 'cases': len(combined_cases), 'pairs': len(combined_pairs),
                      'calls': 19 + len(combined_pairs) + 8 + attacks * 15, 'standaloneRecoveries': attacks * 8,
                      'pairRecoveries': attacks * 6, 'truncations': truncations, 'hostileCases': 324, 'mutations': 4096}
    require(all(stats[key] == value for key, value in expected_stats.items()), 'independent exact call/recovery accounting')
    for seed in SEEDS:
        require(log.decode('ascii').count(f'SEED {seed} mutations=1024 standalone_recoveries=8192 pair_recoveries=6144 passed') == 1,
                'complete unique mutation seed')
    all_singles = groups['ORIGINAL'] + groups['CASE']
    maxima = {'singleResultBytes': max(e['resultBytes'] for e in all_singles),
              'pairResultBytes': max(e['resultBytes'] for e in groups['PAIR']),
              'stageGlslBytes': max(len(r['glsl'].encode('ascii')) for e in all_singles + groups['PAIR'] if e['result']['ok']
                                   for r in ([e['result']['vertex'], e['result']['fragment']] if 'vertex' in e['result'] else [e['result']]))}
    require(native['recordedMaxima'] == maxima and maxima['singleResultBytes'] <= stats['maxSingleResultBytes'] < 147456 and
            maxima['pairResultBytes'] <= stats['maxPairResultBytes'] < 295936 and maxima['stageGlslBytes'] <= 65536,
            'unchanged exact fixed output bounds')
    verify_coverage(native, directory, head)
    return native, fixtures, hardware, cases, pairs, originals
