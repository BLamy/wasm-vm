#!/usr/bin/env python3
"""Record all new conditional cases and the complete explicitly migrated E6 workload."""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[2]
HELD_HEAD = '9497f3da026092db1eb53e8d6187bceff214656a'
BASELINE = ROOT / 'evidence/virgl-dot-reciprocals/worker/native/native-report.json'
BASELINE_SHA = '781960b68e1cb49d03b02ec4e6264183dc52fec408825d37ecb93daa7f189dcb'
FIXTURE = ROOT / 'renderer/virgl-shader/tests/constant-compiler-cases.json'
MIGRATIONS = ROOT / 'renderer/virgl-shader/tests/constant-compiler-migrations.json'
HARDWARE = ROOT / 'renderer/virgl-command/tests/constant-compiler-shaders.json'
PROFILES = ['virgl-webgl2-straight-line-v5'] + [f'virgl-webgl2-raw-bits-v{i}' for i in range(1, 8)]
GROUPS = [('raw', 'raw-bit', 279, 22), ('integer', 'integer-mask', 426, 25),
          ('float', 'float-mask', 454, 45), ('numeric', 'numeric-float', 350, 33),
          ('component', 'component-float', 574, 37), ('dot', 'dot-reciprocal', 616, 41)]
SEEDS = ['6bd2c931', 'f1037a85', '2e849d67', 'a75c1b09']
SOURCES = ['renderer/virgl-shader/build.sh', 'renderer/virgl-shader/index.mjs',
           'renderer/virgl-shader/native_tests/constant_compiler.c', 'renderer/virgl-shader/README.md',
           'renderer/virgl-shader/UPSTREAM.json', 'renderer/virgl-shader/verify_sources.py',
           'tools/virgl-constant-compiler/native.py', 'tools/virgl-constant-compiler/native_receipt.py',
           'tools/virgl-constant-compiler/generate_cases.py']


def require(value, message):
    if not value: raise ValueError(message)


def sha(raw): return hashlib.sha256(raw).hexdigest()


def describe(path):
    raw = path.read_bytes()
    return {'path': str(path.relative_to(ROOT)), 'bytes': len(raw), 'sha256': sha(raw)}


def pair_fixtures(fixtures, hardware):
    pairs = [dict(p, ok=True, expected={'interfaceKey': p['interfaceKey']}) for p in hardware['pairs']]
    for stage in ('vertex', 'fragment'):
        for code in ('parse-error', 'unsupported-feature'):
            rejected = next(c for c in fixtures if c['stage'] == stage and not c['ok'] and c['expected'] == {'errorCode': code})
            v, f = hardware['recoverySingles'][:2]
            if stage == 'vertex': v = rejected['name']
            else: f = rejected['name']
            pairs.append({'name': f'rejected-{stage}-{code}-pair', 'vertex': v, 'fragment': f, 'ok': False, 'expected': {'errorCode': code}})
    bad_fragment = next(c['name'] for c in fixtures if c['stage'] == 'fragment' and c.get('expected') == {'errorCode': 'parse-error'})
    pairs += [
        {'name': 'conditional-then-fragment-parse-error', 'vertex': 'coupled-vertex', 'fragment': bad_fragment,
         'ok': False, 'expected': {'errorCode': 'unsupported-feature'}},
        {'name': 'conditional-incompatible-interface', 'vertex': 'coupled-vertex',
         'fragment': 'numeric-ADD-source0-c0-negate-fragment', 'ok': False, 'expected': {'errorCode': 'unsupported-feature'}},
        {'name': 'conditional-dot-pair', 'vertex': 'conditional-interface-vertex', 'fragment': 'dot::raw-fragment',
         'ok': True, 'expected': {'interfaceKey': 'generic-interpolation-v1:g5/15/smooth;g6/15/smooth;g7/15/smooth'}},
        {'name': 'dot-conditional-pair', 'vertex': 'dot::raw-vertex', 'fragment': 'conditional-interface-fragment',
         'ok': True, 'expected': {'interfaceKey': 'generic-interpolation-v1:g5/15/smooth;g6/15/smooth;g7/15/smooth'}},
    ]
    pairs += [
        {'name': 'conditional-legacy-flat', 'vertex': 'coupled-vertex', 'fragment': 'atlas-pass-fragment',
         'ok': True, 'expected': {'interfaceKey': 'generic-interpolation-v1:g0/15/flat'}},
        {'name': 'legacy-conditional-smooth', 'vertex': 'atlas-pass-vertex', 'fragment': 'coupled-fragment',
         'ok': True, 'expected': {'interfaceKey': 'generic-interpolation-v1:g0/15/smooth'}},
    ]
    return pairs


