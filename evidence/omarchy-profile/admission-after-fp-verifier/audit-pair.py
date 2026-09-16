#!/usr/bin/env python3
"""Independent offline audit of source identity, physical keys and guest replies."""
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import parse_qs, urlsplit

REPO = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
PAIR = REPO / 'evidence/omarchy-profile/admission-after-fp-r1'
WASM = '1bc7285239db053abdaaafe4c5869a5a2495c7c149d01a239ec020e1fedbf88d'
SHA = lambda b: hashlib.sha256(b).hexdigest()
MS = lambda s: round(datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)
PINS = {
    'kernel': (24208896, 'af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce'),
    'bootSnapshot': (205050833, '2231a21eb8ebc8d3965d1352a3523501faebc87bda31e2c8dc184320219235f5'),
    'overlayDelta': (1209196, '1f56d0bd44c945fab3ec1c201d04f39dd3f590320f54c8d2224446ebffb7e7da'),
    'chunkManifest': (1097812, '5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44'),
}
HASH_CACHE = {}


def identity(p):
    p = Path(p)
    if p not in HASH_CACHE:
        b = p.read_bytes()
        HASH_CACHE[p] = (len(b), SHA(b))
    return HASH_CACHE[p]


def expected_keys(command):
    # Literal PC key positions, independent of the app's keymap implementation.
    key = {}
    for start, row in [(16, 'qwertyuiop'), (30, 'asdfghjkl'), (44, 'zxcvbnm')]:
        for offset, c in enumerate(row):
            key[c] = ('Key' + c.upper(), start + offset, False)
    for c, evdev in zip('1234567890', range(2, 12)):
        key[c] = ('Digit' + c, evdev, False)
    key.update({' ':('Space',57,False), "'":('Quote',40,False),
                '>':('Period',52,True), '/':('Slash',53,False), '-':('Minus',12,False)})
    result = []
    for c in command:
        code, evdev, shift = key[c]
        if shift:
            result.append(('keydown', 'ShiftLeft', 'Shift', 42))
        result.extend([('keydown', code, c, evdev), ('keyup', code, c, evdev)])
        if shift:
            result.append(('keyup', 'ShiftLeft', 'Shift', 42))
    result.extend([('keydown', 'Enter', 'Enter', 28), ('keyup', 'Enter', 'Enter', 28)])
    return result


def wire_commands(r):
    requests, outputs, spans = [], '', []
    for event in r['workerTraffic']:
        if event['type'] == 'serial-input':
            assert event['sent'] is True
            text = bytes(event['bytes']).decode()
            if text == '\r':
                assert not requests, 'unexpected serial bootstrap after RPC'
                continue
            match = re.fullmatch(r"printf '\\n__WVBEGIN_([a-z0-9]+)\\n'; (.*); printf '\\n__WVEND_\1_%s\\n' \"\$\?\"\r", text, re.S)
            assert match, ('unframed serial input', text)
            requests.append(dict(id=match[1], command=match[2], sentAt=event['timestamp']))
        elif event['type'] == 'serial-output':
            start = len(outputs)
            outputs += event['text']
            spans.append((start, len(outputs), event['timestamp']))
    assert len({q['id'] for q in requests}) == len(requests)
    for request in requests:
        token = re.escape(request['id'])
        matches = list(re.finditer(r'(?:\r?\n)__WVBEGIN_' + token + r'\r?\n(.*?)\r?\n__WVEND_' + token + r'_(\d+)\r?\n', outputs, re.S))
        assert len(matches) <= 1, 'repeated response fence'
        if matches:
            match = matches[0]
            ended = next(t for start,end,t in spans if start < match.end() <= end)
            assert MS(ended) >= MS(request['sentAt'])
            request.update(stdout=match[1].replace('\r\n', '\n'), exit=int(match[2]), completedAt=ended)
    return requests, outputs


