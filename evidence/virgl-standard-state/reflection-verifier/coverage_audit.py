"""Repair hunk coverage; retain prior exact-source adjudicated coverage intact."""
from pathlib import Path
import hashlib
import heapq
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[3]
V = Path(__file__).resolve().parent
U = ROOT / 'target/evidence/virgl-standard-state-reflection-verifier/unpacked-reflection-repair'
OLD = ROOT / 'target/evidence/virgl-standard-state-reflection-verifier/unpacked-verifier'
HEAD = 'adcbe81bcd091c3d411a8f96ac8746e1a17290fb'
BASE = '01c4dc73f08a752ab5593ae941acdc441d5f4123'
sha = lambda raw: hashlib.sha256(raw).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT)


def counts(length, coverage):
    ranges = sorted((row['startOffset'], row['endOffset'], row['count'])
                    for function in coverage['functions'] for row in function['ranges'])
    result, heap, index = [0] * length, [], 0
    for at in range(length):
        while index < len(ranges) and ranges[index][0] <= at:
            start, end, count = ranges[index]
            heapq.heappush(heap, (end - start, end, count, start))
            index += 1
        while heap and heap[0][1] <= at:
            heapq.heappop(heap)
        if heap:
            result[at] = heap[0][2]
    return result


promoted_path = 'renderer/virgl-command/tests/standard-state-boundaries.mjs'
paths = ['renderer/virgl-command/state.mjs', 'renderer/virgl-command/tests/standard-state-binding.mjs', promoted_path]
recordings = []
for directory in [U / 'hot', U / 'cold', V / 'promoted-final']:
    for file in directory.rglob('*coverage.json'):
        fault = any(part.startswith('fault-') for part in file.parts)
        data = json.loads(file.read_bytes())
        for row in data.get('scripts', [data] if 'source' in data else []):
            if row.get('source') in paths:
                if fault and row['source'] == 'renderer/virgl-command/state.mjs':
                    continue
                need = sha((ROOT / row['source']).read_bytes()) if row['source'] == promoted_path else sha(git('show', HEAD + ':' + row['source']))
                assert row['sha256'] == need, 'immutable worker/runtime coverage source'
                recordings.append((str(file.relative_to(ROOT)), row))
result = {'schema': 1, 'head': HEAD, 'base': BASE, 'files': {}, 'status': 'raw-counts-before-waivers'}
for path in paths:
    raw = (ROOT / path).read_bytes() if path == promoted_path else git('show', HEAD + ':' + path)
    text = raw.decode()
    assert not any(ord(char) > 65535 for char in text), 'V8 UTF16/source offset correspondence'
    merged, origins, sources = [0] * len(text), [''] * len(text), []
    for name, row in recordings:
        if row['source'] != path:
            continue
        sources.append(name)
        coverage = counts(len(text), row['coverage'])
        for at, count in enumerate(coverage):
            if count > merged[at]:
                merged[at], origins[at] = count, name
    added, hunks = [], []
    patch = git('diff', '--unified=0', HEAD, '--', path) if path == promoted_path else git('diff', '--unified=0', BASE, HEAD, '--', path)
    for line in patch.decode().splitlines():
        match = re.match(r'@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@', line)
        if match:
            number = int(match[1])
            hunks.append({'start': number, 'count': int(match[2] or 1)})
        elif line.startswith('+++'):
            continue
        elif line.startswith('+'):
            added.append(number)
            number += 1
        elif line.startswith(' '):
            number += 1
    offset, lines = 0, {}
    for number, line in enumerate(text.splitlines(keepends=True), 1):
        lines[number] = (line, offset)
        offset += len(line)
    rows = []
    for number in added:
        line, offset = lines[number]
        positions = [offset + at for at, char in enumerate(line) if not char.isspace()]
        syntax = not positions or line.strip().startswith('//') or not re.search(r'[\w"\']', line)
        zero = []
        for at in positions:
            if merged[at] == 0:
                if zero and zero[-1][1] == at:
                    zero[-1][1] = at + 1
                else:
                    zero.append([at, at + 1])
        row = {'line': number, 'text': line.strip(),
               'classification': 'structural/comment' if syntax else 'executed' if not zero else 'partial-or-unhit',
               'minimumCount': min([merged[at] for at in positions], default=0),
               'maximumCount': max([merged[at] for at in positions], default=0),
               'citations': sorted({origins[at] for at in positions if origins[at]}),
               'unhitRanges': [{'start': start, 'end': end, 'text': text[start:end]} for start, end in zero]}
        rows.append(row)
    result['files'][path] = {'sha256': sha(raw), 'recordings': sources, 'hunks': hunks, 'addedLines': rows}
    print(path, 'added', len(rows), 'executed', sum(row['classification'] == 'executed' for row in rows),
          'structural', sum(row['classification'] == 'structural/comment' for row in rows))
    for row in rows:
        if row['classification'] == 'partial-or-unhit':
            print(row['line'], row['minimumCount'], row['maximumCount'], row['text'], 'UNHIT:', [span['text'] for span in row['unhitRanges']])
old_raw = (OLD / 'coverage-audit.json').read_bytes()
old = json.loads(old_raw)
assert old['status'] == 'coverage-accounted'
result['carryForward'] = {'record': 'evidence/virgl-standard-state/verifier/recording.tar.gz:coverage-audit.json',
                          'sha256': sha(old_raw), 'sourceHead': old['head'], 'summary': old['summary'],
                          'waivers': old['waivers'], 'stateLineMapping': 'original <=596 unchanged; original >=597 maps to +14'}
(V / 'coverage-audit-raw.json').write_text(json.dumps(result, indent=2) + '\n')