def workload():
    require(sha(BASELINE.read_bytes()) == BASELINE_SHA and BASELINE.read_bytes() == subprocess.check_output(
        ['git', 'show', f'{HELD_HEAD}:{BASELINE.relative_to(ROOT)}'], cwd=ROOT), 'verified E6 baseline exact bytes')
    held = json.loads(BASELINE.read_bytes())
    manifest = json.loads(MIGRATIONS.read_bytes())
    require(manifest['schema'] == 'wasm-vm-constant-compiler-migrations-v1' and manifest['parentHead'] == HELD_HEAD
            and len(manifest['migrations']) == 105, 'explicit fixed historical migration boundary')
    report, groups = {}, []
    for label, stem, count, pair_count in GROUPS:
        old_cases, old_pairs = ('cases', 'pairs') if label == 'dot' else (label + 'Cases', label + 'Pairs')
        cases, pairs = copy.deepcopy(held[old_cases]), copy.deepcopy(held[old_pairs])
        source = f'renderer/virgl-shader/tests/{stem}-cases.json'
        records = [m for m in manifest['migrations'] if m['fixture'] == source]
        replacements = {m['oldName']: m for m in records}
        for case in cases:
            if case['name'] in replacements:
                m = replacements[case['name']]
                require(case['text'] == m['oldText'] and case['result'] == m['oldResult'], 'exact retained migration input/result')
                case.update(name=m['replacementName'], text=m['replacementText'], inputSha256=m['replacementInputSha256'],
                            bytes=len(m['replacementText'].encode('ascii')))
        for pair in pairs:
            for stage in ('vertex', 'fragment'):
                m = replacements.get(pair[stage + 'CaseName'])
                if m: pair.update({stage + 'CaseName': m['replacementName'], stage + 'Sha256': m['replacementInputSha256']})
        current = json.loads((ROOT / source).read_bytes())
        require([(e['name'], e['text'], e['ok']) for e in cases if e['origin'] == 'shared'] ==
                [(e['name'], e['text'], e['ok']) for e in current], 'current fixture exact migrated historical order')
        require((len(cases), len(pairs)) == (count, pair_count), 'entire historical workload')
        report[label + 'Cases'], report[label + 'Pairs'] = cases, pairs
        report[label + 'Fixtures'] = [describe(ROOT / f'renderer/virgl-shader/tests/{stem}-{kind}.json') for kind in ('cases', 'hardware')]
        groups.append((label + '::', cases, pairs))
    shared, hardware = json.loads(FIXTURE.read_bytes()), json.loads(HARDWARE.read_bytes())
    require(hardware['schema'] == 'wasm-vm-constant-compiler-hardware-v1', 'hardware schema')
    fixtures = [dict(c, origin='shared') for c in shared]
    fixtures += [dict(c, ok=True, origin='hardware') for c in hardware['shaders']]
    fixtures += [dict(c, ok=False, expected={'errorCode': 'unsupported-feature'}, origin='hardware-negative') for c in hardware['negativeCases']]
    cases = []
    for f in fixtures:
        raw = f['text'].encode('ascii'); profile = f['expected'].get('profile')
        require(0 < len(raw) <= 16384 and len(f['name'].encode()) < 160, 'bounded shared input')
        entry = {k: f[k] for k in ('name', 'stage', 'text', 'ok', 'origin', 'expected')}
        entry.update(inputSha256=sha(raw), bytes=len(raw))
        if profile: entry['profile'] = profile
        cases.append(entry)
    lookup = {prefix + e['name']: e for prefix, entries, _ in groups for e in entries}
    lookup.update({e['name']: e for e in cases})
    pairs = []
    for f in pair_fixtures(shared, hardware):
        v, p = lookup[f['vertex']], lookup[f['fragment']]
        pairs.append({'name': f['name'], 'vertexCaseName': f['vertex'], 'fragmentCaseName': f['fragment'],
                      'vertexSha256': v['inputSha256'], 'fragmentSha256': p['inputSha256'], 'ok': f['ok'], 'expected': f['expected']})
    report.update(cases=cases, pairs=pairs, originals=copy.deepcopy(held['originals']), fixtures=[describe(FIXTURE), describe(HARDWARE)],
                  dotBaseline=describe(BASELINE), migrationsSource=describe(MIGRATIONS), migrations=manifest['migrations'],
                  pairSubstitutions=manifest['pairSubstitutions'])
    groups.append(('', cases, pairs))
    # Existing E6 recovery names gain only the explicit dot namespace.
    report['recoverySingles'] = [n if '::' in n else 'dot::' + n for n in held['recoverySingles']]
    report['recoverySingles'] += ['coupled-vertex', 'coupled-fragment']
    report['recoveryPairs'] = [n if '::' in n else 'dot::' + n for n in held['recoveryPairs']]
    report['recoveryPairs'] += ['conditional-legacy-flat', 'legacy-conditional-smooth']
    return report, groups


