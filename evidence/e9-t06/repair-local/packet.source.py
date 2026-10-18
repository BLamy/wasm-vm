"""Seal the CSS/admission/cleanup repair without modifying any original recording."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

p = argparse.ArgumentParser()
p.add_argument('source', type=Path)
p.add_argument('destination', type=Path)
p.add_argument('--deployment')
a = p.parse_args()
root = Path.cwd()
source, dest = a.source.resolve(), a.destination
assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all'])
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
r = json.loads((source / 'report.json').read_text())
assert r['status'] == 'passed' and r['errors'] == [] and r['head'] == head
assert r['activeBefore']['sha256'] == r['activeAfter']['sha256']
assert r['layout']['scroll'] <= r['layout']['client'] + 1
assert r['ownerLoss']['reacquired'] == r['prefixBeforeOwnerLoss']['id']
assert r['ownerLoss']['manifestSha256'] == r['prefixBeforeOwnerLoss']['manifestSha256']

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()

for entry in r['files']:
    path = source / entry['path']
    assert path.stat().st_size == entry['bytes'] and sha(path) == entry['sha256'], entry['path']
dest.mkdir(parents=True, exist_ok=False)
copies, aliases, seen = [], [], {}

def copy(path, name, compressed=False):
    target = dest / name
    if compressed:
        with path.open('rb') as f, target.open('wb') as out:
            with gzip.GzipFile(fileobj=out, mode='wb', mtime=0) as z:
                shutil.copyfileobj(f, z)
    else:
        shutil.copyfile(path, target)
    copies.append({'source': str(path), 'path': name, 'source_bytes': path.stat().st_size,
                   'source_sha256': sha(path), 'bytes': target.stat().st_size,
                   'sha256': sha(target), 'encoding': 'gzip' if compressed else 'identity'})

for path in sorted(source.iterdir()):
    if path.is_file() and path.suffix in ('.json', '.png') and path.name != 'javascript-coverage.json':
        copy(path, path.name)
copy(source / 'javascript-coverage.json', 'javascript-coverage.json.gz', True)
for path in sorted(source.glob('*.checkpoint.gz')):
    digest = sha(path)
    if digest in seen:
        aliases.append({'source': str(path), 'packet': seen[digest], 'source_sha256': digest})
    else:
        copy(path, path.name)
        seen[digest] = path.name
copy(Path(__file__), 'packet.source.py')
if a.deployment:
    copy(Path('/tmp/e9-t06-css-deploy.log'), 'deploy.log')
receipt = {'task': 'E9-T06', 'status': 'passed', 'head': head, 'original': str(source),
           'report_sha256': sha(source / 'report.json'), 'deployment': a.deployment,
           'source_sha256': r['source_sha256'], 'driver': r['driver'],
           'originals': r['files'], 'packet': copies, 'aliases': aliases}
(dest / 'provenance.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({'report_sha256': receipt['report_sha256'], 'copies': len(copies),
                  'aliases': len(aliases), 'originals': len(r['files'])}))
