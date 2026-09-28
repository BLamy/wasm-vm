#!/usr/bin/env python3
"""Interrogate recorded range recovery against the unchanged local artifact."""
from pathlib import Path
import hashlib
import json
import re

repo = Path.cwd()
worker = repo / 'evidence/omarchy-profile/direct-fp-imports-r1'
out = repo / 'evidence/omarchy-profile/direct-fp-imports-verifier'
record = json.loads((worker / 'deploy-recovery.json').read_text())
source = (worker / 'deploy-recovery.py').read_text()
initial = (worker / 'cloudflare-deploy-initial.log').read_text()
deploy = (worker / 'cloudflare-deploy.log').read_text()
sha = lambda data: hashlib.sha256(data).hexdigest()
expected = '2231a21eb8ebc8d3965d1352a3523501faebc87bda31e2c8dc184320219235f5'
artifact_path = repo / 'releases/boot-snapshot/omarchy-ready.snap.gz'
artifact = artifact_path.read_bytes()
assert len(artifact) == record['bytes'] == 205050833
assert sha(artifact) == record['sha256'] == record['expectedSha256'] == expected
assert record['url'] == 'https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/sha256/' + expected + '/releases/boot-snapshot/omarchy-ready.snap.gz'
assert record['passed'] and record['publicationExit'] == 0
at = 0
for item in record['ranges']:
    assert item['start'] == at
    assert item['end'] == min(len(artifact), at + 4 * 1024 * 1024) - 1
    chunk = artifact[item['start']:item['end'] + 1]
    assert len(chunk) == item['bytes']
    assert sha(chunk) == item['sha256']
    at = item['end'] + 1
assert len(record['ranges']) == 49 and at == len(artifact)
assert "'--range',str(start)+'-'+str(end)" in source
assert "assert len(data)==end-start+1" in source
assert "assert ('content-range: bytes '+str(start)+'-'+str(end)+'/'+str(size)) in headers.read_text().lower()" in source
assert "assert receipt['sha256']==digest" in source
assert source.index("assert receipt['sha256']==digest") < source.index("result=subprocess.run(command,cwd=repo)")
command = ['npx', '--yes', 'wrangler', 'pages', 'deploy', 'web/dist', '--project-name', 'wasm-vm', '--branch', 'main', '--commit-dirty=true']
assert record['command'] == command
assert 'npx --yes wrangler pages deploy "$DIST" --project-name "$PROJECT" --branch main --commit-dirty=true' in (repo / 'tools/deploy-cloudflare.sh').read_text()
assert all(path.stat().st_size <= 25 * 1024 * 1024 for path in (repo / 'web/dist').rglob('*') if path.is_file())
assert len(re.findall(r'^curl: \(28\) Operation timed out', initial, re.M)) == 2
assert 'public R2 verification failed' in initial
assert 'https://5256a6c7.wasm-vm.pages.dev' in deploy
receipt = {
    'recoveryReceiptSha256': sha((worker / 'deploy-recovery.json').read_bytes()),
    'recoverySourceSha256': sha((worker / 'deploy-recovery.py').read_bytes()),
    'initialFailureLogSha256': sha(initial.encode()), 'deployLogSha256': sha(deploy.encode()),
    'initialTimeoutsPreserved': 2, 'recordedRangeCount': 49,
    'rangeCoverage': [0, len(artifact) - 1], 'allRecordedRangesMatchLocalPinnedArtifact': True,
    'localArtifactSha256': expected, 'fullContentRangeAndDigestGuardsInspected': True,
    'sameFinalPagesCommand': command, 'publicationExit': 0,
    'scope': 'unchanged boot artifact recovery recording reviewed; new runtime/public files independently downloaded separately',
}
(out / 'recovery-inspection.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))
