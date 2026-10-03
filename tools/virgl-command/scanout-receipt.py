#!/usr/bin/env python3
"""Bind retained scanout, native/Wasm parity and an actual cold desktop boot."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SOURCES = json.loads((ROOT / 'tools/virgl-command/scanout-sources.json').read_text())
SPEC = importlib.util.spec_from_file_location('submit_receipt', Path(__file__).with_name('submit-receipt.py'))
SUBMIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SUBMIT)
require, sha = SUBMIT.require, SUBMIT.sha
PARITY_KEYS = (*SUBMIT.PARITY_KEYS, 'scanoutCanonical', 'scanoutDigest')
IMAGE_SHA = '467306a5d842f95927c1f5823363271b55854517f6318576a6a137f5615a5c1e'
MANIFEST_SHA = '1be3c29945747184c3ed868f51add1829e97bfd3945f456d4676d5f035fb4827'
KERNEL_SHA = 'af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce'


def file_sha(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def parity(record):
    value = SUBMIT.parity(record)
    value.update({key: record[key] for key in PARITY_KEYS[-2:]})
    raw = bytes.fromhex(value['scanoutCanonical'])
    require(raw[:8] == b'WV3DSCN1' and len(raw) >= 65
            and sha(raw) == value['scanoutDigest'], 'scanout canonical digest mismatch')
    return value


def state(value, expected):
    raw = value['canonicalBytes']
    if isinstance(raw, dict):
        require(set(raw) == {str(i) for i in range(len(raw))}, 'noncontiguous state bytes')
        raw = [raw[str(i)] for i in range(len(raw))]
    raw = bytes(raw)
    require(raw[:8] == b'WV3DSCN1' and sha(raw) == value['digest'], 'scanout state digest mismatch')
    require(int.from_bytes(raw[8:16], 'little') == int(value['nextGeneration'], 16), 'scanout generation mismatch')
    for i, name in enumerate(('bindings', 'capturesAdmitted', 'capturesCompleted', 'capturesFailed',
                              'acceptedBytes', 'completedBytes')):
        n = int(value['counters'][name], 16)
        require(n == int.from_bytes(raw[16 + i * 8:24 + i * 8], 'little'), 'scanout counter encoding mismatch')
        require(n == expected[name], f'incorrect scanout counter: {name}')


def presentation(scanout, expected):
    for name, number in expected.items():
        require(scanout[name] == number, f'incorrect host scanout counter: {name}')
    require(scanout['activeCaptures'] == scanout['retainedFrames'] == 0, 'capture/frame ownership leak')
    presenter = scanout['presenter']
    require(presenter['pending'] == presenter['ownedBytes'] == 0 and not presenter['scheduled'],
            'presenter retained a completed frame')
    require(presenter['errors'] == [] and presenter['controller']['errors'] == [], 'unexpected presentation errors')
    for name in ('queued', 'drawn', 'superseded', 'cancelled', 'failed'):
        require(scanout[name] == presenter[name], f'host/presenter retirement mismatch: {name}')
    require(scanout['queued'] == sum(scanout[k] for k in ('drawn', 'superseded', 'cancelled', 'failed')),
            'accepted frames were not retired exactly once')
    drawn = [r for r in scanout['retirements'] if r['status'] == 'drawn']
    require(len(drawn) == scanout['drawn'] and all(r['presentation']['drawn'] is True
            and r['presentation']['replay'] is False for r in drawn), 'missing actual draw acknowledgement')
    actual_bytes = sum(r['presentation']['bytes'] for r in drawn)
    for name in ('controllerOwnershipCopyBytes', 'presentationUploadBytes',
                 'backendStagingCopyBytes', 'imageDataCopyBytes'):
        require(presenter[name] == actual_bytes, f'copy accounting mismatch: {name}')
    require(scanout['readbackBytes'] == scanout['rgbaConversionBytes'] == scanout['rowMoveBytes'],
            'readback/orientation conversion accounting mismatch')


def main():
    directory = Path(sys.argv[1]).resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    bound = []

    def record(file, expected=None):
        raw = (directory / file).read_bytes()
        digest = sha(raw)
        require(expected is None or digest == expected, f'evidence drift: {file}')
        bound.append({'path': str(file), 'bytes': len(raw), 'sha256': digest})
        return raw

    # Revalidate the nested receipt, including its exact-head source bindings.
    subprocess.run([sys.executable, str(ROOT / 'tools/virgl-command/submit-receipt.py'),
                    str(directory / 'submit-regression')], cwd=ROOT, check=True)
    regression = json.loads(record('submit-regression/receipt.json'))
    require(regression['status'] == 'passed' and regression['gitHead'] == head, 'B2 regression failed')
    report = json.loads(record('hardware/report.json'))
    require(report['task'] == 'E6-T11c' and report['gitHead'] == head
            and report['status'] == report['browserResult']['status'] == 'passed'
            and not report['trackedChanges'] and report['liveGuest3d'] is False,
            'wrong scanout task, head, scope or result')
    require(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'hardware browser errors')
    result = report['browserResult']['result']
    require(result['status'] == 'passed' and result['guestQueueReplay'] is True
            and result['guestExecution'] is False and result['productionVirgl'] is False,
            'isolated scanout scope mismatch')
    require(result['assertions'] > 0 and result['attacks'], 'missing assertions/attacks')
    browser = report['browser']
    require(browser['headless'] is False and browser['gpu']['featureStatus'][browser['webglFeature']] == 'enabled',
            'headed hardware WebGL required')
    require(not any(re.search(r'swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)', a, re.I)
                    for a in browser['commandLine']), 'software rendering flags')

    sources = {s['path']: s for s in report['sources']}
    require(len(sources) == len(report['sources']) and set(SOURCES) <= sources.keys(), 'missing/duplicate sources')
    for path, item in sources.items():
        raw = (ROOT / path).read_bytes()
        require(len(raw) == item['bytes'] and sha(raw) == item['sha256'], f'source drift: {path}')
        tracked = subprocess.run(['git', 'cat-file', '-e', f'{head}:{path}'], cwd=ROOT, capture_output=True).returncode == 0
        if tracked:
            require(raw == subprocess.check_output(['git', 'show', f'{head}:{path}'], cwd=ROOT), f'unfrozen source: {path}')
        else:
            require(path.startswith(('target/virgl-scanout/pkg/', 'renderer/virgl-shader/build/')),
                    f'uncommitted non-generated source: {path}')
    for item in report['inputs']:
        require(file_sha(ROOT / item['path']) == item['sha256'], 'capture input drift')
    require((ROOT / 'web/src/sink/virgl-scanout-presenter.js').read_bytes()
            == (ROOT / 'web/dist/src/sink/virgl-scanout-presenter.js').read_bytes(), 'built presenter is stale')

    original = result['original']
    require(original['event'] == 161 and original['packets'] == 39 and original['gpuDraws'] == 1
            and original['checkedPixels'] == 256
            and original['sourceSha256'] == '364452bac8463817df9b95ae07be7203ec8411bd6be08ab43029f7c69be028cc'
            and original['sha256'] == 'f079760e9fcffc2e01eed78bdc823536d545bcbcf7b6210b23eb847330d9252c',
            'captured GPU draw did not reach the actual canvas')
    literal = result['literal']
    require(literal['oracle']['bytes'] == [0,0,255,255,0,255,0,64,255,255,0,255,255,0,0,255,255,0,0,128,0,255,0,255]
            and sha(bytes(literal['oracle']['bytes'])) == literal['oracle']['sha256'], 'literal alpha/orientation oracle mismatch')
    for name, captures, queued, drawn, superseded, cancelled, size, copy2d in (
            ('literal', 1, 1, 1, 0, 0, 24, 0), ('scheduling', 5, 6, 3, 1, 2, 120, 8),
            ('immutable', 2, 2, 2, 0, 0, 48, 0)):
        presentation(result[name]['bridge']['scanout'], dict(captures=captures, captureReady=captures,
                     queued=queued, drawn=drawn, superseded=superseded, cancelled=cancelled, failed=0,
                     readbackBytes=size, borrowed2dCopyBytes=copy2d))
    presentation(original['scanout'], dict(captures=1, captureReady=1, queued=1, drawn=1,
                 superseded=0, cancelled=0, failed=0, readbackBytes=4096, borrowed2dCopyBytes=0))
    for name, bindings, captures, size in (('literal', 2, 1, 24), ('scheduling', 5, 5, 120)):
        state(result[name]['scanoutState'], dict(bindings=bindings, capturesAdmitted=captures,
              capturesCompleted=captures, capturesFailed=0, acceptedBytes=size, completedBytes=size))
        require(int(result[name]['frameDiagnostics']['rejected'], 16) == 0, '2D callback failure')
    require({v['mode'] for v in result['faults']} == {
        'pending-reset', 'queued-reset', 'pending-dispose', 'allocation-failure', 'wait-failure'}, 'missing failure controls')
    require(result['presenter']['trustedFaultControls'] == ['failed', 'failed'], 'no-draw/throw falsely retired as drawn')
    require([v['issued'] for v in result['direct']] == [False, True]
            and all(v['scanout']['activeCaptures'] == v['scanout']['queued'] == 0 for v in result['direct']),
            'capture cancellation before/after GPU issue missing')
    require(result['webglPresenter'] == dict(retirements=['drawn'], webglCorners=4,
            recoveryAfterInvalidation='blank'), 'WebGL presentation or stale recovery pixels regressed')
    for name in ('clippy-scanout', 'native-scanout', 'presentation', 'wasm-proof'):
        raw = record(name + '.log')
        require(raw, f'empty gate log: {name}')
        if name == 'native-scanout':
            require(b'test result: ok. 6 passed; 0 failed' in raw, 'native scanout tests failed')
    native = [parity(v) for v in SUBMIT.records((directory / 'native-scanout.log').read_text(), 'SCANOUT3D_PORTABLE_RECORD ')]
    wasm = [parity(v) for v in result['portableRecords']]
    require(len(native) == 12 and native == wasm, 'native/Wasm request, response, ring or state mismatch')
    require(native[-1]['scanoutDigest'] == '52dc6136cdf7dc062e49df5a7fe054b4ef3ca396171b93d5eb4ffed34e881170', 'portable final digest mismatch')
    (directory / 'native-browser-parity.json').write_text(json.dumps(
        {'schema': 1, 'status': 'passed', 'comparedFields': PARITY_KEYS, 'records': native}, indent=2) + '\n')
    record('native-browser-parity.json')

    for name in ('hardware', 'sabotage-orientation'):
        current = report if name == 'hardware' else json.loads(record(name + '/report.json'))
        require(current['gitHead'] == head and current['sources'] == report['sources']
                and current['inputs'] == report['inputs'], 'orientation control source/input drift')
        require(sha(SUBMIT.compact(current['browserResult'])) == current['browserResultSha256'], 'browser result digest mismatch')
        mutation = current.get('sabotage')
        if mutation:
            require(current['status'] == current['browserResult']['status'] == 'failed'
                    and 'scanout canvas top-left RGBA' in current['browserResult']['error']['message'], 'wrong orientation failure oracle')
            require(mutation['mode'] == 'orientation' and mutation['path'] == 'renderer/virgl-command/scanout.mjs'
                    and mutation['originalSha256'] == sources[mutation['path']]['sha256']
                    and mutation['servedSha256'] != mutation['originalSha256'], 'no real orientation source mutation')
        else:
            require(name == 'hardware', 'missing orientation mutation')
        served = {v['path']: v for v in current['servedFiles']}
        require(len(served) == len(current['servedFiles']), 'duplicate served sources')
        for path in ('renderer/virgl-command/scanout.mjs', 'renderer/virgl-command/resources.mjs',
                     'renderer/virgl-command/control-bridge.mjs', 'renderer/virgl-command/tests/scanout-acceptance.mjs',
                     'web/dist/src/sink/virgl-scanout-presenter.js', 'web/dist/src/sink/presentation.js',
                     'target/virgl-scanout/pkg/wasm_vm_wasm.js', 'target/virgl-scanout/pkg/wasm_vm_wasm_bg.wasm'):
            expected = mutation['servedSha256'] if mutation and mutation['path'] == path else sources[path]['sha256']
            require(served['/' + path]['sha256'] == expected, f'wrong served source: {path}')
        require(served['/fixtures.json']['sha256'] == report['fixturesSha256'], 'served fixture drift')
        for key in ('browserCoverage', 'screenshot' if name == 'hardware' else 'failureScreenshot'):
            item = current[key]
            record(name + '/' + item['path'], item['sha256'])

    desktop = json.loads(record('desktop/report.json'))
    require(desktop['schema'] == 'wasm-vm.virgl-scanout-desktop.v1' and desktop['task'] == 'E6-T11c'
            and desktop['gitHead'] == desktop['gitHeadAfter'] == head and desktop['status'] == 'passed', 'wrong desktop run')
    require(all(not v for v in desktop['errors'].values()) and desktop['proofExports'] == [], 'desktop errors/proof exports')
    require(desktop['scope'] == dict(guestExecution=True, productionVirgl=False,
            desktop3dAcceleration=False, unchanged2dDesktop=True), 'desktop scope mismatch')
    require(desktop['acceptance'] == dict(runCount=1, freshContexts=1, headed=True, cacheDisabled=True,
            serviceWorkers='block', noSerialInput=True, warmBoots=0), 'desktop is not a single cold boot')
    require(desktop['servedWasmSha256'] == sources['web/dist/pkg/wasm_vm_wasm_bg.wasm']['sha256'], 'wrong desktop Wasm')
    image = desktop['image']
    require(image['unchanged'] and image['before'] == image['after'] and image['before']['sha256'] == IMAGE_SHA
            and image['before']['bytes'] == 1073741824 and file_sha(image['before']['path']) == IMAGE_SHA, 'desktop image drift')
    manifest = desktop['manifest']
    require(manifest['sha256'] == manifest['after']['sha256'] == MANIFEST_SHA
            and file_sha(manifest['path']) == MANIFEST_SHA and manifest['chunkCount'] == 8192, 'desktop manifest drift')
    require(desktop['kernel']['sha256'] == KERNEL_SHA and file_sha(desktop['kernel']['path']) == KERNEL_SHA, 'kernel drift')
    chunks = 0
    for item in [desktop['harness'], *desktop['served']]:
        require(item['unchanged'] and file_sha(item['path']) == item['sha256']
                and Path(item['path']).stat().st_size == item['bytes'], 'served desktop input drift')
        if 'gitPath' in item:
            require(item['matchesGitHead'] and item['headSha256'] == item['sha256']
                    and sha(subprocess.check_output(['git', 'show', f"{head}:{item['gitPath']}"], cwd=ROOT)) == item['sha256'],
                    'desktop source is not frozen at Git head')
        if item.get('kind') == 'chunk':
            chunks += 1
            require(item['manifestIndices'] and Path(item['path']).stem == item['sha256'], 'non-content-addressed chunk')
    require(chunks > 0, 'desktop did not fetch its root disk')
    proof = desktop['proof']
    require(proof['paused'] and re.fullmatch('[0-9a-f]{64}', proof['stateDigest'])
            and proof['readiness']['wallpaper'] and proof['readiness']['panel']['ready'] and proof['readiness']['menu']
            and proof['frameCount'] > 0 and proof['presentation']['drawnPresents'] > 0
            and proof['presentation']['errors'] == [] and proof['selectedBackend'] == 'canvas2d'
            and proof['fetchStats']['fetches'] > 0 and proof['scheduler']['retiredInstructions'] > 0,
            'desktop guest did not execute and actually present')
    require(desktop['canvas']['width'] == 1280 and desktop['canvas']['height'] == 800
            and desktop['canvas']['bytes'] == 4096000 and re.fullmatch('[0-9a-f]{64}', desktop['canvas']['sha256']), 'missing canvas capture')
    require(desktop['serial']['sha256'] == proof['serialSha256'] and desktop['serial']['bytes'] == proof['serialBytes']
            and not desktop['serial']['overflow'] and desktop['serial']['workerCount'] == 1, 'passive serial observer mismatch')
    for key in ('serial', 'screenshot', 'transcript'):
        item = desktop[key]
        record('desktop/' + item['path'], item['sha256'])
    receipt = dict(schema=1, task='E6-T11c', gitHead=head, status='passed', portableRecords=12,
                   boundary='proof-only retained GPU scanout with separately acknowledged canvas paint; ordinary cold 2D desktop regression',
                   sources=report['sources'], inputs=report['inputs'], records=bound)
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'E6-T11c receipt passed: 12 exact native/Wasm records, {chunks} verified desktop chunks, {len(bound)} evidence bindings')


if __name__ == '__main__':
    main()