def check_identities(r, expected_head):
    assert r['trial']['head'] == expected_head and r['trial']['scopedStatus'] == ''
    assert r['identities']['files']['pkg/wasm_vm_wasm_bg.wasm']['sha256'] == WASM, 'stale served WASM'
    for name, pin in r['trial']['helpers'].items():
        assert identity(REPO / name) == (pin['size'], pin['sha256']), name
    source = r['candidate']['source']
    for role, expected in PINS.items():
        item = source[role]
        assert (item['size'], item['sha256']) == expected, role
        assert identity(item['filename']) == expected, role
    assert source['image'] == dict(imageLen=4294967296, chunkSize=262144, chunkCount=16384)
    if 'loaderIdentity' in r:
        assert r['loaderIdentity']['rawSha256'] == r['loaderIdentity']['baseBinding'] == PINS['chunkManifest'][1]
    generated = json.dumps(r['candidate']['manifest'], separators=(',', ':')).encode()
    for item in r['resourceIdentities']:
        assert item['status'] == 200 and item['method'] == 'GET'
        if item['repoPath']:
            actual = identity(REPO / item['repoPath'])
        elif item['pathname'] == '/artifacts-omarchy.json':
            actual = (len(generated), SHA(generated))
        else:
            assert item['pathname'] == '/chunked-omarchy/manifest-' + PINS['chunkManifest'][1] + '.json'
            actual = PINS['chunkManifest']
        assert actual == (item['size'], item['sha256']), item['pathname']
    inventory = {e['pathname'] for e in r['resourceIdentities']}
    for request in r['browserRequests']:
        pathname = urlsplit(request['url']).path
        assert pathname in inventory or pathname == '/favicon.ico', pathname
    for name, pin in r['identities']['files'].items():
        assert any(e['pathname'] == '/' + name and e['size'] == pin['size'] and e['sha256'] == pin['sha256'] for e in r['resourceIdentities']), name


