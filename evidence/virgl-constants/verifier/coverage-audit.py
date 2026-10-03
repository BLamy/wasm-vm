#!/usr/bin/env python3
"""Independently map frozen added runtime lines to V8 precise coverage offsets."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
BASE = '5af5600c33c69e926c96a3dc82369c31da391565'
HEAD = '81cd3a4c403176be4b0191fa00ed37f4fd1e1e35'
sha = lambda b: hashlib.sha256(b).hexdigest()
worker_path = ROOT / 'evidence/virgl-constants/worker/hardware/browser-coverage.json'
critic_path = HERE / 'normal/coverage.json'
state_path = ROOT / 'evidence/virgl-constants/worker/regression/regression/state/browser-coverage.json'
worker = json.loads(worker_path.read_text())
critic = json.loads(critic_path.read_text())
state = json.loads(state_path.read_text())
report = {'schema': 1, 'base': BASE, 'frozenHead': HEAD, 'coverage': [
    {'path': str(p.relative_to(ROOT)), 'sha256': sha(p.read_bytes())}
    for p in [worker_path, critic_path, state_path]], 'files': []}

for filename in ['renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/state.mjs']:
    source = subprocess.check_output(['git', 'show', f'{HEAD}:{filename}'], cwd=ROOT).decode()
    assert (ROOT / filename).read_text() == source
    diff = subprocess.check_output(['git', 'diff', '--unified=0', BASE, HEAD, '--', filename], cwd=ROOT).decode()
    added = []
    at = None
    for line in diff.splitlines():
        if line.startswith('@@'):
            at = int(re.search(r'\+(\d+)', line).group(1))
        elif line.startswith('+') and not line.startswith('+++'):
            added.append(at); at += 1
        elif at is not None and line and not line.startswith(('-', '+', '\\', 'diff', 'index')):
            at += 1
    wr = next(x for x in worker['scripts'] if x['source'] == filename)
    assert wr['sha256'] == sha(source.encode()) == wr['originalSha256']
    cr = [x for x in critic['result'] if x['url'].endswith('/' + filename)]
    assert len(cr) == 1
    sources = [('worker', wr['coverage']), ('critic', cr[0])]
    for entry in state['scripts']:
        if entry['source'] == filename:
            assert entry['sha256'] == sha(source.encode())
            sources.append(('state-regression', entry['coverage']))
    offsets = [0]
    for line in source.splitlines(keepends=True): offsets.append(offsets[-1] + len(line))
    result = {'path': filename, 'sha256': sha(source.encode()), 'lines': [], 'zeroBranches': []}
    for number in added:
        line = source.splitlines()[number - 1]
        point = offsets[number - 1] + len(line) - len(line.lstrip())
        if not line.strip() or line.lstrip().startswith('//') or line.strip() == '}':
            result['lines'].append({'line': number, 'text': line, 'classification': 'waived', 'reason': 'Comment or structural delimiter, no executable behavior.'})
            continue
        hits = []
        for name, coverage in sources:
            ranges = [(r['endOffset'] - r['startOffset'], r['count'], f['functionName'], r)
                      for f in coverage['functions'] for r in f['ranges']
                      if r['startOffset'] <= point < r['endOffset']]
            ranges.sort(key=lambda row: row[0])
            assert ranges, (filename, number)
            hits.append({'run': name, 'count': ranges[0][1], 'function': ranges[0][2], 'range': ranges[0][3]})
        assert any(hit['count'] > 0 for hit in hits), (filename, number, hits)
        result['lines'].append({'line': number, 'text': line, 'classification': 'executed', 'hits': hits})
    # Retain each zero-count worker branch intersecting changed lines for manual
    # classification; line-level evidence alone does not waive hidden branches.
    for name, coverage in sources:
        for function in coverage['functions']:
            for r in function['ranges']:
                if r['count'] == 0 and any(offsets[n - 1] <= r['startOffset'] < offsets[n] for n in added):
                    corroboration = []
                    for other_name, other in sources:
                        ranges = sorted((x['endOffset'] - x['startOffset'], x['count'])
                                        for f in other['functions'] for x in f['ranges']
                                        if x['startOffset'] <= r['startOffset'] < x['endOffset'])
                        if ranges:
                            corroboration.append({'run': other_name, 'count': ranges[0][1]})
                    assert any(x['count'] > 0 for x in corroboration), (filename, r)
                    result['zeroBranches'].append({'run': name, 'function': function['functionName'], 'range': r,
                                                  'source': source[r['startOffset']:r['endOffset']],
                                                  'heldByOtherCapture': corroboration})
    report['files'].append(result)
report['status'] = 'passed'
report['executableAddedLines'] = sum(x['classification'] == 'executed' for f in report['files'] for x in f['lines'])
(HERE / 'coverage-audit.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': report['status'], 'executableAddedLines': report['executableAddedLines'], 'zeroBranches': sum(len(f['zeroBranches']) for f in report['files'])}))
