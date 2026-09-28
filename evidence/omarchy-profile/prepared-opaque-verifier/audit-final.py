#!/usr/bin/env python3
"""Seal recheck and negative artifact boundary, without executing the guest."""
import hashlib
import json
from pathlib import Path
import os
import subprocess

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
SHA = lambda b: hashlib.sha256(b).hexdigest()
index = ROOT/'evidence/omarchy-profile/prepared-opaque-gates/sha256.txt'
assert SHA(index.read_bytes()) == '8dd0ae4003172dd0c7cfaf11a3473ebf0eff83207f819aaa6d3aef5859ea76f0'
checked = []
for line in index.read_text().splitlines():
    digest, name = line.split('  ', 1)
    actual = (ROOT/name).read_bytes()
    assert SHA(actual) == digest, name
    checked.append(dict(path=name, size=len(actual), sha256=digest))
assert len(checked) == 16
prior = ROOT/'evidence/omarchy-profile/fp-division-r1/sha256.txt'
assert SHA(prior.read_bytes()) == 'da8b6685880651034ec46f81a030ba2dcb516d8c1eb5fba551bb7158829e902a'
carried_count = 0
for line in prior.read_text().splitlines():
    digest, name = line.split('  ', 1)
    assert SHA((prior.parent/name).read_bytes()) == digest, name
    carried_count += 1
assert carried_count == 69
run_dir = ROOT/'evidence/omarchy-profile/prepared-opaque-r1'
report = json.loads((run_dir/'desktop/report.json').read_text())
run = json.loads((run_dir/'run.json').read_text())
pair = Path(run['pairDirectory'])
assert pair == ROOT/'target/omarchy-opaque-r1'
assert pair.is_dir() and not pair.is_symlink() and (pair.stat().st_mode & 0o777) == 0o700
assert list(pair.iterdir()) == []
for name in ['pair', 'capturePersistence', 'captureOverlayStore', 'keyboard']:
    assert name not in report
for name in ['foot', 'presentationBaseline', 'lastPixels', 'visibleAt', 'exportStartedAt', 'exportFinishedAt']:
    assert name not in report['modePreparation']
assert not (run_dir/'desktop/prepared-desktop.png').exists()
assert (run_dir/'desktop/desktop.png').read_bytes() == (run_dir/'desktop/failure.png').read_bytes()
assert report['modePreparation']['status'] == 'preparation-failed-input-untested'
assert report['opaqueFoot']['status'] == 'configuration-failed'
assert run['usablePair'] is False and run['keyboardAcceptance'] is False
assert not report['inputEvents'] and not report['errors']
assert run['exit'] == dict(code=1, signal=None, closed=True, watchdog=None)
env = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
task_diff = subprocess.check_output(['git', 'diff', '--name-only', 'e841c3a1', '03655c48', '--', 'tools', 'crates', 'web', 'Cargo.toml', 'Cargo.lock'], cwd=ROOT, env=env)
assert task_diff == b''
print(json.dumps(dict(workerSubmission='03655c48', frozenHead=run['head'],
    workerIndexSha256=SHA(index.read_bytes()), workerSealedArtifacts=checked,
    priorRuntimeIndexSha256=SHA(prior.read_bytes()), carriedRuntimeArtifacts=carried_count,
    implementationUnchangedAtSubmission=True,
    pairDirectory=dict(path=str(pair), mode='0700', symlink=False, entries=[]),
    noActiveWindowOrPixelQualificationOrExport=True, noPhysicalInput=True,
    initialAndFailureImageIdentical=True, initialImageSha256=SHA((run_dir/'desktop/desktop.png').read_bytes()),
    reportSha256=SHA((run_dir/'desktop/report.json').read_bytes()),
    result='verified-negative-diagnostic-only', usablePair=False), indent=2))
