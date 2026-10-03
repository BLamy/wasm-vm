#!/usr/bin/env python3
"""Bind bounded native pair conversion to original bytes and literal interfaces."""
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
FIXTURE = ROOT / 'renderer/virgl-shader/tests/pair-cases.json'
PROFILE = 'virgl-webgl2-straight-line-v4'
SEEDS = ['6102ab3d', 'b487095f', '938ad217', '27a461cb']
SOURCE_PATHS = [
    'renderer/virgl-shader/bridge.c', 'renderer/virgl-shader/bridge.h',
    'renderer/virgl-shader/index.mjs', 'renderer/virgl-shader/build.sh',
    'renderer/virgl-shader/native_tests/pairs.c', 'renderer/virgl-shader/README.md',
    'renderer/virgl-shader/UPSTREAM.json', 'renderer/virgl-shader/verify_sources.py',
    'tools/virgl-pairs/native.py',
]


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def describe(path):
    raw = path.read_bytes()
    return {'path': str(path.relative_to(ROOT)), 'bytes': len(raw), 'sha256': sha(raw)}


def projection(items):
    return sorted(({key: item[key] for key in ('semanticIndex', 'componentMask', 'interpolation')}
                   for item in items if item['semantic'] == 'GENERIC'), key=lambda item: item['semanticIndex'])


