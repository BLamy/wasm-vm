#!/usr/bin/env python3
"""Independently bind component-float transcripts and six exact historical migrations."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[2]
HELD_HEAD = '67ca333c05fb70d719c49b3dc5cb8c1f8bb2f6de'
NUMERIC_BASELINE = 'evidence/virgl-numeric-floats/worker/native/native-report.json'
NUMERIC_SHA = '86e1e501016a4b1ad59f4b99ee9587cf57d9f170347b7d0719d412102fcac4e7'
LEGACY_BASELINE = 'evidence/virgl-constants/worker/native/native-report.json'
LEGACY_SHA = '1ecee077496f3eea591ff4ac3a14afef91a33700d69d92b174d82bad3881ffef'
LEGACY = 'virgl-webgl2-straight-line-v5'
RAW = 'virgl-webgl2-raw-bits-v1'
MASK = 'virgl-webgl2-raw-bits-v2'
FLOAT = 'virgl-webgl2-raw-bits-v3'
NUMERIC = 'virgl-webgl2-raw-bits-v4'
COMPONENT = 'virgl-webgl2-raw-bits-v5'
MIGRATIONS = 'renderer/virgl-shader/tests/component-float-migrations.json'
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
    require(coverage['schema'] == 'wasm-vm-component-floats-native-coverage-v1', 'native execution counter schema')
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
            require(set(result) == {'ok', 'glsl', 'metadata'} and profile in (LEGACY, RAW, MASK, FLOAT, NUMERIC, COMPONENT), 'complete exact-profile native success')
            result_stage({k: result[k] for k in ('glsl', 'metadata')}, entry['stage'], profile)
            if profile == COMPONENT:
                tex = [line for line in fixture['text'].splitlines() if re.match(r'^\s*(?:[0-9]+:\s*)?TEX\b', line)]
                uses = [re.findall(r'\bSAMP\s*\[\s*([0-9]+)\s*\]', line) for line in tex]
                require(all(len(found) == 1 for found in uses), 'every accepted authored TEX names exactly one sampler')
                indices = sorted({int(found[0]) for found in uses})
                require(result['metadata']['samplers'] == [{'index': i, 'name': f'fssamp{i}', 'type': 'sampler2D'} for i in indices],
                        'only used owned sampler indices enter exact metadata')
                require(len(re.findall(r'\btexture\s*\(', result['glsl'])) == len(tex), 'exact one logical emitted evaluation per TEX')
            if 'samplerIndices' in expected_fields:
                expected_indices = expected_fields['samplerIndices']
                require(type(expected_indices) is list and all(type(index) is int and 0 <= index <= 7 for index in expected_indices),
                        'literal valid sampler indices')
                require([sampler['index'] for sampler in result['metadata']['samplers']] == expected_indices, 'literal sampler expectations')
            if 'constantCount' in expected_fields:
                uniforms = result['metadata']['uniforms']
                require(len(uniforms) == 1 and uniforms[0]['count'] == expected_fields['constantCount'], 'literal constant extent')
            if 'instructions' in expected_fields:
                count = sum(bool(re.match(r'^\s*(?:[0-9]+:\s*)?(?:MOV|ADD|MUL|MAD|TEX|AND|OR|NOT|SHL|USHR|UADD|ISGE|USEQ|USNE|UCMP|FSLT|FSGE|DIV|MAX|FRC|LRP)\b', line))
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


def verify_retained_inputs():
    for filename in ('raw-bit-cases.json', 'raw-bit-hardware.json', 'integer-mask-cases.json', 'integer-mask-hardware.json',
                     'float-mask-cases.json', 'float-mask-hardware.json', 'numeric-float-hardware.json', 'captured-invalid.json', 'component-cases.json', 'bank-cases.json'):
        name = 'renderer/virgl-shader/tests/' + filename
        require((ROOT / name).read_bytes() == git('show', f'{HELD_HEAD}:{name}'), 'every prior input remains byte-identical')


def verify_migrations(held, fixtures):
    """Reconstruct the six allowed changes from verified TGSI, not manifest claims."""
    fixture_path = 'renderer/virgl-shader/tests/numeric-float-cases.json'
    previous = json.loads(git('show', f'{HELD_HEAD}:{fixture_path}'))
    before_by_name = {entry['name']: entry for entry in previous}
    allowed = {f'unsupported-{op}-{stage}' for op in ('MAX', 'DIV') for stage in ('vertex', 'fragment')}
    allowed.update(f'unsupported-numeric-source--IN[1]-{stage}' for stage in ('vertex', 'fragment'))
    manifest = read(ROOT / MIGRATIONS)
    require(set(manifest) == {'schema', 'parentHead', 'migrations'} and
            manifest['schema'] == 'wasm-vm-component-float-migrations-v1' and manifest['parentHead'] == HELD_HEAD,
            'literal migration schema and independently verified parent')
    records = manifest['migrations']
    require(type(records) is list and len(records) == 6 and {record['oldName'] for record in records} == allowed,
            'six unique permitted historical names')
    replacements = {}
    for record in records:
        old = before_by_name[record['oldName']]
        stage = old['stage']
        require(old['ok'] is False and old['expected'] == {'errorCode': 'unsupported-feature'}, 'old exact negative expectation')
        if old['name'].startswith('unsupported-numeric-source-'):
            needle = 'ADD TEMP[117], -IN[1], IMM[0].yyyy'
            text = 'ADD TEMP[117], --IN[1], IMM[0].yyyy'
            name = f'unsupported-numeric-source-repeated-minus-{stage}'
        else:
            opcode = 'MAX' if old['name'] == f'unsupported-MAX-{stage}' else 'DIV'
            require(old['name'] == f'unsupported-{opcode}-{stage}', 'exact approved opcode name')
            needle = f'{opcode} TEMP[117], IN[1], IMM[0].yyyy'
            text = f'{opcode} TEMP[117], |IN[1]|, IMM[0].yyyy'
            name = f'unsupported-{opcode}-absolute-{stage}'
        require(old['text'].count(needle) == 1, 'one exact source modifier substitution')
        new = dict(old, name=name, text=old['text'].replace(needle, text))
        replacements[old['name']] = new
        promoted_name = 'historical-c2-' + old['name']
        promoted = [entry for entry in fixtures if entry['name'] == promoted_name]
        require(len(promoted) == 1 and promoted[0]['text'] == old['text'] and promoted[0]['stage'] == stage and
                promoted[0]['ok'] is True and promoted[0].get('expected') == {'profile': COMPONENT},
                'new positive preserves exact old TGSI and independently named profile')
        expected = {'fixture': fixture_path, 'oldName': old['name'], 'oldInputSha256': sha(old['text'].encode('ascii')),
                    'replacementName': name, 'replacementInputSha256': sha(new['text'].encode('ascii')),
                    'promotedCase': promoted_name, 'profile': COMPONENT}
        require(record == expected, 'exact complete migration record agrees with source reconstruction')
    require(read(ROOT / fixture_path) == [replacements.get(entry['name'], entry) for entry in previous],
            'all unchanged historical fixture fields and only six exact substitutions')
    require([(entry['name'], entry['text']) for entry in held['cases'] if entry['origin'] == 'shared'] ==
            [(entry['name'], entry['text']) for entry in previous], 'verified native baseline has the complete old authored workload')
    return records, replacements


def retained_case(entry, replacements):
    result = dict(entry)
    if entry['name'] in replacements:
        replacement = replacements[entry['name']]
        data = replacement['text'].encode('ascii')
        result.update(name=replacement['name'], text=replacement['text'], inputSha256=sha(data), bytes=len(data))
    return result


def verify_native(output, head):
    output = Path(output)
    directory = output / 'native'
    native = read(directory / 'native-report.json')
    require(native['schema'] == 'wasm-vm-component-floats-native-v1' and native['status'] == 'passed', 'native schema/outcome')
    require(native['sanitizers'] == ['address', 'undefined'] and native['mutationsPerSeed'] == 1024 and
            native['seeds'] == SEEDS, 'sanitizer/mutation identity')
    for source in native['sources'] + native['fixtures'] + native['rawFixtures'] + native['integerFixtures'] + native['floatFixtures'] + native['numericFixtures'] + [native['legacyBaseline'], native['numericBaseline'], native['migrationsSource']] + native['originals']:
        verify_source(source, head)
    require(native['numericBaseline'] == binding(ROOT / NUMERIC_BASELINE) and native['numericBaseline']['sha256'] == NUMERIC_SHA and
            git('show', f'{HELD_HEAD}:{NUMERIC_BASELINE}') == (ROOT / NUMERIC_BASELINE).read_bytes(), 'independently verified E4c2 baseline identity')
    require(native['legacyBaseline'] == binding(ROOT / LEGACY_BASELINE) and native['legacyBaseline']['sha256'] == LEGACY_SHA,
            'independently verified E3b baseline identity')
    held = read(ROOT / NUMERIC_BASELINE)
    old = {entry['sha256']: entry for entry in read(ROOT / LEGACY_BASELINE)['originals']}
    for key, filenames in (('rawFixtures', ('raw-bit-cases.json', 'raw-bit-hardware.json')),
                           ('integerFixtures', ('integer-mask-cases.json', 'integer-mask-hardware.json')),
                           ('floatFixtures', ('float-mask-cases.json', 'float-mask-hardware.json')),
                           ('numericFixtures', ('numeric-float-cases.json', 'numeric-float-hardware.json')),
                           ('fixtures', ('component-float-cases.json', 'component-float-hardware.json'))):
        require(native[key] == [binding(ROOT / ('renderer/virgl-shader/tests/' + filename)) for filename in filenames], 'exact input identities')
    fixtures = read(ROOT / native['fixtures'][0]['path'])
    hardware = read(ROOT / native['fixtures'][1]['path'])
    raw_fixtures = read(ROOT / native['rawFixtures'][0]['path'])
    raw_hardware = read(ROOT / native['rawFixtures'][1]['path'])
    integer_fixtures = read(ROOT / native['integerFixtures'][0]['path'])
    integer_hardware = read(ROOT / native['integerFixtures'][1]['path'])
    float_fixtures = read(ROOT / native['floatFixtures'][0]['path'])
    float_hardware = read(ROOT / native['floatFixtures'][1]['path'])
    numeric_fixtures = read(ROOT / native['numericFixtures'][0]['path'])
    numeric_hardware = read(ROOT / native['numericFixtures'][1]['path'])
    require(hardware['schema'] == 'wasm-vm-component-float-hardware-v1' and numeric_hardware['schema'] == 'wasm-vm-numeric-float-hardware-v1' and float_hardware['schema'] == 'wasm-vm-float-mask-hardware-v1' and raw_hardware['schema'] == 'wasm-vm-raw-bit-hardware-v1' and
            integer_hardware['schema'] == 'wasm-vm-integer-mask-hardware-v1', 'hardware fixture schema identity')
    cases, pairs = verify_workload(native['cases'], native['pairs'], fixtures, hardware)
    raw_cases, raw_pairs = verify_workload(native['rawCases'], native['rawPairs'], raw_fixtures, raw_hardware)
    integer_cases, integer_pairs = verify_workload(native['integerCases'], native['integerPairs'], integer_fixtures, integer_hardware)
    float_cases, float_pairs = verify_workload(native['floatCases'], native['floatPairs'], float_fixtures, float_hardware)
    numeric_cases, numeric_pairs = verify_workload(native['numericCases'], native['numericPairs'], numeric_fixtures, numeric_hardware)
    require((len(raw_cases), len(raw_pairs), len(integer_cases), len(integer_pairs), len(float_cases), len(float_pairs), len(numeric_cases), len(numeric_pairs)) ==
            (279, 22, 426, 25, 454, 45, 350, 33), 'complete retained workloads')
    verify_retained_inputs()
    require(native['migrationsSource'] == binding(ROOT / MIGRATIONS), 'exact explicit migration source identity')
    migrations, replacements = verify_migrations(held, fixtures)
    require(native['migrations'] == migrations, 'full migration manifest independently reconstructed')
    for key, held_key in (('rawCases', 'rawCases'), ('integerCases', 'integerCases'), ('floatCases', 'floatCases'),
                          ('rawPairs', 'rawPairs'), ('integerPairs', 'integerPairs'), ('floatPairs', 'floatPairs'), ('numericPairs', 'pairs')):
        require(native[key] == held[held_key], 'retained full result bytes and input identities unchanged')
    require(native['numericCases'] == [retained_case(entry, replacements) for entry in held['cases']],
            'all C2 results remain exact; only six named input/name substitutions')
    originals = {entry['sha256']: entry for entry in native['originals']}
    require(len(originals) == 19 and list(originals) == sorted(old), 'exact ordered nineteen originals')
    for digest, entry in originals.items():
        require(entry['result'] == old[digest]['result'] and entry['stage'] == old[digest]['stage'] and entry['ok'] is old[digest]['ok'] and
                entry['resultBytes'] == old[digest]['resultBytes'], 'all original result fields unchanged')
    require(sum(entry['ok'] for entry in originals.values()) == 12, 'twelve accepted/seven rejected originals')
    log = (directory / 'native.log').read_bytes()
    require(sha(log) == native['logSha256'], 'complete native transcript digest')
    binary = ROOT / 'renderer/virgl-shader/build/component-float-sanitize/component-float-test'
    require(native['command'] == [str(binary)] and sha(binary.read_bytes()) == native['binarySha256'], 'actual sanitizer binary identity')
    groups = {'ORIGINAL': native['originals'], 'CASE': native['rawCases'] + native['integerCases'] + native['floatCases'] + native['numericCases'] + native['cases'], 'PAIR': native['rawPairs'] + native['integerPairs'] + native['floatPairs'] + native['numericPairs'] + native['pairs']}
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
            require(line in [f'SEED {seed} mutations=1024 standalone_recoveries=12288 pair_recoveries=10240 passed' for seed in SEEDS],
                    'native transcript contains no diagnostic or unexplained output')
    require(all(len(seen[key]) == len(value) for key, value in groups.items()), 'complete native result transcript')
    require(observed == {'LAYOUT': native['layout'], 'STATS': native['stats']}, 'layout/accounting bound to executed binary')
    expected_layout = {'pointerBytes': 8, 'rawIrBytes': 26232, 'rawInstructionBytes': 112, 'rawDestinationBytes': 12, 'rawLaneBytes': 12,
                       'registerBytes': 36, 'rawSourceBytes': 24, 'profileBytes': 7608, 'rawIrBoundBytes': 32768,
                       'profileBoundBytes': 8192, 'fixedWasmMemoryBytes': 16777216, 'fixedWasmStackBytes': 262144}
    require(native['layout'] == expected_layout, 'exact compact native layout and declared unchanged Wasm limits')
    # Rebuild every byte consumed by the C harness. This binds input ordering,
    # case profiles and all twelve/ten recovery indices, not just a printed hash.
    stream = bytearray(b'VGC5' + struct.pack('<I', 19))
    for entry in native['originals']:
        data = (ROOT / entry['path']).read_bytes()
        stream += struct.pack('<III', int(entry['stage'] == 'fragment'), int(entry['ok']), len(data)) + data
    combined_cases = [(prefix + entry['name'], entry) for prefix, key in (('raw::', 'rawCases'), ('integer::', 'integerCases'), ('float::', 'floatCases'), ('numeric::', 'numericCases'), ('', 'cases'))
                      for entry in native[key]]
    combined_pairs = [(prefix + entry['name'], prefix, entry) for prefix, key in (('raw::', 'rawPairs'), ('integer::', 'integerPairs'), ('float::', 'floatPairs'), ('numeric::', 'numericPairs'), ('', 'pairs'))
                      for entry in native[key]]
    index = {name: i for i, (name, _) in enumerate(combined_cases)}
    pair_index = {name: i for i, (name, _, _) in enumerate(combined_pairs)}
    stream += struct.pack('<I', len(combined_cases))
    for name, entry in combined_cases:
        data, encoded_name = entry['text'].encode('ascii'), name.encode('ascii')
        profile = {None: 0, LEGACY: 0, RAW: 1, MASK: 2, FLOAT: 3, NUMERIC: 4, COMPONENT: 5}[entry.get('profile')]
        stream += struct.pack('<IIIII', int(entry['stage'] == 'fragment'), int(entry['ok']), profile, len(encoded_name), len(data)) + encoded_name + data
    stream += struct.pack('<I', len(combined_pairs))
    for name, prefix, entry in combined_pairs:
        encoded_name = name.encode('ascii')
        stream += struct.pack('<IIII', index[prefix + entry['vertexCaseName']], index[prefix + entry['fragmentCaseName']],
                              int(entry['ok']), len(encoded_name)) + encoded_name
    singles = hardware['recoverySingles'][:2] + ['raw::' + name for name in raw_hardware['recoverySingles'][2:]] + [
        'integer::' + name for name in integer_hardware['recoverySingles'][2:]] + ['float::' + name for name in float_hardware['recoverySingles'][2:]] + ['numeric::' + name for name in numeric_hardware['recoverySingles'][2:]] + hardware['recoverySingles'][2:]
    pair_names = ['raw::' + name for name in raw_hardware['recoveryPairs']] + ['integer::' + name for name in integer_hardware['recoveryPairs']] + ['float::' + name for name in float_hardware['recoveryPairs']] + ['numeric::' + name for name in numeric_hardware['recoveryPairs']] + hardware['recoveryPairs']
    require(native['recoverySingles'] == singles and native['recoveryPairs'] == pair_names, 'twelve standalone/ten mixed pair recovery identities')
    anchor_cases = [combined_cases[index[name]][1] for name in singles]
    require([(e['stage'], e['profile']) for e in anchor_cases] == [(stage, profile) for profile in (LEGACY, RAW, MASK, FLOAT, NUMERIC, COMPONENT)
            for stage in ('vertex', 'fragment')], 'legacy-v5/raw-v1/v2/v3/v4/v5 recovery coverage')
    stream += struct.pack('<12I', *[index[name] for name in singles]) + struct.pack('<10I', *[pair_index[name] for name in pair_names])
    require(bytes(stream) == (directory / 'native-input.bin').read_bytes() and sha(stream) == native['streamSha256'],
            'complete independently reconstructed C input stream')
    stats = native['stats']
    truncations = sum(len(entry['text'].encode('ascii')) for entry in anchor_cases)
    attacks = len(combined_cases) + truncations + 324 + 4096
    expected_stats = {'originals': 19, 'acceptedOriginals': 12, 'cases': len(combined_cases), 'pairs': len(combined_pairs),
                      'calls': 19 + len(combined_pairs) + 12 + attacks * 23, 'standaloneRecoveries': attacks * 12,
                      'pairRecoveries': attacks * 10, 'truncations': truncations, 'hostileCases': 324, 'mutations': 4096}
    require(all(stats[key] == value for key, value in expected_stats.items()), 'independent exact call/recovery accounting')
    for seed in SEEDS:
        require(log.decode('ascii').count(f'SEED {seed} mutations=1024 standalone_recoveries=12288 pair_recoveries=10240 passed') == 1,
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
