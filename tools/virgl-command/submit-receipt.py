#!/usr/bin/env python3
"""Bind exact source, native/Wasm queue parity and hardware guest-DMA evidence."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SOURCES = json.loads((ROOT / 'tools/virgl-command/submit-sources.json').read_text())
LOGS = ('format', 'clippy-default', 'clippy-submit', 'clippy-wasm', 'native-submit',
        'native-control', 'native-virtio', 'native-bus', 'native-machine', 'wasm-core-default',
        'wasm-default', 'wasm-gpu-protocol', 'wasm-control-proof', 'wasm-proof', 'shader-build')
PARITY_KEYS = ('case', 'request', 'response', 'usedIndex', 'ring', 'transportCanonical',
               'transportDigest', 'submitCanonical', 'submitDigest')
CONTROLS = {
    'early-collect': 'async CPU collection requires a signaled fence',
    'early-completion': 'completion is posted only after all GPU fences retire',
}
FRAME_HASHES = [
    'f244dc2a7a61960cbad1f603961e4f324ec4f444367ca589744b3e60531f22e9',
    '1d754556e8e0abc93bf12d0c6a44ffdbb6fe925dc7c96dbb8c30474d372d16ae',
    '62f04d5e21e789af6ef74af17498e36c8bbb45788f296124fd64c80832751061',
]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def records(log, marker):
    return [json.loads(line.split(marker, 1)[1]) for line in log.splitlines() if marker in line]


def parity(value):
    result = {key: value[key] for key in PARITY_KEYS}
    for key in ('request', 'response', 'transportCanonical', 'submitCanonical'):
        require(isinstance(result[key], str) and re.fullmatch(r'(?:[0-9a-f]{2})+', result[key]),
                f'invalid canonical hex: {key}')
    for name in ('transport', 'submit'):
        require(sha(bytes.fromhex(result[name + 'Canonical'])) == result[name + 'Digest'],
                f'{name} digest does not describe canonical bytes')
    require(len(result['response']) == 48, 'portable response must contain its complete header')
    require(type(result['usedIndex']) is int and 0 < result['usedIndex'] <= 65535,
            'invalid portable used index')
    require(result['ring'].keys() == {'descriptors', 'avail', 'used'}, 'missing raw ring bytes')
    for value in result['ring'].values():
        require(isinstance(value, str) and re.fullmatch(r'(?:[0-9a-f]{2})+', value), 'invalid ring hex')
    return result


def completed_state(state, expected):
    require(state['pending'] is None, 'completed fixture retained a pending guest head')
    value = state['canonicalBytes']
    if isinstance(value, dict):
        require(set(value) == {str(i) for i in range(len(value))}, 'noncontiguous typed-array encoding')
        value = [value[str(i)] for i in range(len(value))]
    raw = bytes(value)
    require(sha(raw) == state['digest'] and raw[:8] == b'WV3DSUB2' and len(raw) == 97
            and raw[96] == 0, 'completed transport state digest/layout mismatch')
    keys = ('admitted', 'completed', 'cancelled', 'fenced', 'submissionBytes',
            'inputBytes', 'outputBytes', 'exchanges', 'appliedCommands', 'draws')
    require(int.from_bytes(raw[8:16], 'little') == int(state['nextSequence'], 16), 'sequence encoding mismatch')
    for index, key in enumerate(keys):
        number = int(state['counters'][key], 16)
        require(number == int.from_bytes(raw[16 + 8*index:24 + 8*index], 'little'), 'counter encoding mismatch')
        if key in expected:
            require(number == expected[key], f'wrong completion counter: {key}')


def main():
    directory = Path(sys.argv[1]).resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    bound = []

    def record(file, expected=None):
        path = directory / file
        raw = path.read_bytes()
        digest = sha(raw)
        require(expected is None or digest == expected, f'evidence drift: {file}')
        bound.append({'path': str(file), 'bytes': len(raw), 'sha256': digest})
        return raw

    report = json.loads(record('hardware/report.json'))
    require(report['task'] == 'E6-T11b2' and report['gitHead'] == head, 'wrong task or head')
    require(report['status'] == 'passed' and report['browserResult']['status'] == 'passed',
            'hardware acceptance did not pass')
    require(not report['trackedChanges'], 'runtime or harness changed outside frozen commit')
    require(report['liveGuest3d'] is False, 'isolated queue proof is not live Mesa acceleration')
    require(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser errors')
    result = report['browserResult']['result']
    require(result['status'] == 'passed' and result['guestQueueReplay'] is True
            and result['guestExecution'] is False and result['productionVirgl'] is False,
            'queue replay scope or result mismatch')
    require(result['assertions'] > 0 and result['attacks'], 'missing acceptance assertions or attacks')
    original = result['original']
    require(original['packetCount'] == 210 and original['gpuDraws'] == 3
            and original['checkedPixels'] == 768 and len(original['submissions']) == 8,
            'original captured scene was not fully replayed')
    require([frame['sha256'] for frame in original['frames']] == FRAME_HASHES,
            'actual guest readback pixels changed')
    require(result['outputReferencePoison']['bytes'] == 12288
            and result['outputReferencePoison']['hashes'] == FRAME_HASHES,
            'reference output bytes influenced actual rendering')
    completed_state(original['submitState'], {
        'admitted': 8, 'completed': 8, 'cancelled': 0, 'fenced': 8,
        'submissionBytes': 42380, 'inputBytes': 92, 'outputBytes': 12288,
        'exchanges': 6, 'appliedCommands': 210, 'draws': 3,
    })
    ordered = result['ordered']
    require(ordered['queuedCommands'] == 101 and ordered['gpuDraws'] == 100
            and ordered['maximumPending'] == 1 and ordered['heartbeats'] > 0,
            'ordered queue did not execute100 draws and then destroy with browser progress')
    require(ordered['fences'] == ['0000000000000000', 'ffffffffffffffff',
            '0000000000000007', '0000000000000007', '0020000000000001', '0000000000000001'],
            'full-width duplicate/nonmonotonic fence inputs missing')
    completed_state(ordered['submitState'], {
        'admitted': 101, 'completed': 101, 'cancelled': 0, 'fenced': 100,
        'inputBytes': 92, 'outputBytes': 0, 'exchanges': 3,
        'appliedCommands': 139, 'draws': 101,
    })
    for fixture in (original, ordered):
        trace = fixture['commandTrace']
        require(int(trace['dropped'], 16) == 0 and trace['records'], 'guest command trace was truncated')
        require([entry['usedIndex'] for entry in trace['records']] == list(range(1, len(trace['records']) + 1)),
                'guest trace contains skipped or duplicated completions')
    require(result['minimal']['splitPixel'] is True and result['minimal']['memoryGrowth'] is True
            and result['minimal']['denseBytes'] == 64 and result['minimal']['dirtyRows'] == 4,
            'fresh SG/padded rows/Wasm memory-growth proof missing')
    require(int(result['commandTrace']['cursorCommands'], 16) > 0, 'pending control work blocked cursor progress')
    faults = result['postScatterFaults']
    require({entry['fault'] for entry in faults} == {'throw-after-scatter', 'ack-after-backing-revocation'},
            'uncertain output failure controls missing')
    for entry in faults:
        completion = entry['completion']
        require(completion[3] == 6 and completion[4] is False and completion[6] == 1,
                'uncertain output claimed GPU completion or lost its successful draw prefix')
        completed_state(entry['submitState'], {'admitted': 1, 'completed': 1, 'draws': 1,
                        'outputBytes': 4096, 'exchanges': 4})
    gpu_failure = result['uncertainGpuFailure']
    require(gpu_failure['trustedFaultControl'] is True
            and gpu_failure['completion'][3:5] == [6, False]
            and gpu_failure['error']['code'] == 'backend-error',
            'uncertain GPU failure did not preserve its diagnostic and fail closed')
    dma = result['orderedDma']
    require(dma['contexts'] == [2, 3] and dma['oldResource']['id'] == dma['newResource']['id']
            and dma['oldResource']['generation'] != dma['newResource']['generation'],
            'interleaved contexts and resource reuse proof missing')
    browser = report['browser']
    require(browser['headless'] is False and browser['gpu']['featureStatus'][browser['webglFeature']] == 'enabled',
            'headed hardware WebGL is required')
    require(not any(re.search(r'swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)', arg, re.I)
                    for arg in browser['commandLine']), 'software rendering flags')
    sources = {item['path']: item for item in report['sources']}
    require(len(sources) == len(report['sources']) and set(SOURCES) <= sources.keys(), 'missing or duplicate source bindings')
    require('target/virgl-submit/pkg/wasm_vm_wasm_bg.wasm' in sources, 'missing proof Wasm artifact')
    for item in report['sources']:
        raw = (ROOT / item['path']).read_bytes()
        require(len(raw) == item['bytes'] and sha(raw) == item['sha256'], f"source drift: {item['path']}")
        tracked = subprocess.run(['git', 'cat-file', '-e', f"{head}:{item['path']}"], cwd=ROOT,
                                 capture_output=True).returncode == 0
        if tracked:
            committed = subprocess.check_output(['git', 'show', f"{head}:{item['path']}"], cwd=ROOT)
            require(committed == raw, f"source does not match frozen Git head: {item['path']}")
        else:
            require(item['path'].startswith(('target/virgl-submit/pkg/', 'renderer/virgl-shader/build/')),
                    f"uncommitted non-generated source: {item['path']}")
    for item in report['inputs']:
        raw = (ROOT / item['path']).read_bytes()
        require(sha(raw) == item['sha256'], f"reference input drift: {item['path']}")

    for name in LOGS:
        raw = record(f'{name}.log')
        require(raw or name == 'format', f'empty {name} log')
        if name.startswith('native-') or name == 'wasm-gpu-protocol':
            require(b'test result: ok.' in raw and b'FAILED' not in raw, f'{name} tests failed')
    native = [parity(item) for item in records((directory / 'native-submit.log').read_text(), 'SUBMIT3D_PORTABLE_RECORD ')]
    wasm = [parity(item) for item in result['portableRecords']]
    require(len(native) == 8 and native == wasm, 'native/Wasm request, response, ring or state parity failed')
    parity_report = {'schema': 1, 'status': 'passed', 'comparedFields': PARITY_KEYS, 'records': native}
    (directory / 'native-browser-parity.json').write_text(json.dumps(parity_report, indent=2) + '\n')
    record('native-browser-parity.json')

    legacy = json.loads(record('control-regression/report.json'))
    require(legacy['gitHead'] == head and legacy['status'] == 'passed'
            and legacy['browserResult']['status'] == 'passed'
            and legacy['browserErrors'] == {'console': [], 'page': [], 'requests': []},
            'synchronous control regression failed')
    legacy_result = legacy['browserResult']['result']
    require(legacy_result['status'] == 'passed'
            and all(n == 0 for n in legacy_result['summary']['finalLiveGL'].values()),
            'synchronous factory leaked GPU owners')
    control_keys = PARITY_KEYS[:-2]
    native_control = [{key: r[key] for key in control_keys} for r in records(
        (directory / 'native-control.log').read_text(), 'CONTROL3D_PORTABLE_RECORD ')]
    browser_control = [{key: r[key] for key in control_keys} for r in legacy_result['portableRecords']]
    require(len(native_control) == 27 and native_control == browser_control,
            'synchronous native/Wasm control parity regressed')
    for item in legacy['sources']:
        raw = (ROOT / item['path']).read_bytes()
        require(len(raw) == item['bytes'] and sha(raw) == item['sha256'],
                f"synchronous regression source drift: {item['path']}")
        if item['path'] in sources:
            require(item == sources[item['path']], 'shared control/submit source mismatch')
    record(f"control-regression/{legacy['browserCoverage']['path']}", legacy['browserCoverage']['sha256'])
    record(f"control-regression/{legacy['screenshot']['path']}", legacy['screenshot']['sha256'])

    for name in ('hardware', *(f'sabotage-{mode}' for mode in CONTROLS)):
        current = report if name == 'hardware' else json.loads(record(f'{name}/report.json'))
        require(current['task'] == 'E6-T11b2' and current['gitHead'] == head, 'browser run task/head drift')
        require(current['sources'] == report['sources'] and current['inputs'] == report['inputs'],
                'browser controls used different original source or fixture bytes')
        require(sha(compact(current['browserResult'])) == current['browserResultSha256'], 'browser result digest mismatch')
        mutation = None
        if name != 'hardware':
            mode = name.removeprefix('sabotage-')
            require(current['status'] == 'failed' and current['browserResult']['status'] == 'failed'
                    and CONTROLS[mode] in current['browserResult']['error']['message'],
                    f'{mode} omission failed outside its intended oracle')
            mutation = current['sabotage']
            require(mutation['mode'] == mode and mutation['path'] in sources
                    and mutation['originalSha256'] == sources[mutation['path']]['sha256']
                    and mutation['servedSha256'] != mutation['originalSha256'], 'no actual source omission')
        served = {item['path']: item for item in current['servedFiles']}
        require(len(served) == len(current['servedFiles']), 'duplicate served source')
        for path in ('renderer/virgl-command/control-bridge.mjs', 'renderer/virgl-command/resources.mjs',
                     'renderer/virgl-command/state.mjs', 'renderer/virgl-command/tests/submit-acceptance.mjs',
                     'target/virgl-submit/pkg/wasm_vm_wasm.js', 'target/virgl-submit/pkg/wasm_vm_wasm_bg.wasm'):
            expected = mutation['servedSha256'] if mutation and mutation['path'] == path else sources[path]['sha256']
            require('/' + path in served and served['/' + path]['sha256'] == expected, f'wrong served bytes: {path}')
        require(served['/fixtures.json']['sha256'] == report['fixturesSha256'], 'served fixture drift')
        record(f"{name}/{current['browserCoverage']['path']}", current['browserCoverage']['sha256'])
        capture = current['screenshot'] if name == 'hardware' else current['failureScreenshot']
        record(f"{name}/{capture['path']}", capture['sha256'])

    demo = json.loads(record('default-demo/report.json'))
    require(demo['task'] == 'E6-T11b2' and demo['gitHead'] == head and demo['status'] == 'passed'
            and demo['passed'] == 127 and demo['failed'] == 0 and demo['errors'] == []
            and demo['proofExportAbsent'] is True and re.search(r'\blive\b', demo['roadmapPip']),
            'ordinary built demo regression')
    require(demo['servedWasmSha256'] == sources['web/dist/pkg/wasm_vm_wasm_bg.wasm']['sha256'],
            'ordinary demo did not serve bound shipped Wasm')
    for item in demo['served']:
        require(item['path'].startswith('web/dist/'), 'ordinary demo served non-dist source')
        raw = (ROOT / item['path']).read_bytes()
        require(len(raw) == item['bytes'] and sha(raw) == item['sha256'], 'ordinary demo source drift')
    record(f"default-demo/{demo['screenshot']['path']}", demo['screenshot']['sha256'])
    receipt = {'schema': 1, 'task': 'E6-T11b2', 'gitHead': head, 'status': 'passed',
               'boundary': 'isolated guest queue, actual GPU execution and RAM DMA; production 3D disabled',
               'portableRecords': len(native), 'sources': report['sources'], 'inputs': report['inputs'],
               'records': bound}
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f"E6-T11b2 receipt passed: {len(native)} exact native/Wasm records, {len(bound)} bound evidence files")


if __name__ == '__main__':
    main()
