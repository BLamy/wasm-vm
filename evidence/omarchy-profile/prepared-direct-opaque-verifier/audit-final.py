#!/usr/bin/env python3
"""Recheck sealed real evidence and unchanged dependencies after guest cleanup."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
SHA = lambda b: hashlib.sha256(b).hexdigest()


def check_index(index, expected, relative, count=None):
    assert SHA(index.read_bytes()) == expected
    rows = []
    for line in index.read_text().splitlines():
        digest, name = line.split('  ', 1)
        data = (relative/name).read_bytes()
        assert SHA(data) == digest, name
        rows.append(dict(path=str((relative/name).relative_to(ROOT)), size=len(data), sha256=digest))
    if count is not None: assert len(rows) == count
    return dict(path=str(index.relative_to(ROOT)), sha256=expected, count=len(rows), files=rows)


def audit(worker_index_sha):
    out = ROOT/'evidence/omarchy-profile/prepared-direct-opaque-r1'
    report = json.loads((out/'desktop/report.json').read_text())
    run = json.loads((out/'run.json').read_text())
    worker = check_index(ROOT/'evidence/omarchy-profile/prepared-direct-opaque-gates/sha256.txt', worker_index_sha, ROOT)
    names = {row['path'] for row in worker['files']}
    for path in [out/'run.json', out/'desktop/report.json', out/'desktop/serial.log', out/'desktop.log', out/'desktop/desktop.png']:
        assert str(path.relative_to(ROOT)) in names
    ai_dir = ROOT/'evidence/omarchy-profile/direct-opaque-verifier'
    ai = check_index(ai_dir/'sha256.txt', 'e98b479dc9d9dd6b1cc38cbb3fb936d92aae36967bef3716e55cd62422d6446c', ai_dir, 41)
    ai_worker = check_index(ROOT/'evidence/omarchy-profile/direct-opaque-gates-r2/sha256.txt',
        'acc32d1ee23deed68bd1a4e50a92bd7b8151a023361ca606d59cec0ff713d8ca', ROOT, 30)
    ag = check_index(ROOT/'evidence/omarchy-profile/prepared-opaque-verifier/sha256.txt',
        'b71700e20ad7521cff00353f9a41a81263ddaf90b7360745149b04380387f655', ROOT, 24)
    runtime_dir = ROOT/'evidence/omarchy-profile/fp-division-r1'
    runtime = check_index(runtime_dir/'sha256.txt', 'da8b6685880651034ec46f81a030ba2dcb516d8c1eb5fba551bb7158829e902a', runtime_dir, 69)
    pair = Path(run['pairDirectory'])
    assert pair == ROOT/'target/omarchy-direct-opaque-r1'
    assert pair.is_dir() and not pair.is_symlink() and pair.stat().st_mode & 0o777 == 0o700
    assert report['inputEvents'] == [] and report['errors'] == [] and 'keyboard' not in report
    assert run['keyboardAcceptance'] is False and run['usablePair'] is False
    assert run['exit']['closed'] is True and run['exit']['signal'] is None and run['exit']['watchdog'] is None
    prep = report['modePreparation']
    if report['result'] == 'failed':
        assert list(pair.iterdir()) == []
        assert 'pair' not in report and 'captureOverlayStore' not in report
        assert 'exportFinishedAt' not in prep
    if report['result'] == 'failed' and 'exportStartedAt' not in prep:
        for key in ['pair', 'capturePersistence', 'captureOverlayStore']:
            assert key not in report
        assert not (out/'desktop/prepared-desktop.png').exists()
    progress = []
    for line in (out/'desktop.log').read_text().splitlines():
        if line.startswith('OMARCHY_OPAQUE_PREPARATION '):
            progress.append(json.loads(line.split(' ', 1)[1]))
    images = dict(initial=SHA((out/'desktop/desktop.png').read_bytes()))
    for name in ['failure.png', 'prepared-desktop.png']:
        if (out/'desktop'/name).exists(): images[name] = SHA((out/'desktop'/name).read_bytes())
    return dict(head=run['head'], reportSha256=SHA((out/'desktop/report.json').read_bytes()),
        workerSeal=worker, carriedAI=ai, carriedAIWorker=ai_worker, carriedAG=ag, carriedRuntime=runtime,
        pairDirectory=dict(path=str(pair), mode='0700', symlink=False, entries=[p.name for p in pair.iterdir()]),
        progress=dict(count=len(progress), first=progress[0] if progress else None, last=progress[-1] if progress else None,
            frameCounts=sorted({p['frames'] for p in progress}), brightnessCounts=sorted({p['brightPixels'] for p in progress}),
            colorCounts=sorted({p['brightColors'] for p in progress})),
        images=images, result=report['result'], preparationStatus=prep['status'], noPhysicalInput=True,
        guestErrors=[row for row in report['events'] if row['type'] == 'wvm:guest-error'],
        usablePair=run['usablePair'])


if __name__ == '__main__':
    print(json.dumps(audit(sys.argv[1]), indent=2))
