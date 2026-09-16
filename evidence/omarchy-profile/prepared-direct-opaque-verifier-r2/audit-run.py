#!/usr/bin/env python3
"""Independent raw recording audit. Read-only; no worker validation helpers."""
from collections import Counter
from datetime import datetime
import hashlib
import json
from pathlib import Path
import os
import re
import subprocess
import sys
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[3]
SHA = lambda b: hashlib.sha256(b).hexdigest()
MS = lambda s: round(datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)
WASM = '8230800b2ed4fe92ed0647d871d6c548fe824f3a550b09ca4a9b4941bc220ca4'
PINS = {
    'kernel': (24208896, 'af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce'),
    'bootSnapshot': (205050833, '2231a21eb8ebc8d3965d1352a3523501faebc87bda31e2c8dc184320219235f5'),
    'overlayDelta': (1209196, '1f56d0bd44c945fab3ec1c201d04f39dd3f590320f54c8d2224446ebffb7e7da'),
    'chunkManifest': (1097812, '5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44'),
}
PROPERTIES = ['opaque', 'force_rgbx', 'opacity', 'opacity_inactive', 'opacity_fullscreen',
    'opacity_override', 'opacity_inactive_override', 'opacity_fullscreen_override']
DIRECT = "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 --batch '" + '; '.join(
    ['dispatch hl.dsp.window.set_prop({ prop = "' + prop + '", value = "1", window = "activewindow" })' for prop in PROPERTIES]
    + ['getprop active '+prop for prop in PROPERTIES] + ['j/activewindow']) + "'"
LAYERS = 'XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers'
CACHE = {}


def identity(path):
    path = Path(path)
    if path not in CACHE:
        digest, size = hashlib.sha256(), 0
        with path.open('rb') as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
                size += len(chunk)
        CACHE[path] = (size, digest.hexdigest())
    return CACHE[path]


def serial_records(report):
    requests, outputs, spans = [], '', []
    for index, event in enumerate(report['workerTraffic']):
        if event['type'] == 'serial-input':
            assert event['sent'] is True
            text = bytes(event['bytes']).decode('ascii')
            if text == '\r':
                assert not requests
                continue
            match = re.fullmatch(r"printf '\\n__WVBEGIN_([a-z0-9]+)\\n'; (.*); printf '\\n__WVEND_\1_%s\\n' \"\$\?\"\r", text, re.S)
            assert match, ('unframed serial input', index)
            requests.append(dict(id=match[1], command=match[2], sentAt=event['timestamp'], workerIndex=index))
        elif event['type'] == 'serial-output':
            start = len(outputs)
            outputs += event['text']
            spans.append((start, len(outputs), event['timestamp'], index))
    assert len({q['id'] for q in requests}) == len(requests)
    for request in requests:
        token = re.escape(request['id'])
        matches = list(re.finditer(r'(?:\r?\n)__WVBEGIN_' + token + r'\r?\n(.*?\r?\n)__WVEND_' + token + r'_(\d+)\r?\n', outputs, re.S))
        assert len(matches) <= 1
        if matches:
            match = matches[0]
            ended, index = next((t, i) for start, end, t, i in spans if start < match.end() <= end)
            assert MS(ended) >= MS(request['sentAt'])
            request.update(stdout=match[1].replace('\r\n', '\n'), exit=int(match[2]), completedAt=ended, replyWorkerIndex=index)
    return requests


def original(state):
    assert state['latest']['resourceWidth'] == 1280 and state['latest']['resourceHeight'] == 832
    assert state['latest']['rect'] == dict(x=0, y=0, width=1280, height=800)
    assert state['framesReceived'] > 0 and state['successfulPresents'] > 0


