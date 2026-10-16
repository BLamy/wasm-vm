#!/usr/bin/env python3
"""Execute unchanged E5 C harness with exactly two source-bound adjacent negatives.

This versioned compatibility run preserves the old mutation/truncation schedule;
it deliberately does not claim that the unmodified E5 full gate passed.
"""
from __future__ import annotations
import argparse
import copy
import importlib.util
import json
import os
from pathlib import Path
import re
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


new = module('dot_component_builder', 'tools/virgl-dot-reciprocals/native.py')
old = module('dot_component_prior_builder', 'tools/virgl-component-floats/native.py')
require, sha, describe = new.require, new.sha, new.describe


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report_path = args.output / 'native-report.json'
    report_path.unlink(missing_ok=True)
    baseline = describe(new.COMPONENT_BASELINE)
    require(baseline['sha256'] == new.COMPONENT_BASELINE_SHA256 and
            subprocess.check_output(['git', 'show', f'{new.HELD_HEAD}:{baseline["path"]}'], cwd=ROOT) == new.COMPONENT_BASELINE.read_bytes(),
            'verified E5 native baseline exact committed bytes')
    held = json.loads(new.COMPONENT_BASELINE.read_bytes())
    require(held['schema'] == 'wasm-vm-component-floats-native-v1' and held['status'] == 'passed', 'verified E5 baseline schema')
    new.verify_retained_inputs()
    migrations = new.verify_migrations(held, json.loads(new.FIXTURE.read_bytes()))
    fixed = ['renderer/virgl-shader/native_tests/component_floats.c', 'tools/virgl-component-floats/native.py',
             'tools/virgl-component-floats/native_receipt.py']
    for path in fixed:
        require(subprocess.check_output(['git', 'show', f'{new.HELD_HEAD}:{path}'], cwd=ROOT) == (ROOT / path).read_bytes(),
                'unchanged predecessor C harness and retained helper implementations')
    source_paths = sorted(p for pattern in ('*.c', '*.h') for p in (ROOT / 'renderer/virgl-shader').glob(pattern))
    source_paths += [ROOT / path for path in fixed + ['renderer/virgl-shader/build.sh', 'renderer/virgl-shader/index.mjs',
        'renderer/virgl-shader/README.md', 'renderer/virgl-shader/UPSTREAM.json', 'renderer/virgl-shader/verify_sources.py',
        'tools/virgl-dot-reciprocals/component_compat.py', 'tools/virgl-dot-reciprocals/native.py']]
    sources = [describe(path) for path in source_paths]
    fixtures = {key: [describe(ROOT / entry['path']) for entry in held[key]] for key in
                ('rawFixtures', 'integerFixtures', 'floatFixtures', 'numericFixtures', 'fixtures')}
    migration_source = describe(new.MIGRATIONS)
    promoted_source = describe(new.FIXTURE)
    original_groups = {'originals': copy.deepcopy(held['originals'])}
    for label, case_key, pair_key in [('raw', 'rawCases', 'rawPairs'), ('integer', 'integerCases', 'integerPairs'),
                                     ('float', 'floatCases', 'floatPairs'), ('numeric', 'numericCases', 'numericPairs'),
                                     ('', 'cases', 'pairs')]:
        original_groups[case_key] = [new.retained_case(entry) if label == 'numeric' else copy.deepcopy(entry) for entry in held[case_key]]
        original_groups[pair_key] = copy.deepcopy(held[pair_key])
    for old_name in new.MIGRATION_RULES:
        require(all(anchor.split('::')[-1] != old_name for anchor in held['recoverySingles']) and
                all(old_name not in (p['vertexCaseName'], p['fragmentCaseName']) for key in
                    ('rawPairs', 'integerPairs', 'floatPairs', 'numericPairs', 'pairs') for p in held[key]),
                'no migrated input enters an old pair, recovery, truncation or mutation schedule')
    cases = [(prefix + e['name'], e) for prefix, key in
             [('raw::', 'rawCases'), ('integer::', 'integerCases'), ('float::', 'floatCases'), ('numeric::', 'numericCases'), ('', 'cases')]
             for e in original_groups[key]]
    pairs = [(prefix + e['name'], prefix, e) for prefix, key in
             [('raw::', 'rawPairs'), ('integer::', 'integerPairs'), ('float::', 'floatPairs'), ('numeric::', 'numericPairs'), ('', 'pairs')]
             for e in original_groups[key]]
    require(len(cases) == 2083 and len(pairs) == 162, 'complete predecessor case/pair counts')
    indices = {name: i for i, (name, _) in enumerate(cases)}
    pair_indices = {name: i for i, (name, _, _) in enumerate(pairs)}
    stream = bytearray(b'VGC5' + struct.pack('<I', 19))
    for entry in original_groups['originals']:
        data = (ROOT / entry['path']).read_bytes()
        require(describe(ROOT / entry['path']) == {key: entry[key] for key in ('path', 'bytes', 'sha256')}, 'original exact bytes')
        stream += struct.pack('<III', int(entry['stage'] == 'fragment'), int(entry['ok']), len(data)) + data
    profiles = [new.LEGACY_PROFILE, new.RAW_PROFILE, new.MASK_PROFILE, new.FLOAT_PROFILE, new.NUMERIC_PROFILE, new.COMPONENT_PROFILE]
    stream += struct.pack('<I', len(cases))
    for name, entry in cases:
        encoded, data = name.encode('ascii'), entry['text'].encode('ascii')
        raw = profiles.index(entry['profile']) if entry.get('profile') else 0
        stream += struct.pack('<IIIII', int(entry['stage'] == 'fragment'), int(entry['ok']), raw, len(encoded), len(data)) + encoded + data
    stream += struct.pack('<I', len(pairs))
    for name, prefix, entry in pairs:
        encoded = name.encode('ascii')
        stream += struct.pack('<IIII', indices[prefix + entry['vertexCaseName']], indices[prefix + entry['fragmentCaseName']],
                              int(entry['ok']), len(encoded)) + encoded
    singles, pair_names = held['recoverySingles'], held['recoveryPairs']
    require(len(singles) == 12 and len(pair_names) == 10, 'unchanged predecessor recovery cardinality')
    stream += struct.pack('<12I', *[indices[name] for name in singles]) + struct.pack('<10I', *[pair_indices[name] for name in pair_names])
    (args.output / 'native-input.bin').write_bytes(stream)
    binary = args.binary.resolve()
    require(binary == ROOT / 'renderer/virgl-shader/build/component-float-sanitize/component-float-test', 'actual unchanged E5 sanitizer target')
    binary_sha = sha(binary.read_bytes())
    (args.output / 'native.profraw').unlink(missing_ok=True)
    env = dict(os.environ, UBSAN_OPTIONS='halt_on_error=1', ASAN_OPTIONS='abort_on_error=1',
               LLVM_PROFILE_FILE=str((args.output / 'native.profraw').resolve()))
    run = subprocess.run([str(binary)], input=stream, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, timeout=300)
    (args.output / 'native.log').write_bytes(run.stdout)
    require(run.returncode == 0, 'actual predecessor C sanitizer run failed; inspect native.log')
    transcript_groups = {'ORIGINAL': original_groups['originals'], 'CASE': [e for _, e in cases], 'PAIR': [e for _, _, e in pairs]}
    seen = {key: set() for key in transcript_groups}
    stats, layout, seeds_seen = None, None, []
    for line in run.stdout.decode('ascii').splitlines():
        match = re.fullmatch(r'(ORIGINAL|CASE|PAIR) ([0-9]+) (.+)', line)
        if match:
            kind, index, raw = match[1], int(match[2]), match[3].encode('ascii')
            require(index < len(transcript_groups[kind]) and index not in seen[kind], 'unique complete actual predecessor transcript index')
            seen[kind].add(index)
            entry = transcript_groups[kind][index]
            result = json.loads(raw)
            require(result == entry['result'] and len(raw) == entry['resultBytes'] and sha(raw) == entry['resultSha256'],
                    'actual current compiler retains complete predecessor serialized result bytes')
            entry.update(result=result, resultBytes=len(raw), resultSha256=sha(raw))
        elif line.startswith('LAYOUT '):
            require(layout is None, 'one predecessor layout record'); layout = json.loads(line[7:])
        elif line.startswith('STATS '):
            require(stats is None, 'one predecessor statistics record'); stats = json.loads(line[6:])
        else:
            match = re.fullmatch(r'SEED ([0-9a-f]{8}) mutations=1024 standalone_recoveries=12288 pair_recoveries=10240 passed', line)
            require(match is not None, 'only actual complete old seed diagnostics')
            seeds_seen.append(match[1])
    require(all(len(seen[key]) == len(entries) for key, entries in transcript_groups.items()) and seeds_seen == new.SEEDS,
            'all predecessor originals/cases/pairs and four original seeds actually executed')
    require(layout == held['layout'] and stats == held['stats'], 'exact old layout, actual call/recovery totals and bounded output maxima')
    maxima = {'singleResultBytes': max(e['resultBytes'] for e in transcript_groups['ORIGINAL'] + transcript_groups['CASE']),
              'pairResultBytes': max(e['resultBytes'] for e in transcript_groups['PAIR']),
              'stageGlslBytes': max(len(r['glsl'].encode('ascii')) for entries in transcript_groups.values() for e in entries if e['result']['ok']
                  for r in ([e['result']['vertex'], e['result']['fragment']] if 'vertex' in e['result'] else [e['result']]))}
    require(maxima == held['recordedMaxima'], 'exact independently derived predecessor output maxima')
    for identity in sources + [i for entries in fixtures.values() for i in entries] + [baseline, migration_source, promoted_source]:
        require(describe(ROOT / identity['path']) == identity, 'compatibility source changed during execution')
    require(sha(binary.read_bytes()) == binary_sha, 'compatibility sanitizer binary changed during execution')
    measured = old.coverage(binary, args.output)
    report = dict(schema='wasm-vm-component-floats-regression-compat-v1', status='passed', command=[str(binary)],
                  compatibility={'heldHead': new.HELD_HEAD, 'kind': 'unchanged-E5-C-harness-with-two-adjacent-negatives',
                                 'predecessorFullGateClaimed': False}, **original_groups, **fixtures,
                  componentBaseline=baseline, migrationsSource=migration_source, migrations=migrations,
                  promotedFixture=promoted_source, stats=stats, layout=layout, recordedMaxima=maxima, sources=sources,
                  coverage=measured, recoverySingles=singles, recoveryPairs=pair_names, streamSha256=sha(stream),
                  binarySha256=binary_sha, logSha256=sha(run.stdout), seeds=new.SEEDS, mutationsPerSeed=1024,
                  sanitizers=['address', 'undefined'])
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': 'passed', 'compatibility': report['compatibility'], **stats, 'report': str(report_path)}))


if __name__ == '__main__':
    main()
