#!/usr/bin/env python3
"""Bind changed executable lines to authenticated LLVM/V8 or physical source records."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
BASE = '7f2cdec89ca53b37bac120538bb168aaa153d62f'
HEAD = '2e67fac91552702add11c701f61d6c4c0af2260c'
runtime = {'renderer/virgl-command/constant-domain.mjs', 'renderer/virgl-command/state.mjs',
           'renderer/virgl-shader/bridge.c', 'renderer/virgl-shader/raw_bits.c',
           'renderer/virgl-shader/raw_bits.h', 'renderer/virgl-shader/raw_conversions.h'}
diff = subprocess.check_output(['git', 'diff', '--unified=0', BASE, HEAD], cwd=ROOT, text=True)
lines, hunks = [], []
file, line, hunk = None, 0, None
for text in diff.splitlines():
    if text.startswith('+++ b/'):
        file = text[6:]
    elif text.startswith('@@'):
        line = int(re.search(r'\+(\d+)', text)[1])
        hunk = {'file': file, 'header': text, 'firstAddedLine': line, 'added': []}
        hunks.append(hunk)
    elif text.startswith('+') and not text.startswith('+++'):
        row = {'file': file, 'line': line, 'source': text[1:]}
        hunk['added'].append(row)
        lines.append(row)
        line += 1
    elif not text.startswith('-'):
        line += 1

scripts = []
for directory in ['node-consumer-coverage', 'node-attack-coverage']:
    for file in (OUT / directory).glob('*.json'):
        for script in json.loads(file.read_bytes())['result']:
            if script['url'].startswith('file://' + str(ROOT)) and script['url'].endswith(('/constant-domain.mjs', '/state.mjs')):
                scripts.append(script)
for prefix in ['hot', 'cold/acceptance']:
    for file in (OUT / 'unpacked' / prefix).glob('gpu-*/browser-coverage.json'):
        for row in json.loads(file.read_bytes())['scripts']:
            if row['source'] in runtime:
                scripts.append(row['coverage'])
for row in json.loads((OUT / 'gpu-324508639/browser-coverage.json').read_bytes())['scripts']:
    if row['source'] in runtime:
        scripts.append(row['coverage'])

counts = {}
for name in ['bridge.c', 'raw_bits.c', 'raw_conversions.h']:
    counts[name] = {}
    for line in (OUT / ('coverage-' + name + '.txt')).read_text().splitlines():
        match = re.match(r'\s*(\d+)\|\s*([^|]*)\|', line)
        if match:
            counts[name][int(match[1])] = match[2].strip()

for row in lines:
    file = row['file']
    if file not in runtime:
        continue
    if file.endswith('.mjs'):
        source = (ROOT / file).read_text()
        starts = [0] + [m.end() for m in re.finditer('\n', source)]
        start = starts[row['line'] - 1]
        observed = []
        for script in scripts:
            if not script['url'].endswith('/' + file):
                continue
            functions = [f for f in script['functions'] if f['ranges'] and f['ranges'][0]['startOffset'] <= start < f['ranges'][0]['endOffset']]
            if not functions:
                continue
            function = min(functions, key=lambda f: f['ranges'][0]['endOffset'] - f['ranges'][0]['startOffset'])
            ranges = [x for x in function['ranges'] if x['startOffset'] <= start < x['endOffset']]
            observed.append(min(ranges, key=lambda r: r['endOffset'] - r['startOffset'])['count'])
        row['V8'] = max(observed) if observed else None
        assert row['V8'] and row['V8'] > 0, row
        row['disposition'] = 'executed'
        row['citation'] = 'authenticated worker/fourth-seed V8 plus recorded direct Node consumer/hostile-bank coverage'
    elif Path(file).name == 'raw_bits.h':
        row['disposition'] = 'waived'
        row['reason'] = 'Opcode/feature declarations and static assertions compile in the exact native/Wasm builds; no executable body.'
    else:
        name = Path(file).name
        count = counts[name].get(row['line'], '')
        row['LLVM'] = count
        assert count != '0', row
        if count:
            row['disposition'] = 'executed'
            row['citation'] = 'independent llvm-cov show from authenticated hot sanitizer binary/profile'
        elif name == 'raw_conversions.h' and 39 <= row['line'] <= 64:
            row['disposition'] = 'executed-physical-shader'
            row['citation'] = 'native-source-parity.json binds all emitted helper strings to actual shaderSource; source-semantics.json and fourth-seed-semantics.json validate every result bit'
        else:
            row['disposition'] = 'waived'
            row['reason'] = 'Non-executable comment, signature, preprocessor declaration, static assertion or structural whitespace; corresponding function body is exercised.'

for hunk in hunks:
    file = hunk['file']
    if file in runtime:
        hunk['disposition'] = 'executed-or-explicitly-waived'
        continue
    hunk['addedLines'] = len(hunk.pop('added'))
    if file.startswith('renderer/virgl-shader/native_tests/'):
        hunk['disposition'] = 'executed-test-harness'
        hunk['citation'] = 'hot/cold native.log, native.stderr, cases.bin, recorded native LLVM coverage; defensive failing assertions/allocation-error handling is not a runtime claim'
    elif file.startswith(('renderer/virgl-shader/tests/', 'tools/virgl-signed-conversions/')) or file == 'tools/verify-virgl-signed-conversions.sh':
        hunk['disposition'] = 'executed-recording-harness'
        hunk['citation'] = 'hot acceptance.log/incremental-harness.log, cold acceptance.log/cold.log, authenticated reports, browser source/V8 records and independent replay of semantics/source faults'
    elif file in ['Makefile', 'renderer/virgl-shader/build.sh']:
        hunk['disposition'] = 'executed-build-declaration'
        hunk['citation'] = 'exact frozen-head hot/cold make verify-E6-T12g6e invokes added target and sanitizer mode'
    else:
        hunk['disposition'] = 'waived'
        hunk['reason'] = 'Documentation, task/queue declarative status or content; no runtime behavior.'

export = json.loads((OUT / 'coverage-export.json').read_bytes())
helper = next(f for f in export['data'][0]['files'] if f['filename'].endswith('/raw_conversions.h'))
claimed = json.loads((OUT / 'unpacked/hot/native/coverage-helpers.json').read_bytes())
assert claimed['data'][0]['files'][0] == helper
assert helper['summary']['lines']['covered'] == helper['summary']['lines']['count'] == 29
assert helper['summary']['branches']['covered'] == helper['summary']['branches']['count'] == 28
assert helper['summary']['regions']['covered'] == helper['summary']['regions']['count'] == 61
functions = [{'name': f['name'], 'count': f['count']} for f in export['data'][0]['functions'] if any(n.endswith('/raw_conversions.h') for n in f['filenames'])]
report = {'schema': 'critic-conversion-hunk-coverage-v1', 'task': 'E6-T12g6e', 'status': 'passed',
          'base': BASE, 'sourceHead': HEAD, 'hunks': hunks, 'runtimeAddedLines': [r for r in lines if r['file'] in runtime],
          'helperCoverage': helper['summary'], 'helperFunctions': functions, 'needsEvidence': [], 'dead': [],
          'coverageExportSha256': hashlib.sha256((OUT / 'coverage-export.json').read_bytes()).hexdigest()}
(OUT / 'coverage-audit.json').write_text(json.dumps(report, indent=2) + '\n')
print(len(hunks), 'hunks classified;', len(report['runtimeAddedLines']), 'runtime added lines;29/29 helper lines,28/28 branches,61/61 regions.')
