#!/usr/bin/env python3
"""Independent R1 export-stop audit, using recorded wire and source only."""
from datetime import datetime
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT/'evidence/omarchy-profile/prepared-direct-opaque-r1'
raw = (OUT/'desktop/report.json').read_bytes()
sha = hashlib.sha256(raw).hexdigest()
assert sha == 'abc4f6e07166f2569b6e619e4556844897f53fc432a40571ba683e2432d7a771'
report = json.loads(raw)
run = json.loads((OUT/'run.json').read_text())
prep = report['modePreparation']
ms = lambda value: round(datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()*1000)
calls = [(index, row) for index, row in enumerate(report['workerTraffic']) if row['type'] == 'worker-call']
export = [(index, row) for index, row in calls if ms(row['timestamp']) >= ms(prep['exportStartedAt'])
    and row['method'] != 'keyboardLedState']
assert [row['method'] for _, row in export] == ['pause', 'isPaused', 'persist', 'persistStats', 'persistStats', 'snapshotSave']
assert all(row['args'] == [] and row['sent'] is True for _, row in export)
assert export[-1][0] == 1930
assert ms(report['capturePersistence']['timestamp']) < ms(export[-1][1]['timestamp'])
for field in ['stats', 'settled']:
    assert report['capturePersistence'][field] == dict(pendingBlocks=0, pendingBytes=0, flushWaiting=False, writeWaiting=False)
assert 'capturePair' in report['error'] and 'omarchy-desktop-live.mjs:1048:27' in report['error']
assert 'Uncaught RuntimeError: unreachable' in report['error']
errors = [row for row in report['events'] if row['type'] == 'wvm:guest-error']
assert len(errors) == 2 and all(row['detail']['message'] == 'Uncaught RuntimeError: unreachable' for row in errors)
assert 'exportFinishedAt' not in prep
assert not any(key in report for key in ['pair', 'captureOverlayStore'])
assert list(Path(run['pairDirectory']).iterdir()) == []
assert run['result'] == 'preparation-failed-input-untested' and run['usablePair'] is False and run['keyboardAcceptance'] is False
assert run['exit'] == dict(code=1, signal=None, closed=True, watchdog=None)
assert report['cleanup']['closed'] and report['cleanup']['clientClosed']

source_checks = [
    ('tools/verify/omarchy-desktop-live.mjs', 1048, 'window.__snapshotSave()'),
    ('web/main.js', 2468, 'await linuxCtl.snapshotSave();'),
    ('web/loader.js', 1375, 'return machine.persistSnapshot();'),
    ('crates/wasm/src/lib.rs', 4209, 'inner.machine.save_resume()'),
    ('web/linux-worker-host.js', 82, 'client.fail(new Error(event?.message'),
]
source = []
for path, line, fragment in source_checks:
    data = (ROOT/path).read_bytes()
    text = data.decode().splitlines()[line-1]
    assert fragment in text, (path, line)
    source.append(dict(path=path, line=line, text=text.strip(), sha256=hashlib.sha256(data).hexdigest()))

print(json.dumps(dict(
    reportSha256=sha, runSha256=hashlib.sha256((OUT/'run.json').read_bytes()).hexdigest(),
    exportCalls=[dict(workerTrafficIndex=index, **row) for index, row in export],
    persistence=report['capturePersistence'], error=report['error'], guestErrorEvents=errors,
    preparationGatesCompleted=True, exportFailureAfterMs=ms(prep['finishedAt'])-ms(prep['exportStartedAt']),
    pairDirectoryEmpty=True, usablePair=False, ownedChildClosed=True, sourceChain=source,
    conclusion='Snapshot-save invocation failed before snapshot export or exact overlay-store selection. The intended API was called; the recording lacks a Rust panic/allocation stack, so it does not establish a harness-only correction or a specific Rust trap cause.',
), indent=2))
