#!/usr/bin/env python3
"""Rehash the final worker seal and bind it to the committed recording source."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone

REPO = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
BASE = REPO / 'evidence/omarchy-profile'
GATES = BASE / 'residency-after-fp-gates'
PAIR = BASE / 'residency-after-fp-r1'
ENV = {**os.environ, 'DEVELOPER_DIR': '/Library/Developer/CommandLineTools'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=REPO, env=ENV)


expected = sys.argv[1]
assert re.fullmatch('[0-9a-f]{64}', expected)
index = GATES / 'sha256.txt'
assert digest(index.read_bytes()) == expected, 'index differs from worker claim'
rows = []
for line in index.read_text().splitlines():
    sha, name = line.split('  ', 1)
    path = BASE / name
    assert '..' not in Path(name).parts and not Path(name).is_absolute()
    assert Path(name).parts[0] in ['residency-after-fp-gates', 'residency-after-fp-r1']
    data = path.read_bytes()
    assert digest(data) == sha, name
    rows.append({'path': name, 'sha256': sha, 'bytes': len(data)})
assert len({row['path'] for row in rows}) == len(rows), 'duplicate index row'
actual = {str(p.relative_to(BASE)) for folder in [GATES, PAIR]
          for p in folder.rglob('*') if p.is_file() and p != index}
assert {row['path'] for row in rows} == actual, 'unsealed worker files'

read = lambda p: json.loads(p.read_text())
frozen, commands, pair, submission = map(read, [GATES/'frozen.json', GATES/'commands.json',
                                             PAIR/'ab.json', GATES/'submission.json'])
recording_head = frozen['head']
assert recording_head == pair['head'] == commands['head'] == submission['recordingHead']
for row in frozen['files']:
    data = (REPO / row['path']).read_bytes()
    assert digest(data) == row['sha256'], row['path']
    assert data == git('show', f"{recording_head}:{row['path']}"), row['path']
assert commands['allPassed'] and all(row['code'] == 0 for row in commands['commands'])
test_log = (GATES/'recorder.log').read_text()
assert 'tests 62' in test_log and 'pass 62' in test_log
for value in ['fail 0', 'skipped 0', 'cancelled 0']:
    assert value in test_log, value
assert pair['finishedAt'] and [row['arm'] for row in pair['arms']] == ['control', 'candidate']
assert pair['experiment'] == 'residency'
assert submission['responsive'] == {'control': False, 'candidate': False}
independent = read(OUT/'pair-inspection.json')
assert independent['head'] == recording_head
for arm in independent['arms']:
    assert arm['reportSha256'] == digest((PAIR/arm['arm']/'report.json').read_bytes())
    assert arm['desktopAccepted'] is False and arm['nonceVerified'] is False
attack = read(OUT/'worker-audit-attack.json')
assert attack['auditSourceSha256'] == digest((GATES/'audit.mjs').read_bytes())
assert attack['guardSourceSha256'] == digest((REPO/'tools/verify/omarchy-input-trial.mjs').read_bytes())
assert attack['rejected'] and attack['originalReportUnchanged']

result = {'checkedAt': datetime.now(timezone.utc).isoformat(),
          'checkedHead': git('rev-parse', 'HEAD').decode().strip(),
          'recordingHead': recording_head, 'workerIndexSha256': expected,
          'workerFiles': len(rows), 'allRehashed': True,
          'committedRecordingSourcesMatch': True, 'narrowTests': 62,
          'broadGateRerun': False, 'desktopAccepted': {'control': False, 'candidate': False},
          'files': rows}
(OUT/'seal-inspection.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k != 'files'}, indent=2))
