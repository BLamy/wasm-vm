#!/usr/bin/env python3
"""Literal independent frame/packet/uniform/fault audit, plus real sabotage."""
from pathlib import Path
import copy
import hashlib
import json

OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[2]
sha=lambda b:hashlib.sha256(b).hexdigest()
fixture_raw=(ROOT/'tools/virgl-exact-producer/fixtures.json').read_bytes()
fixtures=json.loads(fixture_raw)
node=json.loads((OUT/'unpacked/hot/node.json').read_bytes())
native=json.loads((OUT/'unpacked/hot/native/report.json').read_bytes())
for c,w in zip(native['cases'],node['cases']):
    assert c['result']==w['result'] and c['pairResult']==w['pairResult'] and c['defaultResult']==w['defaultResult']

def sub(snapshot,id):
    c=next(c for c in snapshot['contexts']if c['id']==id)
    return next(s for s in c['subContexts']if s['id']==c['currentSubContext'])

def result(request):
    if 'components'not in request:
        return next(c['result']for c in node['partners']if c['stage']==request['stage']and c['text']==request['text'])
    f=next(c for c in fixtures if c['stage']==request['stage']and c['text']==request['text']and c['components']==request['components'])
    return next(c['result']for c in node['cases']if c['name']==f['name'])

def literal_color(f):
    # Written from the actual source semantics, never from compiler/capture output.
    # Normal SIN(+0)=0. F2I(.25,1.5,-.5,1) then I2F=(0,1,0,1).
    if f.get('inherited')=='conversion':return [0,255,0,255]
    if f.get('inherited')=='raster':return [64,128,128,128]
    if 'USEQ TEMP[0].x' in f['text']:
        # The comparison's component is the explicitly constrained non-sine word.
        e=next(e for e in f['components']if not(e['register']==0 and e['component']==3))
        return [64,128,128,255]if e['word']==1 else[0,255,0,255]
    # Direct raw UIF and a copied/raw negative zero are integer-nonzero.
    return [64,128,128,255]

