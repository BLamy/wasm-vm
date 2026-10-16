#!/usr/bin/env python3
"""Independent native proof and explicitly versioned E5 compatibility validation."""
from __future__ import annotations
import importlib.util
import json
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[2]
HELD_HEAD = '3adaa72f95fd88b8fefd5caa32d6407df22af1dd'
BASELINE = 'evidence/virgl-component-floats/worker/native/native-report.json'
BASELINE_SHA = 'f7a06c2b645275543ee25324646bf79b48fb62a42f528ec396d728be6c891267'
MIGRATIONS = 'renderer/virgl-shader/tests/dot-reciprocal-migrations.json'
LEGACY = 'virgl-webgl2-straight-line-v5'
RAW, MASK, FLOAT, NUMERIC, COMPONENT, DOT = [f'virgl-webgl2-raw-bits-v{i}' for i in range(1, 7)]
SEEDS = ['6bd2c931', 'f1037a85', '2e849d67', 'a75c1b09']


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


base = module('dot_native_base', 'tools/virgl-constants/receipt.py')
previous = module('dot_native_previous', 'tools/virgl-component-floats/native_receipt.py')
require, sha, read, binding, git = base.require, base.sha, base.read, base.binding, base.git
verify_source, verify_records, result_stage = base.verify_source, base.verify_records, previous.result_stage


def fields(entry):
    return {key: entry[key] for key in ('path', 'bytes', 'sha256')}


def verify_coverage(native, directory, head):
    coverage = native['coverage']
    require(coverage['schema'] == 'wasm-vm-dot-reciprocals-native-coverage-v1', 'native execution counter schema')
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


