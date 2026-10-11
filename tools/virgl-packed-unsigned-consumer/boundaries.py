#!/usr/bin/env python3
"""Independently replay original boundary wire state and authenticate native custody."""
import gzip,hashlib,json,re,struct,sys
from pathlib import Path
from pixels import audit_native_lifetimes,descriptor,native,original_fragment,packets,scalar,decoded_native,PACKED_UINT

def main(directory):
    directory=Path(directory);report=json.loads((directory/'report.json').read_text());e=report['browserResult']['result']
    assert report['status']==e['status']=='passed' and e['mode']=='boundaries'
    assert report['browserErrors']==dict(console=[],page=[],requests=[])
    blobs={row['key']:row for row in e['blobs']};assert len(blobs)==len(e['blobs']);decoded={}
    for key,row in blobs.items():
        raw=(directory/row['path']).read_bytes();assert hashlib.sha256(raw).hexdigest()==row['gzipSha256']
        raw=gzip.decompress(raw);assert len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256'];decoded[key]=raw
    def load(ref):
        assert blobs[ref['key']]['sha256']==ref['sha256'];return decoded[ref['key']]
    counts=dict(frames=0,targets=0,words=0,syncs=0,polls=0,cpuReads=0,retiredTargets=0,replacementBackingBytes=0)
    records=[]
    for ri,run in enumerate(e['runs']):
        assert len(run['created'])==len(run['allocations']);resources={};planes={};owners={}
        for made,allocation in zip(run['created'],run['allocations']):
            m=made['metadata'];assert all(allocation['metadata'][key]==value for key,value in m.items())
            owner=dict(metadata=m,generation=made['generation'],texture=allocation['texture'])
            resources.setdefault(m['id'],owner)
            if allocation['texture'] is not None:owners[allocation['texture']]=owner
            if m['format'] in [196,200,31] or m['format'] in PACKED_UINT:
                planes[allocation['texture']]=[native(m['format'],0,lane) for _ in range(m['width']*m['height']) for lane in range(4)]
        positions=struct.unpack('<24f',load(run['positions']));assert all(positions[at+2]==0 and positions[at+3]==1 for at in range(0,24,4))
        contexts={};snapshots={};native_draws={draw['label']:draw for draw in run['draws']};assert len(native_draws)==len(run['draws'])
        for hi,history in enumerate(run['history']):
            ctx=contexts.setdefault(history['ctx'],dict(shaders={},surfaces={},objects={},bound={},fragment=None,
                depthHandle=0,depthEnabled=False,depthWrite=False,depthFunction=0,depth=1,depthZ=.5))
            commands=list(packets(history['hex']));applied=history['result'].get('appliedCommands',0)
            for ci,(op,kind,w,raw) in enumerate(commands):
                if ci>=applied:continue
                if op==1 and kind==4:ctx['shaders'][w[0]]=raw[24:24+w[2]-1].decode('ascii')
                elif op==1 and kind==8:
                    owner=resources[w[1]];assert owner['metadata']['format']==w[2]
                    ctx['surfaces'][w[0]]=dict(**owner,level=w[3])
                elif op==1 and kind==3:ctx['objects'][w[0]]=dict(depthEnabled=bool(w[1]&1),depthWrite=bool(w[1]&2),depthFunction=w[1]>>2&7)
                elif op==2 and kind==3:ctx.update(ctx['objects'][w[0]])
                elif op==4:ctx['depthZ']=scalar(w[6])
                elif op==5:
                    assert len(w)==2+w[0] and w[0]<=4
                    ctx['bound']={slot:ctx['surfaces'][handle] for slot,handle in enumerate(w[2:]) if handle};ctx['depthHandle']=w[1]
                elif op==31 and w[1]==1:ctx['fragment']=ctx['shaders'][w[0]]
                elif op==7:
                    if w[0]&1:ctx['depth']=struct.unpack_from('<d',raw,24)[0]
                    for slot,target in ctx['bound'].items():
                        if not w[0]&(4<<slot):continue
                        m=target['metadata'];assert target['level']==0
                        planes[target['texture']]=[native(m['format'],w[1+lane],lane,True) for _ in range(m['width']*m['height']) for lane in range(4)]
                elif op==8:
                    draw=native_draws[history['label']];outputs,discard=original_fragment(ctx['fragment']);assert not discard
                    assert draw['args']==([4,6,5125,0] if run['kind']=='typed-indexed-reversed-viewport' else [4,0,6]) and draw['native']['viewport']==[0,0,4,4]
                    assert draw['native']['depthTest']==ctx['depthEnabled'] and draw['native']['depthMask']==ctx['depthWrite']
                    assert draw['native']['depthFunction']==512+ctx['depthFunction']
                    passes=not ctx['depthEnabled'] or ctx['depthFunction']==1 and ctx['depthZ']<ctx['depth']
                    assert not ctx['depthEnabled'] or ctx['depthFunction']==1,'bounded fixture uses original LESS'
                    fragment=next(shader['glsl'] for shader in draw['shaders'] if shader['type']==35632)
                    for slot,color in enumerate(draw['native']['colors']):
                        target=ctx['bound'].get(slot);assert color['attachment']==(target['texture'] if target else None)
                        assert color['drawBuffer']==(36064+slot if target and slot in outputs else 0)
                        assert color['mask']==[True,True,True,not bool(target and descriptor(target['metadata']['format'])['components']<4)] and draw['native']['blend'] is False
                        if target:
                            fmt=target['metadata']['format'];d=descriptor(fmt)
                            assert color['level']==target['level']==0 and color['componentType']==(5124 if d['signed'] else 5125) if d['integer'] else color['level']==target['level']==0 and color['componentType']==(35863 if fmt in PACKED_UINT else 5126)
                            assert re.search(r'layout\(location='+str(slot)+r'\) out '+('ivec4' if d['signed'] else 'uvec4' if d['integer'] else 'vec4')+r' fsout_c'+str(slot)+r';',fragment)
                            if passes and slot in outputs:
                                m=target['metadata'];planes[target['texture']]=[native(fmt,outputs[slot][lane],lane) for _ in range(m['width']*m['height']) for lane in range(4)]
                    snapshots[hi]={texture:list(words) for texture,words in planes.items()}
            for fi in run['frames']:
                frame=e['frames'][fi]
                if frame['historyIndex']!=hi:continue
                assert frame['run']==ri and hi in snapshots
                counts['frames']+=1;draw=native_draws[frame['label']];completion=frame['completion']
                assert completion['sequence']>draw['sequence'] and completion['actual'] in [37146,37148] and completion['delivered'] in [37146,37148]
                for target in frame['targets']:
                    owner=owners[target['texture']];assert target['generation']==owner['generation']
                    assert all(target['metadata'][key]==value for key,value in owner['metadata'].items())
                    actual=load(target['native']);words=decoded_native(target['metadata']['format'],actual);expected=snapshots[hi][target['texture']]
                    assert words==expected,(run['kind'],frame['label'],target['slot'],'original wire inverse')
                    assert draw['native']['colors'][target['slot']]['attachment']==target['texture']
                    counts['targets']+=1;counts['words']+=len(words)
                    if frame['retired']:
                        retired=next(row for row in run['retiredPlanes'] if row['texture']==target['texture'])
                        assert retired['completion']==completion and load(retired['native'])==actual;counts['retiredTargets']+=1
        if run['kind']=='shape-cache-context-generation':
            draws=native_draws;assert draws['boundary/original-four']['native']['program']==draws['boundary/returned-four']['native']['program']
            assert draws['boundary/changed-four']['native']['program']!=draws['boundary/original-four']['native']['program']
            assert draws['boundary/context2-four']['native']['program']!=draws['boundary/original-four']['native']['program']
            for label in ['boundary/retained-context1','boundary/retained-context2']:
                assert draws[label]['native']['colors'][3]['attachment']==resources[5]['texture']
            replacement=run['created'][-1];assert replacement['metadata']['id']==5 and replacement['generation']>resources[5]['generation']
            raw=load(run['replacementBacking']);assert raw==bytes([0x71])*20000;counts['replacementBackingBytes']+=len(raw)
        if run['kind']=='typed-indexed-reversed-viewport':
            draw=run['draws'][0];assert draw['name']=='drawElements' and draw['attributes'][0]['integer'] and draw['attributes'][0]['type']==36296
            indices=load(run['indices']);assert indices==bytes(range(6))
            read=next(row for row in run['readbacks'] if row['name']=='getBufferSubData');assert load(read['bytes'])==indices
            buffer=next(row['buffer'] for row in run['allocations'] if row['metadata']['id']==7)
            assert any(row['name']=='bufferSubData' and row['buffer']==buffer and load(row['bytes'])==indices for row in run['uploads'])
        if run['kind'].startswith('queued-'):
            point=run['actions'][0];assert point['kind']=='four-original-generations-held-by-physical-fence'
            assert point['renderer']['jobs']['status']=='finishing' and point['before']['budgets']['imageHolds']==point['after']['budgets']['imageHolds']==4
            for fresh in run['created'][-4:]:assert fresh['generation']>resources[fresh['metadata']['id']]['generation']
            terminal=run['actions'][1]['result'];mode=run['kind'][7:]
            if mode=='complete':assert terminal['ok'] and terminal['gpuComplete'] and len(run['retiredPlanes'])==4
            elif mode=='cancel':assert not terminal['ok'] and terminal['error']['code']=='cancelled' and len(run['retiredPlanes'])==4
            else:
                assert terminal['error']['code']=='disposed' and not run['retiredPlanes']
                assert not any(event['name'] in ['readPixels','getBufferSubData'] and event['cpu'] for event in run['events'])
                assert 'completed' not in run['fenceObjects'][-1],'synchronous disposal drops the unfinished native job without CPU collection'
        if run['kind']=='feedback-clear-native-failure':
            for label,code in [('boundary/nonzero-feedback','framebuffer-feedback'),('boundary/missing-color','incomplete-framebuffer'),
                ('boundary/missing-depth','incomplete-framebuffer'),('boundary/nonzero-nonfinite-float-clear','invalid-value')]:
                history=next(h for h in run['history'] if h['label']==label);assert history['result']['error']['code']==code and label not in native_draws
        if run['kind']=='actual-native-clear-failure':
            fault=run['faultEvents'][0];assert fault['name'] in ['clearBufferiv','clearBufferuiv'] and fault['delivered']==0 and len(run['faultEvents'])==1
            assert run['history'][-1]['result']['error']['code']=='backend-error'
        if run['kind']=='measured-host-closed-config':
            assert all(action['result']['error']['code']=='unsupported-host' for action in run['actions'][:3])
            assert all(action['result']['ok'] is False for action in run['actions'][3:])
        lifetime=audit_native_lifetimes(run)
        for key,value in lifetime.items():counts[key]+=value
        records.append(dict(run=ri,kind=run['kind'],frames=len(run['frames']),draws=len(run['draws']),lifetimes=lifetime))
    assert {run['kind'] for run in e['runs']}=={'shape-cache-context-generation','queued-complete','queued-cancel','queued-renderer-dispose','queued-resource-dispose',
        'feedback-clear-native-failure','original-depth-clear','actual-native-clear-failure','measured-host-closed-config',
        'typed-indexed-reversed-viewport','historical-integer-blend-bypass'}
    result=dict(status='passed',seed=e['seed'],counts=counts,records=records,originalWireInverse=True,productImports=False)
    (directory/'boundary-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__':main(sys.argv[1])
