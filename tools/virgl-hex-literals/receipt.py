#!/usr/bin/env python3
"""Bind literal inputs, primary tokens and independent hardware words to frozen sources."""
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
TASK = 'E6-T12g6c'
SEEDS = [0x34a8c291, 0x98217ef3, 0xe6194bd7]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def main():
    directory = Path(sys.argv[1]).resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    require(not subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=ROOT), 'freeze tracked sources')
    sources, records = {}, {}

    def source(name, digest=None, size=None):
        raw = (ROOT / name).read_bytes()
        require(digest is None or sha(raw) == digest, 'source digest: ' + name)
        require(size is None or len(raw) == size, 'source bytes: ' + name)
        if not name.startswith('renderer/virgl-shader/build/'):
            require(raw == subprocess.check_output(['git', 'show', f'{head}:{name}'], cwd=ROOT), 'committed source: ' + name)
        row = dict(path=name, bytes=len(raw), sha256=sha(raw))
        require(name not in sources or sources[name] == row, 'consistent source: ' + name)
        sources[name] = row

    def artifact(name, digest=None):
        raw = (directory / name).read_bytes()
        require(digest is None or sha(raw) == digest, 'record digest: ' + name)
        records[name] = dict(path=name, bytes=len(raw), sha256=sha(raw))
        return raw

    def report(name, task=TASK, passed=True):
        value = json.loads(artifact(name))
        require(value['gitHead'] == head and value['status'] == ('passed' if passed else 'failed'), 'report outcome/head: ' + name)
        require(task is None or value['task'] == task, 'task: ' + name)
        for row in value.get('sources', []):
            source(row['path'], row['sha256'], row.get('size', row.get('bytes')))
        return value

    def browser(name, passed=True):
        value = report(name + '/report.json', passed=passed)
        require(not value['trackedChanges'], 'frozen browser sources')
        require(value['browserErrors'] == dict(console=[], page=[], requests=[]), 'browser errors')
        info = value['browser']
        require(info['launch']['headless'] is False and info['gpu']['featureStatus'][info['webglFeature']] == 'enabled', 'headed physical GPU')
        capture = value.get('screenshot') or value.get('failureScreenshot')
        artifact(name + '/' + capture['path'], capture['sha256'])
        coverage = value['browserCoverage']
        v8 = json.loads(artifact(name + '/' + coverage['path'], coverage['sha256']))
        for row in v8['scripts']:
            require(row['sha256'] == sources[row['source']]['sha256'], 'V8 source binding')
        for row in value['servedFiles']:
            require(sources[row['path']]['sha256'] == row['sha256'], 'served source binding')
        acceptance = value['acceptance']
        require(acceptance['guestExecution'] is False and acceptance['productionNegotiation'] is False and acceptance['objects']['live'] == 0, 'isolated disposed hardware')
        return acceptance

    native = report('native/report.json')
    require(len(native['cases']) == 676 and native['primaryComparisons'] == 512 and native['seeds'] == SEEDS, 'complete literal table')
    for case in native['cases']:
        require(sha(case['text'].encode()) == case['textSha256'], 'literal source words')
        require(type(case['result']['ok']) is bool and case['result']['ok'] == case['ok'], 'literal admission')
        if case['immediates'] is not None:
            require(case['primary']['immediates'] == case['immediates'], 'primary TGSI literal words')
        if case['equivalent'] is not None:
            alternate = case['equivalentResult']
            require(type(alternate['ok']) is bool and alternate['ok'] == case['ok'], 'prior UINT32 domain')
            if case['equivalentMode'] == 'exact':
                require(case['result'] == alternate, 'raw UINT32 exact emitted result')
            else:
                require(case['result']['metadata'] == alternate['metadata'], 'legacy equivalent metadata')
        if not case['ok']:
            require('glsl' not in case['result'], 'closed rejection')
    artifact('native/cases.bin', native['fixtureSha256'])
    artifact('native/native.log', native['logSha256'])
    require(not artifact('native/native.stderr', native['stderrSha256']), 'sanitizer diagnostics')
    artifact('native/coverage.json', native['coverageSha256'])
    source(native['binary']['path'], native['binary']['sha256'], native['binary']['bytes'])
    wasm = report('wasm/report.json')
    require(wasm['nativeSha256'] == records['native/report.json']['sha256'], 'Wasm binds native')
    require(len(wasm['cases']) == len(native['cases']) == len(wasm['pairs']), 'public calls complete')
    for expected, observed, pair in zip(native['cases'], wasm['cases'], wasm['pairs']):
        require(observed['index'] == pair['index'] == expected['index'] and observed['result'] == expected['result'] and pair['result']['ok'] == expected['ok'], 'public literal parity and pairs')
    retained = report('retained/report.json', task='E6-T12g6b')
    require(len(retained['originals']) == 25 and sum(c['native']['ok'] for c in retained['originals']) == 23, 'original partition unchanged')
    require(len(retained['historical']) == 112 and sum(c['native']['ok'] for c in retained['historical']) == 5, 'historical grammar unchanged')
    joins = json.loads(artifact('independent-joins.json'))
    require(joins['status'] == 'passed' and joins['cases'] == joins['native'] == joins['wasm'] == 402, 'promoted bounds guards')

    words = pixels = 0
    for seed in SEEDS:
        gpu = browser('gpu-' + str(seed))
        require(gpu['seed'] == seed and gpu['fault'] is None and len(gpu['vertices']) == 278 and len(gpu['fragments']) == 324, 'varied physical witnesses')
        require(gpu['checkedWords'] == 13344 and gpu['checkedPixels'] == 5184, 'physical counts')
        for vertex in gpu['vertices']:
            require(sha(vertex['text'].encode()) == vertex['textSha256'] and len(vertex['vectors']) == 4, 'physical literal source and predecessors')
            literal = vertex['words']
            for vector in vertex['vectors']:
                raw = bytes(vector['bytes'])
                require(len(raw) == 48 and sha(raw) == vector['sha256'], 'feedback bytes')
                actual = list(struct.unpack('<12I', raw))
                wanted = [struct.unpack('<I', struct.pack('<f', x))[0] for x in vector['position']]
                wanted += [(x & 0x7fffff) | 0x3f000000 for x in literal] + [(x >> 23) | 0x3f000000 for x in literal]
                require(actual == vector['observed'] == vector['expectedWords'] == wanted and vector['checkedWords'] == 12, 'independent exact hardware words')
                reconstructed = [((actual[8+i] & 511) << 23) | (actual[4+i] & 0x7fffff) for i in range(4)]
                require(reconstructed == vector['reconstructed'] == literal, 'all 32 literal bits')
        for fragment in gpu['fragments']:
            require(sha(fragment['text'].encode()) == fragment['textSha256'], 'physical fragment source')
            raw = bytes(fragment['rgbaBytes'])
            require(len(raw) == 64 and sha(raw) == fragment['sha256'] and fragment['checkedPixels'] == 16, 'pixel bytes')
            if 'plane' in fragment:
                wanted = [((x >> fragment['plane']) & 1) * 255 for x in fragment['words']]
                budget = 0
            else:
                require(fragment['name'].startswith('legacy-'), 'explicit legacy witness')
                wanted, budget = [0, 64, 128, 255], 1
            require(wanted == fragment['expectedBytes'] and all(abs(x - wanted[i % 4]) <= budget for i, x in enumerate(raw)), 'independent physical bit-plane/legacy pixels')
        words += gpu['checkedWords']
        pixels += gpu['checkedPixels']
    faults = []
    for mode in ['vertex', 'fragment']:
        gpu = browser('fault-' + mode, passed=False)
        require(gpu['fault'] == mode and ('independent literal word mismatch' if mode == 'vertex' else 'independent literal pixel mismatch') in gpu['failure']['message'], 'physical corruption caught')
        mutated = [x for x in gpu['vertices'] + gpu['fragments'] if x['mutation']]
        require(len(mutated) == 1 and mutated[0]['mutation']['original'] != mutated[0]['mutation']['served'], 'one emitted source corruption')
        point = next(v['failure'] for v in mutated[0]['vectors'] if 'failure' in v) if mode == 'vertex' else mutated[0]['failure']
        require(point['expected'] != point['actual'], 'observed physical contradiction')
        faults.append(dict(mode=mode, name=mutated[0]['name'], failure=point))
    paths = subprocess.check_output(['git', 'ls-files', 'renderer/virgl-shader', 'tools/virgl-hex-literals',
        'tools/virgl-compiler-bounds/retained.mjs', 'tools/lib/virgl-browser-runner.mjs', 'tools/setup-virgl-emsdk.sh',
        'tools/verify-virgl-hex-literals.sh', 'Makefile', 'web/package-lock.json'], cwd=ROOT, text=True).splitlines()
    for name in paths:
        source(name)
    for name in ['native/virgl-shader', 'wasm/virgl-shader.mjs', 'wasm/virgl-shader.wasm']:
        source('renderer/virgl-shader/build/' + name)
    for file in sorted(directory.rglob('*')):
        if file.is_file() and file.name not in ['receipt.json', 'acceptance.log']:
            artifact(str(file.relative_to(directory)))
    receipt = dict(schema='virgl-hex-literals-receipt-v1', task=TASK, status='passed', gitHead=head,
        guestExecution=False, productionNegotiation=False, nativeCases=676, primaryComparisons=512,
        wasmCases=676, wasmPairs=676, retainedOriginals=25, retainedAdmissions=23, promotedBoundsCases=402,
        checkedWords=words, checkedPixels=pixels, physicalOutputFaults=faults,
        sources=list(sources.values()), records=list(records.values()))
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'{TASK} receipt passed: {words} exact words / {pixels} pixels')


if __name__ == '__main__':
    main()
