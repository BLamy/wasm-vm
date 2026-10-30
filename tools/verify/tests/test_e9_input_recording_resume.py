#!/usr/bin/env python3
"""Attack actual proof-reuse preflight with forged metadata and corrupted artifact bytes."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--recorded', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
original = json.loads((a.recorded / 'report.json').read_bytes())
env = dict(os.environ, GIT_OPTIONAL_LOCKS='0')
results = []
with tempfile.TemporaryDirectory(prefix='e9-input-reuse-attacks-', dir=ROOT / 'target') as scratch:
    for name, prediction in [('source', 'recorded source identity mismatch'),
                             ('omitted-source', 'recorded source inventory mismatch'),
                             ('traversal', 'unsafe artifact path'),
                             ('bytes', 'recording digest mismatch')]:
        base = Path(scratch) / name
        base.mkdir()
        value = copy.deepcopy(original)
        if name == 'source':
            value['source_sha256']['web/loader.js'] = '0' * 64
        elif name == 'omitted-source':
            del value['source_sha256']['web/loader.js']
        elif name == 'traversal':
            value['files'].insert(0, {'path': '../escape', 'bytes': 1, 'sha256': '0' * 64})
        else:
            entry = value['files'][0]
            path = base / entry['path']
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'corrupted recorded material')
            entry['bytes'] = path.stat().st_size
            assert hashlib.sha256(path.read_bytes()).hexdigest() != entry['sha256']
        (base / 'report.json').write_text(json.dumps(value))
        output = Path(scratch) / (name + '-result')
        command = ['python3', '-B', 'tools/verify/e9-input-recording-resume.py',
                   '--recorded', str(base), '--output', str(output)]
        run = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True, timeout=30)
        assert run.returncode != 0 and prediction in run.stderr, (name, run.stdout, run.stderr)
        assert not output.exists(), 'rejected evidence created a submission'
        results.append({'attack': name, 'prediction': prediction, 'status': 'rejected-before-output',
                        'exit_code': run.returncode})
report = {'status': 'passed', 'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, env=env, text=True).strip(),
          'recording_report_sha256': hashlib.sha256((a.recorded / 'report.json').read_bytes()).hexdigest(),
          'cases': results}
a.output.parent.mkdir(parents=True, exist_ok=True)
a.output.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': 'passed', 'rejected_attacks': len(results)}))
