#!/usr/bin/env python3
"""Bind complete V8 regions and added-line samples to the new packet boundary."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
BASE = '71853cd302a2a39cd8f5af001fd8ad1b791b7da6'
directory = Path(sys.argv[1]).resolve()
git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()
added, name, line = {}, None, 0
for row in git('diff', '--unified=0', BASE, 'HEAD', '--', 'renderer/virgl-command').splitlines():
    if row.startswith('+++ b/'):
        name = row[6:]
    elif row.startswith('@@'):
        line = int(re.search(r'\+(\d+)', row)[1])
    elif row.startswith('+') and name:
        added.setdefault(name, []).append(line)
        line += 1
    elif row.startswith(' '):
        line += 1
scripts = []
for file in directory.rglob('browser-coverage.json'):
    if '/fault-' in str(file):
        continue
    for row in json.loads(file.read_text()).get('scripts', []):
        if row['source'] in added:
            scripts.append(dict(record=file.relative_to(directory).as_posix(), **row))
for file in (directory/'node-coverage').glob('coverage-*.json'):
    for row in json.loads(file.read_text())['result']:
        if row['url'].startswith(ROOT.as_uri()+'/'):
            name = row['url'][len(ROOT.as_uri())+1:]
            if name in added:
                scripts.append(dict(record=file.relative_to(directory).as_posix(), source=name,
                                    sha256=hashlib.sha256((ROOT/name).read_bytes()).hexdigest(), coverage=row))
samples = []
for name, lines in added.items():
    text = (ROOT/name).read_text().splitlines(keepends=True)
    for line in lines:
        offset = len(''.join(text[:line-1]).encode('utf-16-le'))//2
        offset += len(text[line-1])-len(text[line-1].lstrip())
        observed = []
        for script in scripts:
            if script['source'] != name:
                continue
            regions = [r for fn in script['coverage']['functions'] for r in fn['ranges']
                       if r['startOffset'] <= offset < r['endOffset']]
            if regions:
                observed.append(dict(record=script['record'], sha256=script['sha256'],
                                     **min(regions, key=lambda r: r['endOffset']-r['startOffset'])))
        samples.append(dict(source=name, line=line, counters=observed,
                            maxCount=max((r['count'] for r in observed), default=0)))
(directory/'coverage-audit.json').write_text(json.dumps(dict(
    schema='original-texture-operations-coverage-v1', gitHead=git('rev-parse', 'HEAD'), predecessor=BASE,
    fullRegionsRemainAuthority=True, lineSamplesOnly=True, addedLines=added,
    scripts=scripts, javascriptSamples=samples), indent=2)+'\n')
print(f'Bound {len(scripts)} complete V8 script records to {len(samples)} added-line samples')
