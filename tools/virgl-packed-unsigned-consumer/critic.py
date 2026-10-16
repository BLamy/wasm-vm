#!/usr/bin/env python3
"""Full original-wire inverse for the promoted mixed packed UINT critic attack."""
import argparse,gzip,hashlib,json,re,struct
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sha=lambda b:hashlib.sha256(b).hexdigest()
def packets(text):
    data=bytes.fromhex(text);at=0
    while at<len(data):
        header=struct.unpack_from('<I',data,at)[0];end=at+4*((header>>16)+1);assert end<=len(data)
        yield header&255,(header>>8)&255,list(struct.unpack_from('<'+'I'*(header>>16),data,at+4)),data[at:end]
        at=end
def number(bits):return struct.unpack('<f',struct.pack('<I',bits))[0]
def bits(value):return struct.unpack('<I',struct.pack('<f',value))[0]
def fields(fmt):return [(10,20),(10,10),(10,0),(2,30)] if fmt==225 else [(10,0),(10,10),(10,20),(2,30)]
def convert(fmt,value,lane):
    if fmt in [225,253]:return min(value,(1<<fields(fmt)[lane][0])-1)
    assert fmt in [31,200];return value
def output(text):
    registers={int(r):int(s or 0) for r,s in re.findall(r'^DCL OUT\[(\d+)\], COLOR(?:\[(\d+)\])?$',text,re.M)}
    imm={int(i):[int(v)&0xffffffff for v in values.split(',')] for i,values in re.findall(r'^IMM\[(\d+)\] UINT32 \{([^}]+)\}$',text,re.M)}
    result={registers[int(r)]:imm[int(i)] for r,i in re.findall(r'\bMOV OUT\[(\d+)\], IMM\[(\d+)\]',text)}
    assert len(result)==len(registers) and all(len(v)==4 for v in result.values())
    return result

