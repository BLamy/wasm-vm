#!/usr/bin/env python3
"""Authenticate source predictions and independently recompute physical conversions."""
import hashlib
import json
import math
from functools import lru_cache
from pathlib import Path
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
TASK = 'E6-T12g6g2'
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


def positive_ratio(word):
    e, mantissa = word >> 23, word & 0x7fffff
    n, shift = mantissa if not e else mantissa | 0x800000, -149 if not e else e - 150
    return (n << shift, 1) if shift >= 0 else (n, 1 << -shift)


@lru_cache(maxsize=None)
def fraction_word(word):
    if (word >> 23) & 255 == 255:
        return 0x7fc00000
    n, d = positive_ratio(word & 0x7fffffff)
    if word & 0x80000000:
        n = -n
    n %= d  # exact Euclidean remainder equals x-floor(x)
    if not n:
        return 0
    low, high = 0, 0x3f800000
    while high - low > 1:
        middle = (low + high) // 2
        m, md = positive_ratio(middle)
        if m*d <= n*md:
            low = middle
        else:
            high = middle
    ln, ld = positive_ratio(low)
    hn, hd = positive_ratio(high)
    delta = 2*n*ld*hd - d*(ln*hd+hn*ld)
    return low if delta < 0 or delta == 0 and not low & 1 else high


def selected(op, value, variant='direct', condition=0, modifier=''):
    a = value['b'][:] if variant == 'join' and not condition else value['a'][:]
    if variant in ['alias','swizzled']:
        a.reverse()
    if modifier == 'neg':
        a = [w ^ 0x80000000 for w in a]
    require(op in ['FRC','FRC_PRECISE'], 'bounded fraction operation')
    if op == 'FRC':
        require(all((w & 0x7f800000) != 0x7f800000 for w in a), 'ordinary finite numerical inputs')
    result = [fraction_word(w) for w in a]
    if variant == 'masked' or variant.startswith('mask-'):
        mask = 5 if variant == 'masked' else int(variant[5:])
        for lane in range(4):
            if not mask & (1 << lane):
                result[lane] = value['a'][lane]
    return result


def zero_allowed(vertex, lane):
    if vertex['backend'] == 'mesa':
        return True
    if vertex['op'] != 'FRC':
        return False
    variant = vertex['variant']
    mask = 5 if variant == 'masked' else int(variant[5:]) if variant.startswith('mask-') else 15
    return bool(mask & (1 << lane))


