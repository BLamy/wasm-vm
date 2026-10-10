#!/usr/bin/env python3
"""Bind LLVM/V8 counters and added-line samples; full regions remain critic authority."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
PREDECESSOR = 'ac2b1ed7a77e82afb21321d6dfdabe0b2da12d4c'
directory = Path(sys.argv[1]).resolve()
sha = lambda raw: hashlib.sha256(raw).hexdigest()
diff = subprocess.check_output(['git', 'diff', '--unified=0', PREDECESSOR, 'HEAD', '--',
                                'renderer/virgl-shader', 'renderer/virgl-command'], cwd=ROOT, text=True)
added = {}
name, line = None, 0
for row in diff.splitlines():
    if row.startswith('+++ b/'):
        name = row[6:]
    elif row.startswith('@@'):
        line = int(re.search(r'\+(\d+)', row)[1])
    elif row.startswith('+') and name:
        added.setdefault(name, []).append(line)
        line += 1
    elif row.startswith(' ') and name:
        line += 1

scripts = []
for file in directory.rglob('browser-coverage.json'):
    for row in json.loads(file.read_text())['scripts']:
        if row['source'] in added:
            scripts.append((file.relative_to(directory).as_posix(), row['source'], row['sha256'], row['coverage']))
node_scripts = []
for file in (directory / 'node-coverage').glob('coverage-*.json'):
    for row in json.loads(file.read_text())['result']:
        if row['url'].startswith(ROOT.as_uri() + '/'):
            name = row['url'][len(ROOT.as_uri()) + 1:]
            if name in added:
                node_scripts.append(dict(source=name, sha256=sha((ROOT/name).read_bytes()), coverage=row))
                scripts.append(('node-coverage-runtime.json', name, sha((ROOT/name).read_bytes()), row))
(directory / 'node-coverage-runtime.json').write_text(json.dumps(dict(schema=1, scripts=node_scripts), indent=2) + '\n')
samples = []
for name, lines in sorted(added.items()):
    if not name.endswith('.mjs'):
        continue
    text = (ROOT/name).read_text()
    source_lines = text.splitlines(keepends=True)
    for line in lines:
        offset = len(''.join(source_lines[:line-1]).encode('utf-16-le')) // 2
        offset += len(source_lines[line-1]) - len(source_lines[line-1].lstrip())
        observed = []
        for file, source, digest, script in scripts:
            if source != name:
                continue
            ranges = [r for fn in script['functions'] for r in fn['ranges']
                      if r['startOffset'] <= offset < r['endOffset']]
            if ranges:
                narrow = min(ranges, key=lambda r: r['endOffset'] - r['startOffset'])
                observed.append(dict(record=file, servedSha256=digest, **narrow))
        samples.append(dict(source=name, line=line, counters=observed,
                            maxCount=max((r['count'] for r in observed), default=0)))

native = []
for file in sorted((directory/'coverage').glob('*.json')):
    data = json.loads(file.read_text())
    for row in data['data'][0]['files']:
        source = Path(row['filename']).resolve()
        if source.is_relative_to(ROOT) and source.relative_to(ROOT).as_posix() in added:
            name = source.relative_to(ROOT).as_posix()
            native.append(dict(record=file.relative_to(directory).as_posix(), source=name,
                               sha256=sha(source.read_bytes()), summary=row['summary'], segments=row['segments']))
report = dict(schema='standard-texture-coverage-v1', status='recorded', predecessor=PREDECESSOR,
              gitHead=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              addedLines=added, javascriptSamples=samples, llvm=native,
              lineSamplesOnly=True, fullRegionsRemainAuthority=True)
(directory/'coverage-audit.json').write_text(json.dumps(report, indent=2) + '\n')
print(f'Bound {len(scripts)} V8 scripts and {len(native)} LLVM file records to the added diff')