def serialize(report, groups):
    cases = [(prefix + e['name'], e) for prefix, entries, _ in groups for e in entries]
    pairs = [(prefix + e['name'], prefix, e) for prefix, _, entries in groups for e in entries]
    indexes = {name: i for i, (name, _) in enumerate(cases)}
    pair_indexes = {name: i for i, (name, _, _) in enumerate(pairs)}
    require(len(indexes) == len(cases) <= 4096 and len(pair_indexes) == len(pairs) <= 320, 'unique bounded native inputs')
    stream = bytearray(b'VGC7' + struct.pack('<I', 19))
    for entry in report['originals']:
        raw = (ROOT / entry['path']).read_bytes()
        stream += struct.pack('<III', int(entry['stage'] == 'fragment'), int(entry['ok']), len(raw)) + raw
    stream += struct.pack('<I', len(cases))
    for name, entry in cases:
        raw, name = entry['text'].encode('ascii'), name.encode('ascii')
        profile = PROFILES.index(entry['profile']) if entry.get('profile') else 0
        stream += struct.pack('<IIIII', int(entry['stage'] == 'fragment'), int(entry['ok']), profile, len(name), len(raw)) + name + raw
    stream += struct.pack('<I', len(pairs))
    for name, prefix, entry in pairs:
        v, f = entry['vertexCaseName'], entry['fragmentCaseName']
        name = name.encode('ascii')
        stream += struct.pack('<IIII', indexes[prefix + v], indexes[prefix + f], int(entry['ok']), len(name)) + name
    stream += struct.pack('<16I', *[indexes[n] for n in report['recoverySingles']])
    stream += struct.pack('<14I', *[pair_indexes[n] for n in report['recoveryPairs']])
    return stream, cases, pairs


