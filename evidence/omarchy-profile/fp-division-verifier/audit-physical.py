#!/usr/bin/env python3
"""Read-only inspection of the actual trusted-keyboard recording."""
from datetime import datetime
import hashlib
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

repo = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
worker = repo / 'evidence/omarchy-profile/fp-division-r1'
record = worker / 'physical-input/desktop'
raw = (record / 'report.json').read_bytes()
r = json.loads(raw)
frozen = json.loads((worker / 'frozen.json').read_text())
sha = lambda b: hashlib.sha256(b).hexdigest()
assert r['trial']['head'] == frozen['head']
assert r['identities']['files']['pkg/wasm_vm_wasm_bg.wasm']['sha256'] == frozen['wasmSha256']
query = parse_qs(urlsplit(r['url']).query)
assert query['jit'] == ['1'] and query['jitColdCounterRecycling'] == ['0']
assert 'testHooks' not in query and 'e2eShowall' not in query
k = r['keyboard']
time = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00'))
duration = int((time(k['deadlineAt']) - time(k['readbackStartedAt'])).total_seconds() * 1000)
assert duration == k['readbackTimeoutMs'] == 120000
assert not k['verified'] and r['result'] == 'failed'
events = r['inputEvents']
assert len(events) == 128
assert all(e['trusted'] and e['target'] == e['activeElement'] == 'ide-display-canvas' for e in events)
typed = ''.join(e['key'] for e in events if e['type'] == 'keydown' and len(e['key']) == 1)
assert k['nonce'] in typed and k['guestFile'] in typed and typed.startswith('printf')
acks = [e for e in r['workerTraffic'] if e.get('method') == 'sendKeyboardEvent' and e['type'] == 'input-result']
assert len(acks) == 128 and all(e['result'] is True and e['error'] is None for e in acks)
reads = [o['exec'] for o in r['observations'] if 'exec' in o]
command = f"if [ -f '{k['guestFile']}' ]; then cat '{k['guestFile']}'; else (exit 75); fi"
assert len(reads) == 13 and len(r['serialCommands']) == 14
assert all(o['command'] == command and o['exit'] == 75 and not o['stdout'].strip() for o in reads)
assert all(o['command'] == command for o in r['serialCommands'])
assert k['nonce'] not in command  # independent readback did not inject the expected answer
runtime = {o['runtime']['label']: o['runtime'] for o in r['observations'] if 'runtime' in o}
before, after = runtime['physical-keyboard-before'], runtime['input-trial-failure']
assert before['presentation']['framesReceived'] == after['presentation']['framesReceived'] == 2
assert after['jit']['hasExecutor'] and not after['jit']['admissionProbe']
assert not after['jit']['coldCounterRecycling']['enabled']
assert after['clock']['mode'] == 'icount' and after['clock']['clockDiv'] == 64
baseline, failure = (record / 'desktop.png').read_bytes(), (record / 'failure.png').read_bytes()
assert baseline == failure
assert r['cleanup']['closed'] is True
receipt = dict(reportSha256=sha(raw), head=r['trial']['head'], wasmSha256=frozen['wasmSha256'],
               nonce=k['nonce'], readbackStartedAt=k['readbackStartedAt'], deadlineAt=k['deadlineAt'],
               deadlineDurationMs=duration, typedTrustedEvents=len(events), focusedCanvasEvents=len(events),
               workerAcknowledgedKeyboardEvents=len(acks), independentReadbackCommands=len(reads),
               readbackExits=[o['exit'] for o in reads], pendingReadbackCommands=1,
               nonceReadbackPassed=False, baselineImageSha256=sha(baseline), failureImageSha256=sha(failure),
               sameImages=True, framesBefore=2, framesAfter=2, closed=True, desktopResponsive=False,
               visualObservation='Both viewed Foot images show only the original prompt and cursor; no typed command, nonce or response appears.',
               actualSettings={key:after['jit'][key] for key in ['hasExecutor','admissionProbe','coldCounterRecycling','decodedCacheEntries','jitResidencyPolicy','jitResidencyCap']},
               actualClock=after['clock'], T03q='remains gated')
(out / 'physical-inspection.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))