def main():
    directory = Path(sys.argv[1]).resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    require(not subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=ROOT), 'freeze tracked sources')
    sources, records, recording_heads = {}, {}, set()
    # Evidence-only repairs carry immutable runtime recordings forward. An old
    # head is acceptable only when the entire commit range changes this
    # harness file; every recorded served source is still digest-checked below.
    harness_repairs = {'tools/virgl-precise-fraction/receipt.py', 'tools/virgl-precise-fraction/plan.mjs',
                       'renderer/virgl-shader/tests/precise-fraction.mjs', 'tools/virgl-precise-fraction/browser.mjs'}

    def recording_head(value):
        recorded = value['gitHead']
        require(subprocess.run(['git','merge-base','--is-ancestor',recorded,head],cwd=ROOT,stdout=subprocess.DEVNULL).returncode == 0, 'recording is from an ancestor source head')
        changed = set(subprocess.check_output(['git','diff','--name-only',recorded,head],cwd=ROOT,text=True).splitlines())
        require(changed <= harness_repairs, 'recorded runtime or dependency source changed')
        recording_heads.add(recorded)

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
        recording_head(value)
        require(value['status'] == ('passed' if passed else 'failed'), 'report outcome: ' + name)
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
    require(len(native['cases']) == 1919 and native['primaryComparisons'] == 1897 and native['seeds'] == SEEDS, 'complete fraction table')
    expected = json.loads(subprocess.check_output(['node', '--input-type=module', '-e',
        "import {getCases} from './tools/virgl-precise-fraction/cases.mjs'; import {getCombinedCases} from './tools/virgl-precise-fraction/combined.mjs'; console.log(JSON.stringify([...getCases(),...getCombinedCases()]));"], cwd=ROOT))
    require(len(expected) == len(native['cases']), 'full predetermined case count')
    for wanted, observed in zip(expected, native['cases']):
        require(all(observed[key] == val for key, val in wanted.items()), 'predetermined case table')
        require(sha(observed['text'].encode()) == observed['textSha256'] and type(observed['result']['ok']) is bool
                and observed['result']['ok'] == observed['ok'], 'public source/admission')
        if not observed['ok']:
            require(not any(key in observed['result'] for key in ['glsl', 'metadata']), 'closed rejection')
        else:
            require(observed['consumerDomain']['ok'] is True and (observed['consumerDomain'].get('fraction') is not None) == (observed.get('fraction') is not False), 'fraction policy consumed')
            if observed.get('base'):
                source(observed['base']['path'], observed['base']['fixtureSha256'])
        if observed['primary']:
            primary = observed['primaryResult']
            require(primary['fractionInstructions'] and '#version 300 es' in primary['glsl'], 'complete pinned primary conversion')
            for op in primary['fractionInstructions']:
                types = (4, 4)
                require((op['sourceType'], op['destinationType']) == types and op['opcode'] + ' ' in observed['text'], 'primary source/destination TGSI types')
    expected_words = json.loads(subprocess.check_output(['node','--input-type=module','-e',
        "import {helperWords} from './tools/virgl-precise-fraction/cases.mjs';console.log(JSON.stringify(helperWords()));"],cwd=ROOT))
    require(len(expected_words) == len(native['helperWords']) == 7968, 'every binary32 exponent/helper word prediction')
    for index,(wanted,observed) in enumerate(zip(expected_words,native['helperWords'])):
        truth = fraction_word(wanted['word'])
        require(wanted['expected'] == truth and observed == dict(index=index,word=wanted['word'],expected=truth,actual=truth), 'independent rational native helper words')
    artifact('native/cases.bin', native['fixtureSha256'])
    native_log = artifact('native/native.log', native['logSha256']).decode().splitlines()
    recorded_words = [list(map(int,line.split()[1:])) for line in native_log if line.startswith('WORD ')]
    require(recorded_words == [[w['index'],w['word'],w['expected'],w['actual']] for w in native['helperWords']], 'actual sanitizer transcript helper predictions')
    require(not artifact('native/native.stderr', native['stderrSha256']), 'sanitizer diagnostics')
    coverage = json.loads(artifact('native/coverage.json', native['coverageSha256']))
    functions = [f for data in coverage['data'] for f in data['functions']]
    for name in ['raw_frc_word', 'raw_frc_complement', 'raw_record', 'raw_emit', 'fraction_contract']:
        require(any((f['name'] == name or f['name'].endswith(':' + name)) and f['count'] > 0 for f in functions), 'recorded fraction compiler path: ' + name)
    source(native['binary']['path'], native['binary']['sha256'], native['binary']['bytes'])
    source(native['primaryFile']['path'], native['primaryFile']['sha256'], native['primaryFile']['bytes'])
    primary_rows = json.loads((ROOT / native['primaryFile']['path']).read_bytes())
    require(primary_rows == [dict(name=c['name'], stage=c['stage'], text=c['text'], primary=c['primaryResult'])
                            for c in native['cases'] if c['primary']], 'primary fixture exact native binding')
    primary_by_text = {c['text']: c['primary'] for c in primary_rows}
    wasm = report('wasm/report.json')
    require(wasm['nativeSha256'] == records['native/report.json']['sha256'] and len(wasm['cases']) == len(wasm['pairs']) == 1919, 'Wasm bound complete singles/pairs')
    for c, observed, pair in zip(native['cases'], wasm['cases'], wasm['pairs']):
        require(c['index'] == observed['index'] == pair['index'] and observed['result'] == c['result'] and pair['result']['ok'] == c['ok'], 'exact public Wasm parity')
        if not c['ok']:
            require(not any(key in pair['result'] for key in ['vertex', 'fragment', 'metadata']), 'closed pair rejection')
    retained = report('retained/report.json', task='E6-T12g6b')
    require(len(retained['originals']) == 25 and sum(c['native']['ok'] for c in retained['originals']) == 23, 'original partition unchanged')
    require(len(retained['historical']) == 112 and sum(c['native']['ok'] for c in retained['historical']) == 5, 'historical grammar unchanged')
    for filename, count in [('independent-joins.json', 402), ('independent-hex-guards.json', 49),
                            ('independent-signed-guards.json', 108), ('independent-conversion-guards.json', 1575),
                            ('independent-scalar-guards.json', 1427), ('independent-minimum-guards.json', 4524)]:
        guard = json.loads(artifact(filename))
        if filename == 'independent-conversion-guards.json':
            source('renderer/virgl-shader/tests/signed-conversion-regressions.mjs', guard['testSha256'])
        if filename == 'independent-scalar-guards.json':
            require(guard['schema'] == 'virgl-scalar-operation-critic-guards-v1', 'exact promoted scalar guard schema')
            source('renderer/virgl-shader/tests/scalar-operation-regressions.mjs', guard['testSha256'])
        if filename == 'independent-minimum-guards.json':
            require(guard['schema'] == 'virgl-minimum-selection-critic-guards-v1', 'exact promoted minimum guard schema')
            source('renderer/virgl-shader/tests/minimum-selection-regressions.mjs', guard['testSha256'])
        require(guard['status'] == 'passed' and type(guard['cases']) is int and guard['cases'] == len(guard['native']) == len(guard['wasm']) == count, 'promoted guard completeness')
        for a, b in zip(guard['native'], guard['wasm']):
            if a['result'].get('error', {}).get('code') == 'invalid-input':
                require(b['result'].get('error', {}).get('code') == 'invalid-input', 'promoted input parity')
            else:
                require(a['result'] == b['result'], 'promoted result parity')
        source('renderer/virgl-shader/build/native/virgl-shader', guard['nativeBinary']['sha256'])
    legacy = report('legacy.json')
    require(legacy['schema'] == 'virgl-fraction-legacy-v1' and len(legacy['cases']) == 1014, 'complete ordinary FRC/ADD/MUL/selected-away compatibility')
    source(legacy['migration']['path'],legacy['migration']['sha256'])
    migrations = json.loads((ROOT / legacy['migration']['path']).read_bytes())
    require(len(migrations) == 2 and all(m['beforeOK'] is False and m['ok'] is True for m in migrations), 'explicit two newly supported FRC_PRECISE fixtures')
    for fixture in legacy['fixtures']:
        source(fixture['path'],fixture['sha256'],fixture['bytes'])
    parent = legacy['parent']
    source(parent['sealPath']);source(parent['indexPath']);source(parent['archive'],parent['archiveSha256'])
    seal = json.loads((ROOT / parent['sealPath']).read_bytes())
    index_raw = (ROOT / parent['indexPath']).read_bytes()
    require(sha(index_raw) == seal['recordIndex']['sha256'] and parent['sourceHead'] == seal['sourceHead'], 'unchanged verified predecessor seal')
    entry = next(r for r in json.loads(index_raw)['records'] if r['path'] == 'generated/native/virgl-shader')
    require(parent['binarySha256'] == entry['sha256'], 'prior independently verified compiler identity')
    for row in legacy['cases']:
        require(row['old']['ok'] is row['ok'] and row['added']['ok'] is row['ok'], 'old/new legacy admission')
        if row['migration']:
            require(row['migration'] in migrations and sha(row['text'].encode()) == row['migration']['inputSha256']
                    and row['parent']['ok'] is False and row['old']['ok'] is True, 'explicit instruction-local fraction migration')
        else:
            require(row['old'] == row['parent'], 'whole predecessor response unchanged')
        if row['ok']:
            restored = dict(row['added']['metadata'])
            require(restored['profile'] == 'virgl-webgl2-raw-bits-v33', 'explicit local fraction wrapper')
            restored['profile'] = restored.pop('fractionBaseProfile');restored.pop('fractionWordContract')
            baseline = dict(row['old']['metadata'])
            if row['migration']:
                require(row['added']['metadata'] == baseline, 'existing fraction policy unchanged by second instruction')
            else:
                if row['baseTransition'] is not None:
                    require(row['baseTransition'] == 'straight-line-v5-to-owned-raw-v1', 'explicit MOV-only owned backend transition')
                    baseline['profile'] = 'virgl-webgl2-raw-bits-v1'
                require(restored == baseline, 'complete unchanged inherited obligations')
    consumer = report('consumer.json')
    require(consumer['nativeSha256'] == records['native/report.json']['sha256'] and len(consumer['contracts']) == 1899
            and len(consumer['forgeries']) == 591 and len(consumer['banks']) == 13 and consumer['accessorInvocations'] == 0,
            'complete hostile metadata/ownership consumer proof')
    require(len(consumer['combined']) == 4 and all(c['base'] == c['restored'] for c in consumer['combined']), 'all original base obligations retained')
    for row in consumer['contracts']:
        require(row['contract']['ok'] is True and (row['contract'].get('fraction') is None or row['contract']['fraction']['authority'] == 'existing-numeric-or-static-word-authority'), 'exact consumer domain')
    for row in consumer['forgeries']:
        require(row['result']['ok'] is False and row['result']['error']['code'] == 'shader-domain-error', 'closed hostile metadata')
    for row in consumer['banks']:
        for checked in row['checks']:
            require(checked['result']['ok'] is checked['wanted'], 'inherited owned bank/domain guard')
    plans = json.loads(subprocess.check_output(['node', 'tools/virgl-precise-fraction/plan.mjs', native['primaryFile']['path']], cwd=ROOT))
    words = pixels = primary_words = primary_pixels = 0
    for seed, plan in zip(SEEDS, plans):
        gpu = browser('gpu-' + str(seed))
        require(gpu['seed'] == seed and gpu['fault'] is None, 'varied seed witness')
        planned_raw = subprocess.check_output(['node','--input-type=module','-e', "import fs from 'node:fs';import {physicalPlan} from './tools/virgl-precise-fraction/plan.mjs';process.stdout.write(JSON.stringify(physicalPlan("+str(seed)+",JSON.parse(fs.readFileSync('renderer/virgl-shader/build/precise-fraction-primary.json')))));"],cwd=ROOT)
        require(gpu['planSha256'] == sha(planned_raw), 'complete pre-observation schedule digest')
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
                require(vertex['predicate'] is False and chosen == vector['selectedWords'], 'independent mathematical scalar result')
                require(vector['inputWords'] == (vector['input']['a'] if vertex['inputSource'] else None), 'physical input source words')
                wanted = [struct.unpack('<I', struct.pack('<f', x))[0] for x in vector['position']]
                wanted += [(x & 0x7fffff) | 0x3f000000 for x in chosen] + [(x >> 23) | 0x3f000000 for x in chosen]
                raw = bytes(vector['bytes'])
                require(len(raw) == 48 and sha(raw) == vector['sha256'], 'feedback bytes binding')
                actual = list(struct.unpack('<12I', raw))
                require(actual == vector['observed'] and vector['expectedWords'] == wanted and vector['checkedWords'] == 12, 'physical scalar bytes/source predictions')
                allowed = [[0x3f000000,0x3f000100] if i >= 8 and zero_allowed(vertex, i-8) and (chosen[i-8] & 0x7fffffff) == 0 else [w] for i,w in enumerate(wanted)]
                require(vector['allowedWords'] == allowed and all(w in allowed[i] for i,w in enumerate(actual)), 'independent physical scalar/ordinary zero contract')
                reconstructed = [((actual[8+i] & 511) << 23) | (actual[4+i] & 0x7fffff) for i in range(4)]
                allowed_results = [[0,0x80000000] if zero_allowed(vertex, i) and (w & 0x7fffffff) == 0 else [w] for i, w in enumerate(chosen)]
                require(reconstructed == vector['reconstructed'] and vector['allowedResults'] == allowed_results and all(w in allowed_results[i] for i,w in enumerate(reconstructed)), 'all32 scalar bits/primary mathematical zeros')
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
            require(fragment['selectedWords'] == chosen and fragment['expectedBytes'] == expected_bytes, 'source-only plane prediction')
            require(all(v == expected_bytes[i%4] or ((fragment['backend'] == 'mesa' or fragment['op'] == 'FRC') and fragment['plane'] == 31 and (chosen[i%4] & 0x7fffffff) == 0 and v in [0,255]) for i,v in enumerate(raw)), 'independent all32 scalar bit planes')
            if fragment['backend'] == 'owned':
                own_pixels += 16
            else:
                primary_pixels += 16
            pixels += 16
        require(own_words > 0 and own_pixels > 0, 'owned full-word scalar hardware proof')
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
                converted = [(int(math.trunc(struct.unpack('<f',struct.pack('<I',w))[0]) < 0) ^ int(fraction_word(w) != 0)) if component['mask'] & (1 << i) else 0 for i,w in enumerate(source_words)]
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
    for mode in ['negative','rounding','special']:
        gpu = browser('fault-' + mode, passed=False)
        require(gpu['fault'] == mode and 'independent scalar word mismatch' in gpu['failure']['message'], 'physical precise fraction corruption caught')
        mutated = [x for x in gpu['vertices'] if x['mutation']]
        require(len(mutated) == 1 and mutated[0]['mutation']['original'] != mutated[0]['mutation']['served'], 'one real emitted-source corruption')
        point = next(v['failure'] for v in mutated[0]['vectors'] if 'failure' in v)
        require(point['expected'] != point['actual'], 'physical contradicted prediction')
        mutation = mutated[0]['mutation']
        require(mutation['original'] == mutated[0]['pair']['vertex']['glsl'] and mutation['served'] == mutation['original'].replace(mutation['needle'], mutation['replacement'], 1), 'one actual emitted helper mutation')
        faults.append(dict(mode=mode, op=mutated[0]['op'], failure=point))
    paths = subprocess.check_output(['git', 'ls-files', 'renderer/virgl-shader', 'tools/virgl-precise-fraction',
        'renderer/virgl-command/state.mjs', 'renderer/virgl-command/constant-domain.mjs', 'renderer/virgl-command/decoder.mjs',
        'renderer/virgl-command/resources.mjs', 'tools/virgl-compiler-bounds/retained.mjs', 'tools/lib/virgl-browser-runner.mjs',
        'tools/setup-virgl-emsdk.sh', 'tools/verify-virgl-precise-fraction.sh', 'tools/virgl-signed-conversions/cases.mjs', 'tools/virgl-signed-conversions/combined.mjs', 'tools/virgl-scalar-operations/combined.mjs', 'tools/virgl-minimum-selection/cases.mjs', 'tools/virgl-minimum-selection/combined.mjs', 'tools/virgl-precise-arithmetic/oracle.mjs', 'Makefile', 'web/package-lock.json'], cwd=ROOT, text=True).splitlines()
    for name in paths:
        source(name)
    for name in ['native/virgl-shader', 'wasm/virgl-shader.mjs', 'wasm/virgl-shader.wasm']:
        source('renderer/virgl-shader/build/' + name)
    for file in sorted(directory.rglob('*')):
        if file.is_file() and file.name not in ['receipt.json', 'acceptance.log']:
            artifact(str(file.relative_to(directory)))
    receipt = dict(schema='virgl-precise-fraction-receipt-v1', task=TASK, status='passed', gitHead=head,
        guestExecution=False, productionNegotiation=False, nativeCases=1919, primaryComparisons=1897, helperWordPredictions=7968,
        wasmCases=1919, wasmPairs=1919, retainedOriginals=25, retainedAdmissions=23,
        promotedBoundsCases=402, promotedHexCases=49, promotedSignedCases=108, promotedConversionCases=1575, promotedScalarCases=1427, promotedMinimumCases=4524,
        metadataAttacks=591, ownedRangeBanks=13, combinedBases=4, legacyCases=1014, legacyFractionMigrations=2,
        recordingHeads=sorted(recording_heads), incrementalHarnessRepairs=sorted(harness_repairs),
        checkedWords=words, checkedPixels=pixels, primaryWords=primary_words, primaryPixels=primary_pixels, physicalOutputFaults=faults,
        sources=list(sources.values()), records=list(records.values()))
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'{TASK} receipt passed: {words} exact words / {pixels} pixels')


if __name__ == '__main__':
    main()
