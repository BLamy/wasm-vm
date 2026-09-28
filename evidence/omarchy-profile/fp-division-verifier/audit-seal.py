#!/usr/bin/env python3
"""Validate the worker seal against Git, disk, and independent observations."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

repo = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
worker = repo / 'evidence/omarchy-profile/fp-division-r1'
sealed = '74b3713cdcb0a6c8d518188eb27077055471a3aa'
env = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
git = lambda *args: subprocess.check_output(['git', *args], cwd=repo, env=env)
sha = lambda b: hashlib.sha256(b).hexdigest()
load = lambda name: json.loads((out / name).read_text())
frozen = load('frozen-source-inspection.json')
cold = load('cold-inspection.json')
production = load('production-inspection.json')
cold_production = load('cold-production-inspection.json')
physical = load('physical-inspection.json')
public = load('public-inspection.json')
ci = load('ci-inspection.json')
submission = json.loads((worker / 'submission.json').read_text())
index = (worker / 'sha256.txt').read_bytes()
assert sha(index) == 'da8b6685880651034ec46f81a030ba2dcb516d8c1eb5fba551bb7158829e902a'
entries = {}
for line in index.decode().splitlines():
    expected, name = line.split('  ', 1)
    assert name not in entries and not Path(name).is_absolute() and '..' not in Path(name).parts
    data = (worker / name).read_bytes()
    assert sha(data) == expected, name
    assert git('show', sealed + ':' + str((worker / name).relative_to(repo))) == data, name
    entries[name] = expected
assert len(entries) == 69
assert set(entries) == {str(p.relative_to(worker)) for p in worker.rglob('*')
                        if p.is_file() and p.name != 'sha256.txt'}
assert git('show', sealed + ':' + str((worker / 'sha256.txt').relative_to(repo))) == index

assert submission['runtimeSourceHead'] == submission['artifactHead'] == frozen['head']
assert submission['submissionSourceHead'] == submission['coldHead'] == cold['head']
assert submission['runtimeWasmSha256'] == frozen['wasm_sha256']
for path, expected in frozen['source_sha256'].items():
    data = git('show', sealed + ':' + path)
    assert sha(data) == expected and data == (repo / path).read_bytes(), path
for path, expected in submission['runtimeFiles'].items():
    assert expected == frozen['source_sha256'][path]
paths = ['crates', 'tests', 'Makefile', 'Cargo.toml', 'Cargo.lock', '.cargo',
         'tools/verify/omarchy-fp-division-browser.mjs', 'web/dist/pkg',
         'web/app.html', 'web/dist/app.html', 'web/roadmap.js', 'web/dist/roadmap.js',
         'web/dist/sw.js', 'web/tasks.json', 'web/dist/tasks.json']
assert git('diff', '--name-only', frozen['head'], sealed, '--', *paths) == b''
task = git('show', sealed + ':tasks/epic-5.5-omarchy/E5.5-T03z-jit-fp-division.md').decode()
assert '\nstatus: implemented\n' in task

affected = json.loads((worker / 'affected-commands.json').read_text())
assert affected['head'] == frozen['head'] and affected['allPassed']
assert len(affected['commands']) == 11 and all(row['code'] == 0 for row in affected['commands'])
for label, counts in submission['completedTests'].items():
    log = (worker / (label + '.log')).read_text()
    rows = re.findall(r'^test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored;', log, re.M)
    assert len(rows) == counts['targets']
    assert sum(int(row[0]) for row in rows) == counts['passed']
    assert all(row[1:] == ('0', '0') for row in rows)
assert submission['focusedAcceptancePassed'] and submission['coldClonePassed']
assert submission['publicBytesMatched'] and public['passed'] and len(public['artifacts']) == 10
assert all(row['status'] == 200 and row['sha256'] == row['expectedSha256'] for row in public['artifacts'])
assert not submission['broadCiPassed'] and not ci['broadCiPassed']
assert not submission['desktopResponsive'] and not physical['desktopResponsive']
for report in [production, cold_production]:
    assert report['retiredViaJit'] == 4601 and report['retiredTotal'] == 5000
    assert report['independentlyReconstructedRamDigest'] == 'fba6d266740297e684328e066f7b134589bcbf96acc2320629cc44563602a6ca'
    assert report['elfSha256'] == 'b587726be44a8f2ced1e146946861bd5db0d2492b1575eb6eb80c70ec88bbe46'
receipt = dict(verdict='verified', scope='E5.5-T03z FDIV.S and required recorded submission',
               workerSubmission=sealed, runtimeAndArtifactHead=frozen['head'], coldHead=cold['head'],
               workerFilesRehashed=len(entries), workerIndexSha256=sha(index),
               workerIndexMatchesCommittedAndDiskBytes=True,
               postFreezeRuntimeFixtureDependencyHarnessAppChanges=False,
               sourceSha256=frozen['source_sha256'], wasmSha256=frozen['wasm_sha256'],
               affectedCommandsPassed=11, tests=submission['completedTests'],
               coldTestsPassed=18, independentDigests=load('preseal-receipt.json')['digests'],
               production=production, coldProduction=cold_production,
               screenshotsViewedAndRehashed=8, publicArtifactsMatched=10,
               desktopResponsive=False, broadCiPassed=False,
               inheritedCiFailureTargets=ci['failingTargets'],
               T03q='remains gated', pendingFollowUp='E5.5-T03aa')
(out / 'final-audit.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))
