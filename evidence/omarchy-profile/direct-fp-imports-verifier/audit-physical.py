#!/usr/bin/env python3
"""Independent raw audit; carries the prior verified key/fence parser forward.
Adds post-verdict sampling audit without importing worker validation or symbolization.
No worker audit or keymap implementation is imported.
"""
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import parse_qs, urlsplit

REPO = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
PAIR = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else REPO / 'evidence/omarchy-profile/direct-fp-imports-r1/physical-input'
OUTPUT_NAME = 'physical-inspection.json'
WASM = '36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916'
SHA = lambda b: hashlib.sha256(b).hexdigest()
MS = lambda s: round(datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)
PINS = {
    'kernel': (24208896, 'af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce'),
    'bootSnapshot': (207172408, '989dff1cad261ab6e53e1dea8f57cb12866d2a236b5366f114102744553d4e75'),
    'overlayDelta': (1232847, '4fde816771e4fcfe085b492b6321302e945c58145c5c16f0c91e02ac94d10972'),
    'chunkManifest': (1097812, '5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44'),
}
HASH_CACHE = {}
HEAD = json.loads((REPO/'evidence/omarchy-profile/direct-fp-imports-r1/cold/report.json').read_text())['head']
PROPERTIES = ['opaque','force_rgbx','opacity','opacity_inactive','opacity_fullscreen',
              'opacity_override','opacity_inactive_override','opacity_fullscreen_override']