def audit(path,override=None):
    raw=path.read_bytes();report=json.loads(raw)if override is None else override
    a=report['acceptance'];fault=a['fault'];assert report['task']==a['task']=='E6-T12g6m3b'
    shot=report['failureScreenshot' if fault else 'screenshot']
    assert sha((path.parent/shot['path']).read_bytes())==shot['sha256']
    assert not report['trackedChanges'] and not a['guestExecution'] and not report['productionNegotiation']
    assert report['browserErrors']=={'console':[],'page':[],'requests':[]}
    assert report['browser']['launch']['headless']is False
    assert report['browser']['gpu']['featureStatus'][report['browser']['webglFeature']]=='enabled'
    assert 'Apple M4 Max' in a['renderer']and 'Metal'in a['renderer']
    assert not a['trustedHostWrapper']and not report['trustedHostWrapper']
    assert a['fixture']=={'sha256':sha(fixture_raw),'bytes':len(fixture_raw)}
    for e in report['sources']+report['servedFiles']:
        if e['path'].startswith('target/virgl-exact-producer-fault/'):
            prefix='cold-fault-source'if '/cold/'in str(path)else'fault-source'
            b=(OUT/'unpacked'/prefix/e['path'].removeprefix('target/virgl-exact-producer-fault/')).read_bytes()
        else:b=(ROOT/e['path']).read_bytes()
        assert sha(b)==e['sha256'],e['path']
    checked={'frames':0,'pixels':0,'rejections':0,'uniformWords':0,'rigs':len(a['rigs'])};points=[]
    for item in a['shaderFixtures']:
        f=next(f for f in fixtures if f['name']==item['fixture']['name']);assert f==item['fixture']
        assert sha(f['text'].encode())==item['textSha256']
        if not fault:assert item['result']==result(item['request'])
    for i,rig in enumerate(a['rigs']):
        assert rig['geometry']=={'positions':[-1,-1,1,-1,1,1,-1,1],'components':2,'indices':[0,1,2,0,2,3],'width':8,'height':8}
        assert rig['glObjects']['live']==0 and all(x==0 for x in rig['finalBudgets'].values())and all(x==0 for x in rig['finalResourceBudgets'].values())
        f=next((f for f in fixtures if f['name']==rig.get('fixture')),None)
        compiled=[]
        for t in rig['translations']:
            assert t['kind']!='pair'
            baseline=result(t['request']);actual=t['result'];assert actual['ok']
            if fault=='metadata'and t['kind']=='exact':
                stripped=copy.deepcopy(baseline);m=stripped['metadata'];m['profile']=m.pop('exactBaseProfile');del m['constantExactDomains'];assert actual==stripped
            elif fault=='derive'and t['kind']=='exact':assert actual['metadata']['constantExactDomains']==baseline['metadata']['constantExactDomains']and actual['glsl']!=baseline['glsl']
            else:assert actual==baseline,'full actual compiler result'
            compiled.append(actual['glsl'])
        for event in rig['glEvents']:
            if event['call']=='shaderSource':assert event['source']in compiled
            if event['call']=='uniform4uiv':
                assert event['words']==event['observed']and len(event['words'])<=184
                assert event['currentProgramId']==event['programId']
                checked['uniformWords']+=len(event['words'])
        for j,d in enumerate(rig['draws']):
            # Lifecycle fixture generation is selected by the actual current exact contract.
            current=sub(d['snapshot'],d['contextId'])
            if f is None:
                selected=next(s for s in current['objects']if s['type']==4 and s['generation']==current['bindings']['vertexShader']['generation'])
                words=selected['translation']['metadata']['constantExactDomains'][0]['components']
                predicted=[64,128,128,255]if words[0]['word']==1 else[0,255,0,255]
            else:predicted=literal_color(f)
            assert d['expectedColor']==predicted,'literal pre-readback prediction'
            assert len(d['rgbaBytes'])==256 and sha(bytes(d['rgbaBytes']))==d['rgbaSha256']
            assert len(d['result']['draws'])==1 and d['result']['draws'][0]['count']==6
            if fault=='derive':
                assert predicted==[64,128,128,255]and d['rgbaBytes']==[0,255,0,255]*64
                points.append({'point':f'acceptance.rigs[{i}].draws[{j}]','expected':predicted,'observed':[0,255,0,255],'pixels':64,'cause':'actual derived bit fault; exact raw1 guard still passes'})
            else:assert d['rgbaBytes']==predicted*64,'complete literal framebuffer'
            for u in d['uniforms']:
                stage=0 if u['stage']=='vertex'else 1;size=min(u['activeCount'],46)*4
                assert u['words'][:size]==current['bindings']['constants'][stage][:size]
            assert d['program']['vertexGeneration']==current['bindings']['vertexShader']['generation']and d['program']['fragmentGeneration']==current['bindings']['fragmentShader']['generation']
            checked['frames']+=1;checked['pixels']+=64
        for j,t in enumerate(rig['attacks']):
            if fault=='metadata':
                assert t['pixelsBefore']==[255,0,0,255]*64 and t['pixelsAfter']==[64,128,128,255]*64
                assert t['result']['ok']and t['result']['appliedCommands']==2 and len(t['result']['draws'])==1
                assert any(e['call']=='uniform4uiv'and e['words'][0]==e['observed'][0]==2 for e in t['events'])
                points.append({'point':f'acceptance.rigs[{i}].attacks[{j}]','expected':'red sentinel unchanged; no unsafe upload/DRAW','observed':'raw2 actually uploaded, DRAW overwrote64red pixels','pixels':64})
                continue
            assert not t['result']['ok']and t['result']['error']['code']in ['constant-exact-domain-error','constant-raster-domain-error','constant-conversion-domain-error','incomplete-draw']
            assert t['result']['appliedCommands']==(1 if t['prefix']is not None else 0)
            assert t['pixelsAfter']==t['pixelsBefore']and t['after']['budgets']==t['before']['budgets']
            assert not any(e['call']in ['drawElements','getBufferSubData','copyBufferSubData','createShader','createProgram','linkProgram']for e in t['events'])
            assert not any(e['call']=='uniform4uiv'and e['name'].startswith('vs'if t['stage']==0 else'fs')for e in t['events'])
            if t['prefix']is not None:
                b=bytes(t['prefix']);header=int.from_bytes(b[:4],'little');assert header&0xffff==12 and len(b)==((header>>16)+1)*4
                assert int.from_bytes(b[4:8],'little')==t['stage']and int.from_bytes(b[8:12],'little')==0
                words=[int.from_bytes(b[q:q+4],'little')for q in range(12,len(b),4)]
                assert sub(t['after'],1)['bindings']['constants'][t['stage']]==words
            checked['rejections']+=1
        if 'prunedReflection'in rig:
            assert any(u['stage']==f['stage']and u['activeCount']==0 for u in rig['prunedReflection']['uniforms'])
        for t in rig['yieldAttacks']:assert t['before']==t['after']and all(not b['ok']and b['error']['code']=='busy'for b in t['busy'])
    assert report['status']==a['status']==('failed'if fault else'passed')
    if fault:
        manifest=report['faultSources'];normal=(ROOT/'renderer/virgl-shader'/manifest['file']).read_bytes()
        assert sha(normal)==manifest['originalSha256']and normal.decode().count(manifest['needle'])==1
        altered=normal.decode().replace(manifest['needle'],manifest['replacement']).encode();assert sha(altered)==manifest['alteredSha256']
        prefix='cold-fault-source'if '/cold/'in str(path)else'fault-source'
        for e in manifest['artifacts']:
            p=OUT/'unpacked'/prefix/fault/e['path'];assert len(p.read_bytes())==e['bytes']and sha(p.read_bytes())==e['sha256']
        delivered=next(e for e in manifest['artifacts']if e['path']=='virgl-shader.wasm')
        assert a['faultWasm']=={'sha256':delivered['sha256'],'bytes':delivered['bytes']}and len(points)==1
    else:assert checked=={'frames':303,'pixels':19392,'rejections':297,'uniformWords':128248,'rigs':37}
    return {'path':str(path.relative_to(OUT)),'reportSha256':sha(raw),'counts':checked,'contradictions':points,'seed':a['seed'],'sourceHead':report['gitHead']}

