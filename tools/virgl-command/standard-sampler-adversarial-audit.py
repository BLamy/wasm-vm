"""Audit complete physical sampler records from literal guest state and uploads."""
import gzip,hashlib,json,struct,sys
from pathlib import Path
from standard_sampler_literal_model import packets,sampler,parameters,original_draws,full_pixels,specialized_shader

sha=lambda raw:hashlib.sha256(raw).hexdigest()

def audit(directory,label):
    root=Path(directory);record=(root/'report.json').read_bytes();q=json.loads(record);fault=bool(q.get('fault'))
    assert q['status']==('failed' if fault else 'passed') and q['browserErrors']==dict(console=[],page=[],requests=[])
    result=q['partial'] if fault else q['browserResult']['result'];refs={row['key']:row for row in result['blobs']};cache={};rows=[];identities={};draw_cache={}
    assert not q['browser']['headless'] and 'M4' in result['gpu']['renderer'] and 'Metal' in result['gpu']['renderer']
    assert not result['guestExecution'] and not result['productionNegotiation']
    def raw(ref):
        assert ref and ref['key'] in refs
        row=refs[ref['key']]
        if row['key'] not in cache:
            packed=(root/row['path']).read_bytes();data=gzip.decompress(packed)
            assert sha(packed)==row['gzipSha256'] and sha(data)==row['sha256'] and len(data)==row['bytes']
            cache[row['key']]=data
        assert ref['sha256']==row['sha256'] and ref['bytes']==row['bytes']
        return cache[row['key']]
    for run_index,run in enumerate(result['runs']):
        through=max((f['submission'] for f in result['frames'] if f['run']==run_index),default=-1)
        if through>=0:draw_cache[run_index]=original_draws(run,through)
    native_bytes=pixels=draw_count=0
    for ordinal,f in enumerate(result['frames']):
        run=result['runs'][f['run']];draws=[d for d in draw_cache[f['run']] if d['record']==f['submission']]
        assert len(draws)==len(f['native'])>0 and run['history'][f['submission']]['result']['gpuComplete'] is True
        metadata={};generations={}
        for created in run['created']:
            if created['beforeSubmission']<=f['submission']:
                m=created['metadata'];metadata[m['id']]=m;generations[m['id']]=created['generation']
                assert all(m[k]==v for k,v in dict(depth=1,arraySize=1,lastLevel=0,nrSamples=0,flags=0).items())
        labels={h['label'] for h in run['history'][:f['submission']+1]};uploads={}
        for exchange in run['exchanges']:
            if exchange['label'] in labels and exchange['direction']=='upload':
                assert exchange['layout']['offset']==0 and exchange['layout']['tightBytes']==len(raw(exchange['blob']))
                uploads[exchange['resource']['id']]=raw(exchange['blob'])
                assert exchange['resource']['generation']==generations[exchange['resource']['id']]
        target=metadata[draws[-1]['target']];assert [target['target'],target['format'],target['bind'],target['width'],target['height']]==[2,67,2,f['width'],f['height']]
        assert len(uploads[3])==48 and uploads[3]==struct.pack('<12f',-1,-1,0,1,3,-1,0,1,-1,3,0,1)
        assert f['original']['positions']==uploads[3].hex()
        for stage in [0,1]:assert raw(f['original']['images'][stage])==uploads[5+stage]
        parameter_differences=0;native_ids=[];shader_hashes=[]
        for native,d in zip(f['native'],draws):
            assert native['name']=='drawArrays' and native['args']==[4,0,3] and d['words']==[0,3,4,0,1,0,0,0,0,0,0xffffffff,0]
            program=next(p for p in f['dump']['programs'] if p['generation']==f['dump']['draws'][len(native_ids)]['programGeneration'])
            assert [program['vertexTGSI'],program['fragmentTGSI']]==[d['vertex'],d['fragment']]
            requests=[p for p in run['requests'] if [p['request']['vertexText'],p['request']['fragmentText']]==[d['vertex'],d['fragment']]]
            assert requests and all(p['result']['ok'] for p in requests)
            assert any([specialized_shader(p['result']['vertex']['glsl'],d['sampling'],0),specialized_shader(p['result']['fragment']['glsl'],d['sampling'],1)]==[program['vertexESSL300'],program['fragmentESSL300']] for p in requests)
            actual_shaders={p['stage']:p['glsl'] for p in native['shaders']}
            assert actual_shaders=={35633:program['vertexESSL300'],35632:program['fragmentESSL300']}
            shader_hashes.append({str(k):sha(v.encode()) for k,v in actual_shaders.items()})
            assert len(native['samplers'])==len(d['sampling'])
            draw_ids={}
            for sample in d['sampling']:
                observed=next(n for n in native['samplers'] if n['name']==sample['name']);view=sample['view'];p=sample['sampler'];m=metadata[view['resource']]
                assert [observed['type'],observed['unit'],observed['resourceId'],observed['generation']]==[35678,sample['unit'],view['resource'],generations[view['resource']]]
                assert [m['target'],m['format'],m['bind'],m['width'],m['height']]==[2,67,8,f['original']['textureWidth'],f['original']['textureHeight']]
                params=parameters(p);different=observed['params']!=params;parameter_differences+=different
                if not fault:assert not different,(label,f['label'],observed['params'],params)
                assert raw(observed['texels'])==uploads[view['resource']];native_bytes+=len(raw(observed['texels']))
                key=(f['run'],sample['token']);identity=observed['nativeSampler'];prior=identities.setdefault(key,identity)
                assert prior==identity and not any(k!=key and k[0]==key[0] and v==identity for k,v in identities.items())
                owner=next(n for n in run['nativeSamplers'] if n['id']==identity);assert owner['deleted']==1
                draw_ids[sample['name']]=identity
            native_ids.append(draw_ids)
            assert len(native['attributes'])==len(d['buffers'])==1
            for attr,b in zip(native['attributes'],d['buffers']):
                assert [attr['name'],attr['resourceId'],attr['generation'],attr['stride'],attr['offset']]==['in_0',b['resource'],generations[b['resource']],b['stride'],b['offset']]
                assert raw(attr['storage'])==uploads[b['resource']];native_bytes+=len(raw(attr['storage']))
        final=draws[-1]
        assert {k:final[k] for k in ['stage','scale','offset','vsCoord']}=={k:f['original'][k] for k in ['stage','scale','offset','vsCoord']}
        expected,lod=full_pixels(final,uploads,metadata,f['width'],f['height']);observed=raw(f['pixels']);assert len(observed)==len(expected)==f['width']*f['height']*4
        if 'expected' in f:assert raw(f['expected'])==expected
        differences=[dict(at=i,expected=a,observed=b) for i,(a,b) in enumerate(zip(expected,observed)) if abs(a-b)>1]
        assert bool(differences)==fault,(label,f['label'],differences[:5])
        if fault:
            assert parameter_differences>0 and 'pixels after completed fence' in q['browserResult']['error']['message']
        else:assert parameter_differences==0 and f['audit']['held'] is True
        rows.append(dict(record=str(root/'report.json'),jsonPoint=('/partial/frames/' if fault else '/browserResult/result/frames/')+str(ordinal),label=f['label'],pixels=len(expected)//4,nativeDraws=len(native_ids),nativeIds=native_ids,lod=lod,shaderSha256=shader_hashes,expectedPixelSha256=sha(expected),observedPixelSha256=sha(observed),pixelMismatches=len(differences),firstMismatches=differences[:16],parameterDifferences=parameter_differences))
        pixels+=len(expected)//4;draw_count+=len(native_ids)
    delays=[]
    for run_index,run in enumerate(result['runs']):
        for owner in ['renderer','resources']:assert all(v==0 for v in run['final'][owner]['budgets'].values())
        assert run['final']['uniformAccess']['pending']==run['final']['uniformAccess']['submitted']==0
        assert all(n['deleted']==1 for n in run['nativeSamplers'])
        syncs={}
        for event in run['events']:
            if event['name']=='fenceSync':syncs[event['sync']]=dict(turn=event['turn'],last=event['turn'],timeouts=0,ordinal=len(syncs),completed=False)
            elif event['name']=='clientWaitSync':
                s=syncs[event['sync']];assert event['turn']>s['last'];s['last']=event['turn']
                if event['actual'] in [37146,37148] and event['delivered']==37147:s['timeouts']+=1
                if event['delivered'] in [37146,37148]:s['completed']=True
            elif event['name']=='deleteSync':assert syncs[event['sync']]['completed']
        if result['schema']=='d19-stage-split-seam-critic-v1':
            for s in syncs.values():assert s['timeouts']==1+(((q['seed']^s['ordinal'])*2654435761)&0xffffffff)%7
        delays.extend(dict(run=run_index,**s) for s in syncs.values())
    for ownership in result.get('ownership',[]):
        if ownership['kind']=='parameter-only':assert ownership['observed']==parameters(ownership['parameters'])
        elif ownership['kind']=='queued-native-samplers':assert ownership['point']['renderer']['jobs']['status']=='finishing' and ownership['point']['renderer']['jobs']['draws']==3
        elif ownership['kind']=='queued-stage-split-replacement':
            assert ownership['point']['renderer']['jobs']['status']=='finishing' and ownership['point']['renderer']['jobs']['draws']==3
            assert ownership['original']['vssamp0']==ownership['replacement']['vssamp0'] and ownership['original']['fssamp0']!=ownership['replacement']['fssamp0']
    for ref in result['blobs']:raw(ref)
    assert all(row['held'] or fault and 'pixels after completed fence' in row['prediction'] for row in result['predictions'])
    return dict(label=label,reportSha256=sha(record),head=q['gitHead'],fault=q.get('fault'),seed=q.get('seed'),mode=q.get('mode'),frames=rows,pixels=pixels,nativeDraws=draw_count,gpuBytes=native_bytes,allBlobs=len(cache),runs=len(result['runs']),fenceSchedules=delays,status='passed')

if __name__=='__main__':
    out=Path(sys.argv[1]).resolve();runs=[]
    for root in sorted(out.glob('gpu-*')):runs.append(audit(root,root.name))
    for name in ['sabotage-wrap','sabotage-filter']:runs.append(audit(out/name,name))
    summary=dict(schema='fresh-d19-literal-native-pixel-audit-v1',status='passed',runs=runs,positivePixels=sum(r['pixels'] for r in runs if not r['fault']),nativeDraws=sum(r['nativeDraws'] for r in runs))
    (out/'adversarial-audit.json').write_text(json.dumps(summary,indent=2)+'\n')
    print('Independent original sampler audit passed:',summary['positivePixels'],'positive pixels;',summary['nativeDraws'],'physical draws including sabotage')
