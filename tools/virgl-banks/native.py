#!/usr/bin/env python3
"""Bind native bank sanitizer results to unchanged originals and shared cases."""
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
FIXTURE = ROOT / 'renderer/virgl-shader/tests/bank-cases.json'
PROFILE = 'virgl-webgl2-straight-line-v5'
SEEDS = ['7c1209ad', '491be583', 'ea016f35', '265d8cb7']
PAIRS = [
    ('hardware-low-pair', 'hardware-low-vertex', 'hardware-low-fragment'),
    ('hardware-high-pair', 'hardware-high-vertex', 'hardware-high-fragment'),
    ('hardware-order-pair', 'hardware-high-vertex', 'hardware-order-fragment'),
    ('hardware-maximal-pair', 'hardware-maximal-vertex', 'hardware-maximal-fragment'),
]
SOURCES = [
    'renderer/virgl-shader/bridge.c', 'renderer/virgl-shader/bridge.h',
    'renderer/virgl-shader/index.mjs', 'renderer/virgl-shader/build.sh',
    'renderer/virgl-shader/native_tests/banks.c', 'renderer/virgl-shader/README.md',
    'renderer/virgl-shader/UPSTREAM.json', 'renderer/virgl-shader/verify_sources.py',
    'tools/virgl-banks/native.py',
]


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def describe(path):
    raw = path.read_bytes()
    return {'path': str(path.relative_to(ROOT)), 'bytes': len(raw), 'sha256': sha(raw)}


def stage_result(result, stage):
    require(set(result) == {'glsl', 'metadata'}, 'exact stage fields')
    require(result['metadata']['profile'] == PROFILE and result['metadata']['stage'] == stage, 'v5 stage identity')
    require(result['glsl'].startswith('#version 300 es') and len(result['glsl'].encode()) <= 65536, 'bounded ESSL300')


