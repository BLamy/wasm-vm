#!/usr/bin/env python3
"""Independent E6-T12e2 file/parity/pixel audit. No worker checker imports/builds."""
import hashlib
import json
import re
import struct
import subprocess
from collections import Counter
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HEAD = '8b7106488b84c256cae7f4eae87eee16a4f09eee'
BASE = 'cffb8d57'
FLAT = '67c701faf0ee06bcefdc246cd8b73f7b8d6278cc2403aa99c18d1912fbb9a0aa'
ANCHORS = {'worker':'d25f140bc69845e49660eb362b7f9edfd52f63e2f606241b76f2ea93b3de891a',
           'cold-clone/acceptance':'6bf2d0baa115bf3f312348cd2ed1f72a81bbc6222a5cb56c60314b8396ba4b9d'}
COLD_SHA = '334bea0d3044c94950be086c47d758986ff27c1e1063e5f68f32011fa889ebd3'
CACHE = {}
COUNTS = Counter()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path):
    return json.loads(path.read_text())


def check(value, name):
    if not value:
        raise AssertionError(name)
    COUNTS[name.split(':')[0]] += 1


def git(*args, cwd=ROOT):
    return subprocess.check_output(['git', *args], cwd=cwd)


def blob(name, revision=HEAD):
    key = name, revision
    if key not in CACHE:
        result = subprocess.run(['git','show',f'{revision}:{name}'],cwd=ROOT,capture_output=True)
        CACHE[key] = result.stdout if result.returncode == 0 else None
    return CACHE[key]


def binding(root, item, source=False):
    path = root / item['path']
    raw = path.read_bytes()
    check(sha(raw) == item['sha256'], f'digest:{path}')
    size = item.get('bytes', item.get('size'))
    check(size is None or len(raw) == size, f'size:{path}')
    if source:
        frozen = blob(item['path'])
        if frozen is not None:
            check(frozen == raw, f'frozen-source:{path}')


def pixel_oracle(draw):
    order, mode = draw['order'], draw['mode']
    check(order in ([0,1,2],[1,2,0]) and draw['indices'] == order, 'triangle-indices')
    check(draw['width'] == draw['height'] == 32, 'triangle-viewport')
    expected = {}
    for x,y in [(4,4),(12,4),(20,4),(4,12),(12,12),(4,20),(8,8)]:
        # Independent rational barycentric interpolation of fixed vertex RGB.
        weights = [1-Fraction(2*x+1,64)-Fraction(2*y+1,64),Fraction(2*x+1,64),Fraction(2*y+1,64)]
        check(all(w > 0 for w in weights), 'sample-strict-interior')
        colors = [(0,0),(1,0),(0,1)]
        channels = [sum(weights[v]*colors[v][c] for v in range(3)) for c in range(2)]
        if mode == 'flat':
            channels = colors[order[-1]]
        elif mode == 'mixed':
            channels[0] = [0,Fraction(1,4),1][order[-1]]
        else:
            check(mode == 'smooth', 'known-pixel-mode')
        expected[x,y] = [int(channel*255+Fraction(1,2)) for channel in channels]+[0,255]
    for x,y in [(28,28),(28,12),(12,28)]:
        check(Fraction(2*x+1,64)+Fraction(2*y+1,64)>1, 'sample-strict-exterior')
        expected[x,y] = [0,0,255,255]
    actual = {tuple(item['pixel']):item for item in draw['checks']}
    check(set(actual)==set(expected) and len(draw['checks'])==draw['checkedPixels']==10, 'complete-pixel-set')
    for point,rgba in expected.items():
        check(actual[point]['observed']==actual[point]['expected']==rgba,'independent-pixel')


