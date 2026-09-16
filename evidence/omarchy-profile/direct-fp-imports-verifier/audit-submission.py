#!/usr/bin/env python3
"""Bind the final worker seal, recorded claims and unchanged freeze to git bytes."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess

OUT = Path(__file__).resolve().parent
REPO = OUT.parents[2]
WORKER = REPO / 'evidence/omarchy-profile/direct-fp-imports-r1'
HEAD = '7d648143e92b7fe861fa4ae7b1f34c0a84451f39'
FROZEN = '8c302e1d6cd084ba1034cfd58c7efb9677dc3e46'
ARTIFACT = 'a3beb0e8dc5da21374a6d59e25658f5db5ce79da'
WASM = '36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916'
INDEX = 'e9160dbff703ac19aa5d4fb591fa1cc4651738916f04c0535905b189e53c2bbf'
ENV = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
sha = lambda b: hashlib.sha256(b).hexdigest()

def git(*args):
    return subprocess.check_output(['git', *args], cwd=REPO, env=ENV)

def committed(path, head=HEAD):
    return git('show', f'{head}:{path}')

def load(name, root=WORKER):
    return json.loads((root / name).read_text())

index_bytes = (WORKER / 'sha256.txt').read_bytes()
assert sha(index_bytes) == INDEX
assert committed(str((WORKER / 'sha256.txt').relative_to(REPO))) == index_bytes
sealed = []
for line in index_bytes.decode().splitlines():
    digest, name = line.split('  ', 1)
    path = WORKER / name
    assert path.resolve().is_relative_to(WORKER.resolve())
    assert name not in [row['name'] for row in sealed]
    data = path.read_bytes()
    assert sha(data) == digest, name
    assert committed(str(path.relative_to(REPO))) == data, ('uncommitted evidence', name)
    sealed.append(dict(name=name, bytes=len(data), sha256=digest))
assert len(sealed) == 89
actual = {str(p.relative_to(WORKER)) for p in WORKER.rglob('*')
          if p.is_file() and p.name != 'sha256.txt' and '__pycache__' not in p.parts}
assert actual == {row['name'] for row in sealed}, 'unsealed worker evidence'

assert git('rev-parse', f'{HEAD}^').decode().strip() == ARTIFACT
changes = git('diff', '--name-only', ARTIFACT, HEAD).decode().splitlines()
allowed = {'tasks/QUEUE.md', 'tasks/epic-5.5-omarchy/E5.5-T03ao-direct-fp-imports.md'}
assert all(p.startswith('evidence/omarchy-profile/direct-fp-imports-r1/') or p in allowed for p in changes)
frozen = load('frozen.json')
assert frozen['head'] == FROZEN and frozen['wasmSha256'] == WASM
file_checks = []
for row in frozen['files'] + frozen['artifacts']:
    path = row['path']
    current = (REPO / path).read_bytes()
    assert sha(current) == row['sha256'], path
    assert committed(path) == current, path
    assert committed(path, FROZEN) == current, ('changed freeze', path)
    file_checks.append(path)
assert len(file_checks) == 58
assert sha((REPO / 'web/dist/pkg/wasm_vm_wasm_bg.wasm').read_bytes()) == WASM

submission = load('submission.json')
assert submission['submissionSourceHead'] == submission['artifactHead'] == submission['coldHead'] == ARTIFACT
assert submission['runtimeSourceHead'] == FROZEN and submission['runtimeWasmSha256'] == WASM
for key in ['focusedAcceptancePassed', 'coldClonePassed', 'publicBytesMatched']:
    assert submission[key] is True, key
assert submission['broadCiPassed'] is False and submission['desktopResponsive'] is False
for path, digest in submission['runtimeFiles'].items():
    assert sha(committed(path)) == digest == sha((REPO / path).read_bytes())
assert submission['completedTests'] == {
    'wasm-native-lib': dict(targets=1, passed=33, failed=0, ignored=0),
    'acceptance': dict(targets=6, passed=32, failed=0, ignored=0)}
assert load('suites-frozen-inspection.json', OUT)['totalPassed'] == 32
assert load('cold-inspection.json', OUT)['passed']
assert load('public-inspection.json', OUT)['passed']
assert load('ci-inspection.json', OUT)['broadCiPassed'] is False

raw = load('physical-input/desktop/report.json')
physical = load('physical-inspection.json', OUT)
correction = load('physical-audit.json')
run = load('physical-input/run.json')
raw_sha = sha((WORKER / 'physical-input/desktop/report.json').read_bytes())
assert physical['reportSha256'] == correction['reportSha256'] == run['reportSha256'] == raw_sha
assert raw_sha == '6ab46d14d2b0b037c59a1c13673609c94590c7432beeb2efbaffedeaa66a75af'
assert physical['head'] == ARTIFACT and physical['completedReads'] == 37 and physical['pendingReads'] == 0
assert physical['nonceVerified'] is False and physical['desktopAccepted'] is False
assert physical['wrapperAuditFailurePreserved'] and physical['independentRawAuditSupersedesIncompleteWrapperAudit']
assert correction['originalAuditFailure'] == run['auditError']
assert correction['passed'] and correction['desktopResponsive'] is False
assert correction['rejectedGeometryAttacks'] == 16
assert len(load('geometry-inspection.json', OUT)['rejectedMutations']) == 15
assert correction['profile'] == dict(durationMs=30022.968, samples=19977, nodes=5211, sampledUs=30022150)
profile = load('profile-inspection.json', OUT)
assert len(profile['nonCustomSections']) == 11 and profile['summary']['samples'] == 19977
assert profile['profileSpanUs'] == 30022968 and profile['summary']['totalUs'] == 30022150
assert profile['profileSha256'] == '24a461f002de9a6a22c22088a6162599546793889f7a5652690b796e0fcf4256'
assert sha((REPO / profile['namedFile']).read_bytes()) == profile['namedSha256']
visual = load('visual-physical-inspection.json', OUT)
assert visual['desktopResponsive'] is False

task_path = 'tasks/epic-5.5-omarchy/E5.5-T03ao-direct-fp-imports.md'
task = committed(task_path).decode()
assert '\nstatus: implemented\n' in task
assert 'Desktop responsiveness is still unsolved' in task
assert 'T03q stays gated' in task and INDEX in task
q_path = 'tasks/epic-5.5-omarchy/E5.5-T03q-responsive-mode-release.md'
assert '\nstatus: pending\n' in committed(q_path).decode()

result = dict(checkedAt=datetime.now(timezone.utc).isoformat(), passed=True,
    workerSubmissionHead=HEAD, frozenHead=FROZEN, artifactColdPhysicalHead=ARTIFACT,
    wasmSha256=WASM, workerIndexSha256=INDEX, sealedFiles=sealed,
    sourceArtifactFilesChecked=file_checks, submissionOnlyChanges=changes,
    rawPhysicalSha256=raw_sha, originalWrapperFailurePreserved=True,
    offlineCorrectionIndependentlySupported=True, independentGeometryMutationsRejected=15,
    desktopResponsive=False, broadCiPassed=False, qStillPending=True,
    note='Final verdict applies to the direct pure FP import boundary; physical outcome remains negative.')
(OUT / 'submission-inspection.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(dict(passed=True, workerSubmissionHead=HEAD, sealedFiles=len(sealed),
    sourceArtifactFilesChecked=len(file_checks), indexSha256=INDEX, desktopResponsive=False), indent=2))