def expectations(result, entry, fixture):
    if 'expected' not in entry:
        return
    expected = entry['expected']
    require(set(expected) <= {'constantCount', 'instructions'}, 'bounded literal expectation fields')
    require(all(type(v) is int and v >= 0 for v in expected.values()), 'nonnegative literal metadata expectations')
    if 'constantCount' in expected:
        uniforms = result['metadata']['uniforms']
        require(len(uniforms) == 1 and uniforms[0]['count'] == expected['constantCount'], 'literal declared constant extent')
    if 'instructions' in expected:
        instructions = sum(bool(re.match(r'^\s*(?:[0-9]+:\s*)?(MOV|ADD|MUL|MAD|TEX)\b', line))
                           for line in fixture['text'].splitlines())
        require(instructions == expected['instructions'] and instructions <= 179, 'literal non-END instruction count')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report_path = args.output / 'native-report.json'
    report_path.unlink(missing_ok=True)
    unique = {}
    for workload in ('textured-scene', 'kmscube', 'glmark2-es2', 'compositor'):
        for path in sorted((ROOT / 'evidence/virgl-corpus/captures' / workload / 'shaders').glob('*.tgsi')):
            raw = path.read_bytes()
            require(sha(raw) == path.stem, 'original SHA identity')
            unique.setdefault(path.stem, (path, raw))
    require(len(unique) == 19, 'nineteen originals')
    originals = []
    stream = bytearray(b'VGB1' + struct.pack('<I', 19))
    for _, (path, raw) in sorted(unique.items()):
        stage = 'vertex' if raw.startswith(b'VERT\n') else 'fragment'
        require(raw.startswith(b'VERT\n' if stage == 'vertex' else b'FRAG\n'), 'original stage')
        accepted = b'PRECISE' not in raw
        originals.append({**describe(path), 'stage': stage, 'ok': accepted})
        stream += struct.pack('<III', int(stage == 'fragment'), int(accepted), len(raw)) + raw
    require(sum(o['ok'] for o in originals) == 12, 'twelve original acceptances')
    fixtures = json.loads(FIXTURE.read_bytes())
    require(type(fixtures) is list and 4 <= len(fixtures) <= 512, 'bounded bank case count')
    stream += struct.pack('<I', len(fixtures))
    cases, indexes = [], {}
    for i, fixture in enumerate(fixtures):
        fields = {'name', 'stage', 'text', 'ok'} | ({'expected'} if 'expected' in fixture else set())
        require(set(fixture) == fields and type(fixture['ok']) is bool, 'exact case fields')
        require(fixture['stage'] in ('vertex', 'fragment'), 'case stage')
        name, text = fixture['name'].encode('ascii'), fixture['text'].encode('ascii')
        require(0 < len(name) < 160 and fixture['name'] not in indexes, 'unique bounded name')
        require(0 < len(text) <= 16384 and all(c in (9, 10, 13) or 32 <= c <= 126 for c in text), 'bounded ASCII text')
        indexes[fixture['name']] = i
        stream += struct.pack('<IIII', int(fixture['stage'] == 'fragment'), int(fixture['ok']), len(name), len(text)) + name + text
        entry = {'name': fixture['name'], 'stage': fixture['stage'], 'inputSha256': sha(text), 'ok': fixture['ok']}
        if 'expected' in fixture:
            require(fixture['ok'] or set(fixture['expected']) == {'errorCode'}, 'negative expectations name only a code')
            entry['expected'] = fixture['expected']
        cases.append(entry)
    require([c['name'] for c in cases[:4]] == ['hardware-low-vertex', 'hardware-high-vertex', 'hardware-low-fragment', 'hardware-high-fragment'], 'recovery anchor order')
    stream += struct.pack('<I', len(PAIRS))
    pairs = []
    for name, vertex, fragment in PAIRS:
        vi, fi = indexes[vertex], indexes[fragment]
        require(cases[vi]['stage'] == 'vertex' and cases[fi]['stage'] == 'fragment' and cases[vi]['ok'] and cases[fi]['ok'], 'pair stage identities')
        raw_name = name.encode('ascii')
        stream += struct.pack('<III', vi, fi, len(raw_name)) + raw_name
        pairs.append({'name': name, 'vertexCaseName': vertex, 'fragmentCaseName': fragment,
                      'vertexSha256': cases[vi]['inputSha256'], 'fragmentSha256': cases[fi]['inputSha256']})
    command = [str(args.binary.resolve())]
    env = dict(os.environ, UBSAN_OPTIONS='halt_on_error=1', ASAN_OPTIONS='abort_on_error=1')
    run = subprocess.run(command, input=stream, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, timeout=240)
    (args.output / 'native.log').write_bytes(run.stdout)
    require(run.returncode == 0, f'bank sanitizer failed: {run.returncode}; see {args.output / "native.log"}')
    log = run.stdout.decode('ascii')
    seen = {'ORIGINAL': set(), 'CASE': set(), 'PAIR': set()}
    stats = None
    for line in log.splitlines():
        match = re.fullmatch(r'(ORIGINAL|CASE|PAIR) ([0-9]+) (.+)', line)
        if match:
            kind, i, raw_result = match[1], int(match[2]), match[3]
            entries = {'ORIGINAL': originals, 'CASE': cases, 'PAIR': pairs}[kind]
            require(i < len(entries) and i not in seen[kind], 'unique bounded result index')
            seen[kind].add(i)
            entry, result = entries[i], json.loads(raw_result)
            entry['result'], entry['resultBytes'] = result, len(raw_result.encode('ascii'))
            require(result.get('ok') is (True if kind == 'PAIR' else entry['ok']), 'literal acceptance')
            if result['ok']:
                if kind == 'PAIR':
                    require(set(result) == {'ok', 'vertex', 'fragment', 'interfaceKey'}, 'exact pair fields')
                    stage_result(result['vertex'], 'vertex'); stage_result(result['fragment'], 'fragment')
                    require(result['interfaceKey'] == 'generic-interpolation-v1:', 'literal no-input pair interface')
                else:
                    require(set(result) == {'ok', 'glsl', 'metadata'}, 'exact single fields')
                    stage_result({k: result[k] for k in ('glsl', 'metadata')}, entry['stage'])
                    if kind == 'CASE':
                        expectations(result, entry, fixtures[i])
            else:
                require(set(result) == {'ok', 'error'} and set(result['error']) == {'code', 'message'}, 'structured error without partial result')
                require(result['error']['code'] in ('parse-error', 'unsupported-feature'), 'rejection before upstream')
                if kind == 'ORIGINAL':
                    require(result['error']['code'] == 'unsupported-feature', 'original remains explicitly unsupported')
                if 'expected' in entry:
                    require(result['error']['code'] == entry['expected']['errorCode'], 'literal semantic or syntax rejection code')
        elif line.startswith('STATS '):
            require(stats is None, 'one statistics record'); stats = json.loads(line[6:])
    require(all(len(seen[k]) == n for k, n in [('ORIGINAL', 19), ('CASE', len(cases)), ('PAIR', 4)]), 'complete recorded results')
    require(stats and stats['originals'] == 19 and stats['acceptedOriginals'] == 12 and stats['cases'] == len(cases) and stats['pairs'] == 4, 'native totals')
    attacks = stats['cases'] + stats['truncations'] + stats['hostileCases'] + stats['mutations']
    require(stats['standaloneRecoveries'] == attacks * 4 and stats['pairRecoveries'] == attacks * 2, 'exact recovery totals')
    require(stats['calls'] == 19 + 4 + 4 + attacks * 7, 'exact call accounting')
    require(stats['mutations'] == 4096, 'four mutation batches')
    for seed in SEEDS:
        require(f'SEED {seed} mutations=1024 standalone_recoveries=4096 pair_recoveries=2048 passed' in log, 'complete seed')
    maxima = {'singleResultBytes': max(e['resultBytes'] for e in originals + cases),
              'pairResultBytes': max(e['resultBytes'] for e in pairs),
              'stageGlslBytes': max(len(r['glsl'].encode('ascii')) for e in originals + cases + pairs
                                   if e['result']['ok'] for r in ([e['result']['vertex'], e['result']['fragment']]
                                                                 if 'vertex' in e['result'] else [e['result']]))}
    require(maxima['singleResultBytes'] <= stats['maxSingleResultBytes'] < 147456 and
            maxima['pairResultBytes'] <= stats['maxPairResultBytes'] < 295936 and maxima['stageGlslBytes'] <= 65536, 'fixed serialization bounds')
    report = {'schema': 'wasm-vm-banks-native-v1', 'status': 'passed', 'command': command,
              'originals': originals, 'cases': cases, 'pairs': pairs, 'stats': stats, 'recordedMaxima': maxima,
              'fixture': describe(FIXTURE), 'sources': [describe(ROOT / p) for p in SOURCES],
              'streamSha256': sha(stream), 'binarySha256': sha(args.binary.read_bytes()),
              'logSha256': sha(run.stdout), 'seeds': SEEDS, 'mutationsPerSeed': 1024,
              'sanitizers': ['address', 'undefined']}
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': 'passed', **stats, 'recordedMaxima': maxima, 'report': str(report_path)}))


if __name__ == '__main__':
    main()
