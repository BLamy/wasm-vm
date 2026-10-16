"""Fresh native identity, literal wire and whole-image interrogation of sealed runs."""
import gzip
import hashlib
import json
import struct
import subprocess
from pathlib import Path

REPO=Path(__file__).resolve().parents[3]
OUT=Path(__file__).resolve().parent
ROOT=REPO/'target/evidence/dimensional-depth-surfaces-cold-final-03/recording'
sha=lambda b:hashlib.sha256(b).hexdigest()
BPP={16:2,18:4,20:4,21:4,126:8}
STENCIL={20:0,126:4}
INTERNAL={16:33189,18:36012,20:35056,21:33190,126:36013}
NATIVE_TARGET={2:3553,4:34067,7:35866}
citations=[]
counts=dict(rows=0,hardware=0,refusals=0,historicalRefusals=0,historicalControls=0,images=0,bytes=0,nativeStates=0,faults=0,lifecycle=0)


def depth(fmt,out,pixel,value):
    at=pixel*BPP[fmt]
    if fmt==16:struct.pack_into('<H',out,at,65535 if value else 0)
    elif fmt==20:struct.pack_into('<I',out,at,(0xffffff00 if value else 0)|out[at])
    elif fmt==21:struct.pack_into('<I',out,at,0xffffff if value else 0)
    else:struct.pack_into('<I',out,at,0x3f800000 if value else 0)


def planes(f,seed,canonical):
    result=[]
    for level in range(3):
        w=max(1,5>>level);h=max(1,(5 if f['target']==4 else 3)>>level);layers=6 if f['target']==4 else 5 if f['target']==7 else 1
        data=bytearray(w*h*layers*BPP[f['format']])
        for z in range(layers):
            for y in range(h):
                for x in range(w):
                    i=(z*h+y)*w+x;at=i*BPP[f['format']];s=(seed+43*level+31*z+17*y+7*x)&255
                    depth(f['format'],data,i,(seed+level+z+y+x)&1)
                    if f['format'] in STENCIL:data[at+STENCIL[f['format']]]=s
                    if not canonical and f['format']==21:data[at+3]=s^0x71
                    if not canonical and f['format']==126:data[at+5:at+8]=bytes([s^0xa7])*3
        result.append(dict(level=level,width=w,height=h,layers=layers,data=data))
    return result


def padded(p,b,bpp,fill):
    result=bytearray([fill]*4096);stride=p['width']*bpp+7;layerstride=stride*p['height']+11
    for z in range(p['layers']):
        for y in range(p['height']):
            start=(z*p['height']+y)*p['width']*bpp;dest=5+z*layerstride+y*stride
            result[dest:dest+p['width']*bpp]=b[start:start+p['width']*bpp]
    return result


def guards(out):
    assert [g['length'] for g in out['guards']]==[7,17,53,101,3918]
    assert all(g['before']==g['after']=='a3'*8 for g in out['guards'])


def response(record):
    request=bytes.fromhex(record['request']);got=bytes.fromhex(record['response'])
    assert len(got)==24 and struct.unpack_from('<I',got)[0] in [0x1100,0x1200,0x1205]
    assert struct.unpack_from('<I',got,4)[0]==struct.unpack_from('<I',request,4)[0]&1
    assert got[8:16]==(request[8:16] if request[4]&1 else bytes(8))
    assert got[16:20]==request[16:20] and got[20]==request[20]
    assert sha(bytes.fromhex(record['transportCanonical']))==record['transportDigest']
    assert sha(bytes.fromhex(record['submitCanonical']))==record['submitDigest']


def image(out,p,wanted,bpp,resource,fill=0x4e,negative=False):
    actual=bytes.fromhex(out['denseActual']);wire=bytes.fromhex(out['record']['request'])
    assert out['denseExpected']==bytes(wanted).hex() and len(actual)==len(wanted)
    assert out['backingExpected']==padded(p,wanted,bpp,fill).hex()
    assert out['backingActual']==padded(p,actual,bpp,fill).hex()
    assert struct.unpack_from('<I',wire)[0]==0x206
    assert struct.unpack_from('<6I',wire,24)==(0,0,0,p['width'],p['height'],p['layers'])
    assert struct.unpack_from('<Q',wire,48)[0]==5
    assert struct.unpack_from('<4I',wire,56)==(resource,p['level'],p['width']*bpp+7,(p['width']*bpp+7)*p['height']+11)
    assert struct.unpack_from('<I',bytes.fromhex(out['record']['response']))[0]==0x1100
    guards(out);counts['images']+=1;counts['bytes']+=len(actual)+4096+80
    if not negative:assert actual==bytes(wanted)
    return actual!=bytes(wanted)


