#!/usr/bin/env python3
"""Authenticate signed source predictions and recompute every physical result."""
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
TASK = 'E6-T12g6d'
SEEDS = [0x51a83bd7, 0xa724c139, 0xe1698f03]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def signed(word):
    return word if word < 0x80000000 else word - 0x100000000


def selected(op, value, variant='direct', condition=0):
    a, b = value['a'][:], value['b'][:]
    if variant in ['alias', 'swizzled']:
        a.reverse()
        b.reverse()
    if variant == 'join' and not condition:
        a, b = b, a
    result = [0xffffffff if signed(x) < signed(y) else 0 for x, y in zip(a, b)] if op == 'ISLT' else [
        x if signed(x) >= signed(y) else y for x, y in zip(a, b)]
    if variant == 'masked':
        result[1], result[3] = value['a'][1], value['a'][3]
    return result


def main():
    directory = Path(sys.argv[1]).resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    require(not subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=ROOT), 'freeze tracked sources')
    sources, records = {}, {}

    def source(name, digest=None, size=None):
        raw = (ROOT / name).read_bytes()
        require(digest is None or sha(raw) == digest, 'source digest: ' + name)
        require(size is None or len(raw) == size, 'source size: ' + name)
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
        require(value['gitHead'] == head and value['status'] == ('passed' if passed else 'failed'), 'report head/outcome: ' + name)
        require(task is None or value['task'] == task, 'task: ' + name)
        for row in value.get('sources', []):
            source(row['path'], row['sha256'], row.get('size', row.get('bytes')))
        return value

    def browser(name, passed=True):
        value = report(name + '/report.json', passed=passed)
        require(not value['trackedChanges'], 'frozen browser sources')
        require(value['browserErrors'] == dict(console=[], page=[], requests=[]), 'browser errors')
        info = value['browser']
        require(info['launch']['headless'] is False and info['gpu']['featureStatus'][info['webglFeature']] == 'enabled', 'physical headed GPU')
        capture = value.get('screenshot') or value.get('failureScreenshot')
        artifact(name + '/' + capture['path'], capture['sha256'])
        coverage = value['browserCoverage']
        for row in json.loads(artifact(name + '/' + coverage['path'], coverage['sha256']))['scripts']:
            require(row['sha256'] == sources[row['source']]['sha256'], 'V8 source binding')
        for row in value['servedFiles']:
            require(sources[row['path']]['sha256'] == row['sha256'], 'served source binding')
        acceptance = value['acceptance']
        require(acceptance['guestExecution'] is False and acceptance['productionNegotiation'] is False and acceptance['objects']['live'] == 0, 'isolated disposed hardware')
        require(acceptance['primaryFile']['sha256'] == native['primaryFile']['sha256'], 'physical primary fixture binding')
        return acceptance

    native = report('native/report.json')
    require(len(native['cases']) == 432 and native['primaryComparisons'] == 392 and native['seeds'] == SEEDS, 'complete signed table')
    expected = json.loads(subprocess.check_output(['node', '--input-type=module', '-e',
        "import {getCases} from './tools/virgl-signed-integers/cases.mjs'; console.log(JSON.stringify(getCases()));"], cwd=ROOT))
    for wanted, observed in zip(expected, native['cases']):
        require(all(observed[key] == val for key, val in wanted.items()), 'predetermined case table')
        require(sha(observed['text'].encode()) == observed['textSha256'] and type(observed['result']['ok']) is bool
                and observed['result']['ok'] == observed['ok'], 'public source/admission')
        if not observed['ok']:
            require(not any(key in observed['result'] for key in ['glsl', 'metadata']), 'closed rejection')
        else:
            require(observed['consumerDomain']['ok'] is True and observed['consumerDomain']['domain'] is None
                    and 'constantRasterDomains' not in observed['result']['metadata'], 'no new domain grant')
        if observed['primary']:
            primary = observed['primaryResult']
            require(primary['signedInstructions'] and '#version 300 es' in primary['glsl'], 'complete pinned primary conversion')
            for op in primary['signedInstructions']:
                require(op['sourceType'] == op['destinationType'] == 3 and op['opcode'] + ' ' in observed['text'], 'primary signed32 types')
    artifact('native/cases.bin', native['fixtureSha256'])
    artifact('native/native.log', native['logSha256'])
    require(not artifact('native/native.stderr', native['stderrSha256']), 'sanitizer diagnostics')
    artifact('native/coverage.json', native['coverageSha256'])
    source(native['binary']['path'], native['binary']['sha256'], native['binary']['bytes'])
    source(native['primaryFile']['path'], native['primaryFile']['sha256'], native['primaryFile']['bytes'])
    primary_rows = json.loads((ROOT / native['primaryFile']['path']).read_bytes())
    require(primary_rows == [dict(name=c['name'], stage=c['stage'], text=c['text'], primary=c['primaryResult'])
                            for c in native['cases'] if c['primary']], 'primary fixture exact native binding')
    primary_by_text = {c['text']: c['primary'] for c in primary_rows}
    wasm = report('wasm/report.json')
    require(wasm['nativeSha256'] == records['native/report.json']['sha256'] and len(wasm['cases']) == len(wasm['pairs']) == 432, 'Wasm bound complete singles/pairs')
    for c, observed, pair in zip(native['cases'], wasm['cases'], wasm['pairs']):
        require(c['index'] == observed['index'] == pair['index'] and observed['result'] == c['result'] and pair['result']['ok'] == c['ok'], 'exact public Wasm parity')
        if not c['ok']:
            require(not any(key in pair['result'] for key in ['vertex', 'fragment', 'metadata']), 'closed pair rejection')
    retained = report('retained/report.json', task='E6-T12g6b')
    require(len(retained['originals']) == 25 and sum(c['native']['ok'] for c in retained['originals']) == 23, 'original partition unchanged')
    require(len(retained['historical']) == 112 and sum(c['native']['ok'] for c in retained['historical']) == 5, 'historical grammar unchanged')
    for filename, count in [('independent-joins.json', 402), ('independent-hex-guards.json', 49),
                            ('independent-signed-guards.json', 108)]:
        guard = json.loads(artifact(filename))
        require(guard['status'] == 'passed' and type(guard['cases']) is int and guard['cases'] == len(guard['native']) == len(guard['wasm']) == count, 'promoted guard completeness')
        for a, b in zip(guard['native'], guard['wasm']):
            if a['result'].get('error', {}).get('code') == 'invalid-input':
                require(b['result'].get('error', {}).get('code') == 'invalid-input', 'promoted input parity')
            else:
                require(a['result'] == b['result'], 'promoted result parity')
        source('renderer/virgl-shader/build/native/virgl-shader', guard['nativeBinary']['sha256'])
    words = pixels = primary_words = primary_pixels = 0
    for seed in SEEDS:
        gpu = browser('gpu-' + str(seed))
        require(gpu['seed'] == seed and gpu['fault'] is None, 'varied seed witness')
        own_words = own_pixels = 0
        for vertex in gpu['vertices']:
            require(sha(vertex['text'].encode()) == vertex['textSha256'], 'physical vertex source')
            if vertex['backend'] == 'mesa':
                require(primary_by_text[vertex['text']] == vertex['primary'], 'unchanged actual primary shader')
            require([x['name'] for x in vertex['reflection']] == ['gl_Position', 'vso_g0', 'vso_g1'], 'physical feedback reflection')
            for vector in vertex['vectors']:
                chosen = selected(vertex['op'], vector['input'], vertex['variant'], vector['condition'])
                if vertex['predicate']:
                    chosen = [0x3f800000 if w else 0 for w in chosen]
                require(chosen == vector['selectedWords'], 'independent signed32 mask/winner')
                wanted = [struct.unpack('<I', struct.pack('<f', x))[0] for x in vector['position']]
                wanted += [(x & 0x7fffff) | 0x3f000000 for x in chosen] + [(x >> 23) | 0x3f000000 for x in chosen]
                raw = bytes(vector['bytes'])
                require(len(raw) == 48 and sha(raw) == vector['sha256'], 'feedback bytes binding')
                actual = list(struct.unpack('<12I', raw))
                require(actual == vector['observed'] == vector['expectedWords'] == wanted and vector['checkedWords'] == 12, 'independent actual signed hardware words')
                require([((actual[8+i] & 511) << 23) | (actual[4+i] & 0x7fffff) for i in range(4)] == chosen == vector['reconstructed'], 'all 32 signed result bits')
                if vertex['backend'] == 'owned':
                    own_words += 12
                else:
                    primary_words += 12
                words += 12
                upload = vector['bankUpload']
                if upload:
                    require(upload['observedA'] == vector['input']['a'] and upload['observedB'] == vector['input']['b'], 'physical exact dynamic bank words')
                    require(upload['words'][:4] == vector['input']['a'] and upload['words'][180:184] == vector['input']['b']
                            and upload['words'][172] == vector['condition'] and all(w == 0xdeadbeef for w in upload['callerAfter']), 'owned host probe bank')
        for fragment in gpu['fragments']:
            require(sha(fragment['text'].encode()) == fragment['textSha256'], 'physical fragment source')
            if fragment['backend'] == 'mesa':
                require(primary_by_text[fragment['text']] == fragment['primary'], 'unchanged primary fragment source')
            chosen = selected(fragment['op'], fragment['input'])
            if fragment['predicate']:
                chosen = [0x3f800000 if w else 0 for w in chosen]
            expected_bytes = [((w >> fragment['plane']) & 1) * 255 for w in chosen]
            raw = bytes(fragment['rgbaBytes'])
            require(len(raw) == 64 and sha(raw) == fragment['sha256'] and fragment['checkedPixels'] == 16, 'physical pixel bytes')
            require(fragment['selectedWords'] == chosen and fragment['expectedBytes'] == expected_bytes and list(raw) == expected_bytes * 16, 'independent all signed bit planes')
            if fragment['backend'] == 'owned':
                own_pixels += 16
            else:
                primary_pixels += 16
            pixels += 16
        require(own_words == 24192 and own_pixels == 9216, 'complete unrestricted raw hardware proof')
        require(gpu['checkedWords'] == sum(len(v['vectors']) * 12 for v in gpu['vertices'])
                and gpu['checkedPixels'] == len(gpu['fragments']) * 16, 'independent hardware counts')
        require(len(gpu['consumers']) == 4, 'sync/async consumers for both operations')
        for consumer in gpu['consumers']:
            require(len(consumer['captures']) == 6 and all(v == 0 for v in consumer['finalBudgets'].values())
                    and all(v == 0 for v in consumer['finalResourceBudgets'].values()), 'real consumer lifetime')
            for submission in consumer['submissions']:
                require(all(w == 255 for w in submission['after']), 'caller bytes mutated after ownership')
            for capture in consumer['captures']:
                banks = capture['snapshot']['contexts'][0]['subContexts'][0]['bindings']['constants']
                require(banks[0] == banks[1] and len(banks[0]) == 184, 'complete owned stage banks')
                for native_uniform in capture['native']:
                    stage = 0 if native_uniform['name'] == 'vsconst0' else 1
                    at = native_uniform['index'] * 4
                    require(native_uniform['words'] == banks[stage][at:at+4], 'physical consumer bank ownership')
            rejection = consumer['rejection']
            require(rejection['result']['ok'] is False and rejection['result']['appliedCommands'] == 0
                    and rejection['before'] == rejection['after'], 'unchanged nonfinite wire rejection')
    faults = []
    for mode in ['signedness', 'winner']:
        gpu = browser('fault-' + mode, passed=False)
        require(gpu['fault'] == mode and 'independent signed word mismatch' in gpu['failure']['message'], 'physical integer source corruption caught')
        mutated = [x for x in gpu['vertices'] if x['mutation']]
        require(len(mutated) == 1 and mutated[0]['mutation']['original'] != mutated[0]['mutation']['served'], 'one real emitted-source corruption')
        point = next(v['failure'] for v in mutated[0]['vectors'] if 'failure' in v)
        require(point['expected'] != point['actual'], 'physical contradicted prediction')
        faults.append(dict(mode=mode, op=mutated[0]['op'], failure=point))
    paths = subprocess.check_output(['git', 'ls-files', 'renderer/virgl-shader', 'tools/virgl-signed-integers',
        'renderer/virgl-command/state.mjs', 'renderer/virgl-command/constant-domain.mjs', 'renderer/virgl-command/decoder.mjs',
        'renderer/virgl-command/resources.mjs', 'tools/virgl-compiler-bounds/retained.mjs', 'tools/lib/virgl-browser-runner.mjs',
        'tools/setup-virgl-emsdk.sh', 'tools/verify-virgl-signed-integers.sh', 'Makefile', 'web/package-lock.json'], cwd=ROOT, text=True).splitlines()
    for name in paths:
        source(name)
    for name in ['native/virgl-shader', 'wasm/virgl-shader.mjs', 'wasm/virgl-shader.wasm']:
        source('renderer/virgl-shader/build/' + name)
    for file in sorted(directory.rglob('*')):
        if file.is_file() and file.name not in ['receipt.json', 'acceptance.log']:
            artifact(str(file.relative_to(directory)))
    receipt = dict(schema='virgl-signed-integers-receipt-v1', task=TASK, status='passed', gitHead=head,
        guestExecution=False, productionNegotiation=False, nativeCases=432, primaryComparisons=392,
        wasmCases=432, wasmPairs=432, retainedOriginals=25, retainedAdmissions=23,
        promotedBoundsCases=402, promotedHexCases=49, promotedSignedCases=108,
        checkedWords=words, checkedPixels=pixels, primaryWords=primary_words, primaryPixels=primary_pixels, physicalOutputFaults=faults,
        sources=list(sources.values()), records=list(records.values()))
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'{TASK} receipt passed: {words} exact words / {pixels} pixels')


if __name__ == '__main__':
    main()