def stage_result(result, stage):
    require(set(result) == {'glsl', 'metadata'}, 'exact stage result shape')
    require(result['metadata']['profile'] == PROFILE and result['metadata']['stage'] == stage, 'versioned stage metadata')
    require(result['glsl'].startswith('#version 300 es') and len(result['glsl'].encode()) <= 65536, 'bounded ESSL300 source')
    for file in ('inputs', 'outputs'):
        for item in result['metadata'][file]:
            require(('interpolation' in item) == (item['semantic'] == 'GENERIC'), 'truthful generic-only interpolation')
            if item['semantic'] == 'GENERIC':
                require(item['interpolation'] in ('smooth', 'flat'), 'bounded interpolation mode')


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
            require(sha(raw) == path.stem, 'unchanged original filename hash')
            unique.setdefault(path.stem, (path, raw))
    require(len(unique) == 19, 'nineteen unique originals')
    originals = []
    stream = bytearray(b'VGP1' + struct.pack('<I', 19))
    for digest, (path, raw) in sorted(unique.items()):
        stage = 'vertex' if raw.startswith(b'VERT\n') else 'fragment'
        require(raw.startswith(b'VERT\n' if stage == 'vertex' else b'FRAG\n'), 'original stage')
        accepted = b'PRECISE' not in raw
        originals.append({**describe(path), 'stage': stage, 'ok': accepted})
        stream += struct.pack('<III', int(stage == 'fragment'), int(accepted), len(raw)) + raw
    require(sum(o['ok'] for o in originals) == 12, 'twelve non-PRECISE originals')
    fixture_bytes = FIXTURE.read_bytes()
    fixtures = json.loads(fixture_bytes)
    require(isinstance(fixtures, list) and 4 <= len(fixtures) <= 256, 'bounded pair fixture count')
    stream += struct.pack('<I', len(fixtures))
    cases, names = [], set()
    for fixture in fixtures:
        require(type(fixture['ok']) is bool, 'literal boolean expectation')
        fields = {'name', 'vertexText', 'fragmentText', 'ok'} | ({'expected'} if fixture['ok'] else set())
        require(set(fixture) == fields, 'exact shared fixture fields')
        name, vertex, fragment = (fixture[key].encode('ascii') for key in ('name', 'vertexText', 'fragmentText'))
        require(0 < len(name) < 160 and fixture['name'] not in names, 'unique bounded name')
        names.add(fixture['name'])
        require(len(vertex) <= 16384 and len(fragment) <= 16384, 'per-stage fixture bounds')
        require(all(byte in (9, 10, 13) or 32 <= byte <= 126 for byte in vertex + fragment), 'ASCII grammar fixture')
        stream += struct.pack('<IIII', int(fixture['ok']), len(name), len(vertex), len(fragment)) + name + vertex + fragment
        item = {'name': fixture['name'], 'vertexSha256': sha(vertex), 'fragmentSha256': sha(fragment), 'ok': fixture['ok']}
        if fixture['ok']:
            item['expected'] = fixture['expected']
        cases.append(item)
    command = [str(args.binary.resolve())]
    env = dict(os.environ, UBSAN_OPTIONS='halt_on_error=1', ASAN_OPTIONS='abort_on_error=1')
    run = subprocess.run(command, input=stream, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, timeout=180)
    (args.output / 'native.log').write_bytes(run.stdout)
    log = run.stdout.decode('utf-8', errors='replace')
    require(run.returncode == 0, f'pair sanitizer failed: {run.returncode}; see {args.output / "native.log"}')
    seen = {'ORIGINAL': set(), 'PAIR': set()}
    stats = None
    for line in log.splitlines():
        match = re.fullmatch(r'(ORIGINAL|PAIR) ([0-9]+) (.+)', line)
        if match:
            kind, index, result = match[1], int(match[2]), json.loads(match[3])
            entries = originals if kind == 'ORIGINAL' else cases
            require(index < len(entries) and index not in seen[kind], 'unique bounded result index')
            seen[kind].add(index)
            entry = entries[index]
            require(result.get('ok') is entry['ok'], 'literal acceptance expectation')
            entry['result'] = result
            if not result['ok']:
                require(set(result) == {'ok', 'error'} and set(result['error']) == {'code', 'message'}, 'structured failure without partial stages')
                require(result['error']['code'] in ('parse-error', 'unsupported-feature', 'unsupported-stage', 'incompatible-interface'), 'guard-stage failure')
            elif kind == 'ORIGINAL':
                stage_result({key: result[key] for key in ('glsl', 'metadata')}, entry['stage'])
                if entry['stage'] == 'vertex':
                    require(all(item['interpolation'] == 'smooth' for item in projection(result['metadata']['outputs'])), 'standalone VS output is smooth')
            else:
                require(set(result) == {'ok', 'vertex', 'fragment', 'interfaceKey'}, 'exact pair result shape')
                stage_result(result['vertex'], 'vertex'); stage_result(result['fragment'], 'fragment')
                expected = entry['expected']
                require(set(expected) == {'interfaceKey', 'vertexOutputs', 'fragmentInputs'}, 'literal interface expectation fields')
                require(result['interfaceKey'] == expected['interfaceKey'], 'literal interface key')
                require(projection(result['vertex']['metadata']['outputs']) == expected['vertexOutputs'], 'literal effective VS interpolation')
                require(projection(result['fragment']['metadata']['inputs']) == expected['fragmentInputs'], 'literal FS interpolation')
        elif line.startswith('STATS '):
            require(stats is None, 'one native statistics record')
            stats = json.loads(line[6:])
    require(len(seen['ORIGINAL']) == 19 and len(seen['PAIR']) == len(cases), 'complete native results')
    require(stats and stats['originals'] == 19 and stats['acceptedOriginals'] == 12 and stats['pairs'] == len(cases), 'native final totals')
    for seed in SEEDS:
        require(f'SEED {seed} mutations=1024 pair_recoveries=4096 standalone_recoveries=2048 passed' in log, 'completed sanitizer seed')
    attacks = stats['pairs'] + stats['truncations'] + stats['hostileCases'] + stats['mutations']
    require(stats['pairRecoveries'] == attacks * 4 and stats['standaloneRecoveries'] == attacks * 2, 'exact recovery totals')
    require(stats['calls'] == 19 + 4 + 2 + attacks * 7, 'exact compiler call accounting')
    report = {'schema': 'wasm-vm-pairs-native-v1', 'status': 'passed', 'command': command,
              'originals': originals, 'cases': cases, 'stats': stats,
              'fixture': describe(FIXTURE), 'sources': [describe(ROOT / path) for path in SOURCE_PATHS],
              'streamSha256': sha(stream), 'binarySha256': sha(args.binary.read_bytes()),
              'logSha256': sha(run.stdout), 'seeds': SEEDS, 'mutationsPerSeed': 1024,
              'sanitizers': ['address', 'undefined']}
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': 'passed', **stats, 'report': str(report_path)}))


if __name__ == '__main__':
    main()
