#!/usr/bin/env python3
"""Invert original TGSI, packets and input bytes. No product or emitted GLSL oracle."""
import copy,gzip,hashlib,json,math,re,struct,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'virgl-packed-unsigned-consumer'))
from pixels import packets,scalar,word
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'virgl-unorm-depth'))
from lifetimes import audit_lifetimes
sha=lambda raw:hashlib.sha256(raw).hexdigest()

def audit(directory,control=False):
    directory=Path(directory);envelope=json.loads((directory/'report.json').read_text());e=envelope.get('partial') or envelope['browserResult']['result']
    assert envelope['browserErrors']==dict(console=[],page=[],requests=[])
    blobs={r['key']:r for r in e['blobs']};assert len(blobs)==len(e['blobs'])
    def load(ref):
        row=blobs[ref['key']];assert row['sha256']==ref['sha256'];z=(directory/row['path']).read_bytes();assert sha(z)==row['gzipSha256'];raw=gzip.decompress(z)
        assert len(raw)==row['bytes'] and sha(raw)==row['sha256'];return raw
    counts=dict(runs=0,frames=0,outputWords=0,depthPixels=0,publicBytes=0,syncs=0,polls=0,cpuReads=0,matchedDrawResponses=0,actualPairResponses=0,actualStageResponses=0,nativeFailures=0,clearIntervalPixels=0,consumedSyncs=0,disposalOnlySyncs=0,fencedCPUReads=0,synchronousCPUReads=0,stratifiedOriginalPackedValues=0,originalS8Values=0,normalizedDepthLanes=0,maximumNormalizedDepthUlp=0);differences=[]
    def compare(raw,expected,where,allowed=()):
        allowed=set(allowed);misses=[];i=0
        if len(raw)!=len(expected):
            differences.append(dict(where=where,observedBytes=len(raw),expectedBytes=len(expected)));return
        while i<len(raw):
            if i in allowed:
                x,y=struct.unpack_from('<I',raw,i)[0],struct.unpack_from('<I',expected,i)[0]
                counts['normalizedDepthLanes']+=1;counts['maximumNormalizedDepthUlp']=max(counts['maximumNormalizedDepthUlp'],abs(x-y))
                if x!=y and (x>0x3f800000 or y>0x3f800000 or abs(x-y)>1) and len(misses)<12:misses.append(dict(wordOffset=i,observed=x,expected=y,maximumUlp=1))
                i+=4
            else:
                if raw[i]!=expected[i] and len(misses)<12:misses.append(dict(byte=i,observed=raw[i],expected=expected[i]))
                i+=1
        if misses:differences.append(dict(where=where,observedBytes=len(raw),expectedBytes=len(expected),misses=misses))
    def lanes_allowed(lanes,length):return [offset+lane*4 for offset in range(0,length,16) for lane in lanes]
    def size(fmt):return 2 if fmt==16 else 8 if fmt==126 else 4
    def zvalue(fmt,raw,i):
        if fmt==16:return struct.unpack_from('<H',raw,i*2)[0]/65535
        if fmt in [20,21]:
            value=struct.unpack_from('<I',raw,i*4)[0];return (value>>8 if fmt==20 else value&0xffffff)/0xffffff
        return struct.unpack_from('<f',raw,i*size(fmt))[0]
    def setz(fmt,raw,i,z):
        if fmt==16:struct.pack_into('<H',raw,i*2,math.floor(z*65535+.5))
        elif fmt in [20,21]:
            old=struct.unpack_from('<I',raw,i*4)[0];n=math.floor(z*0xffffff+.5);struct.pack_into('<I',raw,i*4,((n<<8)|(old&255)) if fmt==20 else ((old&0xff000000)|n))
        else:struct.pack_into('<f',raw,i*size(fmt),z)
    def packed_depth(fmt,raw):
        out=bytearray(raw)
        if fmt==21:
            for i in range(3,len(out),4):out[i]=0
        if fmt==126:
            for i in range(len(out)//8):out[i*8+5:i*8+8]=b'\0'*3
        return bytes(out)
    def diagnostic(fmt,p):
        raw=p['raw'];out=bytearray();s8=bytearray()
        for i in range(p['width']*p['height']):
            out+=struct.pack('<IIII',word(p.get('clear',zvalue(fmt,raw,i))),0,0,1);s8+=bytes([raw[i*4] if fmt==20 else raw[i*8+4] if fmt==126 else 0,0,0,0])
        return bytes(out+s8)
    def compare_depth(fmt,p,native,where):
        expected=diagnostic(fmt,p);count=p['width']*p['height'];counts['depthPixels']+=count
        if 'clear' not in p:return compare(native,expected,where,range(0,count*16,16))
        assert len(native)==len(expected);counts['clearIntervalPixels']+=count;scale=65535 if fmt==16 else 0xffffff;z=p['clear'];lo=math.floor(z*scale)/scale;hi=math.ceil(z*scale)/scale
        for i in range(count):
            v=struct.unpack_from('<f',native,i*16)[0]
            if not max(0,word(lo)-1)<=struct.unpack_from('<I',native,i*16)[0]<=min(0x3f800000,word(hi)+1):differences.append(dict(where=where,pixel=i,observedDepth=v,expectedInterval=[lo,hi]))
            compare(native[i*16+4:i*16+16],expected[i*16+4:i*16+16],where+'/constant-lanes'+str(i))
        compare(native[count*16:],expected[count*16:],where+'/exact-S8')
    def sample(ctx,planes):
        stage,text=next((stage,text) for stage,text in ctx['stage'].items() if re.search(r'\b(TXF|TXL|TEX|TXD|TXB|TXQ)\b',text))
        interpolated=re.search(r'TEX TEMP\[0\], IN\[0\], SAMP\[(\d+)\], 2D',text)
        if interpolated:
            slot=int(interpolated[1]);view=ctx['bound'][stage,slot];state=ctx['sampleStates'][stage,slot]
            assert stage==1 and 'DCL IN[0], GENERIC[0], PERSPECTIVE' in text and 'DCL SVIEW['+str(slot)+'], 2D, FLOAT' in text
            vertex=ctx['stage'][0];assert 'DCL OUT[1], GENERIC[0]' in vertex
            for operation in ['MOV OUT[0], IN[0]','MUL TEMP[0], IN[0], IMM[0]','ADD TEMP[0], TEMP[0], IMM[0]','MOV OUT[1], TEMP[0]']:assert operation in vertex
            m=re.search(r'IMM\[0\] FLT32 \{([^}]+)\}',vertex);assert list(map(float,m[1].split(',')))==[.5,.5,0,0]
            assert view['first']==view['last']==0 and view['swizzle']==[0,1,2,3] and state['min']==state['mag']==0 and state['mip']==2
            p=planes[0];assert p['width']==p['height']==256
            # Fullscreen positions and W=1 are checked independently below.
            # Perspective interpolation of (position.xy*.5+.5) at pixel centers
            # selects exactly source pixel (column,row), with no boundary tie.
            values=[]
            for i in range(65536):values.extend([word(zvalue(fmt,p['raw'],i)),0,0,word(1)])
            return values,stage,slot,view,state,[0]
        op=re.search(r'\b(TXF|TXL|TEX|TXD|TXB|TXQ) TEMP\[0\](?:\.xyw)?, IMM\[(\d+)\],(?: IMM\[\d+\], IMM\[\d+\],)? SAMP\[(\d+)\], 2D',text);assert op,text
        opcode,index,slot=op[1],int(op[2]),int(op[3]);view=ctx['bound'][stage,slot];state=ctx['sampleStates'][stage,slot];assert state['min']==state['mag']==0 and state['mip'] in [0,2]
        assert re.search(r'DCL SVIEW\['+str(slot)+r'\], 2D, FLOAT',text)
        immediates={int(i):list(map(float,values.split(','))) for i,typ,values in re.findall(r'^IMM\[(\d+)\] (FLT32|INT32) \{([^}]+)\}',text,re.M)};coord=immediates[index]
        if opcode=='TXQ':
            assert coord[0].is_integer();p=planes[view['first']+int(coord[0])];values=[p['width'],p['height'],0,view['last']-view['first']+1]
        else:
            lod=int(coord[3]) if opcode in ['TXL','TXF'] else 0
            if opcode=='TXD':
                m=re.search(r'TXD TEMP\[0\], IMM\[\d+\], IMM\[(\d+)\], IMM\[(\d+)\]',text);dx,dy=immediates[int(m[1])],immediates[int(m[2])];base=planes[view['first']]
                rho=max(math.hypot(dx[0]*base['width'],dx[1]*base['height']),math.hypot(dy[0]*base['width'],dy[1]*base['height']));lod=math.floor(math.log2(rho)+.5);assert rho==2
            p=planes[view['first']+lod];x,y=(int(coord[0]),int(coord[1])) if opcode=='TXF' else (math.floor(coord[0]*p['width']),math.floor(coord[1]*p['height']))
            assert 0<=x<p['width'] and 0<=y<p['height'];z=p.get('clear',zvalue(fmt,p['raw'],y*p['width']+x));base=[z,0,0,1];values=[0 if n==4 else 1 if n==5 else base[n] for n in view['swizzle']]
        return [word(v) for v in values],stage,slot,view,state,[i for i,k in enumerate(view['swizzle']) if k==0] if opcode!='TXQ' else []
    for ri,ref in enumerate(e['runs']):
        if 'path' in ref:
            body=(directory/ref['path']).read_bytes();assert len(body)==ref['bytes'] and sha(body)==ref['sha256'];run=json.loads(body)
        else:run=ref
        counts['runs']+=1;fmt=run['format'];assert fmt in [20,21];bpp=4
        planes={p['level']:dict(p,raw=load(p['input'])) for p in run['planes']};backing=load(run['sourceBacking']);wanted=bytearray([0xa7]*len(backing))
        for p in planes.values():
            assert len(p['raw'])==p['width']*p['height']*bpp
            for y in range(p['height']):wanted[p['offset']+y*p['stride']:p['offset']+y*p['stride']+p['width']*bpp]=p['raw'][y*p['width']*bpp:(y+1)*p['width']*bpp]
        assert wanted==backing,'original segmented bytes and every input padding byte'
        if run.get('domain'):
            assert len(planes)==1;edges=[0,1,2,127,128,129,0x7ffffe,0x7fffff,0x800000,0x800001,0xffff7e,0xffff7f,0xffff80,0xfffffd,0xfffffe,0xffffff];words=struct.unpack('<65536I',planes[0]['raw'])
            for i,v in enumerate(words):
                n=edges[i] if i<len(edges) else ((i*257+((i&3)-1))&0xffffff);assert v==(((n<<8)|(i&255)) if fmt==20 else (((i&255)<<24)|n))
            counts['stratifiedOriginalPackedValues']+=65536
            if fmt==20:assert {v&255 for v in words}==set(range(256));counts['originalS8Values']+=256
        pos=struct.unpack('<24f',load(run['positions']));incoming=pos[2]*.5+.5
        assert incoming in [0,.5,1] and pos==tuple(v for x,y in [(-1,-1),(1,-1),(-1,1),(-1,1),(1,-1),(1,1)] for v in [x,y,pos[2],1])
        if run['kind']=='surface':assert incoming==run['incoming']
        contexts={};predictions={};snapshots={};otherDepths={};otherSnapshots={};draws={};color=None
        for d in run['draws']:draws.setdefault(d['label'],[]).append(d)
        for hi,history in enumerate(run['history']):
            ctx=contexts.setdefault(history['ctx'],dict(shaders={},stage={},views={},bound={},samplers={},sampleStates={},surfaces={},colors={},depth=None,dsas={},dsa=dict(enabled=False,write=False,func=0)))
            for ci,(opcode,kind,w,raw) in enumerate(packets(history['hex'])):
                if ci>=history['result'].get('appliedCommands',history.get('appliedBeforeDispose',0)):continue
                if opcode==1 and kind==4:ctx['shaders'][w[0]]=raw[24:24+w[2]-1].decode('ascii')
                elif opcode==31:ctx['stage'][w[1]]=ctx['shaders'][w[0]]
                elif opcode==1 and kind==6:ctx['views'][w[0]]=dict(resource=w[1],format=w[2]&0xffffff,first=w[4]&255,last=w[4]>>8&255,swizzle=[w[5]>>(i*3)&7 for i in range(4)])
                elif opcode==1 and kind==7:ctx['samplers'][w[0]]=dict(min=w[1]>>9&1,mip=w[1]>>11&3,mag=w[1]>>13&1)
                elif opcode==10:
                    for slot,handle in enumerate(w[2:],w[1]):ctx['bound'][w[0],slot]=ctx['views'].get(handle)
                elif opcode==18:
                    for slot,handle in enumerate(w[2:],w[1]):ctx['sampleStates'][w[0],slot]=ctx['samplers'].get(handle)
                elif opcode==1 and kind==8:ctx['surfaces'][w[0]]=dict(resource=w[1],format=w[2],level=w[3])
                elif opcode==5:ctx['colors']={slot:ctx['surfaces'][handle] for slot,handle in enumerate(w[2:]) if handle};ctx['depth']=ctx['surfaces'].get(w[1])
                elif opcode==1 and kind==3:ctx['dsas'][w[0]]=dict(enabled=bool(w[1]&1),write=bool(w[1]&2),func=w[1]>>2&7)
                elif opcode==2 and kind==3:ctx['dsa']=ctx['dsas'][w[0]]
                elif opcode==7:
                    if w[0]&4:
                        assert ctx['colors'][0]['resource']==1;color=w[1:5]*(run['width']*run['height']);predictions[hi]=dict(color=list(color),planes=copy.deepcopy(planes),view=None)
                    if w[0]&1:
                        target=ctx['depth'];z=struct.unpack_from('<d',raw,24)[0]
                        if target['resource']!=6:otherDepths[target['resource'],target['level']]=z
                        else:
                            assert target['format']==fmt;p=planes[target['level']];updated=bytearray(p['raw'])
                            for i in range(p['width']*p['height']):setz(fmt,updated,i,z)
                            p['raw']=bytes(updated);p['clear']=z
                elif opcode==8:
                    draw=draws[history['label']].pop(0);native=draw['native'];colorSurface=ctx['colors'][0];assert draw['args']==[4,0,6] and native['colors'][0]['level']==colorSurface['level']
                    target=next(a for a in run['allocations'] if a['metadata']['id']==colorSurface['resource']);width=max(1,target['metadata']['width']>>colorSurface['level']);height=max(1,target['metadata']['height']>>colorSurface['level']);assert native['viewport']==[0,0,width,height]
                    compare(struct.pack('<I',native['colors'][0]['attachment']),struct.pack('<I',target['texture']),f'{ri}/{hi}/color-attachment')
                    assert native['colors'][0]['componentType']=={31:5126,196:5125,200:5124}[run['outputFormat']]
                    view=None;tolerant=[]
                    if run['kind']=='sample':
                        values,stage,slot,view,state,tolerant=sample(ctx,planes);color=values if len(values)>4 else values*(width*height);assert len(color)==width*height*4;sampler=draw['samplers'][0];assert len(draw['samplers'])==1 and sampler['type']==35678 and sampler['unit']==(16 if stage==0 else 0)+slot
                        assert sampler['parameters']['TEXTURE_MAG_FILTER']==9728 and sampler['parameters']['TEXTURE_MIN_FILTER']==(9984 if state['mip']==0 else 9728)
                        if sampler['metadata']['format']!=fmt or sampler['metadata']['id']!=6:differences.append(dict(where=f'{ri}/{hi}/native-sampler',observed=sampler['metadata'],expectedFormat=fmt))
                        assert sampler['base']==0 and sampler['last']==view['last']-view['first'];assert not native['depthTest']
                    else:
                        imm=re.search(r'IMM\[0\] UINT32 \{([^}]+)\}',ctx['stage'][1]);assert imm;words=[int(v) for v in imm[1].split(',')];assert len(words)==4
                        dsa=ctx['dsa'];target=ctx['depth'];p=planes[target['level']] if target['resource']==6 else None;updated=bytearray(p['raw']) if p else None;assert native['depthTest']==dsa['enabled'] and native['depthMask']==dsa['write'] and native['depthFunction']==512+dsa['func'] and not native['stencilTest']
                        texture=next(a['texture'] for a in run['allocations'] if a['metadata']['id']==target['resource']);depth=native['depth'];compare(struct.pack('<I',depth[0]['texture']),struct.pack('<I',texture),f'{ri}/{hi}/depth-attachment');assert depth[0]['level']==target['level']
                        if depth[1]['texture']!=(texture if target['format'] in [20,126] else None):differences.append(dict(where=f'{ri}/{hi}/stencil-attachment',observed=depth[1]['texture'],expected=texture if target['format'] in [20,126] else None))
                        for i in range(width*height):
                            z=p.get('clear',zvalue(fmt,updated,i)) if p else otherDepths[target['resource'],target['level']];passed=not dsa['enabled'] or [False,incoming<z,incoming==z,incoming<=z,incoming>z,incoming!=z,incoming>=z,True][dsa['func']]
                            if passed:color[i*4:i*4+4]=words
                            if passed and dsa['enabled'] and dsa['write']:assert p is not None;setz(fmt,updated,i,incoming)
                        if p:p['raw']=bytes(updated)
                    assert any(q['method']=='pair' and q['request']['vertexText']==ctx['stage'][0] and q['request']['fragmentText']==ctx['stage'][1] and q['result']['ok'] for q in run['requests']);counts['matchedDrawResponses']+=1
                    predictions[hi]=dict(color=list(color),planes=copy.deepcopy(planes),view=view,draw=draw,tolerant=tolerant)
            snapshots[hi]=copy.deepcopy(planes);otherSnapshots[hi]=copy.deepcopy(otherDepths)
        for fi in run['frames']:
            frame=e['frames'][fi];pred=predictions[frame['historyIndex']];expected=struct.pack('<'+'I'*len(pred['color']),*pred['color']);compare(load(frame['native']),expected,f'{ri}/{fi}/color',lanes_allowed(pred.get('tolerant',[]),len(expected)));counts['frames']+=1;counts['outputWords']+=len(pred['color'])
            if pred.get('draw'):assert frame['completion']['sequence']>pred['draw']['sequence'] and frame['completion']['actual'] in [37146,37148]
            for p in frame.get('outputs',[]):compare(load(p['native']),expected if p['level']==run['outputLevel'] else bytes(p['width']*p['height']*16),f'{ri}/{fi}/output-mip{p["level"]}',lanes_allowed(pred.get('tolerant',[]),len(expected)) if p['level']==run['outputLevel'] else [])
            for kind in ['bindings','depths']:
                for binding in frame.get(kind,[]):
                    if kind=='bindings':assert binding['texture']==pred['draw']['samplers'][0]['texture']
                    for p in binding['planes']:
                        original=pred['planes'][p['original']];assert p['width']==original['width'] and p['height']==original['height'];compare_depth(fmt,original,load(p['native']),f'{ri}/{fi}/{kind}/mip{p["original"]}')
            if 'backing' in frame:
                history=run['history'][frame['publicHistory']];op,kind,w,raw=next(packets(history['hex']));assert op==43 and w[0]==1 and w[12]==2 and w[1]==run['outputLevel'];wanted=bytearray([0x2e]*len(load(frame['backing'])))
                for y in range(w[9]):wanted[w[11]+y*w[3]:w[11]+y*w[3]+w[8]*16]=expected[y*w[8]*16:(y+1)*w[8]*16]
                compare(load(frame['backing']),wanted,f'{ri}/{fi}/public',[w[11]+y*w[3]+x*16+lane*4 for y in range(w[9]) for x in range(w[8]) for lane in pred.get('tolerant',[])]);counts['publicBytes']+=len(wanted)
        if 'depthClear' in run:
            cleared=snapshots[run['clearEvents'][0]['historyIndex']]
            for binding in run['depthClear']['depths']:
                for p in binding['planes']:compare_depth(fmt,cleared[p['original']],load(p['native']),f'{ri}/full-clear/mip{p["original"]}')
        for action in run['actions']:
            if action.get('kind')!='depth-public':continue
            wanted=bytearray(load(action['backingBefore']))
            for read in action['reads']:
                hi=read['historyIndex'];op,kind,w,wire=next(packets(run['history'][hi]['hex']));assert op==43 and w[0]==6 and w[12]==2;p=snapshots[hi][w[1]];raw=packed_depth(fmt,p['raw'])
                rows=[v for v in run['readbacks'] if v['label']==run['history'][hi]['label'] and v['name']=='getBufferSubData' and v['cpu']];assert len(rows)==1
                native=load(rows[0]['bytes']);count=p['width']*p['height'];assert len(native)==count*(8 if fmt==20 else 4)
                chosen=bytearray(raw)
                for i in range(count):
                    bits=struct.unpack_from('<I',native,i*4)[0];z=struct.unpack_from('<f',native,i*4)[0]
                    if 'clear' in p:
                        v=p['clear'];lo=math.floor(v*0xffffff)/0xffffff;upper=math.ceil(v*0xffffff)/0xffffff
                        if not max(0,word(lo)-1)<=bits<=min(0x3f800000,word(upper)+1):differences.append(dict(where=f'{ri}/{hi}/collected-clear',pixel=i,observed=z,interval=[lo,upper]))
                    else:
                        expectedBits=word(zvalue(fmt,p['raw'],i));compare(struct.pack('<I',bits),struct.pack('<I',expectedBits),f'{ri}/{hi}/collected-original-depth',[0])
                    n=math.floor(z*0xffffff+.5)
                    if fmt==20:
                        stencil=native[count*4+i*4:count*4+(i+1)*4];compare(stencil,bytes([p['raw'][i*4],0,0,0]),f'{ri}/{hi}/collected-S8-{i}');value=(n<<8)|stencil[0]
                    else:value=n
                    struct.pack_into('<I',chosen,i*4,value)
                if 'clear' not in p:compare(chosen,raw,f'{ri}/{hi}/original-public-UN24-S8-X8')
                raw=bytes(chosen)
                for y in range(w[9]):wanted[w[11]+y*w[3]:w[11]+y*w[3]+w[8]*bpp]=raw[y*w[8]*bpp:(y+1)*w[8]*bpp]
                compare(load(read['backing']),wanted,f'{ri}/{hi}/depth-public');counts['publicBytes']+=len(wanted)
        if 'replacementBackingAfter' in run:
            action=next(a for a in run['boundaries'] if a.get('kind')=='source-id-reuse');assert action['fresh']>action['old'];compare(load(run['replacementBackingAfter']),load(action['backing']),f'{ri}/replacement-all-bytes')
        if 'nonoverlap' in run:
            row=run['nonoverlap'];pred=predictions[row['historyIndex']];compare(load(row['native']),struct.pack('<'+'I'*len(pred['color']),*pred['color']),f'{ri}/disjoint-depth-output',lanes_allowed(pred.get('tolerant',[]),len(pred['color'])*4));counts['outputWords']+=len(pred['color'])
        for original in run.get('switchInputs',[]):
            otherfmt=original['format'];assert otherfmt in [16,18,126,20,21];data=load(original['input']);backing=load(original['backing']);b=size(otherfmt);assert len(data)==original['width']*original['height']*b
            wanted=bytearray([0xa7]*len(backing))
            for y in range(original['height']):wanted[original['offset']+y*original['stride']:original['offset']+y*original['stride']+original['width']*b]=data[y*original['width']*b:(y+1)*original['width']*b]
            assert backing==wanted,'all original opposite-format words and padding'
        for entry in [*run.get('switchDepths',[]),*run.get('switchPreserved',[])]:
            otherfmt=entry['format'];raw=load(entry['input']);z=otherSnapshots[entry['historyIndex']][entry['resource'],0]
            compare_depth(otherfmt,dict(width=entry['width'],height=entry['height'],raw=raw,clear=z),load(entry['native']),f'{ri}/opposite-depth-{entry["resource"]}/history{entry["historyIndex"]}')
        if 'failurePhase' in run:
            assert run['failure']['ok'] is False and run['faultEvents']
            phase=run['failurePhase'];assert phase in ['resource','view','attachment','draw','read'];assert run['failure']['error']['code'] in ['backend-error','webgl-error','incomplete-framebuffer']
            if phase=='resource':assert run['beforeFailure']['resources']['budgets']==run['afterFailure']['resources']['budgets']
            assert all(v==0 for v in run['final']['resources']['budgets'].values()) and all(v==0 for v in run['final']['renderer']['budgets'].values());counts['nativeFailures']+=1
        for key,value in audit_lifetimes(run).items():counts[key]+=value
        counts['actualPairResponses']+=sum(q['method']=='pair' for q in run['requests']);counts['actualStageResponses']+=sum(q['method']=='stage' for q in run['requests'])
        counts['consumedSyncs']+=sum('completed' in f for f in run['fenceObjects']);counts['disposalOnlySyncs']+=sum(not f['polls'] for f in run['fenceObjects'])
    result=dict(schema='original-packed-depth-consumer-independent-inverse-v1',status='refuted' if differences else 'passed',oracleImportsProductCode=False,originalShaderWireAndInputAreAuthority=True,counts=counts,differences=differences)
    if control:
        assert differences,'actual native corruption must be rejected';result['physicalControl']=dict(fault=e['fault'],recordedPhysicalEvents=sum(len(r['faultEvents']) for r in e['runs']))
        if e['fault'].startswith('completed-'):
            corrupt=next(r['corruption'] for r in e['runs'] if 'corruption' in r);assert corrupt['after']['sync']!=corrupt['before']['sync'] and corrupt['after']['sequence']>corrupt['before']['sequence'] and corrupt['after']['actual'] in [37146,37148];result['physicalControl']['distinctSecondFence']=True
        else:assert result['physicalControl']['recordedPhysicalEvents']>0
    else:assert not differences,differences[:3]
    (directory/'value-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(dict(status=result['status'],counts=counts,differences=len(differences))))
    return result

def main(root):
    root=Path(root)
    if (root/'report.json').exists():return audit(root,'--control' in sys.argv)
    records={}
    for file in sorted(root.glob('hardware-*/report.json')):records[file.parent.name]=audit(file.parent)
    for file in sorted(root.glob('fault-*/report.json')):records[file.parent.name]=audit(file.parent,True)
    assert records
    (root/'independent-values.json').write_text(json.dumps(dict(status='passed',oracleImportsProductCode=False,records=records),indent=2)+'\n')
if __name__=='__main__':main(sys.argv[1])