def audit(directory, head):
    raw = (directory/'desktop/report.json').read_bytes()
    report, run = json.loads(raw), json.loads((directory/'run.json').read_text())
    assert run['head'] == report['trial']['head'] == head
    assert report['trial']['scopedStatus'] == '' and report['mode'] == 'direct-opaque-pair'
    assert report['identities']['files']['pkg/wasm_vm_wasm_bg.wasm']['sha256'] == WASM == run['wasmSha256']
    env = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
    for name, row in report['trial']['helpers'].items():
        actual = subprocess.check_output(['git', 'show', head+':'+name], cwd=ROOT, env=env)
        assert (len(actual), SHA(actual)) == (row['size'], row['sha256']) == identity(ROOT/name)
    for role, pin in PINS.items():
        row = report['candidate']['source'][role]
        assert (row['size'], row['sha256']) == identity(row['filename']) == pin
    generated = json.dumps(report['candidate']['manifest'], separators=(',', ':')).encode()
    for row in report['resourceIdentities']:
        assert row['status'] == 200 and row['method'] == 'GET'
        if row['repoPath']:
            actual = identity(ROOT/row['repoPath'])
            if row['repoPath'].startswith('web/'):
                committed = subprocess.check_output(['git', 'show', head+':'+row['repoPath']], cwd=ROOT, env=env)
                assert actual == (len(committed), SHA(committed))
        elif row['pathname'] == '/artifacts-omarchy.json':
            actual = (len(generated), SHA(generated))
        else:
            assert row['pathname'] == '/chunked-omarchy/manifest-'+PINS['chunkManifest'][1]+'.json'
            actual = PINS['chunkManifest']
        assert actual == (row['size'], row['sha256']), row['pathname']
    url = urlsplit(report['url'])
    origin = url.scheme+'://'+url.netloc
    assert url.scheme == 'http' and url.hostname == '127.0.0.1'
    assert parse_qs(url.query) == dict(guest=['omarchy'], desktop=['1'], omarchyDivider=['64'],
        jit=['1'], jitColdCounterRecycling=['0'], jitResidency=['cap-256'], persist=['1'], omarchyAssetBase=[origin])
    inventory = {row['pathname'] for row in report['resourceIdentities']}
    for row in report['browserRequests']:
        request = urlsplit(row['url'])
        assert request.scheme+'://'+request.netloc == origin and row['method'] == 'GET'
        assert request.path in inventory or request.path == '/favicon.ico'
    assert report['errors'] == [] and report['inputEvents'] == [] and 'keyboard' not in report
    fence = report['preparationInputFence']
    assert fence['ignore'] is True
    assert MS(fence['startedAt']) <= MS(fence['acknowledgedAt']) <= MS(report['browserRequests'][0]['timestamp'])
    calls = [row for row in report['workerTraffic'] if row['type'] == 'worker-call']
    assert all(row['sent'] for row in calls)
    assert not any(re.match(r'(?:send(?:Keyboard|Tablet|Mouse|Agent)|sync(?:Keyboard|Tablet|Mouse))', row['method']) for row in calls)
    displays = [row for row in calls if row['method'] == 'setDisplay']
    assert len(displays) == 1 and displays[0]['args'] == [1280, 800]
    display_replies = [row for row in report['workerTraffic'] if row['type'] == 'input-result'
        and row.get('method') == 'setDisplay' and row.get('id') == displays[0]['id']]
    assert len(display_replies) == 1 and display_replies[0]['result'] is True and display_replies[0]['error'] is None
    assert not any(row['type'] in ('fatal', 'error') for row in report['workerTraffic'])
    for runtime in [row['runtime'] for row in report['observations'] if 'runtime' in row]:
        jit = runtime['jit']
        assert jit['hasExecutor'] and not jit['admissionProbe'] and not jit['entryCost']['timingEnabled']
        assert jit['entryCost']['timerReads'] == 0
        assert jit['coldCounterRecycling'] == dict(enabled=False, threshold=512, capacity=65536, epochs='0', discardedCounters='0')
        assert jit['decodedCacheEntries'] == 4096 and jit['jitResidencyPolicy'] == 'cap-256' and jit['jitResidencyCap'] == 256
        assert runtime['clock']['mode'] == 'icount' and runtime['clock']['clockDiv'] == 64
        original(runtime['presentation'])
    assert report['cleanup']['closed'] and report['cleanup']['timeoutMs'] == 30000
    assert 0 <= MS(report['finishedAt'])-MS(report['cleanup']['startedAt']) <= 30000
    assert MS(report['startup']['deadlineAt'])-MS(report['startup']['startedAt']) == 900000
    assert MS(report['finishedAt'])-MS(report['startup']['startedAt']) <= 1110000
    assert run['exit']['closed'] and run['exit']['watchdog'] is None and run['exit']['signal'] is None
    records = serial_records(report)
    assert all(row['command'] in {DIRECT, LAYERS} for row in records)
    direct = [row for row in records if row['command'] == DIRECT]
    assert len(direct) <= 1
    if 'directOpaque' in report:
        config = report['directOpaque']
        assert MS(displays[0]['timestamp']) < MS(config['startedAt'])
        assert len(direct) == 1 and config['requestCount'] == 1 and config['command'] == DIRECT
        assert config['deadlineAtMs'] == MS(report['startup']['deadlineAt'])
        assert MS(config['startedAt']) <= MS(direct[0]['sentAt']) < config['deadlineAtMs']
        if 'response' in config:
            assert config['response'] == dict(stdout=direct[0]['stdout'], exit=direct[0]['exit'])
            assert MS(direct[0]['completedAt']) <= MS(config['respondedAt']) < config['deadlineAtMs']
        if config['status'] == 'properties-confirmed':
            lines = [line.strip() for line in config['response']['stdout'].splitlines() if line.strip()]
            assert lines[:8] == ['ok'] * 8 and len(lines) > 16
            for i, prop in enumerate(PROPERTIES):
                if 2 <= i <= 4: assert re.fullmatch(r'1(?:\.0+)?', lines[8+i]), prop
                else: assert lines[8+i] == 'true', prop
            foot = json.loads('\n'.join(lines[16:]))
            assert foot == config['foot'] and foot['class'] == 'foot' and foot['mapped'] is True and foot['hidden'] is False
            assert re.fullmatch(r'0x[0-9a-fA-F]+', foot['address']) and int(foot['address'], 16) > 0
            x, y = foot['at']; width, height = foot['size']
            assert all(isinstance(v, (int, float)) for v in [x, y, width, height])
            assert x >= 0 and y >= 26 and width >= 200 and height >= 100 and x+width <= 1280 and y+height <= 800
            assert config['response']['exit'] == 0
        else:
            assert config['status'] == 'configuration-failed'
    prep = report.get('modePreparation')
    if prep and 'presentationBaseline' in prep:
        assert report['directOpaque']['status'] == 'properties-confirmed'
        assert prep['foot'] == report['directOpaque']['foot']
        assert MS(direct[0]['completedAt']) <= MS(report['directOpaque']['respondedAt']) <= MS(prep['baselineAt'])
        original(prep['presentationBaseline'])
        original(prep['lastPixels']['state'])
    elif prep and 'foot' in prep:
        assert prep['foot'] == report['directOpaque']['foot']
    shots = [row for row in report['observations'] if 'screenshot' in row]
    final_shots = {row['screenshot']: row for row in shots}
    overwritten_progress = []
    for row in shots:
        if row is not final_shots[row['screenshot']]:
            # Startup polling intentionally reuses latest.png. The earlier hash
            # is no longer independently inspectable and is not acceptance evidence.
            assert Path(row['screenshot']).name == 'latest.png'
            assert MS(row['timestamp']) < MS(final_shots[row['screenshot']]['timestamp'])
            overwritten_progress.append(row)
        else:
            assert identity(row['screenshot'])[1] == row['sha256']
    prep = report.get('modePreparation')
    if prep and 'exportStartedAt' in prep:
        # These completed preparation gates remain auditable after export fails.
        assert report['directOpaque']['status'] == 'properties-confirmed'
        assert prep['keyboardTested'] is False and prep['foot'] == report['directOpaque']['foot']
        assert MS(direct[0]['completedAt']) <= MS(prep['baselineAt']) <= MS(prep['visibleAt'])
        assert MS(prep['visibleAt']) < MS(report['startup']['deadlineAt'])
        assert MS(prep['visibleAt']) <= MS(prep['exportStartedAt'])
        assert MS(prep['exportDeadlineAt'])-MS(prep['exportStartedAt']) == 180000
        assert MS(prep['finishedAt']) < MS(prep['exportDeadlineAt'])
        original(prep['presentationBaseline'])
        original(prep['lastPixels']['state'])
        original(prep['runtimeAfter']['presentation'])
        assert prep['lastPixels']['pixels']['nonblank']
        assert prep['lastPixels']['state']['framesReceived'] > prep['presentationBaseline']['framesReceived']
        assert prep['lastPixels']['state']['successfulPresents'] > prep['presentationBaseline']['successfulPresents']
        prepared_shots = [row for row in shots if Path(row['screenshot']).name == 'prepared-desktop.png']
        assert len(prepared_shots) == 1
        assert MS(prep['baselineAt']) <= MS(prepared_shots[0]['timestamp']) <= MS(prep['visibleAt'])
        for key in ['stats', 'settled']:
            persisted = report['capturePersistence'][key]
            assert persisted['pendingBlocks'] == 0 and persisted['pendingBytes'] == 0
            assert not persisted['flushWaiting'] and not persisted['writeWaiting']
    if report['result'] == 'prepared-mode-pair-input-untested':
        assert len(direct) == 1 and direct[0]['exit'] == 0
        assert prep['status'] == 'pair-captured-input-untested' and prep['keyboardTested'] is False
        assert prep['foot'] == report['directOpaque']['foot']
        foot = prep['foot']
        assert foot['class'] == 'foot' and foot['mapped'] and not foot['hidden'] and foot['address']
        x, y = foot['at']; width, height = foot['size']
        assert x >= 0 and y >= 26 and width >= 200 and height >= 100 and x+width <= 1280 and y+height <= 800
        assert MS(prep['visibleAt']) < MS(report['startup']['deadlineAt'])
        assert MS(prep['exportDeadlineAt'])-MS(prep['exportStartedAt']) == 180000
        assert MS(prep['visibleAt']) <= MS(prep['exportStartedAt']) <= MS(prep['exportFinishedAt']) < MS(prep['exportDeadlineAt'])
        assert prep['lastPixels']['pixels']['nonblank']
        assert MS(direct[0]['completedAt']) <= MS(prep['baselineAt']) <= MS(prep['visibleAt'])
        original(prep['presentationBaseline'])
        original(prep['lastPixels']['state'])
        assert prep['lastPixels']['state']['framesReceived'] > prep['presentationBaseline']['framesReceived']
        assert prep['lastPixels']['state']['successfulPresents'] > prep['presentationBaseline']['successfulPresents']
        assert report['pair']['paused'] and report['pair']['restoreDecision'] == 'resume'
        for key in ['stats', 'settled']:
            persisted = report['capturePersistence'][key]
            assert persisted['pendingBlocks'] == 0 and not persisted['flushWaiting'] and not persisted['writeWaiting']
        seed = SHA((PINS['bootSnapshot'][1]+':'+PINS['overlayDelta'][1]).encode())
        assert report['captureOverlayStore'] == dict(seed=seed, name='wvov-'+report['pair']['base']+'-seed-'+seed)
        assert run['result'] == 'prepared-pair-awaiting-personal-image-verification' and run['usablePair'] is False
        assert run['exit']['code'] == 0
    else:
        assert report['result'] == 'failed' and prep['status'] == 'preparation-failed-input-untested'
        assert run['usablePair'] is False and run['result'] == 'preparation-failed-input-untested'
        assert run['exit']['code'] == 1
    return dict(head=head, reportSha256=SHA(raw), result=report['result'], runResult=run.get('result'),
        usablePair=run.get('usablePair'), keyboardTested=False, servedReceipts=len(report['resourceIdentities']),
        helpers=len(report['trial']['helpers']), workerEvents=len(report['workerTraffic']),
        workerCalls=dict(Counter(row['method'] for row in calls)), originalDisplaySetup=displays,
        serial=records, screenshots=shots, overwrittenProgressScreenshots=overwritten_progress,
        startup=report['startup'], cleanup=report['cleanup'], inputFence=fence, preparation=prep,
        configuration=report.get('directOpaque'), pair=report.get('pair'), reportError=report.get('error'))


if __name__ == '__main__':
    print(json.dumps(audit(Path(sys.argv[1]), sys.argv[2]), indent=2))
