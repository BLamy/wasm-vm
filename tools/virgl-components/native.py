#!/usr/bin/env python3
"""Bind the component sanitizer run to unchanged originals and shared boundaries."""
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
FIXTURE = ROOT / 'renderer/virgl-shader/tests/component-cases.json'
ORIGINALS = (
    ('kmscube', '003270109615e05345631cf8a2273ebc1bf3d86c7590e05ddc8424c441db7605', 'fragment'),
    ('glmark2-es2', '9819066def2df1cd09f36f142fd2bc6b659395aa21bea6db7f58fbcc122c7c83', 'fragment'),
    ('glmark2-es2', '403b0529c632d3d2ffe4584ede810f5745e8b76ca2ab4f575e1073d8f29fcf0c', 'vertex'),
    ('glmark2-es2', 'e9bc6d3b61e3cda2c215ac8b44a432e2eb1bd4891cfa921c6f914fd3fd86b551', 'vertex'),
)
SEEDS = ['36a9127d', 'c481e35b', '79b40a61', 'a28d65cf']


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report_path = args.output / 'native-report.json'
    report_path.unlink(missing_ok=True)
    paths, inputs = [], []
    for workload, digest, stage in ORIGINALS:
        path = ROOT / f'evidence/virgl-corpus/captures/{workload}/shaders/{digest}.tgsi'
        raw = path.read_bytes()
        require(sha(raw) == digest, f'original hash differs: {path}')
        require(raw.startswith(b'VERT\n' if stage == 'vertex' else b'FRAG\n'), 'original stage')
        paths.append(path)
        inputs.append({'path': str(path.relative_to(ROOT)), 'sha256': digest, 'bytes': len(raw), 'stage': stage})
    raw = FIXTURE.read_bytes()
    cases = json.loads(raw)
    require(isinstance(cases, list) and 0 < len(cases) <= 256, 'bounded shared cases')
    stream = bytearray(b'VGC2' + struct.pack('<I', len(cases)))
    names = set()
    boundaries = []
    for case in cases:
        require(set(case) == {'name', 'stage', 'text', 'ok'}, 'shared case fields')
        require(isinstance(case['ok'], bool) and case['stage'] in ('vertex', 'fragment'), 'case expectation/stage')
        name, text = case['name'].encode('ascii'), case['text'].encode('ascii')
        require(case['name'] not in names, 'unique shared case name')
        names.add(case['name'])
        require(0 < len(name) < 160 and 0 < len(text) <= 16384, 'bounded case strings')
        require(all(32 <= c <= 126 or c in (9, 10, 13) for c in text), 'cases reach grammar guard')
        stream += struct.pack('<IIII', int(case['stage'] == 'fragment'), int(case['ok']), len(name), len(text)) + name + text
        boundaries.append({'name': case['name'], 'stage': case['stage'], 'inputSha256': sha(text), 'ok': case['ok']})
    command = [str(args.binary.resolve()), *map(str, paths)]
    env = dict(os.environ, UBSAN_OPTIONS='halt_on_error=1', ASAN_OPTIONS='abort_on_error=1')
    completed = subprocess.run(command, input=stream, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, timeout=180)
    log = completed.stdout.decode('utf-8', errors='replace')
    (args.output / 'native.log').write_bytes(completed.stdout)
    print(log, end='', flush=True)
    require(completed.returncode == 0, f'component sanitizer failed: {completed.returncode}')
    originals_seen, boundaries_seen = set(), set()
    for line in log.splitlines():
        match = re.fullmatch(r'(ORIGINAL|BOUNDARY) ([0-9]+) (.+)', line)
        if not match:
            continue
        kind, index, result = match[1], int(match[2]), json.loads(match[3])
        entries, seen = (inputs, originals_seen) if kind == 'ORIGINAL' else (boundaries, boundaries_seen)
        require(index < len(entries) and index not in seen, 'unique bounded native output index')
        seen.add(index)
        require(result.get('ok') is (True if kind == 'ORIGINAL' else entries[index]['ok']), 'native acceptance matches literal expectation')
        entries[index]['result'] = result
        if result['ok']:
            require(result['metadata']['profile'] == 'virgl-webgl2-straight-line-v4', 'native profile version')
            require('#version 300 es' in result['glsl'], 'native ESSL300 source')
            if kind == 'ORIGINAL':
                entries[index]['glslSha256'] = sha(result['glsl'].encode())
        else:
            require(result['error']['code'] in ('parse-error', 'unsupported-feature'), 'negative fails guard')
    require(len(originals_seen) == 4 and len(boundaries_seen) == len(cases), 'complete native results')
    for seed in SEEDS:
        require(f'SEED {seed} mutations=1024 recoveries=4096 passed' in log, 'mutation seed completion')
    require(f'PASS originals=4 boundaries={len(cases)} ' in log, 'native final summary')
    report = {'schema': 'wasm-vm-components-native-v1', 'status': 'passed', 'command': command,
              'inputs': inputs, 'cases': boundaries,
              'fixture': {'path': str(FIXTURE.relative_to(ROOT)), 'bytes': len(raw), 'sha256': sha(raw)},
              'streamSha256': sha(stream), 'binarySha256': sha(args.binary.read_bytes()),
              'logSha256': sha(completed.stdout), 'seeds': SEEDS, 'mutationsPerSeed': 1024,
              'sanitizers': ['address', 'undefined']}
    report_path.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
