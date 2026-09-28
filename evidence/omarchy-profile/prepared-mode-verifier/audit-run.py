#!/usr/bin/env python3
"""Independent raw report audit. No worker validator and no guest execution."""
from collections import Counter
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import os
import sys
from urllib.parse import parse_qs, urlsplit

REPO = Path(__file__).resolve().parents[3]
HEAD = sys.argv[2] if len(sys.argv) > 2 else '1cfedb179a63ac274bf36fa42202b6e5eb10e177'
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


def identity(path):
    path = Path(path)
    if path not in HASH_CACHE:
        data = path.read_bytes()
        HASH_CACHE[path] = (len(data), SHA(data))
    return HASH_CACHE[path]


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
        matches = list(re.finditer(r'(?:\r?\n)__WVBEGIN_' + token + r'\r?\n(.*?)\r?\n__WVEND_' + token + r'_(\d+)\r?\n', outputs, re.S))
        assert len(matches) <= 1
        if matches:
            match = matches[0]
            ended, index = next((t, i) for start, end, t, i in spans if start < match.end() <= end)
            assert MS(ended) >= MS(request['sentAt'])
            request.update(stdout=match[1].replace('\r\n', '\n'), exit=int(match[2]), completedAt=ended, replyWorkerIndex=index)
    return requests


def audit(directory):
    raw = (directory/'desktop/report.json').read_bytes()
    report = json.loads(raw)
    run = json.loads((directory/'run.json').read_text())
    assert run['head'] == report['trial']['head'] == HEAD
    assert report['trial']['scopedStatus'] == ''
    assert report['mode'] == 'mode-pair'
    assert report['identities']['files']['pkg/wasm_vm_wasm_bg.wasm']['sha256'] == WASM == run['wasmSha256']
    env = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
    for name, row in report['trial']['helpers'].items():
        actual = subprocess.check_output(['git', 'show', HEAD+':'+name], cwd=REPO, env=env)
        assert (len(actual), SHA(actual)) == (row['size'], row['sha256'])
    for role, expected in PINS.items():
        row = report['candidate']['source'][role]
        assert (row['size'], row['sha256']) == identity(row['filename']) == expected
    generated = json.dumps(report['candidate']['manifest'], separators=(',', ':')).encode()
    for row in report['resourceIdentities']:
        assert row['status'] == 200 and row['method'] == 'GET'
        if row['repoPath']:
            actual = identity(REPO/row['repoPath'])
            if row['repoPath'].startswith('web/'):
                committed = subprocess.check_output(['git', 'show', HEAD+':'+row['repoPath']], cwd=REPO, env=env)
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
        actual = urlsplit(row['url'])
        assert actual.scheme+'://'+actual.netloc == origin and row['method'] == 'GET'
        assert actual.path in inventory or actual.path == '/favicon.ico'
    assert not report['errors'] and not report['inputEvents'] and 'keyboard' not in report
    assert report['preparationInputFence']['ignore'] is True
    assert MS(report['preparationInputFence']['acknowledgedAt']) <= MS(report['browserRequests'][0]['timestamp'])
    calls = [row for row in report['workerTraffic'] if row['type'] == 'worker-call']
    assert all(row['sent'] for row in calls)
    assert not any(re.match(r'(?:send(?:Keyboard|Tablet|Mouse|Agent)|sync(?:Keyboard|Tablet|Mouse))', row['method']) for row in calls)
    assert not any(row['type'] in ('fatal', 'error') for row in report['workerTraffic'])
    runtimes = [row['runtime'] for row in report['observations'] if 'runtime' in row]
    for runtime in runtimes:
        jit = runtime['jit']
        assert jit['hasExecutor'] and not jit['admissionProbe'] and not jit['entryCost']['timingEnabled']
        assert jit['entryCost']['timerReads'] == 0
        assert jit['coldCounterRecycling'] == dict(enabled=False, threshold=512, capacity=65536, epochs='0', discardedCounters='0')
        assert jit['decodedCacheEntries'] == 4096 and jit['jitResidencyPolicy'] == 'cap-256' and jit['jitResidencyCap'] == 256
        assert runtime['clock']['mode'] == 'icount' and runtime['clock']['clockDiv'] == 64
    assert report['cleanup']['closed'] and report['cleanup']['timeoutMs'] == 30000
    assert 0 <= MS(report['finishedAt'])-MS(report['cleanup']['startedAt']) <= 30000
    assert MS(report['startup']['deadlineAt'])-MS(report['startup']['startedAt']) == 900000
    assert MS(report['finishedAt'])-MS(report['startup']['startedAt']) <= 1110000
    assert run['exit']['closed'] and run['exit']['watchdog'] is None and run['exit']['signal'] is None
    records = serial_records(report)
    command = 'XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -r eval \'hl.monitor({ output = "", mode = "640x400@60", position = "auto", scale = 1 })\''
    allowed = {command, *['XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j '+suffix for suffix in ['layers', 'clients', 'activewindow']]}
    assert all(row['command'] in allowed for row in records)
    commands = [row for row in records if row['command'] == command]
    assert len(commands) <= 1
    shots = {row['screenshot']: row for row in report['observations'] if 'screenshot' in row}
    for name, row in shots.items():
        assert identity(name)[1] == row['sha256']
    summary = dict(head=HEAD, reportSha256=SHA(raw), result=report['result'], runResult=run.get('result'),
        usablePair=run.get('usablePair'), keyboardTested=False, servedReceipts=len(report['resourceIdentities']),
        helpers=len(report['trial']['helpers']), workerEvents=len(report['workerTraffic']),
        workerCalls=dict(Counter(row['method'] for row in calls)), serial=records,
        screenshots=list(shots.values()), startup=report['startup'], cleanup=report['cleanup'],
        preparation=report.get('modePreparation'), mode=report.get('renderBudget'), compositor=report.get('compositorMode'))
    if report['result'] == 'prepared-mode-pair-input-untested':
        assert len(commands) == 1 and commands[0]['exit'] == 0 and commands[0]['stdout'].strip() == 'ok'
        prep = report['modePreparation']
        assert prep['status'] == 'pair-captured-input-untested' and prep['keyboardTested'] is False
        assert MS(prep['visibleAt']) < MS(report['startup']['deadlineAt'])
        assert MS(prep['exportDeadlineAt'])-MS(prep['exportStartedAt']) == 180000
        assert MS(prep['exportFinishedAt']) < MS(prep['exportDeadlineAt'])
        assert prep['foot']['address'] == prep['active']['address']
        assert prep['foot']['mapped'] and not prep['foot']['hidden'] and prep['foot']['class'] == 'foot'
        assert prep['lastPixels']['pixels']['nonblank']
        assert report['pair']['paused'] and report['pair']['restoreDecision'] == 'resume'
        for key in ['stats', 'settled']:
            persisted = report['capturePersistence'][key]
            assert persisted['pendingBlocks'] == 0 and not persisted['flushWaiting'] and not persisted['writeWaiting']
        seed = SHA((PINS['bootSnapshot'][1]+':'+PINS['overlayDelta'][1]).encode())
        assert report['captureOverlayStore'] == dict(seed=seed, name='wvov-'+report['pair']['base']+'-seed-'+seed)
        assert run['result'] == 'prepared-pair-awaiting-personal-image-verification' and run['usablePair'] is False
    else:
        assert report['result'] == 'failed' and report['modePreparation']['status'] == 'preparation-failed-input-untested'
        assert run['usablePair'] is False and run['result'] == 'preparation-failed-input-untested'
    return summary


if __name__ == '__main__':
    print(json.dumps(audit(Path(sys.argv[1])), indent=2))
