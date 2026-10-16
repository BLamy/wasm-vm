#!/usr/bin/env python3
"""Authenticate the compiler envelope's frozen-source native/wasm/GPU recording."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
TASK = 'E6-T12g6b'
SEEDS = [0x2317509d, 0x834baa1f, 0xfa1836c7]
ENVELOPE = dict(textBytes=49152, tokens=8192, glslBytes=262144, instructions=768,
                registerIndex=7, temporaryRegisterIndex=511, constantRegisterIndex=45,
                immediateRegisterIndex=31, conditionalDepth=16, lines=1536, lineBytes=512)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(value, label):
    if not value:
        raise ValueError(label)


def main():
    directory = Path(sys.argv[1]).resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    require(not subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=ROOT),
            'tracked sources must be frozen')
    sources, records = {}, {}

    def source(name, digest=None, size=None):
        raw = (ROOT / name).read_bytes()
        require(digest is None or sha(raw) == digest, 'source digest: ' + name)
        require(size is None or len(raw) == size, 'source byte count: ' + name)
        if not name.startswith('renderer/virgl-shader/build/'):
            require(raw == subprocess.check_output(['git', 'show', f'{head}:{name}'], cwd=ROOT),
                    'source differs from recorded commit: ' + name)
        value = dict(path=name, bytes=len(raw), sha256=sha(raw))
        require(name not in sources or sources[name] == value, 'inconsistent source: ' + name)
        sources[name] = value

    def artifact(name, digest=None):
        file = directory / name
        raw = file.read_bytes()
        require(digest is None or sha(raw) == digest, 'record digest: ' + name)
        records[name] = dict(path=name, bytes=len(raw), sha256=sha(raw))
        return raw

    def report(name, task=TASK, passed=True):
        value = json.loads(artifact(name))
        require(value['gitHead'] == head, 'report source head: ' + name)
        require(value['status'] == ('passed' if passed else 'failed'), 'report outcome: ' + name)
        if task is not None:
            require(value['task'] == task, 'report task: ' + name)
        for item in value.get('sources', []):
            source(item['path'], item['sha256'], item.get('size', item.get('bytes')))
        return value

    def browser(name, task=TASK, passed=True):
        value = report(name + '/report.json', task, passed)
        require(not value['trackedChanges'], 'browser frozen source: ' + name)
        require(value['browserErrors'] == dict(console=[], page=[], requests=[]), 'browser errors: ' + name)
        info = value['browser']
        require(info['launch']['headless'] is False and
                info['gpu']['featureStatus'][info['webglFeature']] == 'enabled', 'physical GPU: ' + name)
        screen = value.get('screenshot') or value.get('failureScreenshot')
        require(screen is not None, 'browser screenshot: ' + name)
        artifact(name + '/' + screen['path'], screen['sha256'])
        coverage = value['browserCoverage']
        data = json.loads(artifact(name + '/' + coverage['path'], coverage['sha256']))
        for script in data['scripts']:
            require(script['sha256'] == sources[script['source']]['sha256'], 'V8 source digest')
        for item in value['servedFiles']:
            require(item['path'] in sources and sources[item['path']]['sha256'] == item['sha256'],
                    'served file source binding')
        return value['acceptance']

    native = report('native/report.json')
    require(native['envelope'] == ENVELOPE and native['seeds'] == SEEDS, 'native envelope and schedules')
    require(len(native['cases']) == 603 and len(native['pairs']) == 23, 'complete native witnesses')
    require(len(native['allocationFaults']) == 752, 'all actual successful allocation sites')
    for case in native['cases']:
        require(sha(case['text'].encode()) == case['textSha256'], 'literal native input digest')
        require(type(case['result']['ok']) is bool and case['result']['ok'] == case['ok'], 'literal native admission')
    for fault in native['allocationFaults']:
        require(fault['result']['ok'] is False and
                not any(key in fault['result'] for key in ['glsl', 'vertex', 'fragment']), 'allocation failure is closed')
    for size in [111744, 433092, 207884, 262145]:
        require(any(f['requestedBytes'] == size for f in native['allocationFaults']), 'actual sized arena fault')
    require(native['layout'] == dict(ir=111744, profile=32440, flow=433092, frame=27068,
                raster=207884, conversion=33584, pairConversions=67168,
                singleResponse=1589248, pairResponse=3179520, rasterQueue=1024, laneBits=16, pcBits=16),
            'actual object layouts and integer widths')
    require(native['writers'] == dict(glslLimit=262144, singleWorstEscapedBytes=1572866,
                pairWorstEscapedBytes=3145732, shortCapacity=128, status='passed'), 'writer boundaries')
    artifact('native/cases.bin', native['fixtureSha256'])
    artifact('native/native.log', native['logSha256'])
    require(not artifact('native/native.stderr', native['stderrSha256']), 'sanitizer diagnostics')
    coverage = json.loads(artifact('native/coverage.json', native['coverageSha256']))
    executed = {function['name']: function['count'] for data in coverage['data'] for function in data['functions']}
    for name in ['validate_body', 'control', 'flow_snapshot', 'flow_join', 'raw_record', 'raster_graph',
                 'raw_certify_raster_outputs', 'raw_emit', 'bridge_translate_pair', 'writer_limits']:
        require(any(key.endswith(':' + name) or key == name for key, count in executed.items() if count),
                'owned boundary execution: ' + name)
    source(native['binary']['path'], native['binary']['sha256'], native['binary']['bytes'])
    wasm = report('wasm/report.json')
    require(wasm['nativeSha256'] == records['native/report.json']['sha256'] and
            wasm['envelope'] == ENVELOPE and len(wasm['cases']) == 603 and len(wasm['pairs']) == 23,
            'complete native/wasm equivalence')
    require(wasm['fixedMemory']['bytes'] == 16777216 and wasm['fixedMemory']['stackBytes'] == 262144 and
            wasm['fixedMemory']['exhausted']['ok'] is False and wasm['fixedMemory']['recovered'],
            'fixed wasm memory failure and recovery')
    require(wasm['wireEnvelope']['shaderTextBytes'] == 49152 and wasm['wireEnvelope']['shaderTokens'] == 8192,
            'wire envelope')
    retained = report('retained/report.json')
    require(len(retained['originals']) == 25 and len(retained['historical']) == 112, 'unchanged literal corpus')
    for original in retained['originals']:
        source(original['path'], original['sha256'], original['bytes'])
        require(original['native'] == original['wasm'], 'native/wasm complete original agreement')
        if original['sha256'].startswith('92cb866a'):
            require(original['old']['error']['code'] == 'input-too-large' and
                    original['native']['error']['code'] == 'unsupported-feature', 'explicit original size migration')
        else:
            require(original['native'] == original['old'], 'old literal emitted GLSL and metadata')
    require(sum(e['native']['ok'] for e in retained['originals']) == 23, 'two full originals still rejected')
    require([e['name'] for e in retained['historical'] if not e['old']['ok'] and e['native']['ok']] ==
            ['oversized-temp-range'], 'single explicit historical capacity admission')
    require(retained['oldBinary']['archiveSha256'] ==
            '9941036d869021078ce41f67e219b568c24a5b00294598dba4b6873c67b3af6e', 'authenticated parent compiler')
    artifact('retained/parent-native', retained['oldBinary']['sha256'])

    stack = []
    for filename in ['stack/native.su', 'stack/bridge.su', 'stack/raw_bits.su']:
        rows = []
        for line in artifact(filename).decode().splitlines():
            location, size, kind = line.split('\t')
            rows.append(dict(location=location, bytes=int(size), kind=kind))
        stack.append(dict(path=filename, frames=rows, largestFrameBytes=max(row['bytes'] for row in rows)))
    wasm_sum = sum(row['bytes'] for table in stack[1:] for row in table['frames'])
    require(wasm_sum < 262144 and all(row['kind'] == 'static' for table in stack[1:] for row in table['frames']),
            'sum of all nonrecursive owned wasm frames fits fixed stack')

    old_native = report('retained-f6-native/report.json', task=None)
    old_wasm = report('retained-f6-wasm/report.json', task=None)
    require(len(old_native['originals']) == 19 and len(old_native['pairs']) == 88 and
            sum(e['ok'] for e in old_native['pairs']) == 57, 'old F6 pair regression')
    require(old_wasm['nativeSha256'] == records['retained-f6-native/report.json']['sha256'] and
            old_wasm['memory'] == dict(initialBytes=16777216, finalBytes=16777216, sameBuffer=True), 'F6 wasm retention')
    old_gpu = browser('retained-f6-gpu', 'E6-T12f6')
    require(len(old_gpu['originals']) == 19 and len(old_gpu['pairs']) == 88, 'physical original F6 retention')
    provenance = report('gears-provenance.json', task=None)
    require(len(provenance['originals']) == 6, 'G1 authenticated literal originals')
    compiler = report('gears-compiler.json', task=None)
    require([e['result']['ok'] for e in compiler['originals']] == [True, True, True, False, True, False, True],
            'four G6a originals and unsupported original partition')
    gears = browser('retained-gears-gpu', 'E6-T12g6a')
    require(gears['checkedVertexWords'] == 864 and gears['checkedPixels'] == 9216, 'physical G6a original retention')
    words = pixels = 0
    for seed in SEEDS:
        gpu = browser('gpu-' + str(seed))
        require(gpu['seed'] == seed and gpu['fault'] is None and gpu['envelope'] == ENVELOPE and
                gpu['checkedWords'] == 3456 and gpu['checkedPixels'] == 27648 and gpu['objects']['live'] == 0,
                'physical envelope oracle and disposal')
        for vertex in gpu['vertices']:
            require(len(vertex['vectors']) == 48, 'varied hardware predecessors')
            for vector in vertex['vectors']:
                raw = bytes(vector['bytes'])
                require(sha(raw) == vector['sha256'] and len(raw) == 32, 'raw feedback bytes')
                actual = [int.from_bytes(raw[i:i+4], 'little') for i in range(0, 32, 4)]
                require(actual == vector['observed'] == vector['expectedWords'], 'independent exact physical words')
                require(len(vector['checks']) == 8, 'all feedback lanes compared')
        for fragment in gpu['fragments']:
            require(len(fragment['draws']) == 48, 'varied hardware fragment inputs')
            for draw in fragment['draws']:
                raw = bytes(draw['rgbaBytes'])
                require(len(raw) == 256 and sha(raw) == draw['sha256'] and draw['checkedPixels'] == 64,
                        'raw fragment bytes')
                require(all(abs(value - draw['expectedBytes'][i % 4]) <= 1 for i, value in enumerate(raw)),
                        'independent physical pixels')
        words += gpu['checkedWords']; pixels += gpu['checkedPixels']
    faults = []
    for mode in ['high-register', 'branch-join', 'counter']:
        gpu = browser('fault-' + mode, passed=False)
        require(gpu['fault'] == mode and 'independent bound word mismatch' in gpu['failure']['message'] and
                gpu['objects']['live'] == 0, 'physical fault caught and objects disposed')
        mutations = [v for v in gpu['vertices'] if v['mutation']]
        require(len(mutations) == 1 and mutations[0]['mutation']['matches'] > 0, 'one physical source fault')
        mutation = mutations[0]['mutation']
        point = next(v for v in mutations[0]['vectors'] if 'failure' in v)
        require(mutation['original'] != mutation['served'] and point['failure']['expected'] != point['failure']['actual'],
                'fault actually changes independent readback')
        faults.append(dict(mode=mode, name=mutations[0]['name'], vector=point['vector']['name'],
                           failure=point['failure'], sourceSha256=sha(mutation['original'].encode()),
                           servedSha256=sha(mutation['served'].encode())))

    paths = subprocess.check_output(['git', 'ls-files', 'renderer/virgl-shader', 'renderer/virgl-command',
        'tools/virgl-compiler-bounds', 'tools/virgl-original-corpus', 'tools/virgl-gears-shaders',
        'tools/lib/virgl-browser-runner.mjs', 'tools/setup-virgl-emsdk.sh',
        'tools/verify-virgl-compiler-bounds.sh', 'Makefile', 'web/package-lock.json'], cwd=ROOT, text=True).splitlines()
    for name in paths:
        source(name)
    for name in ['renderer/virgl-shader/build/native/virgl-shader',
                 'renderer/virgl-shader/build/wasm/virgl-shader.mjs',
                 'renderer/virgl-shader/build/wasm/virgl-shader.wasm']:
        source(name)
    # Seal all diagnostic logs, raw native profiles and physical captures. The
    # acceptance log is still being written; seal.py authenticates its final bytes.
    for file in sorted(directory.rglob('*')):
        if file.is_file() and file.name not in ['receipt.json', 'acceptance.log']:
            artifact(str(file.relative_to(directory)))
    receipt = dict(schema='virgl-compiler-bounds-receipt-v1', task=TASK, status='passed', gitHead=head,
        guestExecution=False, productionNegotiation=False, envelope=ENVELOPE, nativeCases=603, pairs=23,
        allocationFailures=752, measuredLayout=native['layout'], writers=native['writers'], stack=stack,
        ownedWasmFrameSumBytes=wasm_sum, stackScope='sum of nonrecursive owned optimized frames; upstream/libc excluded',
        fixedMemory=wasm['fixedMemory'], retainedOriginals=25, retainedAdmissions=23,
        historicalAdmissionMigration='oversized-temp-range', checkedWords=words, checkedPixels=pixels,
        physicalOutputFaults=faults, sources=list(sources.values()), records=list(records.values()))
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'{TASK} receipt passed: {words} exact words / {pixels} pixels; {wasm_sum} owned wasm frame bytes')


if __name__ == '__main__':
    main()