def main():
    base = ROOT / 'evidence/virgl-pairs'
    cold = read(base/'cold-clone/report.json')
    check(sha((base/'cold-clone/report.json').read_bytes())==COLD_SHA,'cold-report-anchor')
    check(cold['gitHead']==cold['cloneHead']==cold['cloneHeadAfter']==HEAD,'cold-heads')
    check(cold['status']=='passed' and cold['exitCode']==0 and cold['statusBefore']==cold['statusAfter']=='','cold-clean-success')
    clone = Path(cold['clone'])
    check(git('rev-parse','HEAD',cwd=clone).decode().strip()==HEAD,'retained-head')
    check(git('status','--porcelain','--untracked-files=all',cwd=clone)==b'','retained-clean')
    check(sha(blob('tools/virgl-pairs/cold.py'))==cold['harnessSha256'],'cold-frozen-harness')
    check(sha((base/'cold-clone/cold.log').read_bytes())==cold['logSha256'],'cold-log')
    for item in cold['acceptanceFiles']:
        binding(base/'cold-clone',item)
    prior = json.loads(blob('docs/gpu-3d-contract.json',BASE))['capturedShaders']
    prior_accepted = {digest for digest,result in prior.items() if result['currentBridge']=='translated'}
    check(len(prior_accepted)==11 and FLAT not in prior_accepted,'eleven-prior-identities')
    fixtures = read(ROOT/'renderer/virgl-shader/tests/pair-cases.json')
    check(len(fixtures)==114 and sum(x['ok'] for x in fixtures)==75,'pair-fixture-count')
    summaries = {}
    for label, anchor in ANCHORS.items():
        directory = base/label
        source_root = clone if label.startswith('cold') else ROOT
        receipt = read(directory/'receipt.json')
        check(sha((directory/'receipt.json').read_bytes())==anchor,'receipt-anchor')
        check(receipt['gitHead']==HEAD and receipt['status']=='passed','receipt-head')
        for item in receipt['sources']:
            check(blob(item['path']) is not None,'receipt-source-tracked')
            binding(source_root,item,True)
        for item in receipt['records']:
            binding(directory,item)
        for filename,digest in receipt['compilerSha256'].items():
            check(sha(Path(filename).read_bytes())==digest,'compiler-binding')
        # All nested receipts and runtime browser reports belong to this head,
        # including preserved component, shader, draw and state suites.
        report_count = 0
        for path in sorted(directory.rglob('*.json')):
            document = read(path)
            if not isinstance(document,dict):
                continue
            if 'sources' in document and isinstance(document['sources'],list):
                for item in document['sources']:
                    binding(source_root,item,True)
            if 'servedFiles' in document:
                for item in document['servedFiles']:
                    if item['path']=='/':
                        wrapper='tools/'+Path(document['command'][1]).name
                        html=re.search(r'const html = `([^`]+)`;',blob(wrapper).decode()).group(1).encode()
                        check(sha(html)==item['sha256'] and len(html)==item['bytes'],'prior-draw-served-html')
                    elif item['path']=='/fixtures.json':
                        expected=document.get('sabotage',{}).get('servedSha256',document['fixtureTransport']['sha256'])
                        check(item['sha256']==expected,'prior-draw-served-fixture-transport')
                    else:
                        binding(source_root,{**item,'path':item['path'].lstrip('/')},True)
            if path.name=='report.json' and 'gitHead' in document:
                report_count+=1
                check(document['gitHead']==HEAD,'nested-report-head')
                check(document.get('trackedChanges',[])==[],'nested-report-clean-sources')
                if 'browserErrors' in document:
                    check(all(not value for value in document['browserErrors'].values()),'nested-browser-errors')
        corpus = read(directory/'components/regression/contract/receipt.json')['capturedShaderResults']
        check(set(corpus)==set(prior),'all19-original-identities')
        check({h for h,r in corpus.items() if r['ok']}==prior_accepted|{FLAT},'exact12-original-identities')
        check(Counter('translated' if r['ok'] else r['error']['code'] for r in corpus.values())=={'translated':12,'unsupported-feature':7},'original-outcomes')
        native = read(directory/'native/native-report.json')
        check(native['sanitizers']==['address','undefined'] and native['status']=='passed','native-sanitizers')
        check(sha((directory/'native/native.log').read_bytes())==native['logSha256'],'native-log')
        logged={'ORIGINAL':{},'PAIR':{}}
        for line in (directory/'native/native.log').read_text().splitlines():
            match=re.fullmatch(r'(ORIGINAL|PAIR) ([0-9]+) (.+)',line)
            if match:
                logged[match[1]][int(match[2])]=json.loads(match[3])
        for category,items in [('ORIGINAL',native['originals']),('PAIR',native['cases'])]:
            check(len(logged[category])==len(items),'native-log-result-count')
            for index,item in enumerate(items):
                check(logged[category][index]==item['result'],'native-log-result-parity')
        check(sha((source_root/'renderer/virgl-shader/build/pair-sanitize/pair-test').read_bytes())==native['binarySha256'],'native-binary')
        check({x['sha256']:x['result'] for x in native['originals']}==corpus,'native19-parity')
        stream=bytearray(b'VGP1'+struct.pack('<I',19))
        for item in native['originals']:
            binding(source_root,item,True)
            raw=blob(item['path'])
            check(raw==blob(item['path'],BASE) and sha(raw)==item['sha256'],'unchanged-original-bytes')
            if not item['result']['ok']:
                check(b'PRECISE' in raw,'precise-remains-rejected')
            stream+=struct.pack('<III',int(item['stage']=='fragment'),int(item['result']['ok']),len(raw))+raw
        stream+=struct.pack('<I',len(fixtures))
        for case,fixture in zip(native['cases'],fixtures):
            check(case['name']==fixture['name'] and case['result']['ok']==fixture['ok'],'pair-literal-outcome')
            values=[fixture[key].encode('ascii') for key in ('name','vertexText','fragmentText')]
            stream+=struct.pack('<IIII',int(fixture['ok']),*(len(v) for v in values))+b''.join(values)
            for stage in ('vertex','fragment'):
                check(case[stage+'Sha256']==sha(fixture[stage+'Text'].encode()),'pair-input-digest')
        check(len(native['cases'])==114 and sha(stream)==native['streamSha256'],'native-stream-reconstruction')
        hardware=read(directory/'hardware/report.json')
        sabotage=read(directory/'sabotage/report.json')
        for report in [hardware,sabotage]:
            check(report['browser']['gpu']['featureStatus'][report['browser']['webglFeature']]=='enabled','hardware-webgl-enabled')
            check('Apple M4 Max' in report['acceptance']['renderer']['renderer'] and 'Metal' in report['acceptance']['renderer']['renderer'],'actual-hardware-identity')
            served={x['path']:x['sha256'] for x in report['servedFiles']}
            for name in ['renderer/virgl-command/state.mjs','renderer/virgl-shader/index.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/resources.mjs','renderer/virgl-command/tests/flat-pairs.mjs']:
                check(served[name]==sha(blob(name)),'served-actual-runtime')
            proof=report['acceptance']['shaderPairs']
            check({x['sha256']:x['result'] for x in proof['corpus']}==corpus,'wasm19-parity')
            check(len(proof['cases'])==114,'wasm-pair-count')
            for actual,expected in zip(proof['cases'],native['cases']):
                check(actual=={k:expected[k] for k in ['name','vertexSha256','fragmentSha256','result']},'all114-native-wasm-parity')
            check(proof['recovery']=={'rounds':2,'conversions':912},'pair-recovery-count')
        proof=hardware['acceptance']['shaderPairs']; renderer=hardware['acceptance']['rendererPairs']
        anchors={x['name']:x for x in proof['anchors']}
        native_pairs={(x['vertexSha256'],x['fragmentSha256']):x['result'] for x in native['cases']}
        check(anchors['flat']['fragmentSha256']==FLAT,'original-flat-hardware-anchor')
        for item in anchors.values():
            check(native_pairs[item['vertexSha256'],item['fragmentSha256']]==item['result'],'hardware-anchor-native-parity')
            for stage in ['vertex','fragment']:
                check(sha(item[stage+'Text'].encode())==item[stage+'Sha256'],'anchor-original-text')
        check(len(proof['draws'])==8 and len(renderer['draws'])==44,'all52-draws')
        for draw in proof['draws']:
            pixel_oracle(draw)
            for stage in ['vertex','fragment']:
                check(draw[stage+'GlslSha256']==sha(anchors[draw['mode']]['result'][stage]['glsl'].encode()),'direct-compiled-source')
            check(draw['programLogs']=={'vertex':'','fragment':'','link':''},'direct-compile-link')
        rigs=[renderer['primary'],renderer['mixed'],*renderer['faults'],*renderer['quota'],renderer['negatives']]
        for draw in renderer['draws']:
            pixel_oracle(draw)
            program=draw['program']
            check(program['key']==f"{program['vertexGeneration']}:{program['fragmentGeneration']}:{program['interfaceKey']}",'renderer-generation-interface-key')
            check(program['interfaceKey']==anchors[draw['mode']]['result']['interfaceKey'],'renderer-anchor-key')
            check(draw['programId']==draw['requestedProgramId'],'actual-selected-program')
            matches=[(rig,event) for rig in rigs for event in rig['glEvents'] if event['call']=='drawElements' and event['label']==draw['name']+' draw']
            check(len(matches)==1,'unique-actual-draw-event')
            rig,event=matches[0]
            check(event['programId']==draw['programId'] and event['count']==3,'actual-program-draw-event')
            check(any(e['call']=='linkProgram' and e['id']==draw['programId'] and e['status'] is True for e in rig['glEvents']),'actual-program-link-event')
        phases=renderer['draws']
        check(phases[0]['programId']==phases[2]['programId']==phases[4]['programId'] and phases[1]['programId']==phases[3]['programId']==phases[5]['programId'] and phases[0]['programId']!=phases[1]['programId'],'smooth-flat-reuse-identities')
        for rig in rigs:
            check(all(v==0 for v in rig['finalBudgets'].values()) and rig['glObjects']['live']==0,'rig-cleanup')
            for pair in rig['pairTranslations']:
                identity=tuple(sha(pair['request'][stage+'Text'].encode()) for stage in ['vertex','fragment'])
                check(native_pairs[identity]==pair['original'],'renderer-real-pair-native-parity')
        failed=sabotage['acceptance']['rendererPairs']['draws'][-1]
        check(failed['failure']=={'pixel':[4,4],'expected':[0,255,0,255],'observed':[36,36,0,255]},'stale-program-pixel-failure')
        check(failed['programId']!=failed['requestedProgramId'],'stale-program-real-identity')
        regressions={}
        for name,draws,pixels in [('components/regression/literal',9,4336),('components/regression/captured',3,768),('components/hardware',10,4736)]:
            result=read(directory/name/'report.json')['acceptance']
            check(result['status']=='passed' and len(result['draws'])==draws and result['checkedPixels']==pixels,'prior-shader-regression')
            for draw in result['draws']:
                for point in draw['checks']:
                    check(point['expected']==point['observed'],'prior-shader-pixels')
            regressions[name]={'draws':draws,'pixels':pixels}
        for name in ['draw','draw/state','components']:
            rec=read(directory/name/'receipt.json')
            check(rec['status']=='passed' and rec['gitHead']==HEAD,'same-head-prior-receipt')
        for name in ['draw/hardware','draw/state/hardware','draw/state/decoder','draw/state/resources']:
            check(read(directory/name/'report.json')['status']=='passed','prior-draw-state-result')
        replay=read(directory/'draw/hardware/report.json')['browserResult']['result']['original']
        check((replay['packetCount'],replay['gpuDraws'],replay['checkedPixels'])==(210,3,768),'prior-original-replay-counts')
        phases=[[[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,0,255]],
                [[255,0,0,255],[0,128,0,255],[0,0,0,255],[255,128,0,255]],
                [[64,0,191,255],[0,64,191,255],[0,0,255,255],[64,64,191,255]]]
        for frame,colors,offset in zip(replay['frames'],phases,[64,4160,8256]):
            raw=bytes(channel for y in range(32) for x in range(32) for channel in colors[2*(y//16)+x//16])
            check(sha(raw)==frame['readback']['rgbaSha256'],'prior-independent-complete-readback')
            check(frame['readback']['offset']==offset and frame['readback']['byteLength']==4096,'prior-readback-range')
            check(frame['actualGlCall']['count']==6 and frame['actualGlCall']['mode']==4,'prior-actual-draw-call')
        regressions['originalDrawReplay']={'packets':210,'draws':3,'pixels':768,'completeReadbacks':3}
        summaries[label]={'receiptSha256':anchor,'sources':len(receipt['sources']),'records':len(receipt['records']),
                          'nestedReports':report_count,'nativeCases':114,'acceptedPairs':75,'originalOutcomes':receipt['shaderOutcomes'],
                          'pairDraws':52,'pairPixels':520,'regressions':regressions,
                          'servedWasm':next(x for x in hardware['servedFiles'] if x['path'].endswith('.wasm'))}
    output={'task':'E6-T12e2','status':'bindings-held','frozenHead':HEAD,'checks':dict(COUNTS),'evidence':summaries,
            'coldClone':str(clone),'coldFiles':len(cold['acceptanceFiles']),'removedEnvironmentNames':cold['removedEnvironmentNames'],
            'scope':'Read-only bindings/parity/independent pixel oracle audit. Counts do not establish implementation coverage; main verifier owns attacks and task verdict.'}
    Path(__file__).with_name('binding-audit.json').write_text(json.dumps(output,indent=2)+'\n')
    print(json.dumps({'status':output['status'],'checks':sum(COUNTS.values()),'evidence':summaries},indent=2))


if __name__=='__main__':
    main()