def expectations(result, entry):
    require(result['ok'] is entry['ok'], 'literal acceptance: ' + entry.get('name', entry.get('path', '')))
    if not result['ok']:
        require(set(result) == {'ok', 'error'} and result['error']['code'] == entry.get('expected', {'errorCode': 'unsupported-feature'})['errorCode'], 'literal structured error')
    elif 'profile' in entry:
        e, metadata = entry['expected'], result['metadata']
        require(metadata['profile'] == entry['profile'] and metadata['stage'] == entry['stage'], 'literal stage/profile')
        if 'constantDomains' in e: require(metadata.get('constantDomains') == e['constantDomains'], 'exact derived domain')
        if 'constantCount' in e:
            require(metadata['uniforms'] == ([{'name': ('vs' if entry['stage'] == 'vertex' else 'fs') + 'const0',
                    'type': 'uvec4[]', 'count': e['constantCount'], 'encoding': 'float32-bits'}] if e['constantCount'] else []), 'literal bank extent')
    elif 'vertexCaseName' in entry:
        require(result['interfaceKey'] == entry['expected']['interfaceKey'], 'literal linked interface: ' + entry['name'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True); parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'native-report.json').unlink(missing_ok=True)
    report, groups = workload(); stream, cases, pairs = serialize(report, groups)
    sources = sorted(p for pattern in ('*.c', '*.h') for p in (ROOT / 'renderer/virgl-shader').glob(pattern))
    report['sources'] = [describe(p) for p in sources] + [describe(ROOT / p) for p in SOURCES]
    binary = args.binary.resolve(); binary_sha = sha(binary.read_bytes())
    (args.output / 'native-input.bin').write_bytes(stream)
    env = dict(os.environ, UBSAN_OPTIONS='halt_on_error=1', ASAN_OPTIONS='abort_on_error=1',
               LLVM_PROFILE_FILE=str((args.output / 'native.profraw').resolve()))
    run = subprocess.run([str(binary)], input=stream, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, timeout=600)
    (args.output / 'native.log').write_bytes(run.stdout)
    require(run.returncode == 0, f'sanitizer failed: {run.returncode}; inspect native.log')
    entries = {'ORIGINAL': report['originals'], 'CASE': [e for _, e in cases], 'PAIR': [e for _, _, e in pairs]}
    seen = {k: set() for k in entries}; faults = []; seeds = []
    for line in run.stdout.decode('ascii').splitlines():
        match = re.fullmatch(r'(ORIGINAL|CASE|PAIR) ([0-9]+) (.+)', line)
        if match:
            kind, index, raw = match[1], int(match[2]), match[3].encode('ascii')
            require(index not in seen[kind] and index < len(entries[kind]), 'unique native transcript result')
            seen[kind].add(index); entry = entries[kind][index]; result = json.loads(raw)
            if 'result' in entry:
                require((result, len(raw), sha(raw)) == (entry['result'], entry['resultBytes'], entry['resultSha256']), 'complete retained serialized result: ' + entry.get('name', entry.get('path', '')))
            expectations(result, entry)
            entry.update(result=result, resultBytes=len(raw), resultSha256=sha(raw))
        elif line.startswith('FAULT '):
            _, index, raw = line.split(' ', 2); require(int(index) == len(faults), 'ordered actual allocation fault'); faults.append(json.loads(raw))
        elif line.startswith('LAYOUT '): report['layout'] = json.loads(line[7:])
        elif line.startswith('STATS '): report['stats'] = json.loads(line[6:])
        else:
            m = re.fullmatch(r'SEED ([0-9a-f]{8}) mutations=1024 standalone_recoveries=16384 pair_recoveries=14336 passed', line)
            require(m is not None, 'only expected native diagnostics'); seeds.append(m[1])
    require(all(len(seen[k]) == len(v) for k, v in entries.items()) and seeds == SEEDS, 'complete native run')
    report['recordedMaxima'] = {'singleResultBytes': max(e['resultBytes'] for e in entries['ORIGINAL'] + entries['CASE']),
        'pairResultBytes': max(e['resultBytes'] for e in entries['PAIR']),
        'stageGlslBytes': max(len(stage['glsl'].encode()) for group in entries.values() for e in group if e['result']['ok']
           for stage in ([e['result']['vertex'], e['result']['fragment']] if 'vertex' in e['result'] else [e['result']]))}
    for source in report['sources'] + report['fixtures'] + [report['dotBaseline'], report['migrationsSource']] + [v for label, *_ in GROUPS for v in report[label+'Fixtures']]:
        require(describe(ROOT / source['path']) == source, 'source unchanged during recording')
    require(sha(binary.read_bytes()) == binary_sha, 'native artifact unchanged')
    report.update(schema='wasm-vm-constant-compiler-native-v1', status='passed', command=[str(binary)],
                  binarySha256=binary_sha, streamSha256=sha(stream), logSha256=sha(run.stdout), allocationFaults=faults,
                  seeds=SEEDS, mutationsPerSeed=1024, sanitizers=['address', 'undefined'], coverage=coverage(binary, args.output),
                  compatibility={'heldHead': HELD_HEAD, 'retainedCases': 2699, 'retainedPairs': 203,
                                 'adjacentNegatives': 105, 'pairSubstitutions': 2, 'predecessorFullGateClaimed': False})
    (args.output / 'native-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': 'passed', **report['stats'], 'report': str(args.output / 'native-report.json')}))


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
    return {'schema': 'wasm-vm-constant-compiler-native-coverage-v1', 'sources': summaries, 'commands': commands,
            'nativeStack': {'boundary': 'Instrumented native per-function observations only; dynamic sanitizer frames do not establish total or Wasm stack usage.',
                            'files': stack_records},
            'tools': [{'path': str(path), 'sha256': sha(path.read_bytes()),
                       'version': subprocess.check_output([str(path), '--version'], text=True).strip()}
                      for path in (profdata, cov)],
            'records': [{'path': name, 'bytes': (output / name).stat().st_size,
                         'sha256': sha((output / name).read_bytes())} for name in names]}



if __name__ == "__main__": main()
