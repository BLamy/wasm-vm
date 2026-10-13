"""Record the narrow checks required to finalize this verifier-only change."""
import ast
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent
REPO = OUT.parents[2]
for path in OUT.glob('*.py'):
    ast.parse(path.read_text(), filename=str(path))
commands = [
    ['node', '--check', 'tools/virgl-stream-output-shaders/alias-browser.mjs'],
    ['node', '--check', str((OUT / 'component-wasm.mjs').relative_to(REPO))],
    ['python3', 'tools/check_task_policy.py'],
    ['python3', 'tools/build_queue.py'],
    ['git', 'diff', '--check'],
    ['git', 'diff', '--exit-code', '0c167360a8d01a1e51b7be1309d6caf70fbff611', '--',
     'renderer', 'crates', 'web', 'guest', 'Cargo.lock', 'Cargo.toml'],
]
rows = []
for command in commands:
    result = subprocess.run(command, cwd=REPO, capture_output=True)
    row = dict(command=command, cwd=str(REPO), exitCode=result.returncode,
               stdout=result.stdout.decode(), stderr=result.stderr.decode(),
               stdoutSha256=hashlib.sha256(result.stdout).hexdigest(),
               stderrSha256=hashlib.sha256(result.stderr).hexdigest())
    rows.append(row)
    if result.returncode:
        raise AssertionError(row)
report = dict(schema='stream-output-shaders-critic-final-checks-v1', status='passed',
              commands=rows, pythonSyntaxFiles=len(list(OUT.glob('*.py'))),
              sourceMutation=False, finishedAt=datetime.now(timezone.utc).isoformat())
(OUT / 'final-checks.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(dict(status='passed', commands=len(rows), sourceMutation=False)))
