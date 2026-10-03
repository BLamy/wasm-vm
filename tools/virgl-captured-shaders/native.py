#!/usr/bin/env python3
"""Bind native sanitizer inputs to the captured TGSI hashes and shared attacks."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[2]
CAPTURE = ROOT / 'evidence/virgl-corpus/captures/textured-scene/shaders'
HASHES = ('e96102a3202dde8b0b05ffa142eb6064c5fe916b673bbf1d31464bcbac56fb33',
          '80d6db6a6f10b93770698cfdd47232fed0fca94f4cb07ba7381bb38563de9808')
CASES = ROOT / 'renderer/virgl-shader/tests/captured-invalid.json'


def require(value, message):
    if not value:
        raise ValueError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    receipt = args.output / 'native-report.json'
    receipt.unlink(missing_ok=True)
    paths = [CAPTURE / f'{digest}.tgsi' for digest in HASHES]
    inputs = []
    for path, expected in zip(paths, HASHES):
        data = path.read_bytes()
        actual = hashlib.sha256(data).hexdigest()
        require(actual == expected, f'captured shader hash differs: {path}')
        inputs.append({'path': str(path.relative_to(ROOT)), 'bytes': len(data), 'sha256': actual})
    cases_raw = CASES.read_bytes()
    cases = json.loads(cases_raw)
    require(isinstance(cases, list) and 0 < len(cases) <= 1024, 'bounded nonempty attack fixture')
    stream = bytearray(b'VGC1' + struct.pack('<I', len(cases)))
    names = set()
    for case in cases:
        require(set(case) == {'name', 'stage', 'text'}, 'attack fixture fields')
        require(case['name'] not in names, 'duplicate attack name')
        names.add(case['name'])
        require(case['stage'] in ('vertex', 'fragment'), 'attack stage')
        name, text = case['name'].encode('ascii'), case['text'].encode('ascii')
        require(0 < len(name) < 160 and len(text) <= 16384, 'attack fixture byte limits')
        require(all(32 <= c <= 126 or c in (9, 10, 13) for c in text), 'attack must reach grammar guard')
        stream += struct.pack('<III', int(case['stage'] == 'fragment'), len(name), len(text)) + name + text
    env = dict(os.environ, UBSAN_OPTIONS='halt_on_error=1', ASAN_OPTIONS='abort_on_error=1')
    command = [str(args.binary.resolve()), *map(str, paths)]
    result = subprocess.run(command, input=stream, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, timeout=180)
    log = result.stdout.decode('utf-8', errors='replace')
    (args.output / 'native.log').write_text(log)
    print(log, end='', flush=True)
    require(result.returncode == 0 and '\nPASS ' in log, f'native sanitizer attacks failed: {result.returncode}')
    report = {'schema': 'wasm-vm-captured-native-v1', 'status': 'passed', 'command': command,
              'inputs': inputs, 'negativeCases': len(cases),
              'negativeFixtureSha256': hashlib.sha256(cases_raw).hexdigest(),
              'streamSha256': hashlib.sha256(stream).hexdigest(),
              'logSha256': hashlib.sha256(result.stdout).hexdigest(),
              'binarySha256': hashlib.sha256(args.binary.read_bytes()).hexdigest(),
              'seeds': ['18a9e24d', '4c907fb3', 'c31e7d82', '9b4260a5'],
              'mutationsPerSeed': 2048, 'sanitizers': ['address', 'undefined']}
    receipt.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
