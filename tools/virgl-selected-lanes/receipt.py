#!/usr/bin/env python3
"""Interrogate exact-source selected-lane native, Wasm and physical GPU evidence."""
import copy
import json
from pathlib import Path
import struct
import subprocess
import sys
from shared import ROOT, require, sha, read, binding, source, same, git
import native_receipt
import wasm_receipt
import faults
import retained

BASE = native_receipt.load('selected_browser_envelope', 'tools/virgl-constants/receipt.py')
COVERAGE = ['renderer/virgl-command/tests/selected-lanes.mjs',
            'renderer/virgl-command/tests/selected-lanes-oracle.mjs',
            'renderer/virgl-command/state.mjs', 'renderer/virgl-command/constant-domain.mjs']


def u32s(values, length=None):
    require(type(values) is list and (length is None or len(values) == length)
            and all(type(x) is int and 0 <= x <= 0xffffffff for x in values), 'typed complete raw words')


def browser_envelope(directory, head, fault=None):
    directory = Path(directory)
    r = read(directory / 'report.json')
    require(r['task'] == 'E6-T12f2' and r['gitHead'] == head
            and r['status'] == ('failed' if fault else 'passed') and r['guestExecution'] is False
            and r['currentGuest3dAdvertisement'] is False, 'exact isolated browser identity')
    require(r['trackedChanges'] == [] and same(r['browserErrors'], {'console': [], 'page': [], 'requests': []}),
            'frozen error-free browser sources')
    sources = {e['path']: e for e in r['sources']}
    served = {e['path']: e for e in r['servedFiles']}
    require(len(sources) == len(r['sources']) and len(served) == len(r['servedFiles']), 'unique complete source inventory')
    for item in sources.values(): BASE.verify_source(item, head)
    matches = []
    for name, item in served.items():
        require(type(item['size']) is int and item['size'] >= 0, 'typed served browser bytes')
        if name in sources: require(same(item, sources[name]), 'unchanged served support source')
        else:
            require(fault is not None and item['sha256'] == fault['wasm']['sha256']
                    and item['size'] == fault['wasm']['bytes'] and name.endswith('/' + fault['wasm']['path']),
                    'only sealed actual compiler fault bytes may differ')
            matches.append(name)
    wasm = 'renderer/virgl-shader/build/wasm/virgl-shader.wasm'
    if fault:
        require(len(matches) == 1 and r['acceptance']['faultWasmSha256'] == fault['wasm']['sha256'],
                'browser consumed exactly the real source-fault compiler')
    else: require(wasm in served and same(served[wasm], sources[wasm]), 'browser consumed current fixed-memory compiler')
    browser = r['browser']
    require(browser['gpu']['featureStatus'][browser['webglFeature']] == 'enabled', 'actual hardware WebGL')
    qualified = {'browserVersion': browser['version'], **{k: r['host'][k] for k in ('platform', 'architecture', 'release')},
                 'renderer': r['acceptance']['renderer']['renderer']}
    require(qualified in read(ROOT / 'docs/gpu-3d-contract.json')['browserMatrix']['qualified'], 'qualified real hardware/browser')
    require(not any('--disable-gpu' in a or 'swiftshader' in a.lower() for a in browser['actualCommandLine']), 'real GPU launch')
    photo = r['failureScreenshot'] if fault else r['screenshot']
    raw = (directory / photo['path']).read_bytes()
    require(raw.startswith(b'\x89PNG') and sha(raw) == photo['sha256'], 'recorded physical browser screenshot')
    coverage = r['browserCoverage']; raw = (directory / coverage['path']).read_bytes()
    require(sha(raw) == coverage['sha256'], 'actual V8 coverage digest')
    exported = json.loads(raw)
    require(same(list(exported), ['schema', 'scripts']) and type(exported['schema']) is int and exported['schema'] == 1
            and [e['source'] for e in exported['scripts']] == COVERAGE, 'complete bounded runtime coverage inventory')
    for script in exported['scripts']:
        require(script['source'] in served and script['sha256'] == served[script['source']]['sha256'], 'served runtime counters')
        c = script['coverage']; require(set(c) == {'scriptId', 'url', 'functions'} and c['functions'], 'actual script coverage')
        for f in c['functions']:
            require(set(f) == {'functionName', 'ranges', 'isBlockCoverage'} and type(f['functionName']) is str
                    and type(f['isBlockCoverage']) is bool and f['ranges'], 'closed actual function coverage')
            for reg in f['ranges']:
                require(set(reg) == {'startOffset', 'endOffset', 'count'}
                        and all(type(reg[k]) is int and reg[k] >= 0 for k in reg) and reg['endOffset'] >= reg['startOffset'],
                        'typed real V8 counters')
        require(any(reg['count'] > 0 for f in c['functions'] for reg in f['ranges']), 'runtime path actually executed')
    return r