def inspect_arm(r, arm, expected_head):
    check_identities(r, expected_head)
    query = parse_qs(urlsplit(r['url']).query)
    origin = urlsplit(r['url'])
    assert origin.scheme == 'http' and origin.hostname == '127.0.0.1'
    assert query == dict(guest=['omarchy'], desktop=['1'], omarchyDivider=['64'], jit=['1'],
                         jitColdCounterRecycling=['1' if arm == 'candidate' else '0'],
                         omarchyAssetBase=[origin.scheme + '://' + origin.netloc])
    trial = r['trial']
    assert trial['arm'] == arm and trial['recycling'] is (arm == 'candidate')
    for key,value in dict(startupMs=300000,typingMs=60000,readbackMs=120000,captureMs=20000,cleanupMs=30000).items():
        assert trial[key] == value
    assert not trial['profilingRequested'] and not trial['admissionProbeRequested']
    assert not any(r.get(k) for k in ['failureCheckpoint','renderBudgetRequested','compositorModeRequested','failureCaptureError'])
    assert r['errors'] == []
    assert not any(e.get('method') == 'sendAgentInput' for e in r['workerTraffic'])
    assert r['cleanup']['closed'] and not r['cleanup'].get('forceKilled')
    assert r['cleanup']['timeoutMs'] == 30000
    assert 0 <= MS(r['finishedAt']) - MS(r['cleanup']['startedAt']) <= 30000
    assert MS(r['finishedAt']) - MS(r['startup']['startedAt']) <= 530000
    assert MS(r['startup']['deadlineAt']) - MS(r['startup']['startedAt']) == 300000
    runtimes = [o['runtime'] for o in r['observations'] if 'runtime' in o]
    for rt in runtimes:
        j = rt['jit']; policy = j['coldCounterRecycling']
        assert j['hasExecutor'] and not j['admissionProbe'] and not j['entryCost']['timingEnabled']
        assert j['entryCost']['timerReads'] == 0
        assert policy['enabled'] is (arm == 'candidate')
        assert policy['threshold'] == 512 and policy['capacity'] == 65536
        assert 0 <= int(policy['epochs']) <= 2**64-1 and 0 <= int(policy['discardedCounters']) <= 2**64-1
        assert j['decodedCacheEntries'] == 4096 and j['jitResidencyPolicy'] == 'repack-off' and j['jitResidencyCap'] == 24
        assert rt['clock']['mode'] == 'icount' and rt['clock']['clockDiv'] == 64
        assert rt['presentation']['width'] == 1280 and rt['presentation']['height'] == 800
    screenshots = [o for o in r['observations'] if 'screenshot' in o]
    for shot in screenshots:
        p = Path(shot['screenshot'])
        if p.name != 'latest.png':  # A progress path is deliberately overwritten during polling.
            assert identity(p)[1] == shot['sha256'], str(p)
    requests, outputs = wire_commands(r)
    assert requests and requests[0]['command'] == 'XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers'
    assert not any('hyprctl -i 0 -j clients' in q['command'] or 'activewindow' in q['command'] for q in requests)
    events = r['inputEvents']
    summary = dict(arm=arm, head=expected_head, result=r['result'], outcome=trial.get('outcome',r['result']),
                   servedReceipts=len(r['resourceIdentities']), browserRequests=len(r['browserRequests']),
                   helpers=len(trial['helpers']), rawSerialRequests=requests,
                   runtimeSamples=runtimes, closed=True, screenshots=screenshots)
    if 'keyboard' not in r:
        assert not events and r['result'] == 'failed' and trial['outcome'] == 'startup-failed-input-not-tested'
        summary.update(physicalInputTested=False, desktopAccepted=False)
        return summary
    k = r['keyboard']; nonce = k['nonce']; filename = k['guestFile']
    assert re.fullmatch('[0-9a-f]{16}', nonce) and re.fullmatch('/tmp/desktop-keys-[0-9a-f]{16}', filename)
    assert nonce not in filename
    command = "printf '" + nonce + "' > " + filename
    expected = expected_keys(command)
    assert [(e['type'],e['code'],e['key']) for e in events] == [e[:3] for e in expected], 'physical key sequence'
    assert all(e['trusted'] and not e['repeat'] and e['target'] == e['activeElement'] == 'ide-display-canvas' for e in events)
    assert all(events[i]['ms'] <= events[i+1]['ms'] for i in range(len(events)-1))
    assert r['restored'] is True
    ready = next(e for e in r['events'] if e['type'] == 'wvm:desktop-ready')
    assert ready['ms'] < events[0]['ms']
    assert MS(events[0]['timestamp']) < MS(r['startup']['deadlineAt'])
    assert 0 <= k['typingMs'] <= 60000
    assert k['enteredAtMs'] == MS(k['typedAt']) == MS(k['readbackStartedAt'])
    assert k['enteredAtMs'] - MS(k['startedAt']) == k['typingMs']
    assert MS(k['deadlineAt']) - k['enteredAtMs'] == k['readbackTimeoutMs'] == k['deadlineMs'] == 120000
    calls = [e for e in r['workerTraffic'] if e['type'] == 'worker-call' and e['method'] in ['sendKeyboardEvent','syncKeyboard']]
    assert len(calls) == 2 * len(events)
    acks = {(e['worker'],e['id']):e for e in r['workerTraffic'] if e['type'] == 'input-result'}
    assert len({(e['worker'],e['id']) for e in calls}) == len(calls)
    for i, event in enumerate(expected):
        call, sync = calls[2*i:2*i+2]
        assert call['method'] == 'sendKeyboardEvent' and call['args'] == [1,event[3],1 if event[0] == 'keydown' else 0]
        assert sync['method'] == 'syncKeyboard' and sync['args'] == [] and sync['worker'] == call['worker']
        for c in [call,sync]:
            a = acks[(c['worker'],c['id'])]
            assert c['sent'] and a['method'] == c['method'] and a['result'] is True and a['error'] is None
            assert a['ms'] >= c['ms'] >= events[i]['ms']
    read_command = f"if [ -f '{filename}' ]; then cat '{filename}'; else (exit 75); fi"
    reads = requests[1:]
    assert all(q['command'] == read_command and nonce not in q['command'] for q in reads)
    assert len(reads) == len(r['serialCommands'])
    for raw, claimed in zip(reads,r['serialCommands']):
        assert claimed['command'] == raw['command'] and claimed['stage'] == 'physical keyboard:nonce-readback'
        assert k['enteredAtMs'] <= MS(raw['sentAt']) < MS(k['deadlineAt'])
    completed = [q for q in reads if 'exit' in q]
    observed = [o['exec'] for o in r['observations'] if 'exec' in o]
    assert len(completed) == len(observed)
    for raw, claimed in zip(completed,observed):
        assert raw['command'] == claimed['command'] and raw['exit'] == claimed['exit']
        assert raw['stdout'].strip() == claimed['stdout'].strip()
        assert MS(raw['completedAt']) <= MS(claimed['timestamp'])
    successes = [q for q in completed if q['exit'] == 0 and q['stdout'].strip() == nonce and MS(q['completedAt']) <= MS(k['deadlineAt'])]
    assert k['verified'] is bool(successes), 'claimed nonce success differs from independent on-time wire reply'
    assert all(q['exit'] in [0,75] for q in completed)
    before = next(rt for rt in runtimes if rt['label'] == 'physical-keyboard-before')
    after = runtimes[-1]
    fresh = after['presentation']['framesReceived'] > before['presentation']['framesReceived'] and after['presentation']['successfulPresents'] > before['presentation']['successfulPresents']
    accepted = r['result'] == 'input-trial-physical-nonce-and-fresh-presentation'
    if accepted:
        assert successes and fresh and MS(k['completedAt']) <= MS(k['deadlineAt'])
        assert any(Path(s['screenshot']).name == 'desktop-keyboard.png' for s in screenshots)
    else:
        assert r['result'] == 'failed'
        if not successes:
            assert trial['outcome'] == 'nonce-readback-failed'
    summary.update(physicalInputTested=True, trustedPhysicalEvents=len(events), matchedKeyboardRPCs=len(calls),
                   completedReads=len(completed), pendingReads=len(reads)-len(completed),
                   nonce=nonce, nonceVerified=bool(successes), deadlineAt=k['deadlineAt'],
                   desktopAccepted=accepted, freshGuestFrame=fresh, keyboard=k,
                   visualAcceptance='Requires independent inspection; counters do not establish response.')
    return summary


