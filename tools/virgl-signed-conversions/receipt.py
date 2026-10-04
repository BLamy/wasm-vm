#!/usr/bin/env python3
"""Authenticate source predictions and independently recompute physical conversions."""
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
TASK = 'E6-T12g6e'
SEEDS = [0x51a83bd7, 0xa724c139, 0xe1698f03]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def signed(word):
    return word if word < 0x80000000 else word - 0x100000000


def defined(word):
    return (word & 0x7fffffff) < 0x4f000000 or (word >= 0x80000000 and (word & 0x7fffffff) == 0x4f000000)


def selected(op, value, variant='direct', condition=0, modifier=''):
    # Python's binary64 exactly represents every signed32 source; pack applies
    # binary32 nearest-even. Unpack/trunc implements F2I independently of both
    # the C unsigned-word helpers and the JavaScript rational oracle.
    a = value['b'][:] if variant == 'join' and not condition else value['a'][:]
    if variant in ['alias', 'swizzled']:
        a.reverse()
    a = [w ^ 0x80000000 if modifier == 'neg' else w & 0x7fffffff if modifier == 'abs'
         else w | 0x80000000 if modifier == 'negabs' else w for w in a]
    if op == 'I2F':
        result = [struct.unpack('<I', struct.pack('<f', signed(w)))[0] for w in a]
    else:
        require(op == 'F2I' and all(defined(w) for w in a), 'only TGSI-defined F2I inputs')
        result = [math.trunc(struct.unpack('<f', struct.pack('<I', w))[0]) & 0xffffffff for w in a]
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
    require(len(native['cases']) == 364 and native['primaryComparisons'] == 325 and native['seeds'] == SEEDS, 'complete conversion table')
    expected = json.loads(subprocess.check_output(['node', '--input-type=module', '-e',
        "import {getCases} from './tools/virgl-signed-conversions/cases.mjs'; import {getCombinedCases} from './tools/virgl-signed-conversions/combined.mjs'; console.log(JSON.stringify([...getCases(),...getCombinedCases()]));"], cwd=ROOT))
    require(len(expected) == len(native['cases']), 'full predetermined case count')
    for wanted, observed in zip(expected, native['cases']):
        require(all(observed[key] == val for key, val in wanted.items()), 'predetermined case table')
        require(sha(observed['text'].encode()) == observed['textSha256'] and type(observed['result']['ok']) is bool
                and observed['result']['ok'] == observed['ok'], 'public source/admission')
        if not observed['ok']:
            require(not any(key in observed['result'] for key in ['glsl', 'metadata']), 'closed rejection')
        else:
            require(observed['consumerDomain']['ok'] is True and observed['consumerDomain']['conversion']['kind'] == 'tgsi-signed32-binary32-v1', 'conversion policy consumed')
            if observed.get('base'):
                source(observed['base']['path'], observed['base']['fixtureSha256'])
        if observed['primary']:
            primary = observed['primaryResult']
            require(primary['conversionInstructions'] and '#version 300 es' in primary['glsl'], 'complete pinned primary conversion')
            for op in primary['conversionInstructions']:
                types = (3, 4) if op['opcode'] == 'I2F' else (4, 3)
                require((op['sourceType'], op['destinationType']) == types and op['opcode'] + ' ' in observed['text'], 'primary source/destination TGSI types')
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
    require(wasm['nativeSha256'] == records['native/report.json']['sha256'] and len(wasm['cases']) == len(wasm['pairs']) == 364, 'Wasm bound complete singles/pairs')
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
    consumer = report('consumer.json')
    require(consumer['nativeSha256'] == records['native/report.json']['sha256'] and len(consumer['contracts']) == 324
            and len(consumer['forgeries']) == 7849 and len(consumer['banks']) == 9 and consumer['accessorInvocations'] == 0,
            'complete hostile metadata/ownership consumer proof')
    require(len(consumer['combined']) == 4 and all(c['base'] == c['restored'] for c in consumer['combined']), 'all original base obligations retained')
    for row in consumer['contracts']:
        require(row['contract']['ok'] is True and row['contract']['conversion']['domain'] == 'finite-negative-le-2^31-positive-lt-2^31', 'exact consumer domain')
    for row in consumer['forgeries']:
        require(row['result']['ok'] is False and row['result']['error']['code'] == 'shader-domain-error', 'closed hostile metadata')
    for row in consumer['banks']:
        require(row['checked']['ok'] is True and row['checked']['words'] == row['safe'], 'complete owned prefix')
        for rejected in row['rejections']:
            if 'result' in rejected:
                require(rejected['result']['ok'] is False, 'unsafe component bank rejected')
    plans = json.loads(subprocess.check_output(['node', 'tools/virgl-signed-conversions/plan.mjs', native['primaryFile']['path']], cwd=ROOT))
    words = pixels = primary_words = primary_pixels = 0
    for seed, plan in zip(SEEDS, plans):
        gpu = browser('gpu-' + str(seed))
        require(gpu['seed'] == seed and gpu['fault'] is None, 'varied seed witness')
        require(len(gpu['vertices']) == len(plan['vertices']) and len(gpu['fragments']) == len(plan['fragments']), 'complete physical program set')
        own_words = own_pixels = 0
        for vertex, planned in zip(gpu['vertices'], plan['vertices']):
            require(all(vertex[k] == planned[k] for k in ['op','variant','bank','backend','modifier','inputSource','text'])
                    and len(vertex['vectors']) == len(planned['vectors']), 'complete source/modifier/lane physical vertex set')
            require(sha(vertex['text'].encode()) == vertex['textSha256'], 'physical vertex source')
            if vertex['backend'] == 'mesa':
                require(primary_by_text[vertex['text']] == vertex['primary'], 'unchanged actual primary shader')
            require([x['name'] for x in vertex['reflection']] == ['gl_Position', 'vso_g0', 'vso_g1'], 'physical feedback reflection')
            for vector, prediction in zip(vertex['vectors'], planned['vectors']):
                require(vector['input'] == prediction['input'] and vector['condition'] == prediction['condition']
                        and vector['position'] == plan['positions'][prediction['position']], 'predetermined independent inputs/positions')
                chosen = selected(vertex['op'], vector['input'], vertex['variant'], vector['condition'], vertex['modifier'])
                require(vertex['predicate'] is False and chosen == vector['selectedWords'], 'independent exact signed conversion')
                require(vector['inputWords'] == (vector['input']['a'] if vertex['inputSource'] else None), 'physical input source words')
                wanted = [struct.unpack('<I', struct.pack('<f', x))[0] for x in vector['position']]
                wanted += [(x & 0x7fffff) | 0x3f000000 for x in chosen] + [(x >> 23) | 0x3f000000 for x in chosen]
                raw = bytes(vector['bytes'])
                require(len(raw) == 48 and sha(raw) == vector['sha256'], 'feedback bytes binding')
                actual = list(struct.unpack('<12I', raw))
                require(actual == vector['observed'] == vector['expectedWords'] == wanted and vector['checkedWords'] == 12, 'independent actual conversion hardware words')
                require([((actual[8+i] & 511) << 23) | (actual[4+i] & 0x7fffff) for i in range(4)] == chosen == vector['reconstructed'], 'all 32 signed result bits')
                if vertex['backend'] == 'owned':
                    own_words += 12
                else:
                    primary_words += 12
                words += 12
                upload = vector['bankUpload']
                if upload:
                    require(upload['observedA'] == vector['input']['a'] and (upload['observedB'] is None or upload['observedB'] == vector['input']['b']), 'physical exact dynamic bank words')
                    require(upload['words'][:4] == vector['input']['a'] and upload['words'][180:184] == vector['input']['b']
                            and upload['words'][172] == vector['condition'] and all(w == 0xdeadbeef for w in upload['callerAfter']), 'owned host probe bank')
        for fragment, planned in zip(gpu['fragments'], plan['fragments']):
            require(all(fragment[k] == planned[k] for k in ['op','input','plane','text','backend']), 'complete physical fragment planes')
            require(sha(fragment['text'].encode()) == fragment['textSha256'], 'physical fragment source')
            if fragment['backend'] == 'mesa':
                require(primary_by_text[fragment['text']] == fragment['primary'], 'unchanged primary fragment source')
            chosen = selected(fragment['op'], fragment['input'])
            require(fragment['predicate'] is False, 'no result predicate substitution')
            expected_bytes = [((w >> fragment['plane']) & 1) * 255 for w in chosen]
            raw = bytes(fragment['rgbaBytes'])
            require(len(raw) == 64 and sha(raw) == fragment['sha256'] and fragment['checkedPixels'] == 16, 'physical pixel bytes')
            require(fragment['selectedWords'] == chosen and fragment['expectedBytes'] == expected_bytes and list(raw) == expected_bytes * 16, 'independent all signed bit planes')
            if fragment['backend'] == 'owned':
                own_pixels += 16
            else:
                primary_pixels += 16
            pixels += 16
        require(own_words == 26616 and own_pixels == 11264, 'complete unrestricted raw conversion hardware proof')
        require(gpu['checkedWords'] == sum(len(v['vectors']) * 12 for v in gpu['vertices'])
                and gpu['checkedPixels'] == len(gpu['fragments']) * 16 + 320, 'independent hardware counts')
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
        require([(d['stage'], d['asynchronous']) for d in gpu['bankDraws']] == [(0,False),(0,True),(1,False),(1,True)], 'both stages and actual sync/async draw consumers')
        for draw in gpu['bankDraws']:
            stage = draw['stage']
            component = dict(register=45 if stage == 0 else 0, mask=10 if stage == 0 else 5)
            require(draw['components'] == component and not draw['oracleStops'], 'exact post-swizzle component certificate')
            metadata = draw['pair']['vertex' if stage == 0 else 'fragment']['metadata']
            require(metadata['constantConversionDomains'][0]['components'] == [component], 'real compiler range obligation')
            require(len(draw['draws']) == 5 and len(draw['attacks']) == 6 and len(draw['restorations']) == 1
                    and len(draw['yieldAttacks']) == (1 if draw['asynchronous'] else 0), 'complete A/B/A, unused lanes, hostile banks and actual waits')
            geometry = draw['resourceInputs']
            require(geometry[0]['bytes'] == list(struct.pack('<8f', -1,-1,1,-1,1,1,-1,1))
                    and geometry[1]['bytes'] == list(struct.pack('<6H', 0,1,2,0,2,3)), 'physical draw geometry independent bytes')
            require([x['label'] for x in draw['draws']] == ['A','B','A restored','unused out-of-domain component','restored after range rejects'], 'ordered draw witnesses')
            for observed in draw['draws']:
                source_words = observed['words'][component['register']*4:component['register']*4+4]
                converted = [selected('F2I', dict(a=[w], b=[w]))[0] if component['mask'] & (1 << i) else 0 for i,w in enumerate(source_words)]
                rgba = [converted[3]&1,0,converted[1]&1,0] if stage == 0 else [0,converted[2]&1,0,converted[0]&1]
                rgba = [w*255 for w in rgba]
                raw = bytes(observed['rgbaBytes'])
                require(len(observed['words']) == 184 and observed['source'] == observed['uniformWords'] == source_words,
                        'physical exact owned conversion draw bank')
                require(raw == bytes(rgba*16) and observed['expectedRGBA'] == rgba and sha(raw) == observed['sha256']
                        and observed['checkedPixels'] == 16 and observed['result']['ok'] is True, 'independent actual indexed conversion pixels')
                constants = observed['snapshot']['contexts'][0]['subContexts'][0]['bindings']['constants']
                require(constants[stage] == observed['words'], 'actual renderer owns whole declared prefix')
                pixels += 16
            for attack, poison in zip(draw['attacks'][:5], [0x4f000000,0x4f000001,0xcf000001,0x7f7fffff,0xff7fffff]):
                require(attack['poison'] == poison and not defined(poison) and attack['before'] == attack['after']
                        and attack['pixelsBefore'] == attack['pixelsAfter'], 'range rejection preserves CPU/GPU state')
                require(attack['result']['ok'] is False and attack['result']['error']['code'] == 'constant-conversion-domain-error'
                        and attack['result']['appliedCommands'] == 0 and not any(e['call'] in ['uniform4uiv','drawElements','getBufferSubData','copyBufferSubData'] for e in attack['events']), 'rejected before uploads/index reads/draws')
            require(draw['attacks'][5]['result']['ok'] is False and draw['attacks'][5]['result']['error']['code'] == 'incomplete-draw', 'complete prefix guard survives reflection pruning')
            for attack in draw['yieldAttacks']:
                require(attack['before'] == attack['after'] and all(r['ok'] is False and r['error']['code'] == 'busy' for r in attack['attempts']), 'immutable async plan across actual index wait')
            for submission in draw['submissions']:
                require(all(b == 255 for b in submission['after']), 'draw consumer caller mutation after snapshot')
            require(all(v == 0 for v in draw['finalBudgets'].values()) and all(v == 0 for v in draw['finalResourceBudgets'].values()), 'zero actual draw resource budgets')
    faults = []
    for mode in ['rounding', 'truncate']:
        gpu = browser('fault-' + mode, passed=False)
        require(gpu['fault'] == mode and 'independent conversion word mismatch' in gpu['failure']['message'], 'physical conversion source corruption caught')
        mutated = [x for x in gpu['vertices'] if x['mutation']]
        require(len(mutated) == 1 and mutated[0]['mutation']['original'] != mutated[0]['mutation']['served'], 'one real emitted-source corruption')
        point = next(v['failure'] for v in mutated[0]['vectors'] if 'failure' in v)
        require(point['expected'] != point['actual'], 'physical contradicted prediction')
        mutation = mutated[0]['mutation']
        require(mutation['original'] == mutated[0]['pair']['vertex']['glsl'] and mutation['served'] == mutation['original'].replace(mutation['needle'], mutation['replacement'], 1), 'one actual emitted helper mutation')
        faults.append(dict(mode=mode, op=mutated[0]['op'], failure=point))
    range_gpu = browser('fault-range', passed=False)
    require(range_gpu['fault'] == 'range' and len(range_gpu['bankDraws']) == 1, 'actual isolated consumer range fault')
    stop = range_gpu['bankDraws'][0]['oracleStops']
    require(len(stop) == 1 and stop[0]['word'] == 0x4f000000 and stop[0]['index'] == 181 and stop[0]['call'] == 'uniform4uiv'
            and stop[0]['unsafeGpuCalled'] is False, 'independent intercept stopped real unsafe upload')
    descriptor = json.loads((ROOT / 'renderer/virgl-shader/build/signed-conversions-range-fault.json').read_bytes())
    original = (ROOT / 'renderer/virgl-command/constant-domain.mjs').read_text()
    served = (ROOT / descriptor['served']['path']).read_text()
    require(sha(original.encode()) == descriptor['originalSha256'] and original.count(descriptor['needle']) == 1
            and served == original.replace(descriptor['needle'], 'false && '+descriptor['needle'], 1)
            and sha(served.encode()) == descriptor['served']['sha256'], 'exact real component guard source fault')
    state_original = (ROOT / 'renderer/virgl-command/state.mjs').read_text()
    state_served = (ROOT / descriptor['state']['path']).read_text()
    expected_state = state_original.replace('"./decoder.mjs"', '"/renderer/virgl-command/decoder.mjs"').replace(
        '"../virgl-shader/index.mjs"', '"/renderer/virgl-shader/index.mjs"').replace(
        '"./constant-domain.mjs"', '"/'+descriptor['served']['path']+'"')
    require(sha(state_original.encode()) == descriptor['state']['originalSha256'] and state_served == expected_state
            and sha(state_served.encode()) == descriptor['state']['sha256'], 'actual consumer routes only the source-fault module')
    faults.append(dict(mode='range', failure=stop[0]))
    paths = subprocess.check_output(['git', 'ls-files', 'renderer/virgl-shader', 'tools/virgl-signed-conversions',
        'renderer/virgl-command/state.mjs', 'renderer/virgl-command/constant-domain.mjs', 'renderer/virgl-command/decoder.mjs',
        'renderer/virgl-command/resources.mjs', 'tools/virgl-compiler-bounds/retained.mjs', 'tools/lib/virgl-browser-runner.mjs',
        'tools/setup-virgl-emsdk.sh', 'tools/verify-virgl-signed-conversions.sh', 'Makefile', 'web/package-lock.json'], cwd=ROOT, text=True).splitlines()
    for name in paths:
        source(name)
    for name in ['native/virgl-shader', 'wasm/virgl-shader.mjs', 'wasm/virgl-shader.wasm']:
        source('renderer/virgl-shader/build/' + name)
    for file in sorted(directory.rglob('*')):
        if file.is_file() and file.name not in ['receipt.json', 'acceptance.log']:
            artifact(str(file.relative_to(directory)))
    receipt = dict(schema='virgl-signed-conversions-receipt-v1', task=TASK, status='passed', gitHead=head,
        guestExecution=False, productionNegotiation=False, nativeCases=364, primaryComparisons=325,
        wasmCases=364, wasmPairs=364, retainedOriginals=25, retainedAdmissions=23,
        promotedBoundsCases=402, promotedHexCases=49, promotedSignedCases=108,
        metadataAttacks=7849, ownedRangeBanks=9, combinedBases=4,
        checkedWords=words, checkedPixels=pixels, primaryWords=primary_words, primaryPixels=primary_pixels, physicalOutputFaults=faults,
        sources=list(sources.values()), records=list(records.values()))
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'{TASK} receipt passed: {words} exact words / {pixels} pixels')


if __name__ == '__main__':
    main()