def verify_dot_workload(cases, pairs, fixtures, hardware):
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
            require(set(result) == {'ok', 'glsl', 'metadata'} and profile in (LEGACY, RAW, MASK, FLOAT, NUMERIC, COMPONENT, DOT), 'complete exact-profile native success')
            result_stage({k: result[k] for k in ('glsl', 'metadata')}, entry['stage'], profile)
            if profile == DOT:
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
                count = sum(bool(re.match(r'^\s*(?:[0-9]+:\s*)?(?:MOV|ADD|MUL|MAD|TEX|AND|OR|NOT|SHL|USHR|UADD|ISGE|USEQ|USNE|UCMP|FSLT|FSGE|DIV|MAX|FRC|LRP|DP3|RCP|RSQ)\b', line))
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


def verify_migrations(held, fixtures):
    """Independently derive the only two permitted edits from verified sources."""
    path = 'renderer/virgl-shader/tests/numeric-float-cases.json'
    original = json.loads(git('show', f'{HELD_HEAD}:{path}'))
    entries = {entry['name']: entry for entry in original}
    replacements, expected = {}, []
    for stage in ('vertex', 'fragment'):
        old = entries[f'unsupported-DP3-{stage}']
        before, after = 'DP3 TEMP[117], IN[1], IMM[0].yyyy', 'DP3 TEMP[117], |IN[1]|, IMM[0].yyyy'
        require(old['stage'] == stage and old['ok'] is False and old['expected'] == {'errorCode': 'unsupported-feature'}
                and old['text'].count(before) == 1, 'exact verified DP3 negative and one permitted operand substitution')
        name = f'unsupported-DP3-absolute-{stage}'
        new = dict(old, name=name, text=old['text'].replace(before, after))
        replacements[old['name']] = new
        promoted_name = 'historical-e5-' + old['name']
        promoted = [entry for entry in fixtures if entry['name'] == promoted_name]
        require(len(promoted) == 1 and promoted[0]['text'] == old['text'] and promoted[0]['stage'] == stage
                and promoted[0]['ok'] is True and promoted[0]['expected'] == {'profile': DOT},
                'exact old DP3 body retained as a new v6 positive')
        expected.append({'fixture': path, 'oldName': old['name'], 'oldInputSha256': sha(old['text'].encode('ascii')),
                         'replacementName': name, 'replacementInputSha256': sha(new['text'].encode('ascii')),
                         'promotedCase': promoted_name, 'profile': DOT})
    manifest = read(ROOT / MIGRATIONS)
    require(set(manifest) == {'schema', 'parentHead', 'migrations'} and
            manifest['schema'] == 'wasm-vm-dot-reciprocal-migrations-v1' and manifest['parentHead'] == HELD_HEAD,
            'explicit successor-owned two-migration schema and verified parent')
    records = manifest['migrations']
    require(type(records) is list and len(records) == 2 and sorted(records, key=lambda e: e['oldName']) ==
            sorted(expected, key=lambda e: e['oldName']), 'exact two complete migration records without additions or duplicates')
    require(read(ROOT / path) == [replacements.get(entry['name'], entry) for entry in original],
            'every historical fixture field is unchanged except the two exact names and texts')
    require([(entry['name'], entry['text']) for entry in held['numericCases'] if entry['origin'] == 'shared'] ==
            [(entry['name'], entry['text']) for entry in original], 'verified E5 baseline binds the complete historical numeric workload')
    for name in replacements:
        require(all(name not in (pair['vertexCaseName'], pair['fragmentCaseName']) for key in
                    ('rawPairs', 'integerPairs', 'floatPairs', 'numericPairs', 'pairs') for pair in held[key])
                and all(anchor.split('::')[-1] != name for anchor in held['recoverySingles']),
                'neither migration changes a pair, recovery anchor, truncation or mutation input')
    return records, replacements


def retained_case(entry, replacements):
    value = dict(entry)
    if entry['name'] in replacements:
        replacement = replacements[entry['name']]
        data = replacement['text'].encode('ascii')
        value.update(name=replacement['name'], text=replacement['text'], inputSha256=sha(data), bytes=len(data))
    return value


def verify_recording(output, *, compatibility):
    """Check recorded content and current files; this alone makes no Git-head claim."""
    output = Path(output)
    directory = output / 'native'
    native = read(directory / 'native-report.json')
    schema = 'wasm-vm-component-floats-regression-compat-v1' if compatibility else 'wasm-vm-dot-reciprocals-native-v1'
    require(native['schema'] == schema and native['status'] == 'passed', 'explicit native run identity and outcome')
    require(native['sanitizers'] == ['address', 'undefined'] and native['seeds'] == SEEDS
            and native['mutationsPerSeed'] == 1024, 'actual unchanged sanitizer and varied mutation policy')
    baseline = binding(ROOT / BASELINE)
    require(native['componentBaseline'] == baseline and baseline['sha256'] == BASELINE_SHA
            and git('show', f'{HELD_HEAD}:{BASELINE}') == (ROOT / BASELINE).read_bytes(), 'independently verified E5 baseline bytes')
    held = read(ROOT / BASELINE)
    require(held['schema'] == 'wasm-vm-component-floats-native-v1' and held['status'] == 'passed', 'verified predecessor schema')
    new_fixtures = read(ROOT / 'renderer/virgl-shader/tests/dot-reciprocal-cases.json')
    records, replacements = verify_migrations(held, new_fixtures)
    require(native['migrations'] == records and native['migrationsSource'] == binding(ROOT / MIGRATIONS),
            'native migration claims independently reconstructed')
    fixed = ['raw-bit-cases.json', 'raw-bit-hardware.json', 'integer-mask-cases.json', 'integer-mask-hardware.json',
             'float-mask-cases.json', 'float-mask-hardware.json', 'numeric-float-hardware.json',
             'component-float-cases.json', 'component-float-hardware.json', 'component-float-migrations.json',
             'captured-invalid.json', 'component-cases.json', 'bank-cases.json']
    old_sources = ['renderer/virgl-shader/native_tests/component_floats.c',
                   'tools/virgl-component-floats/native.py', 'tools/virgl-component-floats/native_receipt.py']
    for name in [*['renderer/virgl-shader/tests/' + name for name in fixed], *old_sources]:
        require((ROOT / name).read_bytes() == git('show', f'{HELD_HEAD}:{name}'), 'retained authored source and predecessor harness unchanged')
    groups = []
    maps = {}
    for label, stem, count, pair_count in [('raw', 'raw-bit', 279, 22), ('integer', 'integer-mask', 426, 25),
                                          ('float', 'float-mask', 454, 45), ('numeric', 'numeric-float', 350, 33),
                                          ('component', 'component-float', 574, 37)]:
        component = label == 'component'
        cases_key, pairs_key = ('cases', 'pairs') if compatibility and component else (label + 'Cases', label + 'Pairs')
        fixture_key = 'fixtures' if compatibility and component else label + 'Fixtures'
        identities = [binding(ROOT / f'renderer/virgl-shader/tests/{stem}-{kind}.json') for kind in ('cases', 'hardware')]
        require(native[fixture_key] == identities, 'exact retained fixture source identities')
        fixtures, hardware = [read(ROOT / entry['path']) for entry in identities]
        cases, pairs = previous.verify_workload(native[cases_key], native[pairs_key], fixtures, hardware)
        require((len(cases), len(pairs)) == (count, pair_count), 'complete retained group cardinality')
        held_cases = held['cases' if component else label + 'Cases']
        if label == 'numeric':
            held_cases = [retained_case(entry, replacements) for entry in held_cases]
        require(native[cases_key] == held_cases and native[pairs_key] == held['pairs' if component else label + 'Pairs'],
                'every prior full result is byte-identical; only two input/name substitutions')
        prefix = '' if compatibility and component else label + '::'
        groups.append((prefix, native[cases_key], native[pairs_key], hardware))
        maps[label] = (fixtures, hardware, cases, pairs)
    if not compatibility:
        identities = [binding(ROOT / f'renderer/virgl-shader/tests/dot-reciprocal-{kind}.json') for kind in ('cases', 'hardware')]
        require(native['fixtures'] == identities, 'exact new workload source identities')
        fixtures, hardware = [read(ROOT / entry['path']) for entry in identities]
        cases, pairs = verify_dot_workload(native['cases'], native['pairs'], fixtures, hardware)
        maps['dot'] = (fixtures, hardware, cases, pairs)
        groups.append(('', native['cases'], native['pairs'], hardware))
    originals = {entry['sha256']: entry for entry in native['originals']}
    require(native['originals'] == held['originals'] and len(originals) == 19
            and sum(entry['ok'] for entry in originals.values()) == 12, 'all nineteen original input and result bytes preserved exactly')
    for source in native['sources'] + native['originals'] + [native['componentBaseline'], native['migrationsSource']]:
        require(fields(source) == binding(ROOT / source['path']), 'current source identity before exact-head verification')
    compiler_names = {str(path.relative_to(ROOT)) for pattern in ('*.c', '*.h')
                      for path in (ROOT / 'renderer/virgl-shader').glob(pattern)}
    expected_sources = compiler_names | {
        'renderer/virgl-shader/index.mjs', 'renderer/virgl-shader/build.sh', 'renderer/virgl-shader/README.md',
        'renderer/virgl-shader/UPSTREAM.json', 'renderer/virgl-shader/verify_sources.py',
        'tools/virgl-dot-reciprocals/native.py'}
    if compatibility:
        expected_sources.update(old_sources + ['tools/virgl-dot-reciprocals/component_compat.py'])
        require(native['promotedFixture'] == binding(ROOT / 'renderer/virgl-shader/tests/dot-reciprocal-cases.json'),
                'exact promoted-fixture source binding for compatibility proof')
        require(fields(native['promotedFixture']) == binding(ROOT / native['promotedFixture']['path']), 'current promoted-fixture identity')
    else:
        expected_sources.add('renderer/virgl-shader/native_tests/dot_reciprocals.c')
        require(native['legacyBaseline'] == held['legacyBaseline'], 'unchanged exact original legacy baseline')
        require(fields(native['legacyBaseline']) == binding(ROOT / native['legacyBaseline']['path']), 'current legacy baseline identity')
    require({source['path'] for source in native['sources']} == expected_sources
            and len(native['sources']) == len(expected_sources), 'all compiler, harness and builder sources bound exactly once')
    fixture_keys = ['rawFixtures', 'integerFixtures', 'floatFixtures', 'numericFixtures', 'fixtures']
    if not compatibility:
        fixture_keys += ['componentFixtures']
    for key in fixture_keys:
        for source in native[key]:
            require(fields(source) == binding(ROOT / source['path']), 'current fixture identity')
    if compatibility:
        require(native['compatibility'] == {'heldHead': HELD_HEAD, 'kind': 'unchanged-E5-C-harness-with-two-adjacent-negatives',
                'predecessorFullGateClaimed': False}, 'compatibility run is explicitly distinct from the unmodified E5 full gate')
    binary = ROOT / ('renderer/virgl-shader/build/component-float-sanitize/component-float-test' if compatibility else
                     'renderer/virgl-shader/build/dot-reciprocal-sanitize/dot-reciprocal-test')
    require(native['command'] == [str(binary)] and native['binarySha256'] == sha(binary.read_bytes()), 'current executed sanitizer binary identity')
    singles_count, pairs_count = (12, 10) if compatibility else (14, 12)
    cases_all = [(prefix + entry['name'], entry) for prefix, entries, _, _ in groups for entry in entries]
    pairs_all = [(prefix + entry['name'], prefix, entry) for prefix, _, entries, _ in groups for entry in entries]
    index = {name: i for i, (name, _) in enumerate(cases_all)}
    pair_index = {name: i for i, (name, _, _) in enumerate(pairs_all)}
    require(len(index) == len(cases_all) <= 3072 and len(pair_index) == len(pairs_all) <= 256, 'unique bounded total native workload')
    stream = bytearray((b'VGC5' if compatibility else b'VGD6') + struct.pack('<I', 19))
    for entry in native['originals']:
        data = (ROOT / entry['path']).read_bytes()
        stream += struct.pack('<III', int(entry['stage'] == 'fragment'), int(entry['ok']), len(data)) + data
    stream += struct.pack('<I', len(cases_all))
    profiles = [LEGACY, RAW, MASK, FLOAT, NUMERIC, COMPONENT] + ([] if compatibility else [DOT])
    for name, entry in cases_all:
        data, encoded = entry['text'].encode('ascii'), name.encode('ascii')
        raw = profiles.index(entry['profile']) if entry.get('profile') else 0
        stream += struct.pack('<IIIII', int(entry['stage'] == 'fragment'), int(entry['ok']), raw, len(encoded), len(data)) + encoded + data
    stream += struct.pack('<I', len(pairs_all))
    for name, prefix, entry in pairs_all:
        encoded = name.encode('ascii')
        stream += struct.pack('<IIII', index[prefix + entry['vertexCaseName']], index[prefix + entry['fragmentCaseName']],
                              int(entry['ok']), len(encoded)) + encoded
    singles = groups[-1][3]['recoverySingles'][:2]
    singles += [prefix + name for prefix, _, _, hardware in groups for name in hardware['recoverySingles'][2:]]
    pair_names = [prefix + name for prefix, _, _, hardware in groups for name in hardware['recoveryPairs']]
    require(len(singles) == singles_count and len(pair_names) == pairs_count and native['recoverySingles'] == singles
            and native['recoveryPairs'] == pair_names, 'complete ordered recovery anchors independently reconstructed')
    if compatibility:
        require(singles == held['recoverySingles'] and pair_names == held['recoveryPairs'], 'unchanged old mutation/truncation anchor schedule')
    anchors = [cases_all[index[name]][1] for name in singles]
    require([(entry['stage'], entry['profile']) for entry in anchors] ==
            [(stage, profile) for profile in profiles for stage in ('vertex', 'fragment')], 'every retained/new profile recovers in both stages')
    require(len(set(pair_names)) == pairs_count, 'unique mixed pair recovery anchors')
    for name in pair_names:
        _, prefix, pair = pairs_all[pair_index[name]]
        require(cases_all[index[prefix + pair['vertexCaseName']]][1]['profile'] !=
                cases_all[index[prefix + pair['fragmentCaseName']]][1]['profile'], 'every recovery pair mixes backend profiles')
    stream += struct.pack(f'<{singles_count}I', *[index[name] for name in singles])
    stream += struct.pack(f'<{pairs_count}I', *[pair_index[name] for name in pair_names])
    require(bytes(stream) == (directory / 'native-input.bin').read_bytes() and native['streamSha256'] == sha(stream),
            'every native stream byte independently reconstructed')
    if compatibility:
        require(len(cases_all) == 2083 and len(pairs_all) == 162, 'complete predecessor native workload')
    log = (directory / 'native.log').read_bytes()
    require(sha(log) == native['logSha256'], 'actual complete sanitizer transcript digest')
    transcript_groups = {'ORIGINAL': native['originals'], 'CASE': [entry for _, entry in cases_all],
                         'PAIR': [entry for _, _, entry in pairs_all]}
    seen = {key: set() for key in transcript_groups}
    observed, seeds_seen, order = {}, [], []
    for line in log.decode('ascii').splitlines():
        match = re.fullmatch(r'(ORIGINAL|CASE|PAIR) ([0-9]+) (.+)', line)
        if match:
            kind, i, raw = match[1], int(match[2]), match[3].encode('ascii')
            require(i < len(transcript_groups[kind]) and i not in seen[kind], 'unique bounded native transcript index')
            seen[kind].add(i)
            order.append((kind, i))
            entry = transcript_groups[kind][i]
            require(json.loads(raw) == entry['result'] and len(raw) == entry['resultBytes']
                    and sha(raw) == entry['resultSha256'], 'actual serialized result agrees byte-for-byte with bound full result')
        elif line.startswith(('LAYOUT ', 'STATS ')):
            kind, raw = line.split(' ', 1)
            require(kind not in observed, 'one actual layout/statistics record')
            observed[kind] = json.loads(raw)
        else:
            match = re.fullmatch(r'SEED ([0-9a-f]{8}) mutations=1024 standalone_recoveries=([0-9]+) pair_recoveries=([0-9]+) passed', line)
            require(match is not None and int(match[2]) == singles_count * 1024 and int(match[3]) == pairs_count * 1024,
                    'only complete expected mutation diagnostics in successful transcript')
            seeds_seen.append(match[1])
    require(seeds_seen == SEEDS and all(len(seen[key]) == len(entries) for key, entries in transcript_groups.items()),
            'all actual originals/cases/pairs and every seed recorded once in order')
    require(order == [(kind, index) for kind in ('ORIGINAL', 'PAIR', 'CASE')
                      for index in range(len(transcript_groups[kind]))], 'actual C harness result transcript order')
    require(observed == {'LAYOUT': native['layout'], 'STATS': native['stats']}, 'layout and accounting bound to actual execution')
    require(native['layout'] == held['layout'], 'exact retained compact layout and fixed Wasm limits')
    truncations = sum(len(entry['text'].encode('ascii')) for entry in anchors)
    attacks = len(cases_all) + truncations + 324 + 4096
    expected_stats = {'originals': 19, 'acceptedOriginals': 12, 'cases': len(cases_all), 'pairs': len(pairs_all),
                      'calls': 19 + len(pairs_all) + singles_count + attacks * (1 + singles_count + pairs_count),
                      'standaloneRecoveries': attacks * singles_count, 'pairRecoveries': attacks * pairs_count,
                      'truncations': truncations, 'hostileCases': 324, 'mutations': 4096}
    require(all(native['stats'][key] == value for key, value in expected_stats.items()), 'independent exact actual call/recovery totals')
    require(set(native['stats']) == set(expected_stats) | {'maxSingleResultBytes', 'maxPairResultBytes'},
            'complete exact statistics field inventory')
    if compatibility:
        require(native['stats'] == held['stats'], 'entire predecessor mutation/truncation workload and maxima remain unchanged')
    singles_all = native['originals'] + transcript_groups['CASE']
    maxima = {'singleResultBytes': max(entry['resultBytes'] for entry in singles_all),
              'pairResultBytes': max(entry['resultBytes'] for entry in transcript_groups['PAIR']),
              'stageGlslBytes': max(len(stage['glsl'].encode('ascii')) for entry in singles_all + transcript_groups['PAIR']
                 if entry['result']['ok'] for stage in ([entry['result']['vertex'], entry['result']['fragment']]
                 if 'vertex' in entry['result'] else [entry['result']]))}
    require(native['recordedMaxima'] == maxima and maxima['singleResultBytes'] <= native['stats']['maxSingleResultBytes'] < 147456
            and maxima['pairResultBytes'] <= native['stats']['maxPairResultBytes'] < 295936 and maxima['stageGlslBytes'] <= 65536,
            'actual fixed serialization and GLSL bounds')
    verify_records(directory, native['coverage'])
    fixtures, hardware, cases, pairs = maps['component' if compatibility else 'dot']
    return native, fixtures, hardware, cases, pairs, originals


def _verify(output, head, *, compatibility):
    """Acceptance entry: recording proof AND unconditional exact-head bindings."""
    result = verify_recording(output, compatibility=compatibility)
    native = result[0]
    fixture_keys = ['rawFixtures', 'integerFixtures', 'floatFixtures', 'numericFixtures', 'fixtures']
    if not compatibility:
        fixture_keys.append('componentFixtures')
    sources = native['sources'] + native['originals'] + [native['componentBaseline'], native['migrationsSource']]
    sources += [entry for key in fixture_keys for entry in native[key]]
    sources.append(native['promotedFixture'] if compatibility else native['legacyBaseline'])
    sources += [binding(ROOT / ('renderer/virgl-shader/tests/' + filename)) for filename in
                ('component-float-migrations.json', 'captured-invalid.json', 'component-cases.json', 'bank-cases.json')]
    sources += [binding(ROOT / path) for path in ('renderer/virgl-shader/native_tests/component_floats.c',
                'tools/virgl-component-floats/native.py', 'tools/virgl-component-floats/native_receipt.py')]
    for source in sources:
        verify_source(source, head)
    (previous.verify_coverage if compatibility else verify_coverage)(native, Path(output) / 'native', head)
    return result


def verify_native(output, head):
    return _verify(output, head, compatibility=False)