def main():
    ab = json.loads((PAIR / 'ab.json').read_text())
    carry = json.loads((OUT / 'carry-forward.json').read_text())
    assert ab['head'] == carry['head'] and ab['wasmSha256'] == WASM
    assert [a['arm'] for a in ab['arms']] == ['control','candidate']
    assert MS(ab['arms'][0]['finishedAt']) <= MS(ab['arms'][1]['startedAt'])
    summaries, reports = [], []
    for entry in ab['arms']:
        assert entry['closed'] and not entry.get('watchdog') and not entry.get('signal') and not entry.get('error')
        arm = entry['arm']; p = PAIR / arm / 'report.json'
        r = json.loads(p.read_text()); reports.append(r)
        assert entry['cleanup'] == r['cleanup'] and entry['result'] == r['result']
        assert MS(r['finishedAt']) <= MS(entry['finishedAt'])
        summary = inspect_arm(r, arm, ab['head'])
        summary['reportSha256'] = identity(p)[1]
        summaries.append(summary)
    assert reports[0]['candidate'] == reports[1]['candidate']
    assert reports[0]['trial']['helpers'] == reports[1]['trial']['helpers']
    if all('keyboard' in r for r in reports):
        assert reports[0]['keyboard']['nonce'] != reports[1]['keyboard']['nonce']
    result = dict(head=ab['head'], abSha256=identity(PAIR/'ab.json')[1], arms=summaries)
    (OUT / 'pair-inspection.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps([dict(arm=s['arm'], outcome=s['outcome'], nonceVerified=s.get('nonceVerified'),
                           trustedPhysicalEvents=s.get('trustedPhysicalEvents'), completedReads=s.get('completedReads'),
                           desktopAccepted=s['desktopAccepted']) for s in summaries],indent=2))
if __name__ == '__main__':
    main()
