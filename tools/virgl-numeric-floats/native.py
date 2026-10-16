#!/usr/bin/env python3
"""Bind numeric-shadow sanitizer results to retained v5/v1/v2/v3 and original bytes."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'renderer/virgl-shader/tests/numeric-float-cases.json'
HARDWARE = ROOT / 'renderer/virgl-shader/tests/numeric-float-hardware.json'
LEGACY = ROOT / 'evidence/virgl-constants/worker/native/native-report.json'
LEGACY_SHA256 = '1ecee077496f3eea591ff4ac3a14afef91a33700d69d92b174d82bad3881ffef'
LEGACY_PROFILE = 'virgl-webgl2-straight-line-v5'
RAW_PROFILE = 'virgl-webgl2-raw-bits-v1'
MASK_PROFILE = 'virgl-webgl2-raw-bits-v2'
FLOAT_PROFILE = 'virgl-webgl2-raw-bits-v3'
NUMERIC_PROFILE = 'virgl-webgl2-raw-bits-v4'
FLOAT_BASELINE = ROOT / 'evidence/virgl-float-masks/worker/native/native-report.json'
FLOAT_BASELINE_SHA256 = 'd2af1399a55e947170d0ba60981a9671d0d885c7ceff87f7717c9f98603286b3'
HELD_HEAD = '59f1b924286af70096d9fb19fbdb35b9ec2ed7a1'
RAW_FIXTURE = ROOT / 'renderer/virgl-shader/tests/raw-bit-cases.json'
RAW_HARDWARE = ROOT / 'renderer/virgl-shader/tests/raw-bit-hardware.json'
INTEGER_FIXTURE = ROOT / 'renderer/virgl-shader/tests/integer-mask-cases.json'
INTEGER_HARDWARE = ROOT / 'renderer/virgl-shader/tests/integer-mask-hardware.json'
FLOAT_FIXTURE = ROOT / 'renderer/virgl-shader/tests/float-mask-cases.json'
FLOAT_HARDWARE = ROOT / 'renderer/virgl-shader/tests/float-mask-hardware.json'
SEEDS = ['6bd2c931', 'f1037a85', '2e849d67', 'a75c1b09']
SOURCES = [
    'renderer/virgl-shader/index.mjs', 'renderer/virgl-shader/build.sh',
    'renderer/virgl-shader/native_tests/numeric_floats.c', 'renderer/virgl-shader/README.md',
    'renderer/virgl-shader/UPSTREAM.json', 'renderer/virgl-shader/verify_sources.py',
    'tools/virgl-numeric-floats/native.py',
]


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def describe(path):
    raw = path.read_bytes()
    return {'path': str(path.relative_to(ROOT)), 'bytes': len(raw), 'sha256': sha(raw)}


def stage_result(result, stage, profile):
    require(set(result) == {'glsl', 'metadata'}, 'exact stage fields')
    require(result['metadata']['profile'] == profile and result['metadata']['stage'] == stage,
            f'exact stage/backend identity: {stage}/{profile}')
    require(result['glsl'].startswith('#version 300 es') and len(result['glsl'].encode('ascii')) <= 65536,
            'bounded ESSL300')


def expectations(result, entry, fixture):
    expected = entry.get('expected', {})
    require(set(expected) <= {'profile', 'constantCount', 'instructions', 'samplerIndices'}, 'bounded literal metadata fields')
    require(all(type(v) is int and v >= 0 for k, v in expected.items() if k not in ('profile', 'samplerIndices')),
            'nonnegative literal metadata expectations')
    if result['metadata']['profile'] == NUMERIC_PROFILE:
        tex_lines = [line for line in fixture['text'].splitlines() if re.match(r'^\s*(?:[0-9]+:\s*)?TEX\b', line)]
        sampler_matches = [re.findall(r'\bSAMP\s*\[\s*([0-9]+)\s*\]', line) for line in tex_lines]
        require(all(len(matches) == 1 for matches in sampler_matches), 'one explicit sampler per valid authored TEX')
        indices = sorted({int(matches[0]) for matches in sampler_matches})
        samplers = [{'index': index, 'name': f'fssamp{index}', 'type': 'sampler2D'} for index in indices]
        require(result['metadata']['samplers'] == samplers, 'owned sampler metadata equals exact authored TEX uses')
        require(len(re.findall(r'\btexture\s*\(', result['glsl'])) == len(tex_lines), 'one emitted logical texture evaluation per TEX')
    if 'samplerIndices' in expected:
        require(type(expected['samplerIndices']) is list and all(type(index) is int and 0 <= index <= 7 for index in expected['samplerIndices']),
                'literal bounded sampler index list')
        require([sampler['index'] for sampler in result['metadata']['samplers']] == expected['samplerIndices'], 'literal used sampler indices')
    if 'constantCount' in expected:
        uniforms = result['metadata']['uniforms']
        require(len(uniforms) == 1 and uniforms[0]['count'] == expected['constantCount'],
                f'{entry["name"]}: literal declared constant extent')
    if 'instructions' in expected:
        # Count authored TGSI statements independently of the emitted GLSL.
        opcodes = r'(?:MOV|ADD|MUL|MAD|TEX|AND|OR|NOT|SHL|USHR|UADD|ISGE|USEQ|USNE|UCMP|FSLT|FSGE)'
        instructions = sum(bool(re.match(r'^\s*(?:[0-9]+:\s*)?' + opcodes + r'\b', line))
                           for line in fixture['text'].splitlines())
        require(instructions == expected['instructions'] and instructions <= 179,
                f'{entry["name"]}: literal non-END instruction count')


def fixtures_and_pairs(fixture_path=FIXTURE, hardware_path=HARDWARE, schema="wasm-vm-numeric-float-hardware-v1"):
    """Bound and enumerate authored inputs; never synthesize expected GPU words."""
    fixtures = json.loads(fixture_path.read_bytes())
    hardware = json.loads(hardware_path.read_bytes())
    require(type(fixtures) is list, 'shared cases list')
    core_keys = {'schema', 'shaders', 'pairs', 'recoverySingles', 'recoveryPairs'}
    if schema == 'wasm-vm-numeric-float-hardware-v1':
        extra_keys = {'numericPrograms', 'texturePrograms', 'numericVectors', 'textures', 'operationDefinitions'}
    else:
        extra_keys = {'vectors', 'probes'}
        if schema in ('wasm-vm-integer-mask-hardware-v1', 'wasm-vm-float-mask-hardware-v1'):
            extra_keys.add('operationDefinitions')
    require(set(hardware) == core_keys | extra_keys and hardware['schema'] == schema, 'hardware fixture schema')
    merged = []
    for f in fixtures:
        require(set(f) <= {'name', 'stage', 'text', 'ok', 'profile', 'expected'} and
                {'name', 'stage', 'text', 'ok'} <= set(f), 'exact shared case fields')
        merged.append(dict(f, origin='shared'))
    for f in hardware['shaders']:
        require(set(f) == {'name', 'stage', 'text', 'profile', 'instructions'}, 'exact hardware shader fields')
        merged.append({k: f[k] for k in ('name', 'stage', 'text', 'profile')} |
                      {'ok': True, 'expected': {'profile': f['profile'], 'instructions': f['instructions']}, 'origin': 'hardware'})
    require(4 <= len(merged) <= 768, 'bounded merged case count')
    indexes = {f['name']: i for i, f in enumerate(merged)}
    require(len(indexes) == len(merged), 'unique names across shared/hardware inputs')
    pairs = []
    for p in hardware['pairs']:
        require(set(p) == {'name', 'vertex', 'fragment', 'interfaceKey'}, 'exact hardware pair fields')
        pairs.append({'name': p['name'], 'vertex': p['vertex'], 'fragment': p['fragment'], 'ok': True,
                      'expected': {'interfaceKey': p['interfaceKey']}})
    # A rejected stage must not expose a partial pair, regardless of whether it
    # is the first stage or follows a valid owned stage. These are shared TGSI
    # fixtures, not mutated generated GLSL or caller-selected compiler flags.
    for stage in ('vertex', 'fragment'):
        for code in ('parse-error', 'unsupported-feature'):
            candidates = [f for f in merged if f['stage'] == stage and not f['ok'] and
                          f.get('expected') == {'errorCode': code}]
            require(candidates, f'missing {stage} {code} pair rejection anchor')
            v, f = hardware['recoverySingles'][2:]
            if stage == 'vertex':
                v = candidates[0]['name']
            else:
                f = candidates[0]['name']
            pairs.append({'name': f'rejected-{stage}-{code}-pair', 'vertex': v, 'fragment': f,
                          'ok': False, 'expected': {'errorCode': code}})
    require(2 <= len(pairs) <= 64 and len({p['name'] for p in pairs}) == len(pairs), 'unique bounded pairs')
    require(len(hardware['recoverySingles']) == 4 and len(hardware['recoveryPairs']) == 2,
            'four single/two pair recovery anchors')
    return merged, pairs, hardware, indexes


def coverage(binary, output):
    """Preserve source-bound LLVM counters; no inferred coverage from test names."""
    output = output.resolve()
    raw = output / 'native.profraw'
    require(raw.is_file() and raw.stat().st_size > 0, 'sanitizer run produced LLVM counters')
    profdata = Path(subprocess.check_output(['xcrun', '--find', 'llvm-profdata'], text=True).strip())
    cov = Path(subprocess.check_output(['xcrun', '--find', 'llvm-cov'], text=True).strip())
    profile = output / 'native.profdata'
    commands = []

    def record(command, destination):
        commands.append(command)
        run = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
        (output / destination).write_bytes(run.stdout)
        require(run.returncode == 0 and not run.stderr,
                f'coverage command failed: {command}: {run.stderr.decode(errors="replace")}')
        return run.stdout

    record([str(profdata), 'merge', '-sparse', str(raw), '-o', str(profile)], 'coverage-merge.log')
    paths = [ROOT / 'renderer/virgl-shader/bridge.c', ROOT / 'renderer/virgl-shader/raw_bits.c']
    arguments = [str(binary), '-instr-profile=' + str(profile), *map(str, paths)]
    exported = json.loads(record([str(cov), 'export', *arguments], 'coverage.json'))
    record([str(cov), 'report', *arguments], 'coverage-report.txt')
    record([str(cov), 'show', *arguments, '-show-line-counts-or-regions', '-show-branches=count'], 'coverage-show.txt')
    require(exported['type'] == 'llvm.coverage.json.export' and len(exported['data']) == 1,
            'one complete LLVM coverage export')
    files = exported['data'][0]['files']
    require({Path(entry['filename']).resolve() for entry in files} == {path.resolve() for path in paths},
            'coverage binds exactly both changed C implementation files')
    summaries = []
    for entry in files:
        path = Path(entry['filename']).resolve()
        require(entry['segments'] and entry['summary']['lines']['covered'] > 0, 'real native execution counters')
        summaries.append({**describe(path), 'summary': entry['summary']})
    names = ['native.profraw', 'native.profdata', 'coverage-merge.log', 'coverage.json',
             'coverage-report.txt', 'coverage-show.txt']
    stack_records = []
    for filename in ('bridge.su', 'raw_bits.su'):
        path = binary.parent / filename
        raw_stack = path.read_bytes()
        require(raw_stack, 'compiler emitted native stack observations')
        (output / filename).write_bytes(raw_stack)
        functions = []
        for line in raw_stack.decode('ascii').splitlines():
            function, size, kind = line.split('\t')
            require(size.isdecimal() and kind in ('static', 'dynamic', 'dynamic,bounded'),
                    'structured compiler stack observation')
            functions.append({'function': function, 'bytes': int(size), 'kind': kind})
        names.append(filename)
        stack_records.append({'path': filename, 'source': 'renderer/virgl-shader/' + filename[:-3] + '.c',
                              'functions': functions})
    return {'schema': 'wasm-vm-numeric-floats-native-coverage-v1', 'sources': summaries, 'commands': commands,
            'nativeStack': {'boundary': 'Instrumented native per-function observations only; dynamic sanitizer frames do not establish total or Wasm stack usage.',
                            'files': stack_records},
            'tools': [{'path': str(path), 'sha256': sha(path.read_bytes()),
                       'version': subprocess.check_output([str(path), '--version'], text=True).strip()}
                      for path in (profdata, cov)],
            'records': [{'path': name, 'bytes': (output / name).stat().st_size,
                         'sha256': sha((output / name).read_bytes())} for name in names]}


def verify_retained_inputs():
    """No historical fixture rewrite is authorized by this boundary."""
    for path in (RAW_FIXTURE, RAW_HARDWARE, INTEGER_FIXTURE, INTEGER_HARDWARE, FLOAT_FIXTURE, FLOAT_HARDWARE):
        require(path.read_bytes() == subprocess.check_output(['git', 'show', f'{HELD_HEAD}:{path.relative_to(ROOT)}'], cwd=ROOT),
                'all retained native and hardware input bytes unchanged')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report_path = args.output / 'native-report.json'
    report_path.unlink(missing_ok=True)
    # Include every owned compiler C/header file. Vendor identity is separately
    # pinned by UPSTREAM.json and verified by build.sh/verify_sources.py.
    compiler_sources = sorted(p for pattern in ('*.c', '*.h')
                              for p in (ROOT / 'renderer/virgl-shader').glob(pattern))
    sources = [describe(p) for p in compiler_sources] + [describe(ROOT / p) for p in SOURCES]
    fixture_identities = [describe(FIXTURE), describe(HARDWARE)]
    raw_fixture_identities = [describe(RAW_FIXTURE), describe(RAW_HARDWARE)]
    integer_fixture_identities = [describe(INTEGER_FIXTURE), describe(INTEGER_HARDWARE)]
    float_fixture_identities = [describe(FLOAT_FIXTURE), describe(FLOAT_HARDWARE)]
    float_identity = describe(FLOAT_BASELINE)
    require(float_identity['sha256'] == FLOAT_BASELINE_SHA256, 'exact independently verified E4c1 baseline')
    float_held = json.loads(FLOAT_BASELINE.read_bytes())
    require(float_held['schema'] == 'wasm-vm-float-masks-native-v1' and float_held['status'] == 'passed', 'held ordered-float baseline')
    require(subprocess.check_output(['git', 'show', f'{HELD_HEAD}:{float_identity["path"]}'], cwd=ROOT) == FLOAT_BASELINE.read_bytes(),
            'baseline bytes recorded on independently verified head')
    baseline_identity = describe(LEGACY)
    require(baseline_identity['sha256'] == LEGACY_SHA256, 'exact committed E3b legacy baseline')
    baseline = json.loads(LEGACY.read_bytes())
    require(baseline['schema'] == 'wasm-vm-constants-native-v1' and baseline['status'] == 'passed',
            'held native baseline schema/status')
    held = {e['sha256']: e for e in baseline['originals']}
    require(len(held) == 19, 'nineteen unique baseline originals')
    binary = args.binary.resolve()
    binary_sha = sha(binary.read_bytes())
    unique = {}
    for workload in ('textured-scene', 'kmscube', 'glmark2-es2', 'compositor'):
        for path in sorted((ROOT / 'evidence/virgl-corpus/captures' / workload / 'shaders').glob('*.tgsi')):
            raw = path.read_bytes()
            require(sha(raw) == path.stem, 'original SHA identity')
            unique.setdefault(path.stem, (path, raw))
    require(set(unique) == set(held), 'unchanged set of nineteen originals')
    originals = []
    stream = bytearray(b'VGN4' + struct.pack('<I', 19))
    for digest, (path, raw) in sorted(unique.items()):
        stage = 'vertex' if raw.startswith(b'VERT\n') else 'fragment'
        require(raw.startswith(b'VERT\n' if stage == 'vertex' else b'FRAG\n'), 'original stage')
        accepted = b'PRECISE' not in raw
        require(held[digest]['stage'] == stage and held[digest]['ok'] is accepted, 'held original stage/outcome')
        originals.append({**describe(path), 'stage': stage, 'ok': accepted})
        stream += struct.pack('<III', int(stage == 'fragment'), int(accepted), len(raw)) + raw
    require(sum(o['ok'] for o in originals) == 12, 'twelve original acceptances')
    fixtures, pair_fixtures, hardware, indexes = fixtures_and_pairs()
    raw_fixtures, raw_pairs, raw_hardware, _ = fixtures_and_pairs(RAW_FIXTURE, RAW_HARDWARE, 'wasm-vm-raw-bit-hardware-v1')
    integer_fixtures, integer_pairs, integer_hardware, _ = fixtures_and_pairs(INTEGER_FIXTURE, INTEGER_HARDWARE, 'wasm-vm-integer-mask-hardware-v1')
    float_fixtures, float_pairs, float_hardware, _ = fixtures_and_pairs(FLOAT_FIXTURE, FLOAT_HARDWARE, 'wasm-vm-float-mask-hardware-v1')
    raw_case_count, raw_pair_count = len(raw_fixtures), len(raw_pairs)
    integer_case_count, integer_pair_count = len(integer_fixtures), len(integer_pairs)
    float_case_count, float_pair_count = len(float_fixtures), len(float_pairs)
    require((raw_case_count, raw_pair_count, integer_case_count, integer_pair_count, float_case_count, float_pair_count) == (279, 22, 426, 25, 454, 45),
            'complete frozen E4a/E4b/E4c1 workloads')
    verify_retained_inputs()
    for label, old_cases, old_pairs, baseline_cases, baseline_pairs in (
            ('raw', raw_fixtures, raw_pairs, float_held['rawCases'], float_held['rawPairs']),
            ('integer', integer_fixtures, integer_pairs, float_held['integerCases'], float_held['integerPairs']),
            ('float', float_fixtures, float_pairs, float_held['cases'], float_held['pairs'])):
        require(len(old_cases) == len(baseline_cases) and len(old_pairs) == len(baseline_pairs), 'complete retained workload cardinality')
        for fixture, previous in zip(old_cases, baseline_cases):
            expected = previous
            require(fixture['name'] == expected['name'] and fixture['stage'] == expected['stage'] and
                    fixture['text'] == expected['text'] and fixture['ok'] is expected['ok'], 'exact retained input bytes and outcome')
            fixture['name'] = label + '::' + fixture['name']
        for pair, previous in zip(old_pairs, baseline_pairs):
            require(pair['name'] == previous['name'] and pair['vertex'] == previous['vertexCaseName'] and
                    pair['fragment'] == previous['fragmentCaseName'] and pair['ok'] is previous['ok'], 'exact retained pair workload')
            for key in ('name', 'vertex', 'fragment'):
                pair[key] = label + '::' + pair[key]
    fixtures = raw_fixtures + integer_fixtures + float_fixtures + fixtures
    pair_fixtures = raw_pairs + integer_pairs + float_pairs + pair_fixtures
    indexes = {fixture['name']: i for i, fixture in enumerate(fixtures)}
    require(len(indexes) == len(fixtures) <= 2048 and len(pair_fixtures) <= 256, 'complete bounded combined workload')
    stream += struct.pack('<I', len(fixtures))
    cases = []
    for fixture in fixtures:
        require(type(fixture['ok']) is bool and fixture['stage'] in ('vertex', 'fragment'), 'case stage/outcome')
        name, text = fixture['name'].encode('ascii'), fixture['text'].encode('ascii')
        require(0 < len(name) < 160, 'bounded case name')
        require(0 < len(text) <= 16384 and all(c in (9, 10, 13) or 32 <= c <= 126 for c in text), 'bounded ASCII text')
        profile = fixture.get('profile', fixture.get('expected', {}).get('profile'))
        require((fixture['ok'] and profile in (LEGACY_PROFILE, RAW_PROFILE, MASK_PROFILE, FLOAT_PROFILE, NUMERIC_PROFILE)) or
                (not fixture['ok'] and profile is None), 'positive exact profile/negative no profile')
        raw_backend = {None: 0, LEGACY_PROFILE: 0, RAW_PROFILE: 1, MASK_PROFILE: 2, FLOAT_PROFILE: 3, NUMERIC_PROFILE: 4}[profile]
        stream += struct.pack('<IIIII', int(fixture['stage'] == 'fragment'), int(fixture['ok']),
                              int(raw_backend), len(name), len(text)) + name + text
        entry = {'name': fixture['name'], 'stage': fixture['stage'], 'inputSha256': sha(text),
                 'bytes': len(text), 'ok': fixture['ok'], 'origin': fixture['origin'], 'text': fixture['text']}
        if profile:
            entry['profile'] = profile
        if 'expected' in fixture:
            require(fixture['ok'] or set(fixture['expected']) == {'errorCode'}, 'negative expectations name only a code')
            entry['expected'] = fixture['expected']
        require(fixture['ok'] or entry.get('expected', {}).get('errorCode') in ('parse-error', 'unsupported-feature', 'translation-error'),
                'every negative has a literal rejection code')
        cases.append(entry)
    stream += struct.pack('<I', len(pair_fixtures))
    pairs = []
    for p in pair_fixtures:
        vi, fi = indexes[p['vertex']], indexes[p['fragment']]
        require(cases[vi]['stage'] == 'vertex' and cases[fi]['stage'] == 'fragment', 'pair stage identities')
        require(not p['ok'] or cases[vi]['ok'] and cases[fi]['ok'], 'positive pair accepted stages')
        name = p['name'].encode('ascii')
        require(0 < len(name) < 160, 'bounded pair name')
        stream += struct.pack('<IIII', vi, fi, int(p['ok']), len(name)) + name
        pairs.append({'name': p['name'], 'vertexCaseName': p['vertex'], 'fragmentCaseName': p['fragment'],
                      'vertexSha256': cases[vi]['inputSha256'], 'fragmentSha256': cases[fi]['inputSha256'],
                      'ok': p['ok'], 'expected': p['expected']})
    pair_indexes = {p['name']: i for i, p in enumerate(pairs)}
    single_names = [*hardware['recoverySingles'][:2],
                    *['raw::' + n for n in raw_hardware['recoverySingles'][2:]],
                    *['integer::' + n for n in integer_hardware['recoverySingles'][2:]],
                    *['float::' + n for n in float_hardware['recoverySingles'][2:]],
                    *hardware['recoverySingles'][2:]]
    pair_names = ['raw::' + n for n in raw_hardware['recoveryPairs']] + ['integer::' + n for n in integer_hardware['recoveryPairs']] + ['float::' + n for n in float_hardware['recoveryPairs']] + hardware['recoveryPairs']
    single_anchors = [indexes[n] for n in single_names]
    pair_anchors = [pair_indexes[n] for n in pair_names]
    require([(cases[i]['stage'], cases[i].get('profile')) for i in single_anchors] ==
            [(stage, profile) for profile in (LEGACY_PROFILE, RAW_PROFILE, MASK_PROFILE, FLOAT_PROFILE, NUMERIC_PROFILE) for stage in ('vertex', 'fragment')],
            'legacy/v1/v2/v3/v4 standalone recovery identities')
    stream += struct.pack('<10I', *single_anchors) + struct.pack('<8I', *pair_anchors)
    (args.output / 'native-input.bin').write_bytes(stream)
    command = [str(binary)]
    (args.output / 'native.profraw').unlink(missing_ok=True)
    env = dict(os.environ, UBSAN_OPTIONS='halt_on_error=1', ASAN_OPTIONS='abort_on_error=1',
               LLVM_PROFILE_FILE=str((args.output / 'native.profraw').resolve()))
    run = subprocess.run(command, input=stream, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, timeout=300)
    (args.output / 'native.log').write_bytes(run.stdout)
    require(run.returncode == 0, f'numeric-float sanitizer failed: {run.returncode}; see {args.output / "native.log"}')
    log = run.stdout.decode('ascii')
    seen = {'ORIGINAL': set(), 'CASE': set(), 'PAIR': set()}
    stats, layout = None, None
    for line in log.splitlines():
        match = re.fullmatch(r'(ORIGINAL|CASE|PAIR) ([0-9]+) (.+)', line)
        if match:
            kind, i, raw_result = match[1], int(match[2]), match[3]
            entries = {'ORIGINAL': originals, 'CASE': cases, 'PAIR': pairs}[kind]
            require(i < len(entries) and i not in seen[kind], 'unique bounded result index')
            seen[kind].add(i)
            entry, result = entries[i], json.loads(raw_result)
            entry.update(result=result, resultBytes=len(raw_result.encode('ascii')),
                         resultSha256=sha(raw_result.encode('ascii')))
            require(result.get('ok') is entry['ok'], f'{kind}/{i}: literal acceptance')
            if result['ok']:
                if kind == 'PAIR':
                    require(set(result) == {'ok', 'vertex', 'fragment', 'interfaceKey'}, 'exact pair fields')
                    for stage, key in [('vertex', 'vertexCaseName'), ('fragment', 'fragmentCaseName')]:
                        stage_result(result[stage], stage, cases[indexes[entry[key]]]['profile'])
                    require(result['interfaceKey'] == entry['expected']['interfaceKey'], 'literal pair interface')
                else:
                    require(set(result) == {'ok', 'glsl', 'metadata'}, 'exact single fields')
                    stage_result({k: result[k] for k in ('glsl', 'metadata')}, entry['stage'],
                                 LEGACY_PROFILE if kind == 'ORIGINAL' else entry['profile'])
                    if kind == 'CASE':
                        expectations(result, entry, fixtures[i])
            else:
                require(set(result) == {'ok', 'error'} and set(result['error']) == {'code', 'message'},
                        'structured error without partial output')
                expected_code = 'unsupported-feature' if kind == 'ORIGINAL' else entry['expected']['errorCode']
                require(result['error']['code'] == expected_code, f'{kind}/{i}: exact rejection code')
            previous = None
            if kind == 'CASE':
                previous_cases = float_held['rawCases'] + float_held['integerCases'] + float_held['cases']
                if i < len(previous_cases):
                    previous = previous_cases[i]
            if kind == 'PAIR':
                previous_pairs = float_held['rawPairs'] + float_held['integerPairs'] + float_held['pairs']
                if i < len(previous_pairs):
                    previous = previous_pairs[i]
            if previous is not None:
                require(result == previous['result'] and entry['resultBytes'] == previous['resultBytes'] and
                        entry['resultSha256'] == previous['resultSha256'], f'{entry["name"]}: exact complete held result bytes')
            if kind == 'ORIGINAL':
                previous = held[entry['sha256']]
                require(result == previous['result'] and entry['resultBytes'] == previous['resultBytes'] and
                        sha((raw_result + '\n').encode('ascii')) == previous['stdoutSha256'],
                        f'{entry["sha256"]}: byte-for-byte held legacy translation/error')
        elif line.startswith('LAYOUT '):
            require(layout is None, 'one runtime layout record')
            layout = json.loads(line[7:])
        elif line.startswith('STATS '):
            require(stats is None, 'one statistics record')
            stats = json.loads(line[6:])
    require(all(len(seen[k]) == n for k, n in [('ORIGINAL', 19), ('CASE', len(cases)), ('PAIR', len(pairs))]),
            'complete recorded results')
    require(layout and layout['rawIrBoundBytes'] == 32768 and layout['profileBoundBytes'] == 8192 and
            layout['rawIrBytes'] == 26232 and layout['rawInstructionBytes'] == 112 and layout['rawDestinationBytes'] == 12 and layout['rawSourceBytes'] == 24 and
            layout['registerBytes'] == 36 and layout['rawLaneBytes'] == 12 and layout['profileBytes'] == 7608 and
            layout['fixedWasmMemoryBytes'] == 16777216 and layout['fixedWasmStackBytes'] == 262144,
            'runtime private layout and unchanged fixed Wasm bounds')
    for entry in pairs:
        if entry['ok']:
            fs = cases[indexes[entry['fragmentCaseName']]]['result']
            require(entry['result']['fragment'] == {k: fs[k] for k in ('glsl', 'metadata')},
                    'paired fragment exactly equals standalone')
    require(stats and stats['originals'] == 19 and stats['acceptedOriginals'] == 12 and
            stats['cases'] == len(cases) and stats['pairs'] == len(pairs), 'native totals')
    attacks = stats['cases'] + stats['truncations'] + stats['hostileCases'] + stats['mutations']
    require(stats['standaloneRecoveries'] == attacks * 10 and stats['pairRecoveries'] == attacks * 8,
            'exact recovery totals')
    require(stats['calls'] == 19 + len(pairs) + 10 + attacks * 19, 'exact call accounting')
    require(stats['mutations'] == 4096, 'four mutation batches')
    for seed in SEEDS:
        require(log.count(f'SEED {seed} mutations=1024 standalone_recoveries=10240 pair_recoveries=8192 passed') == 1,
                'complete unique seed')
    maxima = {'singleResultBytes': max(e['resultBytes'] for e in originals + cases),
              'pairResultBytes': max(e['resultBytes'] for e in pairs),
              'stageGlslBytes': max(len(r['glsl'].encode('ascii')) for e in originals + cases + pairs
                                   if e['result']['ok'] for r in ([e['result']['vertex'], e['result']['fragment']]
                                                                 if 'vertex' in e['result'] else [e['result']]))}
    require(maxima['singleResultBytes'] <= stats['maxSingleResultBytes'] < 147456 and
            maxima['pairResultBytes'] <= stats['maxPairResultBytes'] < 295936 and maxima['stageGlslBytes'] <= 65536,
            'fixed serialization bounds')
    for identity in sources + fixture_identities + raw_fixture_identities + integer_fixture_identities + float_fixture_identities + [baseline_identity, float_identity] + [
            {k: o[k] for k in ('path', 'bytes', 'sha256')} for o in originals]:
        require(describe(ROOT / identity['path']) == identity, f'source changed during run: {identity["path"]}')
    require(sha(binary.read_bytes()) == binary_sha, 'native binary changed during run')
    measured_coverage = coverage(binary, args.output)
    raw_cases, raw_pairs = cases[:raw_case_count], pairs[:raw_pair_count]
    integer_cases = cases[raw_case_count:raw_case_count + integer_case_count]
    integer_pairs = pairs[raw_pair_count:raw_pair_count + integer_pair_count]
    float_cases = cases[raw_case_count + integer_case_count:raw_case_count + integer_case_count + float_case_count]
    float_pairs = pairs[raw_pair_count + integer_pair_count:raw_pair_count + integer_pair_count + float_pair_count]
    for label, case_group, pair_group in (('raw', raw_cases, raw_pairs), ('integer', integer_cases, integer_pairs), ('float', float_cases, float_pairs)):
        for entry in case_group:
            entry['name'] = entry['name'].removeprefix(label + '::')
        for entry in pair_group:
            for key in ('name', 'vertexCaseName', 'fragmentCaseName'):
                entry[key] = entry[key].removeprefix(label + '::')
    report = {'schema': 'wasm-vm-numeric-floats-native-v1', 'status': 'passed', 'command': command,
              'originals': originals, 'cases': cases[raw_case_count + integer_case_count + float_case_count:], 'pairs': pairs[raw_pair_count + integer_pair_count + float_pair_count:],
              'rawCases': raw_cases, 'rawPairs': raw_pairs, 'integerCases': integer_cases, 'integerPairs': integer_pairs,
              'floatCases': float_cases, 'floatPairs': float_pairs, 'floatBaseline': float_identity,
              'rawFixtures': raw_fixture_identities, 'integerFixtures': integer_fixture_identities, 'floatFixtures': float_fixture_identities, 'stats': stats, 'recordedMaxima': maxima, 'layout': layout, 'coverage': measured_coverage,
              'fixtures': fixture_identities, 'legacyBaseline': baseline_identity,
              'sources': sources, 'recoverySingles': single_names, 'recoveryPairs': pair_names,
              'streamSha256': sha(stream), 'binarySha256': binary_sha, 'logSha256': sha(run.stdout),
              'seeds': SEEDS, 'mutationsPerSeed': 1024, 'sanitizers': ['address', 'undefined']}
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': 'passed', **stats, 'recordedMaxima': maxima, 'report': str(report_path)}))


if __name__ == '__main__':
    main()