COMMAND = "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 --batch '" + '; '.join(
    ['getprop active '+p for p in PROPERTIES]+['j/activewindow']) + "'"



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
        matches = list(re.finditer(r'(?:\r?\n)__WVBEGIN_' + token + r'\r?\n(.*?\r?\n)__WVEND_' + token + r'_(\d+)\r?\n', outputs, re.S))
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
                         jitColdCounterRecycling=['1'],
                         jitResidency=['cap-256' if arm == 'candidate' else 'repack-off'],
                         omarchyAssetBase=[origin.scheme + '://' + origin.netloc])
    trial = r['trial']
    assert trial['arm'] == arm == 'candidate' and trial['recycling'] is True
    assert trial['experiment'] == 'prepared-recycling'
    assert trial['jitResidencyPolicy'] == ('cap-256' if arm == 'candidate' else 'repack-off')
    assert trial['jitResidencyCap'] == (256 if arm == 'candidate' else 24)
    for key,value in dict(startupMs=300000,typingMs=60000,readbackMs=120000,captureMs=20000,cleanupMs=30000).items():
        assert trial[key] == value
    assert not trial['profilingRequested'] and not trial['admissionProbeRequested']
    assert not any(r.get(k) for k in ['failureCheckpoint','renderBudgetRequested','compositorModeRequested','failureCaptureError'])
    assert r['errors'] == []
    assert not any(e.get('method') == 'sendAgentInput' for e in r['workerTraffic'])
    assert r['cleanup']['closed'] and not r['cleanup'].get('killError')
    if r['cleanup'].get('forceKilled'):
        # The unchanged recorder has a bounded owned-browser kill fallback.
        # The task requires <=30s cleanup, not a graceful browser-server exit.
        assert r['cleanup']['clientClosed'] is True
        assert r['cleanup']['closeError'] == 'Error: browser close: deadline exceeded (UNPROVEN)'
        assert 10000 <= MS(r['finishedAt']) - MS(r['cleanup']['startedAt']) <= 30000
    assert r['cleanup']['timeoutMs'] == 30000
    assert 0 <= MS(r['finishedAt']) - MS(r['cleanup']['startedAt']) <= 30000
    assert MS(r['finishedAt']) - MS(r['startup']['startedAt']) <= 710000
    assert MS(r['startup']['deadlineAt']) - MS(r['startup']['startedAt']) == 300000
    runtimes = [o['runtime'] for o in r['observations'] if 'runtime' in o]
    for rt in runtimes:
        j = rt['jit']; policy = j['coldCounterRecycling']
        assert j['hasExecutor'] and not j['admissionProbe'] and not j['entryCost']['timingEnabled']
        assert j['entryCost']['timerReads'] == 0
        assert policy['enabled'] is True
        assert policy['threshold'] == 512 and policy['capacity'] == 65536
        assert 0 <= int(policy['epochs']) <= 2**64-1 and 0 <= int(policy['discardedCounters']) <= 2**64-1
        assert j['decodedCacheEntries'] == 4096
        assert j['jitResidencyPolicy'] == ('cap-256' if arm == 'candidate' else 'repack-off')
        assert j['jitResidencyCap'] == (256 if arm == 'candidate' else 24)
        assert rt['clock']['mode'] == 'icount' and rt['clock']['clockDiv'] == 64
        assert rt['presentation']['width'] == 1280 and rt['presentation']['height'] == 800
        presentation = rt['presentation']
        assert presentation['fixedViewport'] is True
        assert presentation['gpu']['width'] == 1280 and presentation['gpu']['height'] == 800
        assert presentation['latest']['resourceWidth'] == 1280
        assert presentation['latest']['resourceHeight'] == 832
        rect = presentation['latest']['rect']
        assert all(type(rect[key]) is int for key in ['x','y','width','height'])
        assert rect['x'] >= 0 and rect['y'] >= 0 and rect['width'] > 0 and rect['height'] > 0
        assert rect['x'] + rect['width'] <= 1280 and rect['y'] + rect['height'] <= 832
        assert presentation['errors'] == []
    screenshots = [o for o in r['observations'] if 'screenshot' in o]
    for shot in screenshots:
        p = Path(shot['screenshot'])
        if p.name != 'latest.png':  # A progress path is deliberately overwritten during polling.
            assert identity(p)[1] == shot['sha256'], str(p)
    requests, outputs = wire_commands(r)
    assert len(requests)>=2 and requests[0]['command']=='XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers'
    assert requests[0]['exit']==0 and requests[1]['command']==COMMAND
    assert len([q for q in requests if q['command'] == COMMAND]) == 1
    prop=requests[1]; receipt=r['preparedDirect']
    assert r['preparedDirectRequested'] is True and receipt['requestCount'] == 1
    assert receipt['command'] == COMMAND and receipt['status'] == 'properties-confirmed'
    assert receipt['deadlineAtMs'] == MS(r['startup']['deadlineAt'])
    assert MS(receipt['startedAt']) <= MS(prop['sentAt']) <= MS(prop['completedAt']) <= MS(receipt['respondedAt']) < receipt['deadlineAtMs']
    assert receipt['response'] == dict(stdout=prop['stdout'],exit=prop['exit'])
    lines=[line.strip() for line in prop['stdout'].splitlines() if line.strip()]
    assert prop['exit'] == 0 and len(lines)>8
    assert all(lines[i]=='true' for i in [0,1,5,6,7])
    assert all(re.fullmatch(r'1(?:\.0+)?',lines[i]) for i in [2,3,4])
    foot=json.loads('\n'.join(lines[8:])); assert foot==receipt['foot']
    assert all(foot[k] is True for k in ['mapped','visible','acceptsInput']) and foot['hidden'] is False
    assert foot['class']=='foot' and foot['pid']==503 and foot['address']=='0x55555eb73630'
    assert foot['at']==[12,38] and foot['size']==[1256,750]
    assert MS(receipt['respondedAt']) <= MS(r['keyboard']['startedAt'])
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
    assert k['enteredAtMs'] <= MS(k['typedAt']) == MS(k['readbackStartedAt']) < MS(k['deadlineAt'])
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
    reads = requests[2:]
    assert all(q['command'] == read_command and nonce not in q['command'] for q in reads)
    assert len(requests)-1 == len(r['serialCommands'])
    assert r['serialCommands'][0]['command'] == COMMAND
    for raw, claimed in zip(reads,r['serialCommands'][1:]):
        assert claimed['command'] == raw['command'] and claimed['stage'] == 'physical keyboard:nonce-readback'
        assert k['enteredAtMs'] <= MS(raw['sentAt']) < MS(k['deadlineAt'])
    completed = [q for q in reads if 'exit' in q]
    observed = [o['exec'] for o in r['observations'] if 'exec' in o]
    # The task allows a previously pending read to settle during sampling.
    # Every claimed observation must bind a raw reply; late raw replies never
    # become on-time successes. Keep reply parsing independent of the harness.
    assert len(observed) <= len(completed)+1
    by_command = iter([requests[1], *completed])
    for raw, claimed in zip(by_command,observed):
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
    run = json.loads((PAIR / 'run.json').read_text())
    assert run['purpose'] == 'prepared-pair-direct-fp-imports-runtime'
    assert run['head'] == HEAD
    wrapper_error = run.get('auditError')
    if wrapper_error:
        # The retained wrapper stopped before its final fields because it
        # conflates latest damage bounds with the fixed canvas. Raw geometry,
        # wire inputs, fence, sampling and cleanup are independently checked
        # below; no missing wrapper result is treated as an assertion passing.
        assert wrapper_error.startswith('AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:')
        for text in ['height: 28', 'width: 118', 'x: 10', 'y: 36', 'height: 800', 'width: 1280']:
            assert text in wrapper_error
        assert 'desktopAcceptance' not in run and 'visualInspectionRequired' not in run
        assert run['input']['machineAcceptance'] is False
        assert run['configuration']['configuration'] == 'properties-confirmed'
    else:
        assert run['desktopAcceptance'] is False and run['visualInspectionRequired'] is True
    assert run['acceptanceClaim'] is False
    assert run.get('finishedAt') and run['wasmSha256'] == WASM
    assert run['exit']['closed'] and not run['exit'].get('watchdog') and not run['exit'].get('signal') and not run['exit'].get('error')
    report_path = PAIR / 'desktop/report.json'
    r = json.loads(report_path.read_text())
    summary = inspect_arm(r, 'candidate', run['head'])
    summary['wrapperAuditFailurePreserved'] = wrapper_error
    summary['independentRawAuditSupersedesIncompleteWrapperAudit'] = bool(wrapper_error)
    assert run['reportSha256']==identity(report_path)[1]
    if summary['desktopAccepted']:
        assert r['workerCost']['status']=='skipped-input-passed'
        summary.update(reportSha256=identity(report_path)[1],runSha256=identity(PAIR/'run.json')[1],
            profile='skipped-input-passed', sourceClaim='Machine-positive requires separate personal image inspection.')
        (OUT / OUTPUT_NAME).write_text(json.dumps(summary,indent=2)+'\n')
        print(json.dumps({k:summary[k] for k in ['head','outcome','trustedPhysicalEvents','matchedKeyboardRPCs','completedReads','pendingReads','nonceVerified','desktopAccepted','reportSha256']},indent=2))
        return
    if summary['nonceVerified']:
        assert summary['desktopAccepted'] is False
        assert r['trial']['outcome'] == 'nonce-passed-presentation-unproven'
        assert 'workerCost' not in r
        summary.update(reportSha256=identity(report_path)[1], runSha256=identity(PAIR/'run.json')[1],
            cleanup=r['cleanup'], cleanupElapsedMs=MS(r['finishedAt'])-MS(r['cleanup']['startedAt']),
            sourceClaim='Nonce passed but required fresh presentation did not; desktop remains unproven.')
        (OUT / OUTPUT_NAME).write_text(json.dumps(summary,indent=2)+'\n')
        print(json.dumps({k:summary[k] for k in ['head','outcome','nonceVerified','desktopAccepted','reportSha256']},indent=2))
        return
    assert summary['desktopAccepted'] is False and summary['nonceVerified'] is False
    capture = r['workerCost']
    assert capture['status'] == 'captured' and capture['diagnostic'] is True and capture['acceptanceChanged'] is False
    assert capture['timeoutMs'] == 180000 and capture['sampleMs'] == 30000
    verdict = capture['inputVerdict']
    assert verdict['result'] == r['result'] == 'failed'
    assert verdict['outcome'] == r['trial']['outcome'] == 'nonce-readback-failed'
    for key, value in verdict['keyboard'].items():
        assert r['keyboard'][key] == value, ('changed fixed keyboard field', key)
    assert set(r['keyboard']) - set(verdict['keyboard']) <= {'desktopReadyPageMs', 'firstPhysicalKeydownPageMs', 'readyToFirstPhysicalKeydownMs'}
    k = r['keyboard']
    shots = [s for s in summary['screenshots'] if Path(s['screenshot']).name == 'failure.png']
    assert len(shots) == 1
    shot = shots[0]
    assert MS(k['deadlineAt']) <= MS(k['failedAt']) <= MS(shot['timestamp']) <= MS(k['failedAt']) + 20000
    assert MS(shot['timestamp']) <= MS(capture['startedAt']) <= MS(capture['sampleStartedAt'])
    assert 30000 <= MS(capture['sampleStoppedAt']) - MS(capture['sampleStartedAt']) <= 60000
    assert MS(capture['sampleStoppedAt']) <= MS(capture['finishedAt']) <= MS(capture['deadlineAt'])
    assert MS(capture['startedAt']) <= MS(capture['deadlineAt']) - 180000 <= MS(capture['sampleStartedAt'])
    assert MS(capture['finishedAt']) <= MS(r['cleanup']['startedAt'])
    assert MS(r['finishedAt']) <= MS(run['finishedAt'])
    assert r['cleanup']['clientClosed'] is True
    if 'postVerdictInput' in run:
        assert run['postVerdictInput']['noPostVerdictIngress'] is True
    else:
        assert wrapper_error, 'unexpected missing wrapper ingress audit'
    assert not any(r.get(key) for key in ['workerCostError', 'failureCaptureError', 'failureCheckpoint'])
    assert identity(PAIR / 'desktop/failure.png')[1] == capture['failureImageSha256'] == shot['sha256']
    raw_path = PAIR / 'desktop/worker-cpu.json'
    assert identity(raw_path) == (capture['bytes'],capture['sha256'])
    raw = json.loads(raw_path.read_text())
    worker_url = r['url'].split('/app.html',1)[0] + '/linux-worker.js'
    assert raw['url'] == raw['target']['url'] == capture['url'] == worker_url
    assert raw['target']['type'] == 'worker' and raw['target']['targetId']
    assert raw['target'] == capture['target'] and raw['intervalUs'] == capture['intervalUs'] == 1000
    assert raw['browser'] == capture['browser'] and raw['browser']
    for event in r['inputEvents']:
        assert MS(event['timestamp']) <= MS(k['typedAt']), 'new guest keys after Enter'
    no_new_serial = [e for e in r['workerTraffic'] if e['type'] == 'serial-input' and MS(e['timestamp']) > MS(k['failedAt'])]
    assert not no_new_serial, 'new serial input after verdict'
    assert r['workerCostInputFence']==r['preparedDirectInputFence']
    if 'workerCostInputFence' in r:
        fence = r['workerCostInputFence']
        assert fence['method'] == 'Input.setIgnoreInputEvents' and fence['ignore'] is True
        assert k['enteredAtMs'] <= MS(fence['startedAt']) <= MS(fence['acknowledgedAt']) < MS(k['deadlineAt'])
        assert all(MS(e['timestamp']) <= MS(fence['startedAt']) for e in r['inputEvents'])
        observe_only = {'keyboardLedState','inputDeviceStats','jitStats','schedulerStats','guestClockState'}
        for event in r['workerTraffic']:
            if MS(event['timestamp']) <= MS(k['failedAt']):
                continue
            if event['type'] == 'serial-output':
                continue
            assert event['type'] == 'worker-call', 'post-verdict ingress or mutation acknowledgement'
            assert event['method'] in observe_only and event['args'] == [] and event['sent'] is True, 'non-observational post-verdict RPC'
        summary['hostInputFence'] = fence
        summary['noPostVerdictGuestInput'] = True
    post_calls = [e for e in r['workerTraffic'] if e['type'] == 'worker-call' and MS(e['timestamp']) >= MS(k['failedAt'])]
    assert not any(e['method'] in ['pause','step','setProfiling','enableEntryCostTiming','sendAgentInput','sendKeyboardEvent','syncKeyboard','sendTabletEvent','syncTablet','sendMouseEvent','syncMouse','setDisplay'] for e in post_calls), 'guest input or mutation after fixed verdict'
    requests = summary['rawSerialRequests']
    late = [q for q in requests if 'completedAt' in q and MS(q['completedAt']) > MS(k['deadlineAt'])]
    summary.update(reportSha256=identity(report_path)[1], runSha256=identity(PAIR/'run.json')[1],
                   capture=capture, laterReplies=late, postVerdictWorkerCalls=post_calls,
                   cleanup=r['cleanup'], cleanupElapsedMs=MS(r['finishedAt'])-MS(r['cleanup']['startedAt']),
                   sourceClaim='Independent physical/wire/identity/timeline audit; image inspected separately.')
    (OUT / OUTPUT_NAME).write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps({k:summary[k] for k in ['head','outcome','trustedPhysicalEvents','matchedKeyboardRPCs','completedReads','pendingReads','nonceVerified','desktopAccepted','reportSha256']},indent=2))
if __name__ == '__main__':
    main()