def texture(calls,target,fmt,width,height,layers):
    bound={}
    for call in calls:
        a=call['delivered']
        if call['name']=='bindTexture':bound[a[0]]=a[1]
        elif call['name'] in ['texStorage2D','texStorage3D'] and a[:5]==[NATIVE_TARGET[target],3,INTERNAL[fmt],width,height]:
            if target!=7 or a[5]==layers:return bound[a[0]]['object']
    raise AssertionError('no actual source native allocation')


def native_state(state,f,identity):
    d=state['depth'];assert d['type']==5890 and d['texture']['object']==identity
    assert d['level']==f['level'] and (d['face']-34069 if f['target']==4 else d['layer'])==f['layer']
    if f['format'] in STENCIL:
        s=state['stencil'];assert s['type']==5890 and s['texture']['object']==identity and s['level']==d['level']
        assert (s['face'] if f['target']==4 else s['layer'])==(d['face'] if f['target']==4 else d['layer'])
    else:assert state['stencil']['type']==0
    counts['nativeStates']+=1


def sample(f,model):
    texels=[]
    for p in model[1:3]:
        for z in range(1 if f['target']==7 else 0,5 if f['target']==7 else 6):
            for y in range(p['height']):
                for x in range(p['width']):texels.append((p,((z*p['height']+y)*p['width']+x)*BPP[f['format']]))
    p=dict(level=0,width=64,height=(len(texels)+63)//64,layers=1);out=bytearray(p['width']*p['height']*16)
    for i,(q,at) in enumerate(texels):
        fmt=f['format'];value=struct.unpack_from('<H' if fmt==16 else '<I',q['data'],at)[0]
        value=value>>8 if fmt==20 else value&0xffffff if fmt==21 else value
        assert value in [0,65535 if fmt==16 else 0xffffff if fmt in [20,21] else 0x3f800000]
        struct.pack_into('<4I',out,i*16,0x3f800000 if value else 0,0,0,0x3f800000)
    return p,out


names=[m+'-'+str(s) for m in ['hardware','boundaries','refresh'] for s in [54831,90107,171281]]+['attacks','mrt','historical','fault-layer','fault-face']
for name in names:
    directory=ROOT/name;report=json.loads((directory/'report.json').read_bytes());negative=name.startswith('fault-')
    assert report['head']=='cb04190a0fd8d989fb54fb7b2caf39cc86a8a0e7' and not report['trackedChanges']
    assert report['browserErrors']==dict(console=[],page=[],requests=[])
    assert report['status']==('failed' if negative else 'passed')
    assert report['browser']['gpu']['featureStatus'].get('webgl2',report['browser']['gpu']['featureStatus'].get('webgl'))=='enabled'
    tuples=set()
    for pin in report['runs']:
        packed=(directory/pin['path']).read_bytes();raw=gzip.decompress(packed)
        assert len(packed)==pin['gzipBytes'] and sha(packed)==pin['gzipSha256'] and len(raw)==pin['bytes'] and sha(raw)==pin['sha256']
        row=json.loads(raw);counts['rows']+=1;assert row['guestTrace'] and len(row['machineDigest'])==64
        assert row['cleaned']['liveObjects']==row['cleaned']['liveSyncs']==0
        for record in row['records']:response(record)
        cite=dict(file=str((directory/pin['path']).relative_to(REPO)),line=1,sha256=pin['sha256'],name=row['name'],seed=row['seed'])
        if row['name'].startswith('historical-'):
            counts['historicalControls']+=len(row['controls']);counts['historicalRefusals']+=len(row['refusals'])
            for refusal in row['refusals']:
                assert refusal['before']['store']==refusal['after']['store']
                assert struct.unpack_from('<I',bytes.fromhex(refusal['record']['response']))[0]==0x1205
            assert all(struct.unpack_from('<I',bytes.fromhex(v['response']))[0]==0x1100 for v in row['controls'])
            citations.append(dict(**cite,prediction='P4',pointer='/refusals'));continue
        f=row['fixture'];fmt=f['format'];seed=row['seed'];tuples.add((f['target'],fmt,f['bind'],f['level'],f['layer']))
        raw_planes=planes(f,seed,False);model=planes(f,seed,True);p=model[f['level']]
        assert f['width']==p['width'] and f['height']==p['height'] and f['bind'] in [1,9]
        for i,(expected,source) in enumerate(zip(raw_planes,row['sourcePlanes'])):
            assert source['input']==expected['data'].hex()==row['exchanges'][i]['bytes']
            assert source['backing']==padded(expected,expected['data'],BPP[fmt],0x8d).hex();guards(source)
            wire=bytes.fromhex(source['record']['request']);assert struct.unpack_from('<I',wire)[0]==0x205 and struct.unpack_from('<2I',wire,56)==(6,i)
        selected_points=list(dict.fromkeys([(0,0),(p['width']-1,p['height']-1)]));assert f['points']==[list(v) for v in selected_points]
        for y in range(p['height']):
            for x in range(p['width']):
                pixel=(f['layer']*p['height']+y)*p['width']+x;depth(fmt,p['data'],pixel,1)
                if fmt in STENCIL:p['data'][pixel*BPP[fmt]+STENCIL[fmt]]=seed&255
        for x,y in selected_points:
            pixel=(f['layer']*p['height']+y)*p['width']+x;depth(fmt,p['data'],pixel,0)
            if fmt in STENCIL:p['data'][pixel*BPP[fmt]+STENCIL[fmt]]=((seed+97)&255)^255
        cp=dict(level=0,width=p['width'],height=p['height'],layers=f['color']['arraySize']);color=bytearray(bytes([11,29,47,83])*(cp['width']*cp['height']*cp['layers']))
        for i in range(cp['width']*cp['height']):at=(f['colorLayer']*cp['width']*cp['height']+i)*4;color[at:at+4]=bytes([255,0,255,0])
        for x,y in selected_points:at=((f['colorLayer']*cp['height']+y)*cp['width']+x)*4;color[at:at+4]=bytes([0,255,0,255])
        mismatch=False
        for i,out in enumerate(row['outputs']):
            q=model[out['level']] if out['kind']=='depth' else cp;wanted=q['data'] if out['kind']=='depth' else color
            mismatch|=image(out,q,wanted,BPP[fmt] if out['kind']=='depth' else 4,6 if out['kind']=='depth' else 1,negative=negative)
            citations.append(dict(**cite,prediction='P2',pointer='/outputs/'+str(i),actualSha256=sha(bytes.fromhex(out['denseActual']))))
        identity=texture(row['calls'],f['target'],fmt,5,5 if f['target']==4 else 3,f['source']['arraySize'])
        states=[s for s in row['attachmentStates'] if row['operationNativeStart']<=s['sequence']<row['operationNativeEnd'] and row['calls'][s['sequence']]['name'] in ['clear','drawArrays','drawArraysInstanced']]
        assert any(row['calls'][s['sequence']]['name'].startswith('draw') for s in states)
        if negative:
            assert mismatch and row['faultHits']>0 and row['status']=='failed'
            assert any(c.get('fault')=='physical-original-depth-attachment' and c['arguments']!=c['delivered'] for c in row['calls'])
            counts['faults']+=1;citations.append(dict(**cite,prediction='P2 sabotage',pointer='/outputs/0'));continue
        assert row['status']=='passed' and len(row['outputs'])==4
        for s in states:
            native_state(s['state'],f,identity)
            if row['calls'][s['sequence']]['name'].startswith('draw'):assert s['state']['depthTest'] and s['state']['depthFunction']==513 and s['state']['depthMask'] and s['state']['stencilTest']==(fmt in STENCIL)
        citations.append(dict(**cite,prediction='P1',pointer='/attachmentStates',nativeTexture=identity,nativeSequences=[s['sequence'] for s in states]))
        expected_cost=sum(len(p['data']) for p in raw_planes)*(2 if fmt==126 else 1)+f['width']*f['height']*f['color']['arraySize']*4+len(f['positions'])
        assert row['cost']==expected_cost
        if 'attack' in row:
            a=row['attack'];counts['refusals']+=1;assert a['before']['host']['store']==a['after']['host']['store']
            assert struct.unpack_from('<I',bytes.fromhex(a['record']['response']))[0]==0x1205
            assert not any(c['name'].startswith('draw') or c['name'] in ['framebufferTextureLayer','framebufferTexture2D'] for c in row['calls'][a['before']['calls']:a['after']['calls']])
            citations.append(dict(**cite,prediction='P3',pointer='/attack'))
        if 'lifecycle' in row:
            life=row['lifecycle'];counts['lifecycle']+=1;q,wanted=sample(f,model);image(life['samples'][0],q,wanted,16,2,0xc7)
            oldp=model[f['level']]
            for y in range(oldp['height']):
                for x in range(oldp['width']):
                    i=(f['layer']*oldp['height']+y)*oldp['width']+x;depth(fmt,oldp['data'],i,0)
                    if fmt in STENCIL:oldp['data'][i*BPP[fmt]+STENCIL[fmt]]=55
            q,wanted=sample(f,model);image(life['samples'][1],q,wanted,16,2,0xc7)
            assert life['samples'][0]['host']['renderer']['work']['programLinks']==life['samples'][1]['host']['renderer']['work']['programLinks']
            for clear in life['clears']:
                for s in row['attachmentStates']:
                    if clear['nativeStart']<=s['sequence']<clear['nativeEnd'] and row['calls'][s['sequence']]['name']=='clear':native_state(s['state'],f,identity)
            if life['mode']=='private-refresh-aspect':
                a=life['aspectOutput'];q={k:a[k] for k in ['level','width','height','layers']};wanted=bytearray(q['width']*q['height']*BPP[a['format']])
                for i in range(q['width']*q['height']):
                    depth(a['format'],wanted,i,1)
                    if a['format'] in STENCIL:wanted[i*BPP[a['format']]+STENCIL[a['format']]]=117
                image(a,q,wanted,BPP[a['format']],8)
                for out in life['refreshedPlanes']:q=model[out['level']];image(out,q,q['data'],BPP[fmt],6)
            else:
                keep=life['retention'];assert keep['oldGeneration']!=keep['newGeneration']
                assert keep['replacement']['format']!=fmt and keep['replacement']['target']!=f['target']
                sub=keep['after']['renderer']['contexts'][0]['subContexts'][0]
                assert next(o for o in sub['objects'] if o['handle']==21)['resourceGeneration']==keep['oldGeneration']
                assert next(o for o in sub['objects'] if o['handle']==65)['resourceGeneration']==keep['oldGeneration']
                for out in life['replacementOutputs']:q={k:out[k] for k in ['level','width','height','layers']};image(out,q,bytearray(q['width']*q['height']*q['layers']*BPP[out['format']]),BPP[out['format']],6)
                reset=life['reset'];assert reset['pending']['syncs']==1 and reset['usedIndex']==0
                assert reset['response']==reset['responseBeforeReset'] and reset['after']['store']['budgets']['gpuBytes']==reset['after']['store']['budgets']['backingBytes']==0
                assert reset['pending']['guestTrace'] and reset['pending']['machineDigest']
                if f.get('waitFailed'):assert life['waitFailure']['host']['poisoned'] and life['waitFailure']['native']['poisoned'] and struct.unpack_from('<I',bytes.fromhex(life['waitFailure']['record']['response']))[0]==0x1200
            citations.append(dict(**cite,prediction='P5/P6',pointer='/lifecycle'))
    if name.startswith('hardware-'):
        expected={(target,fmt,role,mip,layer) for target in [4,7] for fmt in BPP for role in [1,9] for mip in range(3) for layer in range(6 if target==4 else 5)}
        assert tuples==expected and len(report['runs'])==330;counts['hardware']+=330
    print(name+': interrogated '+str(len(report['runs']))+' complete rows',flush=True)
assert counts['hardware']==990 and counts['refusals']==130 and counts['faults']==2 and counts['lifecycle']==66
assert counts['historicalControls']==61 and counts['historicalRefusals']==120
(OUT/'citations.jsonl').write_text(''.join(json.dumps(c)+'\n' for c in citations))
report=dict(schema='dimensional-depth-surfaces-fresh-full-interrogation-v1',status='passed',counts=counts,
            predictions={k:'HELD' for k in ['P1','P2','P3','P4','P5','P6']},citationsSha256=sha((OUT/'citations.jsonl').read_bytes()))
(OUT/'interrogation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
