#!/usr/bin/env python3
"""Retain only the decoder's V8 counters; omit Node/Playwright internals."""
import hashlib
import json
from pathlib import Path
import sys

raw, output = map(Path, sys.argv[1:])
root = Path(__file__).resolve().parents[2]
source = root / 'renderer/virgl-command/decoder.mjs'
data = source.read_bytes()
results = []
for path in sorted(raw.glob('coverage-*.json')):
    for script in json.loads(path.read_text())['result']:
        if script['url'] == source.as_uri():
            results.append(script)
if len(results) != 1:
    raise ValueError(f'expected one decoder script coverage result, found {len(results)}')
report = {'schema': 1, 'source': str(source.relative_to(root)),
          'sha256': hashlib.sha256(data).hexdigest(), 'coverage': results[0]}
output.write_text(json.dumps(report, indent=2) + '\n')
print(f'Recorded V8 counters for {len(results[0]["functions"])} decoder functions')
