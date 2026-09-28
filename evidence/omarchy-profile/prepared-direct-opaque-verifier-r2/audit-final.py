#!/usr/bin/env python3
"""Bind completed R2 audits, immutable evidence seal and private artifacts."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
OUT = ROOT/'evidence/omarchy-profile/prepared-direct-opaque-r2'
sha = lambda data: hashlib.sha256(data).hexdigest()
report = json.loads((OUT/'desktop/report.json').read_text())
run = json.loads((OUT/'run.json').read_text())
raw = json.loads((HERE/'run-audit.json').read_text())
source = json.loads((HERE/'source-audit.json').read_text())
metadata = json.loads((HERE/'metadata-audit.json').read_text())
assert raw['reportSha256'] == sha((OUT/'desktop/report.json').read_bytes())
assert run['head'] == source['head'] == metadata['head'] == '7a3f3f3583220c320b850dfb10d7aca87fd1525e'
assert report['inputEvents'] == [] and report['errors'] == [] and 'keyboard' not in report
assert run['keyboardAcceptance'] is False and run['usablePair'] is False
assert run['exit']['closed'] and run['exit']['signal'] is None and run['exit']['watchdog'] is None
pair = Path(run['pairDirectory'])
assert pair == ROOT/'target/omarchy-direct-opaque-r2'
assert pair.is_dir() and not pair.is_symlink() and pair.stat().st_mode & 0o777 == 0o700
assert metadata['frozenAt'] > run['startedAt']  # explicit post-launch correction
assert metadata['failedPrelaunchDisclosed'] and metadata['metadataSubstitutionExactlyDeclared']
assert not any('e5-t22c-guest-mode' in row.get('repoPath', '') for row in report['resourceIdentities'] if row.get('repoPath'))

images = {}
for name in ['desktop.png', 'prepared-desktop.png', 'failure.png']:
    path = OUT/'desktop'/name
    if path.exists(): images[name] = dict(bytes=path.stat().st_size, sha256=sha(path.read_bytes()))

if report['result'] == 'prepared-mode-pair-input-untested':
    pair_audit = json.loads((HERE/'pair-audit.json').read_text())
    image = json.loads((HERE/'prepared-image.json').read_text())
    assert pair_audit['report']['sha256'] == raw['reportSha256']
    assert image['sha256'] == images['prepared-desktop.png']['sha256']
    assert image['width'] == 1280 and image['height'] == 800 and image['nonblank']
    assert image['brightPixels'] == report['modePreparation']['lastPixels']['pixels']['brightPixels']
    assert image['brightColors'] == report['modePreparation']['lastPixels']['pixels']['brightColors']
    assert not [row for row in report['events'] if row['type'] == 'wvm:guest-error']
    assert sorted(p.name for p in pair.iterdir()) == ['omarchy-overlay-delta.bin.gz', 'omarchy-ready.snap.gz']
    assert run['exit']['code'] == 0 and run['result'] == 'prepared-pair-awaiting-personal-image-verification'
else:
    pair_audit = None
    assert run['result'] == 'preparation-failed-input-untested' and run['exit']['code'] == 1

index = ROOT/'evidence/omarchy-profile/prepared-direct-opaque-gates-r2/sha256.txt'
expected = sys.argv[1]
assert sha(index.read_bytes()) == expected
sealed = []
for line in index.read_text().splitlines():
    digest, name = line.split('  ', 1)
    data = (ROOT/name).read_bytes()
    assert sha(data) == digest, name
    sealed.append(dict(path=name, bytes=len(data), sha256=digest))
names = {row['path'] for row in sealed}
for name in ['run.json', 'desktop/report.json', 'desktop.log', 'desktop/desktop.png']:
    assert str((OUT/name).relative_to(ROOT)) in names
if report['result'] == 'prepared-mode-pair-input-untested':
    assert str((OUT/'desktop/prepared-desktop.png').relative_to(ROOT)) in names

print(json.dumps(dict(head=run['head'], result=report['result'], parentResult=run['result'],
    reportSha256=raw['reportSha256'], parentReceiptSha256=sha((OUT/'run.json').read_bytes()),
    images=images, pair=pair_audit, pairDirectory=dict(path=str(pair), mode='0700', symlink=False,
        entries=[p.name for p in pair.iterdir()]),
    workerSeal=dict(path=str(index.relative_to(ROOT)), sha256=expected, files=sealed),
    sourceClosureModules=len(source['staticClosure']), metadataCorrectionIsPostLaunch=True,
    usablePair=run['usablePair'], keyboardAcceptance=False, cleanup=report['cleanup']
), indent=2))
