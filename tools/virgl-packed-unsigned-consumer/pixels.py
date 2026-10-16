#!/usr/bin/env python3
"""Invert literal original TGSI/wire state independently of product JS and GLSL."""
import gzip,hashlib,json,re,struct,sys,math
from pathlib import Path

TABLE=json.loads((Path(__file__).resolve().parents[1]/'virgl-command/standard-packed-unsigned-formats.json').read_text())
PACKED_UINT={r['originalFormat']:r for r in TABLE['records']}
def word(value):return struct.unpack('<I',struct.pack('<f',value))[0]
def scalar(value):return struct.unpack('<f',struct.pack('<I',value))[0]
def descriptor(fmt):
    if fmt in PACKED_UINT:return dict(integer=True,packedUnsigned=True,bits=32,signed=False,components=4,**PACKED_UINT[fmt])
    if 177<=fmt<=200:
        n=fmt-177;bits=[8,16,32][n//8];return dict(integer=True,bits=bits,signed=(n%8)>=4,components=n%4+1)
    assert fmt==31,fmt
    return dict(integer=False,bits=32,signed=False,components=4)
def native(fmt,raw,lane,clear=False):
    d=descriptor(fmt)
    if d.get('packedUnsigned'):
        return min(raw,2**d['rgbaFields'][lane]['bits']-1)
    if lane>=d['components']:return (1 if d['integer'] else word(1)) if lane==3 else 0
    if not d['integer']:return raw
    value=raw if not d['signed'] or raw<2**31 else raw-2**32
    if clear:value=max(-(2**(d['bits']-1)) if d['signed'] else 0,min(2**(d['bits']-int(d['signed']))-1,value))
    return value&0xffffffff
def decoded_native(fmt,raw):
    assert len(raw)%4==0
    return list(struct.unpack('<'+'I'*(len(raw)//4),raw))
def original_packed(fmt,values):
    d=PACKED_UINT[fmt];packed=0
    for lane,field in enumerate(d['rgbaFields']):
        assert 0<=values[lane]<2**field['bits'],'native integer field already saturated'
        packed|=values[lane]<<field['offset']
    return packed.to_bytes(d['guestPixelBytes'],'little')
def packets(text):
    data=bytes.fromhex(text);at=0
    while at<len(data):
        header=struct.unpack_from('<I',data,at)[0];count=header>>16;end=at+(count+1)*4
        assert end<=len(data)
        yield header&255,(header>>8)&255,list(struct.unpack_from('<'+'I'*count,data,at+4)),data[at:end]
        at=end
def original_fragment(text):
    declared={int(register):int(slot or 0) for register,slot in re.findall(r'^DCL OUT\[(\d+)\], COLOR(?:\[(\d+)\])?$',text,re.M)}
    immediates={int(index):[int(value)&0xffffffff for value in values.split(',')] for index,values in re.findall(r'^IMM\[(\d+)\] UINT32 \{([^}]+)\}$',text,re.M)}
    result={declared[int(register)]:immediates[int(index)] for register,index in re.findall(r'\bMOV OUT\[(\d+)\], IMM\[(\d+)\]',text)}
    assert len(result)==len(declared) and all(len(words)==4 for words in result.values())
    if 'PROPERTY FS_COLOR0_WRITES_ALL_CBUFS 1' in text:
        assert set(result)=={0};result={slot:result[0] for slot in range(4)}
    return result,bool(re.search(r'\bKILL\b',text))
def audit_native_lifetimes(run):
    syncs={entry['id']:entry for entry in run['fenceObjects']};counts=dict(syncs=len(syncs),polls=0,cpuReads=0)
    assert len(syncs)==len(run['fenceObjects'])
    for entry in syncs.values():
        assert entry['identity']=='WebGLSync' and entry['deleted']==1;counts['polls']+=len(entry['polls'])
        assert all(p['sequence']>entry['createdSequence'] and p['sync']==entry['id'] for p in entry['polls'])
    writer=0
    for event in run['events']:
        if event['name'] in ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced','clearBufferiv','clearBufferuiv','clearBufferfv','clear','texSubImage2D','bufferSubData','copyBufferSubData']:writer=event['sequence']
        if event['name'] in ['readPixels','getBufferSubData'] and event['cpu']:
            c=event['completion'];entry=syncs[c['sync']];assert c['actual'] in [37146,37148] and c['delivered'] in [37146,37148]
            assert event['sequence']>c['sequence']>writer and entry['createdSequence']>writer,(event['name'],writer,c)
            assert any(p['sequence']==c['sequence'] and p['actual']==c['actual'] and p['delivered']==c['delivered'] for p in entry['polls']);counts['cpuReads']+=1
    assert all(obj['deleted']==1 for obj in run['nativeObjects'])
    assert all(n==0 for budgets in [run['final']['renderer']['budgets'],run['final']['resources']['budgets']] for n in budgets.values())
    return counts
def main(directory,control=False):
    directory=Path(directory);r=json.loads((directory/'report.json').read_text());e=r.get('browserResult',{}).get('result') or r.get('partial')
    assert e and r['browserErrors']==dict(console=[],page=[],requests=[])
    blobs={row['key']:row for row in e['blobs']};counts=dict(frames=0,targets=0,words=0,planes=0,backingBytes=0,syncs=0,polls=0,cpuReads=0,nativeDrawStates=0);differences=[]
    def load(ref):
        row=blobs[ref['key']];assert row['sha256']==ref['sha256']
        raw=(directory/row['path']).read_bytes();assert hashlib.sha256(raw).hexdigest()==row['gzipSha256']
        raw=gzip.decompress(raw);assert len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256'];return raw
    for index,run in enumerate(e['runs']):
        created={row['metadata']['id']:row['metadata'] for row in run['created']};surfaces={};shaders={};objects={};bound={};fragment=None
        state=dict(mask=15,blend=False,source=1,destination=1,alphaSource=1,alphaDestination=1,scissor=False,box=[0,0,0,0],color=[0,0,0,0],viewport=[0,0,0,0]);planes={};last=-1
        textures={row['metadata']['id']:row['texture'] for row in run['allocations']};draws={row['label']:row for row in run['draws']}
        for m in created.values():
            if m['id'] not in [1,2,4,5,9]:continue
            d=descriptor(m['format'])
            for level in range(m['lastLevel']+1):
                width=max(1,m['width']>>level);height=max(1,m['height']>>level)
                planes[m['id'],level]=[native(m['format'],0,lane) for _ in range(width*height) for lane in range(4)]
        for fi in run['frames']:
            frame=e['frames'][fi];assert frame['run']==index
            for history in run['history'][last+1:frame['historyIndex']+1]:
                for op,kind,w,raw in packets(history['hex']):
                    if op==1 and kind==4:shaders[w[0]]=raw[24:24+w[2]-1].decode('ascii')
                    elif op==1 and kind==8:surfaces[w[0]]=dict(id=w[1],format=w[2],level=w[3])
                    elif op==1 and kind==1:
                        bits=w[3];objects[kind,w[0]]=dict(rgbFunction=bits>>1&7,alphaFunction=bits>>14&7,mask=bits>>27&15,blend=bool(bits&1),source=bits>>4&31,destination=bits>>9&31,alphaSource=bits>>17&31,alphaDestination=bits>>22&31)
                    elif op==1 and kind==2:objects[kind,w[0]]=dict(scissor=bool(w[1]&(1<<14)))
                    elif op==2 and kind in [1,2]:state.update(objects[kind,w[0]])
                    elif op==5:
                        assert len(w)==2+w[0];bound={slot:surfaces[handle] for slot,handle in enumerate(w[2:]) if handle}
                    elif op==14:state['color']=list(map(scalar,w))
                    elif op==15:state['box']=[w[1]&65535,w[1]>>16,w[2]&65535,w[2]>>16]
                    elif op==4:
                        v=list(map(scalar,w[1:]));state['viewport']=[v[3]-v[0],v[4]-abs(v[1]),2*v[0],2*abs(v[1])]
                    elif op==31 and w[1]==1:fragment=shaders[w[0]]
                    elif op in [7,8]:
                        outputs,discard=original_fragment(fragment) if op==8 else ({},False)
                        if op==8:
                            draw=draws[history['label']]['native'];counts['nativeDrawStates']+=1
                            assert draw['blend']==state['blend'] and draw['scissor']==state['scissor'] and draw['viewport']==state['viewport']
                            equations=[32774,32778,32779,32775,32776];rgb_function=state.get('rgbFunction',0);alpha_function=state.get('alphaFunction',0)
                            assert draw['blendEquations']==([equations[rgb_function],equations[alpha_function]] if state['blend'] else [32774,32774])
                            factors={1:1,7:32769,8:32771,23:32770,24:32772};mixed=state['source'] in [7,23] and state['destination'] in [8,24] or state['source'] in [8,24] and state['destination'] in [7,23]
                            assert draw['blendFactors']==([1 if mixed or rgb_function>=3 else factors[state['source']],0 if rgb_function>=3 else factors[state['destination']],factors[state['alphaSource']],factors[state['alphaDestination']]] if state['blend'] else [1,0,1,0])
                            assert draw['blendColor']==state['color']
                            if draw['blendFold'] is not None:
                                assert mixed and state['blend'] and rgb_function<3
                                factor=[state['color'][3]]*3 if state['source'] in [8,24] else state['color'][:3]
                                if state['source'] in [23,24]:factor=[1-value for value in factor]
                                assert draw['blendFold']==factor+[1]
                            for slot,color in enumerate(draw['colors']):
                                target=bound.get(slot);attachment=textures[target['id']] if target else None
                                if color['attachment']!=attachment:
                                    assert control;differences.append(dict(frame=fi,slot=slot,kind='native-attachment',observed=color['attachment'],expected=attachment))
                                reflected=next(row for row in draw['outputs'] if row['slot']==slot)['location']
                                assert reflected in [slot,-1] and (slot in outputs or reflected==-1)
                                assert discard or reflected==(slot if slot in outputs else -1)
                                assert color['drawBuffer']==(36064+slot if target and reflected==slot else 0)
                                implicit=bool(target and descriptor(target['format'])['components']<4)
                                assert color['mask']==[bool(state['mask']&(1<<lane)) and not(implicit and lane==3) for lane in range(4)]
                                if target:
                                    d=descriptor(target['format']);assert color['level']==target['level']
                                    assert color['componentType']==(5124 if d['signed'] else 5125) if d['integer'] else color['componentType']==5126
                        for slot,target in bound.items():
                            if op==7 and not w[0]&(4<<slot) or op==8 and (discard or slot not in outputs):continue
                            m=created[target['id']];assert m['format']==target['format'];level=target['level'];fmt=m['format'];d=descriptor(fmt)
                            width=max(1,m['width']>>level);height=max(1,m['height']>>level);plane=planes[target['id'],level]
                            source=w[1:5] if op==7 else outputs[slot]
                            for y in range(height):
                                for x in range(width):
                                    if op==8 and state['scissor'] and not(state['box'][0]<=x<state['box'][2] and state['box'][1]<=y<state['box'][3]):continue
                                    for lane in range(4):
                                        if lane==3 and d['components']<4 or op==8 and not state['mask']&(1<<lane):continue
                                        at=(y*width+x)*4+lane;value=source[lane]
                                        if op==8 and state['blend'] and not d['integer']:
                                            src=scalar(value);dst=scalar(plane[at])
                                            factors={1:1,7:state['color'][lane],8:state['color'][3],23:1-state['color'][lane],24:1-state['color'][3]}
                                            a=state['alphaSource'] if lane==3 else state['source'];b=state['alphaDestination'] if lane==3 else state['destination']
                                            equation=state.get('alphaFunction' if lane==3 else 'rgbFunction',0);left=src*factors[a];right=dst*factors[b]
                                            value=word(left+right if equation==0 else left-right if equation==1 else right-left if equation==2 else min(src,dst) if equation==3 else max(src,dst))
                                        plane[at]=native(fmt,value,lane,op==7)
            last=frame['historyIndex'];counts['frames']+=1
            for target in frame['targets']:
                m=target['metadata'];fmt=m['format'];d=descriptor(fmt);key=m['id'],target['level'];expected=planes[key];actual=load(target['native'])
                words=decoded_native(fmt,actual);counts['words']+=len(words);counts['targets']+=1
                if words!=expected:differences.append(dict(frame=fi,slot=target['slot'],kind='native',miss=[dict(at=at,observed=a,expected=b) for at,(a,b) in enumerate(zip(words,expected)) if a!=b][:16]))
                for plane in target['planes']:
                    native_plane=load(plane['native']);observed=decoded_native(fmt,native_plane)
                    if observed!=planes[m['id'],plane['level']]:differences.append(dict(frame=fi,slot=target['slot'],kind='native-level',level=plane['level']))
                    counts['planes']+=1
                if 'backing' not in target:
                    assert control and differences and frame is e['frames'][-1] and target is frame['targets'][-1],'only a real failing control may stop before the public transfer'
                    continue
                backing=load(target['backing']);wanted=bytearray([0x2e]*len(backing));transfers=list(packets(run['history'][target['publicHistory']]['hex']));assert len(transfers)==1
                op,_,w,_=transfers[0];assert op==43 and w[0]==m['id'] and w[1]==target['level'] and w[12]==2
                pixel=d['guestPixelBytes'] if d.get('packedUnsigned') else d['components']*(d['bits']//8);width,height=w[8],w[9];stride=w[3] or width*pixel
                for y in range(height):
                    for x in range(width):
                        if d.get('packedUnsigned'):
                            at=w[11]+y*stride+x*pixel;wanted[at:at+pixel]=original_packed(fmt,expected[(y*width+x)*4:(y*width+x+1)*4]);continue
                        for lane in range(d['components']):
                            value=expected[(y*width+x)*4+lane];size=d['bits']//8;at=w[11]+y*stride+x*pixel+lane*size
                            wanted[at:at+size]=(value&((1<<(size*8))-1)).to_bytes(size,'little')
                if backing!=wanted:differences.append(dict(frame=fi,slot=target['slot'],kind='public-original-padding'))
                counts['backingBytes']+=len(backing)
        for key,value in audit_native_lifetimes(run).items():counts[key]+=value
    if control:
        assert r['status']=='failed' and e['sabotage']['held'] is False and e['sabotage']['slot']==3
        assert any(d['slot']==3 and d['kind']=='native' for d in differences)
        if r['fault']=='completed-output':
            frame=e['frames'][-1];assert frame['originalCompletion']['sync']!=frame['sabotageCompletion']['sync']
            assert frame['originalCompletion']['sequence']<frame['sabotageCompletion']['sequence']
        else:assert r['fault']=='nonzero-attachment'
    result=dict(status='passed' if not differences else 'refuted',counts=counts,differences=differences,originalWireInverse=True,productImports=False,expectedPhysicalControl=control)
    (directory/'pixel-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
    assert bool(differences)==control,'original whole-word inverse result contradicts expected control'
if __name__=='__main__':main(sys.argv[1],len(sys.argv)>2 and sys.argv[2]=='--control')