if __name__=='__main__':
    reports=[]
    for prefix in ['hot','cold/acceptance']:
        for name in ['gpu-1779033703','gpu-3144134277','gpu-1013904242','fault-derive','fault-metadata']:reports.append(audit(OUT/'unpacked'/prefix/name/'report.json'))
    for seed in [2773480762,1359893119,2600822924]:reports.append(audit(OUT/f'gpu-{seed}/report.json'))
    base=OUT/'unpacked/hot/gpu-1779033703/report.json';original=json.loads(base.read_bytes());sabotage=[]
    for label in ['pixel-with-recomputed-digest','native-upload-with-consistent-observation','strip-compiler-exact-contract']:
        mutant=copy.deepcopy(original)
        if label.startswith('pixel'):
            d=mutant['acceptance']['rigs'][0]['draws'][0];d['rgbaBytes'][0]^=1;d['rgbaSha256']=sha(bytes(d['rgbaBytes']))
        elif label.startswith('native'):
            e=next(e for e in mutant['acceptance']['rigs'][0]['glEvents']if e['call']=='uniform4uiv');e['words'][0]^=1;e['observed'][0]^=1
            # A forged consistent API upload is still contradicted by the independently recorded program snapshot.
            d=mutant['acceptance']['rigs'][0]['draws'][0];d['uniforms'][0]['words'][0]^=1
        else:
            t=next(t for t in mutant['acceptance']['rigs'][0]['translations']if t['kind']=='exact');del t['result']['metadata']['constantExactDomains']
        try:audit(base,mutant)
        except (AssertionError,KeyError,StopIteration)as error:sabotage.append({'label':label,'status':'caught','error':str(error),'originalSha256':sha(base.read_bytes()),'mutantSha256':sha(json.dumps(mutant).encode())})
        else:raise AssertionError('independent capture auditor missed '+label)
    output={'task':'E6-T12g6m3b','status':'passed','reports':reports,'sabotage':sabotage,'newSeeds':[2773480762,1359893119,2600822924]}
    (OUT/'capture-audit.json').write_text(json.dumps(output,indent=2)+'\n')
    print(json.dumps({'reports':len(reports),'freshFrames':sum(r['counts']['frames']for r in reports if not r['path'].startswith('unpacked/')),'sabotagesCaught':len(sabotage)}))