def inspect(directory,control=False):
    directory=Path(directory).resolve();raw_report=(directory/'report.json').read_bytes();report=json.loads(raw_report)
    e=report.get('browserResult',{}).get('result') or report.get('partial');assert e['mode']=='critic'
    assert report['status']==('failed' if control else 'passed') and report['browserErrors']==dict(console=[],page=[],requests=[])
    assert report['browser']['headless'] is False and 'Apple M4 Max' in e['gpu'] and 'Metal' in e['gpu']
    assert not any(re.search(r'swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu',s,re.I) for s in report['browser']['commandLine'])
    assert not e['guestExecution'] and not e['productionNegotiation']
    blobs={b['key']:b for b in e['blobs']};assert len(blobs)==len(e['blobs']);data={}
    for key,b in blobs.items():
        compressed=(directory/b['path']).read_bytes();assert sha(compressed)==b['gzipSha256']
        raw=gzip.decompress(compressed);assert len(raw)==b['bytes'] and sha(raw)==b['sha256'];data[key]=raw
    def load(ref):assert blobs[ref['key']]['sha256']==ref['sha256'];return data[ref['key']]
    assert len(e['runs'])==1;run=e['runs'][0]
    owners={};current={};planes={};dimensions={}
    for creation,allocation in zip(run['created'],run['allocations']):
        m=creation['metadata'];assert all(allocation['metadata'][k]==v for k,v in m.items())
        t=allocation['texture'];owner=dict(metadata=m,generation=creation['generation'],texture=t)
        current.setdefault(m['id'],owner)
        if t is None:continue
        owners[t]=owner
        for level in range(m['lastLevel']+1):
            w,h=max(1,m['width']>>level),max(1,m['height']>>level);dimensions[t,level]=(w,h)
            planes[t,level]=[0]*(w*h*4)
    assert len(run['created'])==len(run['allocations'])
    reuse=next(a for a in run['actions'] if a['kind']=='critic-mixed-alias-id-reuse')
    assert {r['slot'] for r in reuse['replacements']}=={0,3}
    contexts={};snapshots={};draws={d['label']:d for d in run['draws']};assert len(draws)==len(run['draws'])
    for hi,history in enumerate(run['history']):
        if hi==reuse['beforeHistory']:
            for r in reuse['replacements']:
                old=current[r['metadata']['id']];new=owners[r['texture']]
                assert old['generation']==r['oldGeneration']<r['newGeneration']==new['generation']
                assert old['metadata']['format']!=new['metadata']['format'] and {old['metadata']['format'],new['metadata']['format']}=={225,253}
                assert load(r['backing'])==load(r['backingAfter'])==bytes([0x71])*20000
                current[r['metadata']['id']]=new
        ctx=contexts.setdefault(history['ctx'],dict(shaders={},objects={},surfaces={},bound={},fragment=None,mask=15,blend=False,
                    source=1,destination=0,alphaSource=1,alphaDestination=0,color=[0,0,0,0],scissor=False,box=[0,0,0,0]))
        assert history['result']['ok'] and history['result']['gpuComplete']
        for op,kind,w,packet in packets(history['hex']):
            if op==1 and kind==4:ctx['shaders'][w[0]]=packet[24:24+w[2]-1].decode('ascii')
            elif op==31 and w[1]==1:ctx['fragment']=ctx['shaders'][w[0]]
            elif op==1 and kind==8:
                owner=current[w[1]];assert owner['metadata']['format']==w[2]
                ctx['surfaces'][w[0]]=dict(**owner,level=w[3])
            elif op==5:ctx['bound']={i:ctx['surfaces'][h] for i,h in enumerate(w[2:]) if h};assert w[0]==4 and w[1]==0
            elif op==1 and kind==1:
                v=w[3];ctx['objects'][kind,w[0]]=dict(mask=v>>27&15,blend=bool(v&1),source=v>>4&31,destination=v>>9&31,alphaSource=v>>17&31,alphaDestination=v>>22&31)
            elif op==1 and kind==2:ctx['objects'][kind,w[0]]=dict(scissor=bool(w[1]&(1<<14)))
            elif op==2 and kind in [1,2]:ctx.update(ctx['objects'][kind,w[0]])
            elif op==14:ctx['color']=list(map(number,w))
            elif op==15:ctx['box']=[w[1]&65535,w[1]>>16,w[2]&65535,w[2]>>16]
            elif op in [7,8]:
                values=output(ctx['fragment']) if op==8 else None
                if op==8:
                    assert set(values)=={1,3};draw=draws[history['label']];native=draw['native']
                    assert native['blend']==ctx['blend'] and native['scissor']==ctx['scissor'] and draw['args']==[4,0,6]
                    assert native['viewport']==[0,0,8,4] and native['scissorBox']==[1,1,6,2] and native['blendFold']==[.25,.5,.75,1]
                    assert native['blendFactors']==[1,32771,1,1] and native['blendEquations']==[32774,32774]
                    for color in native['colors']:
                        slot=color['slot'];target=ctx['bound'][slot];fmt=target['metadata']['format']
                        assert color['attachment']==target['texture'] and color['level']==target['level']==1
                        assert color['componentType']==(5126 if fmt==31 else 5124 if fmt==200 else 5125)
                        assert color['drawBuffer']==(36064+slot if slot in values else 0) and color['mask']==[True,False,True,False]
                    assert [(o['slot'],o['location']) for o in native['outputs']]==[(0,-1),(1,1),(2,-1),(3,3)]
                    matching=[q for q in run['requests'] if q['method']=='pair' and q['request']['fragmentText']==ctx['fragment']]
                    assert matching and all(q['request']['signedColorMask']==0 and q['request']['unsignedColorMask']==8 and q['result']['ok'] for q in matching)
                for slot,target in ctx['bound'].items():
                    if op==7 and not w[0]&(4<<slot) or op==8 and slot not in values:continue
                    fmt=target['metadata']['format'];key=target['texture'],target['level'];width,height=dimensions[key];plane=planes[key];src=w[1:5] if op==7 else values[slot]
                    for y in range(height):
                        for x in range(width):
                            if op==8 and ctx['scissor'] and not(ctx['box'][0]<=x<ctx['box'][2] and ctx['box'][1]<=y<ctx['box'][3]):continue
                            for lane in range(4):
                                if op==8 and not ctx['mask']&(1<<lane):continue
                                at=(y*width+x)*4+lane;value=src[lane]
                                if op==8 and ctx['blend'] and fmt==31:
                                    factor={1:1,7:ctx['color'][lane],8:ctx['color'][3]};left=ctx['alphaSource'] if lane==3 else ctx['source'];right=ctx['alphaDestination'] if lane==3 else ctx['destination']
                                    value=bits(number(value)*factor[left]+number(plane[at])*factor[right])
                                plane[at]=convert(fmt,value,lane)
        snapshots[hi]={k:list(v) for k,v in planes.items()}
    differences=[];counts=dict(frames=0,targets=0,words=0,privatePlanes=0,publicBytes=0,replacementBytes=40000)
    points=[]
    for fi,frame in enumerate(e['frames']):
        expected=snapshots[frame['historyIndex']];counts['frames']+=1
        if frame['kind']=='draw':assert frame['completion']['sequence']>draws[frame['label']]['sequence']
        for target in frame['targets']:
            owner=owners[target['texture']];assert target['generation']==owner['generation'] and target['metadata']['id']==owner['metadata']['id'] and target['metadata']['format']==owner['metadata']['format']
            key=target['texture'],target['level'];want=expected[key];actual=load(target['native']);words=list(struct.unpack('<'+'I'*(len(actual)//4),actual));assert len(words)==len(want)
            miss=[dict(at=i,observed=a,expected=b) for i,(a,b) in enumerate(zip(words,want)) if a!=b]
            if miss:differences.append(dict(frame=fi,slot=target['slot'],kind='native',miss=miss,sha256=target['native']['sha256']))
            counts['targets']+=1;counts['words']+=len(words)
            for plane in target['planes']:
                raw=load(plane['native']);observed=list(struct.unpack('<'+'I'*(len(raw)//4),raw));wanted=expected[target['texture'],plane['level']]
                assert len(observed)==len(wanted)
                if observed!=wanted:differences.append(dict(frame=fi,slot=target['slot'],kind='private-level',level=plane['level'],sha256=plane['native']['sha256']))
                counts['privatePlanes']+=1
            if 'backing' in target:
                backing=load(target['backing']);wanted=bytearray([0x2e]*len(backing));commands=list(packets(run['history'][target['publicHistory']]['hex']));assert len(commands)==1
                op,_,w,_=commands[0];m=target['metadata'];fmt=m['format'];width,height=dimensions[key];pixel=4 if fmt in [225,253] else 16
                assert op==43 and w[0]==m['id'] and w[1]==1 and w[12]==2 and w[8:11]==[width,height,1]
                assert w[11]==5 and w[3]==width*pixel+3
                for y in range(height):
                    for x in range(width):
                        lanes=want[(y*width+x)*4:(y*width+x+1)*4]
                        encoded=sum(v<<shift for v,(_,shift) in zip(lanes,fields(fmt))).to_bytes(4,'little') if pixel==4 else struct.pack('<4I',*lanes)
                        at=w[11]+y*w[3]+x*pixel;wanted[at:at+pixel]=encoded
                assert backing==wanted;counts['publicBytes']+=len(backing)
            else:assert frame['reused']
        points.append(dict(frame=fi,packetHistory=frame['historyIndex'],completion=frame['completion'],targetDigests=[dict(slot=t['slot'],nativeSha256=t['native']['sha256']) for t in frame['targets']]))
    syncs={s['id']:s for s in run['fenceObjects']};assert len(syncs)==len(run['fenceObjects'])
    assert [e['sequence'] for e in run['events']]==list(range(1,len(run['events'])+1));writer=0
    for s in syncs.values():
        creates=[e for e in run['events'] if e['name']=='fenceSync' and e['sync']==s['id']];deletes=[e for e in run['events'] if e['name']=='deleteSync' and e['sync']==s['id']]
        assert len(creates)==len(deletes)==s['deleted']==1 and s['identity']=='WebGLSync' and creates[0]['sequence']==s['createdSequence']
        polls=[e for e in run['events'] if e['name']=='clientWaitSync' and e['sync']==s['id']];assert polls==s['polls']
        assert all(s['createdSequence']<e['sequence']<deletes[0]['sequence'] and e['args']==[0,0] and (e['delivered']==37147 or e['delivered']==e['actual']) for e in polls)
    for event in run['events']:
        if event['name'] in ['drawArrays','drawElements','clearBufferiv','clearBufferuiv','clearBufferfv','clear','texSubImage2D','bufferSubData','copyBufferSubData']:writer=event['sequence']
        if event['name'] in ['readPixels','getBufferSubData'] and event['cpu']:
            c=event['completion'];assert event['sequence']>c['sequence']>writer and syncs[c['sync']]['createdSequence']>writer
            assert c['actual'] in [37146,37148] and c['delivered']==c['actual'] and any(p['sequence']==c['sequence'] for p in syncs[c['sync']]['polls'])
    assert all(o['deleted']==1 for o in run['nativeObjects']) and all(v==0 for owner in ['renderer','resources'] for v in run['final'][owner]['budgets'].values())
    assert draws['critic/context1-first']['native']['program']==draws['critic/context1-warm']['native']['program']==draws['critic/context1-retained']['native']['program']
    assert draws['critic/context2-first']['native']['program']!=draws['critic/context1-first']['native']['program']
    if control:
        assert report['fault']=='completed-output' and e['sabotage']['held'] is False
        ctl=run['control'];before=load(ctl['before']);target=e['frames'][-1]['targets'][-1];after=load(target['native']);at=ctl['pixel']*4+ctl['lane'];offset=at*4
        assert struct.unpack_from('<I',before,offset)[0]==17 and struct.unpack_from('<I',after,offset)[0]==16
        assert before[:offset]==after[:offset] and before[offset+4:]==after[offset+4:]
        a,b=ctl['originalCompletion'],ctl['sabotageCompletion'];assert a['sync']!=b['sync'] and a['sequence']<b['sequence']
        assert any(event['name']=='texSubImage2D' and a['sequence']<event['sequence']<syncs[b['sync']]['createdSequence'] for event in run['events'])
        assert differences and differences[0]['frame']==8 and differences[0]['slot']==3 and differences[0]['miss']==[dict(at=36,observed=16,expected=17)]
    else:assert not differences
    result=dict(status='refuted' if differences else 'passed',prediction='P12-promoted-sabotage' if control else 'P11-novel',counts=counts,differences=differences,points=points,
                originalPacketsAndTGSIDerived=True,storedExpectationsRead=False,productRuntimeImports=False,nativeUintTolerance=0,reportSha256=sha(raw_report),inverseSha256=sha(Path(__file__).read_bytes()),control=control)
    (directory/'critic-audit.json').write_text(json.dumps(result,indent=2)+'\n');return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('directory',type=Path);parser.add_argument('--control',action='store_true');args=parser.parse_args()
    print(json.dumps(inspect(args.directory,args.control)))