def instrument(stage, result, kernel, category, poison):
    """Reconstruct the explicit diagnostic projection; normal compiler results stay exact."""
    if stage != kernel['stage'] or category == 'normal': return result
    result = copy.deepcopy(result); code = result['glsl']; seam = ' highp vec4 float_rhs;\n'
    require(code.count(seam) == 1, 'one actual shadow declaration')
    if category == 'observer':
        code = code.replace(seam, seam + ' highp uint demand_reads = 0u;\n')
        mark = ' /* guarded interpolation */\n'; require(code.count(mark) == 1, 'one real guarded instruction')
        start = code.index(mark); brace = code.index('{\n', start)
        code = code[:brace+2] + ' demand_reads = 1u;\n' + code[brace+2:]
        end = code.rindex('}\n')
        code = code[:end] + ' ' + ('vso_g0' if stage == 'vertex' else 'fsout_c0') + ' = vec4(float(demand_reads));\n' + code[end:]
    else:
        require(category == 'poison', 'closed diagnostic category'); u32s(poison, 4)
        register = kernel['roles']['payload']
        code = code.replace(seam, seam + f' raw_temp[{register}] = uvec4(' + ', '.join(str(x)+'u' for x in poison)
                            + f');\n float_temp[{register}] = uintBitsToFloat(raw_temp[{register}]);\n')
    result['glsl'] = code
    return result


def geometry():
    vertices, indices = [], []
    bits = lambda value: struct.unpack('<I', struct.pack('<f', value))[0]
    for bit in range(32):
        first = len(vertices) // 8
        for dx, dy in ((0,0), (1,0), (1,1), (0,1)):
            vertices += [bits(-1+(bit+dx)/16), bits(-1+dy/16), (96+bit)*8388608+4194304,
                         96*8388608+4194304, 0x3e800000, 0x3f400000, 0x3f000017, 0x3e000000]
        indices += [first, first+1, first+2, first, first+2, first+3]
    return {'width':64, 'height':64, 'stride':32, 'vertexWords':vertices, 'indexWords':indices}


