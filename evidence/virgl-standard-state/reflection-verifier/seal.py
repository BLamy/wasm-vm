"""Seal this fresh verifier's bounded repair observations and frozen harness."""
from pathlib import Path
import gzip
import hashlib
import io
import json
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[3]
V = Path(__file__).resolve().parent
HEAD = 'adcbe81bcd091c3d411a8f96ac8746e1a17290fb'
CLAIM = 'b1263f6e60d68239288309218b3e8cc4590363ad'
sha = lambda raw: hashlib.sha256(raw).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT)
promoted = ['Makefile', 'renderer/virgl-command/tests/standard-state-boundaries.mjs',
            'tools/verify-virgl-standard-state-adversarial.mjs',
            'tools/verify-virgl-standard-state-adversarial.sh',
            'tools/virgl-command/standard-state-adversarial-audit.py']
source_paths = [*promoted, *['renderer/virgl-command/' + name + '.mjs'
                           for name in ['state', 'resources', 'decoder', 'constant-domain', 'cache']],
                'renderer/virgl-command/tests/standard-state-binding.mjs',
                'renderer/virgl-command/standard-state-README.md',
                'renderer/virgl-shader/standard.mjs', 'renderer/virgl-shader/index.mjs',
                'renderer/virgl-shader/build/wasm/virgl-shader.mjs',
                'renderer/virgl-shader/build/wasm/virgl-shader.wasm',
                'tools/verify-virgl-standard-state.mjs', 'tools/verify-virgl-standard-state.sh',
                'tools/virgl-command/standard-state-pixels.mjs',
                'tools/virgl-command/standard-state-receipt.py']
for name in source_paths:
    raw = (ROOT / name).read_bytes()
    if name not in promoted and '/build/' not in name:
        assert git('show', HEAD + ':' + name) == raw, 'no verifier runtime/worker proof edit'
    file = V / 'sources' / name
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(raw)
patch = git('diff', CLAIM, '--', *promoted[:3])
for name in promoted[3:]:
    result = subprocess.run(['git', 'diff', '--no-index', '--', '/dev/null', name], cwd=ROOT, capture_output=True)
    assert result.returncode == 1 and not result.stderr
    patch += result.stdout
(V / 'promoted-harness.diff').write_bytes(patch)
(V / 'repair.diff').write_bytes(git('diff', '01c4dc73f08a752ab5593ae941acdc441d5f4123', HEAD,
                                   '--', 'renderer', 'tools'))
for name in ['authentication.json', 'recording-audit.json', 'coverage-audit.json',
             'promoted-final/adversarial-audit.json']:
    assert json.loads((V / name).read_bytes())['status'] in ['passed', 'coverage-accounted']
assert (V / 'verdict.md').read_text().startswith('VERDICT: verified\n')
assert (V / 'promoted-final/acceptance.log').read_bytes().endswith(b'STANDARD_STATE_ADVERSARIAL_COMPLETE\n')
predictions = json.loads((V / 'prediction-results.json').read_bytes())
assert all(row['status'] == 'HELD' for row in predictions['predictions'])
members = {}
for file in sorted(V.rglob('*')):
    if not file.is_file() or '__pycache__' in file.parts:
        continue
    name = file.relative_to(V).as_posix()
    if name in ['manifest.json', 'records.json', 'recording.tar.gz']:
        continue
    members[name] = file.read_bytes()
records = {'schema': 'virgl-standard-binding-repair-critic-records-v1', 'task': 'E6-T11d5',
           'sourceHead': HEAD, 'workerClaimHead': CLAIM,
           'records': [{'path': name, 'bytes': len(data), 'sha256': sha(data)} for name, data in sorted(members.items())]}
index = (json.dumps(records, indent=2) + '\n').encode()
(V / 'records.json').write_bytes(index)
archive = io.BytesIO()
with gzip.GzipFile(fileobj=archive, mode='wb', mtime=0) as compressed:
    with tarfile.open(fileobj=compressed, mode='w') as tar:
        for name, data in sorted(members.items()):
            info = tarfile.TarInfo(name)
            info.size, info.mode, info.mtime = len(data), 0o644, 0
            tar.addfile(info, io.BytesIO(data))
packed = archive.getvalue()
(V / 'recording.tar.gz').write_bytes(packed)
manifest = {'schema': 'virgl-standard-binding-repair-critic-seal-v1', 'task': 'E6-T11d5',
            'verdict': 'verified', 'sourceHead': HEAD, 'workerClaimHead': CLAIM,
            'records': len(members), 'archiveBytes': len(packed), 'archiveSha256': sha(packed),
            'recordIndexSha256': sha(index), 'runtimeHunkLines': 14, 'newRuntimeWaivers': 0,
            'carriedRuntimeHunks': 45, 'carriedPartialWaivers': 7, 'newDiagnosticHarnessWaivers': 2,
            'workerArchiveSha256': '9c2a187e7f192c35bcc9c06eb32d1e7fc90e8e7ca938cb37c6a124eb3bdc467e',
            'priorCriticArchiveSha256': '6f05eeafad2f2dcdc225957b6ee95889855c1abc3538b480ad3f9a1222257c9b',
            'promotedHarnessDiffSha256': sha(patch),
            'finalPromotedAuditSha256': sha((V / 'promoted-final/adversarial-audit.json').read_bytes()),
            'authority': 'isolated-standard-state-binding', 'guestExecution': False,
            'productionDrawAuthority': False, 'fullGuestApiClaim': False}
(V / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
if '--verify' in sys.argv:
    with tarfile.open(V / 'recording.tar.gz') as tar:
        extracted = {}
        for member in tar.getmembers():
            assert member.isfile() and member.name not in extracted and member.name in members
            assert not Path(member.name).is_absolute() and '..' not in Path(member.name).parts
            extracted[member.name] = tar.extractfile(member).read()
        assert extracted == members
    assert sha((V / 'recording.tar.gz').read_bytes()) == manifest['archiveSha256']
    assert sha((V / 'records.json').read_bytes()) == manifest['recordIndexSha256']
print(json.dumps(manifest))