def pixels(words=None, demand=None):
    result = bytearray()
    for y in range(64):
        for x in range(64):
            result.extend([0,0,255,255] if y >= 2 else ([255 if demand else 0]*4 if demand is not None
                          else [((word >> (x//2)) & 1)*255 for word in words]))
    return list(result)


def verify_gpu(p, native, fixture, reference, mode='normal', fault_results=None, fault_pairs=None):
    require(p['schema'] == 'selected-lanes-gpu-v1' and p['mode'] == mode and p['guestExecution'] is False
            and p['status'] == ('passed' if mode == 'normal' else 'failed'), 'closed isolated GPU claim')
    for key,path in (('fixture','renderer/virgl-shader/tests/selected-lanes-cases.json'),
                     ('partners','renderer/virgl-command/tests/bounded-loops-shaders.json')):
        require(same(p[key],binding(ROOT/path)), 'actual bound literal GPU fixture')
    for name in ('checkedWords','checkedPixels','observerPixels'):
        require(type(p[name]) is int and p[name] >= 0, 'typed physical totals')
    expected_rigs = []
    for kernel in fixture['kernels']:
        if mode != 'normal' and (kernel['variant'] != 'plain' or kernel['roles']['form'] != 'a'): continue
        categories = (['poison'] if mode == 'width-proof' else ['observer'] if mode == 'guard-open'
                      else ['normal'] + (['observer'] if kernel['variant'] in ('plain','old-destination','discarded-nan') else []))
        for category in categories:
            for poison in ([[0]*4, [0x3f800000]*4] if category == 'poison' else [None]):
                expected_rigs.append((kernel, category, poison))
    require(len(p['rigs']) == len(expected_rigs), 'every hardware kernel and independent diagnostic rig')
    all_cases = {e['name']: e for e in native['cases']}
    all_cases.update({e['name']: e for e in native['loopCases']})
    all_pairs = {e['name']: e for e in native['pairs']}
    words = word_pixels = observer_pixels = 0
    for rig, (kernel, category, poison) in zip(p['rigs'], expected_rigs):
        require(same(rig['kernel'], kernel) and rig['category'] == category and same(rig['poison'], poison), 'literal complete rig identity')
        input_name = 'reject-a-nonzero-missing-width-' + kernel['stage'] if mode == 'width-proof' else kernel['case']
        require(rig['input'] == input_name and same(rig['geometry'], geometry()), 'exact shader and physical geometry')
        entries = rig['translations']; require([e['kind'] for e in entries] == ['single','single','pair'], 'actual singles and linked pair')
        names = [input_name if kernel['stage']=='vertex' else 'pass-vertex', input_name if kernel['stage']=='fragment' else 'pass-fragment']
        for entry, name, stage in zip(entries[:2], names, ('vertex','fragment')):
            wanted = fault_results[name] if mode != 'normal' and name == input_name else all_cases[name]['result']
            require(same(entry['request'], {'stage':stage, 'text':all_cases[name]['text']}) and same(entry['actual'], wanted), 'actual compiler single equals native full output')
            require(same(entry['result'], instrument(stage, wanted, kernel, category, poison)), 'only explicit diagnostic shader changes')
        pair = entries[2]
        wanted_pair = all_pairs['gpu-'+kernel['case']+'-pair']['result'] if mode == 'normal' else fault_pairs[input_name+'-pair']['result']
        require(same(pair['request'], {'vertexText':all_cases[names[0]]['text'], 'fragmentText':all_cases[names[1]]['text']})
                and same(pair['actual'], wanted_pair), 'actual native/Wasm pair output')
        transformed = {**wanted_pair, 'vertex':instrument('vertex',wanted_pair['vertex'],kernel,category,poison),
                       'fragment':instrument('fragment',wanted_pair['fragment'],kernel,category,poison)}
        require(same(pair['result'], transformed), 'exact checked pair and diagnostic projection')
        sources = [e['source'] for e in rig['glEvents'] if e['call']=='shaderSource']
        expected_sources = [e['result']['glsl'] for e in entries[:2]]
        expected_sources += [transformed[stage]['glsl'] for index,stage in enumerate(('vertex','fragment'))
                             if transformed[stage]['glsl'] != entries[index]['result']['glsl']]
        require(same(sources, expected_sources), 'shared renderer compiles actual standalone and checked qualifier shader bytes')
        for event in rig['glEvents']:
            if event['call'] in ('compileShader','linkProgram'): require(event['status'] is True, 'actual native compile/link succeeds')
            if event['call']=='uniform4uiv':
                u32s(event['words']); require(same(event['words'],event['observed']) and event['programId']==event['currentProgramId'], 'physical uint bank readback on owned program')
        creates=[e['id'] for e in rig['glEvents'] if e['call'].startswith('create')]
        deletes=[e['id'] for e in rig['glEvents'] if e['call'].startswith('delete')]
        require(len(creates)==len(set(creates)) and len(deletes)==len(set(deletes)) and set(creates)==set(deletes)
                and rig['objects']['created']==len(creates), 'actual complete object creation/deletion trace')
        require(len([e for e in rig['glEvents'] if e['call']=='drawElements']) == len(rig['draws']), 'every capture corresponds to one real shared draw')
        inputs = rig['resourceInputs']; require([e['id'] for e in inputs]==[101,102,103], 'owned real resources')
        for capture, item, fmt, values in zip(rig['bufferReadbacks'],inputs[:2],('I','H'),(geometry()['vertexWords'],geometry()['indexWords'])):
            wanted_bytes=list(struct.pack('<'+fmt*len(values),*values))
            require(capture['resourceId']==item['id'] and same(capture['bytes'],wanted_bytes) and same(item['bytes'],wanted_bytes), 'actual immutable native vertex/index input bytes')
        require(type(rig['objects']['created']) is int and rig['objects']['created']>0 and type(rig['objects']['live']) is int
                and rig['objects']['live']==0 and all(type(x) is int and x==0 for x in list(rig['finalBudgets'].values())+list(rig['finalResourceBudgets'].values())), 'all native objects and owned budgets released')
        vectors = [next(v for v in fixture['vectors'] if v['name']=='discarded')] if category=='poison' else fixture['vectors'][:2] if mode=='guard-open' else fixture['vectors']
        require(len(rig['draws'])==len(vectors), 'every literal predecessor drawn')
        for d, vector in zip(rig['draws'],vectors):
            oracle = reference['cases'][kernel['case']][vector['name']]
            require(same(d['vector'],vector) and same(d['bank'],oracle['bank']) and same(d['oracle'],{k:v for k,v in oracle.items() if k!='bank'}), 'independent literal predecessor/version/demand trace')
            require(type(d['checkedPixels']) is int and d['checkedPixels']==4096 and type(d['submission']) is int, 'typed physical capture')
            submission=rig['submissions'][d['submission']]
            require(submission['result']['ok'] is True and same(submission['result']['draws'],[d['draw']]) and d['draw']['count']==192
                    and d['draw']['actualMinIndex']==0 and d['draw']['actualMaxIndex']==127 and d['draw']['framebuffer']['resourceId']==103, 'actual prepared shared renderer indexed draw')
            uploads=[e for e in rig['glEvents'][submission['eventsStart']:submission['eventsEnd']] if e['call']=='uniform4uiv']
            require(uploads and all(len(e['words'])==184 and same(e['words'],oracle['bank']) for e in uploads), 'draw actually uploaded the checked complete current bank')
            raw=d['rgbaBytes']; require(type(raw) is list and len(raw)==16384 and all(type(x) is int and 0<=x<=255 for x in raw)
                                       and sha(bytes(raw))==d['rgbaSha256'], 'typed physical framebuffer bytes and digest')
            wanted_words = poison if category=='poison' else oracle['words']
            demand = True if mode=='guard-open' else oracle['demanded']
            expected_pixels=pixels(demand=demand) if category=='observer' else pixels(words=wanted_words)
            require(same(raw,expected_pixels), 'every independent physical bit/pixel')
            if category=='observer':
                require(d['words'] is None, 'observer output has explicit separate scope'); observer_pixels+=4096
                if mode=='guard-open' and not oracle['demanded']:
                    require(same(d['failure'],{'x':0,'y':0,'expectedPixel':[0]*4,'observedPixel':[255]*4}), 'source fault exposes discarded-path execution')
                else: require('failure' not in d, 'defined observer path matches')
            else:
                u32s(d['words'],4); reconstructed=[sum((raw[(2*bit)*4+lane]//255)<<bit for bit in range(32)) for lane in range(4)]
                require(same(reconstructed,wanted_words) and same(d['words'],wanted_words) and 'failure' not in d, 'full four hardware words reconstructed independently')
                words+=4;word_pixels+=4096
    require((p['checkedWords'],p['checkedPixels'],p['observerPixels'])==(words,word_pixels,observer_pixels), 'independent physical totals')
    if mode=='normal': require((words,word_pixels,observer_pixels)==(1216,1245184,196608) and p['poisonWitness']==[], 'complete two-form hardware matrix')
    if mode=='width-proof':
        require(same(p['poisonWitness'],[{'stage':s,'words':[[0]*4,[0x3f800000]*4]} for s in ('vertex','fragment')]), 'independent two-stage missing-data poison witness')
    return {'words':words,'pixels':word_pixels,'observerPixels':observer_pixels,'rigs':len(expected_rigs)}


def verify(output, head):
    output=Path(output).resolve()
    n=native_receipt.verify(output/'native',head); w=wasm_receipt.verify(output/'wasm',head,n)
    fixture=read(ROOT/'renderer/virgl-shader/tests/selected-lanes-cases.json')
    reference_raw=subprocess.check_output(['node','tools/virgl-selected-lanes/oracle.mjs'],cwd=ROOT)
    require((output/'oracle.json').read_bytes()==reference_raw, 'complete independent literal observation recording')
    reference=json.loads(reference_raw)
    primary=browser_envelope(output/'gpu',head); gpu=verify_gpu(primary['acceptance'],n,fixture,reference)
    fm=read(output/'fault-artifacts/manifest.json')
    require(fm['schema']=='selected-lanes-actual-source-faults-v1' and fm['status']=='passed' and fm['gitHead']==head
            and set(fm['modes'])==set(faults.MUTATIONS), 'all real exact-source compiler faults')
    fault_reports=[]
    for mode,(filename,before,after) in faults.MUTATIONS.items():
        rec=fm['modes'][mode]; original=(ROOT/'renderer/virgl-shader'/filename).read_bytes(); mutated=original.replace(before.encode(),after.encode())
        require(original.count(before.encode())==1 and rec['filename']==filename and rec['before']==before and rec['after']==after
                and rec['originalSha256']==sha(original) and rec['mutatedSha256']==sha(mutated), 'one exact actual source mutation')
        for field in ('source','native','pairNative','pairTranslations','wasm','translations','wasmParity','buildLog'):
            require(same(binding(output/'fault-artifacts'/rec[field]['path'],output/'fault-artifacts'),rec[field]), 'actual compiler fault artifact')
        require((output/'fault-artifacts'/rec['source']['path']).read_bytes()==mutated, 'recorded mutated compiler bytes')
        parity=read(output/'fault-artifacts'/rec['wasmParity']['path']); translations=read(output/'fault-artifacts'/rec['translations']['path'])
        require(parity['schema']=='selected-lanes-fault-wasm-v1' and parity['status']=='passed' and parity['wasmSha256']==rec['wasm']['sha256']
                and len(parity['results'])==len(translations)==len(fixture['cases']), 'complete real fault native/Wasm parity')
        for a,b,e in zip(parity['results'],translations,fixture['cases']):
            require(a['name']==b['name']==e['name'] and a['inputSha256']==b['inputSha256']==sha(e['text'].encode())
                    and same(a['result'],b['result']) and same(json.loads(b['stdout']),a['result']), 'all full actual fault compiler results')
        pairs=read(output/'fault-artifacts'/rec['pairTranslations']['path'])
        require(len(pairs)==len(parity['pairs'])==4 and all(a['name']==b['name'] and same(a['result'],b['result'])
                and same(json.loads(b['stdout']),b['result']) for a,b in zip(parity['pairs'],pairs)), 'full native/Wasm real source-fault pair parity')
        authored={e['name']:e for e in fixture['cases']};partners=read(ROOT/'renderer/virgl-command/tests/bounded-loops-shaders.json')['shaders']
        expected_pairs=[]
        for stage in ('vertex','fragment'):
            for prefix in ('a-plain-','reject-a-nonzero-missing-width-'):
                e=authored[prefix+stage]
                expected_pairs.append({'name':e['name']+'-pair','vertexText':e['text'] if stage=='vertex' else next(p['text'] for p in partners if p['name']=='pass-vertex'),
                                       'fragmentText':e['text'] if stage=='fragment' else next(p['text'] for p in partners if p['name']=='pass-fragment')})
        require(all(same({k:e[k] for k in wanted},wanted) for e,wanted in zip(pairs,expected_pairs)), 'literal source-bound actual fault pair requests')
        r=browser_envelope(output/('fault-'+mode),head,rec)
        require(r['mode']==mode and 'independent' in r['acceptance']['failure']['message']
                and all(r['browser'][k]==primary['browser'][k] for k in ('version','executableSha256'))
                and same(r['browser']['gpu']['devices'],primary['browser']['gpu']['devices']), 'fault fails the independent oracle on the same hardware')
        result=verify_gpu(r['acceptance'],n,fixture,reference,mode,{e['name']:e['result'] for e in translations},{e['name']:e for e in pairs})
        fault_reports.append({'mode':mode,**result,'report':binding(output/('fault-'+mode)/'report.json',output)})
    old_gpu=retained.verify(output,head,n)
    # Bind changed sources plus every held verifier dependency actually imported.
    held_receipt=read(ROOT/'evidence/virgl-raw-equality/proof-response/receipt.json')
    paths={item['path'] for item in held_receipt['sources']}
    for directory in (ROOT/'tools/virgl-selected-lanes', ROOT/'renderer/virgl-shader'):
        paths.update(str(p.relative_to(ROOT)) for p in directory.rglob('*') if p.is_file()
                     and not any(part.startswith('.') or part in ('build','__pycache__') for part in p.relative_to(directory).parts))
    paths.update(COVERAGE + ['tools/verify-virgl-selected-lanes.sh'])
    paths.update(str(p.relative_to(ROOT)) for p in (ROOT/'renderer/virgl-command').glob('*.mjs'))
    sources=[binding(ROOT/p) for p in sorted(paths)]
    for item in sources: source(item,head)
    for item in fm['sources']: source(item,head)
    records=[binding(p,output) for p in sorted(output.rglob('*')) if p.is_file() and p.name not in ('receipt.json','acceptance.log')]
    production=read(ROOT/'docs/gpu-3d-contract.json')['production']
    require(same(production,json.loads(git('show',native_receipt.producer.HELD_HEAD+':docs/gpu-3d-contract.json'))['production']), 'production GPU advertisement stays gated')
    if (output/'negative-receipts.json').exists():
        # The second sealing pass binds the first positive receipt and all promoted rejection results.
        import receipt_attacks
        negative=read(output/'negative-receipts.json')
        expected_names=['gpu/'+n for n in receipt_attacks.GPU_ATTACKS]+['wasm/'+n for n in receipt_attacks.WASM_ATTACKS]
        require(negative['schema']=='selected-lanes-negative-receipts-v1' and negative['status']=='passed'
                and [r['name'] for r in negative['results']]==expected_names
                and all(r['outcome']=='rejected' and type(r['reason']) is str and r['reason'] for r in negative['results']), 'all promoted typed proof forgeries rejected')
        positive=negative['positiveReceipt'];raw=(output/'positive-receipt.json').read_bytes()
        require(positive['path']=='receipt.json' and type(positive['bytes']) is int and positive['bytes']==len(raw)
                and positive['sha256']==sha(raw) and json.loads(raw)['gitHead']==head, 'first exact-head positive proof bound')
    return {'schema':'selected-lanes-submission-v1','task':'E6-T12f2','status':'passed','gitHead':head,
            'heldHead':native_receipt.producer.HELD_HEAD,'guestExecution':False,'production':production,
            'predecessorFullGateClaimed':False,'native':{k:n[k] for k in ('stats','layout','flow','recordedMaxima','compatibility')},
            'wasm':w,'gpu':gpu,'retainedGpu':old_gpu,'faults':fault_reports,'sources':sources,'records':records}


if __name__=='__main__':
    output=Path(sys.argv[1]).resolve(); report=verify(output,git('rev-parse','HEAD').decode().strip())
    (output/'receipt.json').write_text(json.dumps(report,indent=2)+'\n')
    print('E6-T12f2 recorded native/Wasm/shared GPU selected-lane proof passed.')
