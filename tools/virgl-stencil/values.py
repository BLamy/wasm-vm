#!/usr/bin/env python3
"""Invert original DSA/CLEAR/TGSI and input bytes; never import renderer code."""
import copy,gzip,hashlib,json,math,re,struct,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'virgl-packed-unsigned-consumer'))
from pixels import packets,word
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'virgl-unorm-depth'))
from lifetimes import audit_lifetimes
sha=lambda raw:hashlib.sha256(raw).hexdigest()
OPS=[7680,0,7681,7682,7683,34055,34056,5386]
def cmp(n,a,b):return [False,a<b,a==b,a<=b,a>b,a!=b,a>=b,True][n]
def bpp(fmt):return 8 if fmt==126 else 2 if fmt==16 else 4
def so(fmt):return 0 if fmt==20 else 4 if fmt==126 else None
def zget(fmt,p,i):
    if fmt==16:return struct.unpack_from('<H',p,i*2)[0]/65535
    if fmt in [20,21]:
        n=struct.unpack_from('<I',p,i*4)[0];return (n>>8 if fmt==20 else n&0xffffff)/0xffffff
    return struct.unpack_from('<f',p,i*bpp(fmt))[0]
def zset(fmt,p,i,z):
    if fmt in [20,21]:
        n=math.floor(z*0xffffff+.5);old=struct.unpack_from('<I',p,i*4)[0]
        struct.pack_into('<I',p,i*4,((n<<8)|(old&255)) if fmt==20 else ((old&0xff000000)|n))
    elif fmt==16:struct.pack_into('<H',p,i*2,math.floor(z*65535+.5))
    else:struct.pack_into('<f',p,i*bpp(fmt),z)
def face(w):return dict(enabled=bool(w&1),func=w>>1&7,fail=w>>4&7,zpass=w>>7&7,zfail=w>>10&7,value=w>>13&255,write=w>>21&255)
def dsa(w):return dict(enabled=bool(w[1]&1),write=bool(w[1]&2),func=w[1]>>2&7,faces=[face(w[2]),face(w[3])])
def effective(ctx):
    front,back=ctx['dsa']['faces'];unified=front['enabled'] and not back['enabled'];return [front,front if unified else back],[ctx['refs'][0],ctx['refs'][0] if unified else ctx['refs'][1]],front['enabled'] or back['enabled']
def audit(directory,control=False):
    directory=Path(directory);env=json.loads((directory/'report.json').read_text());e=env.get('partial') or env['browserResult']['result']
    assert env['browserErrors']==dict(console=[],page=[],requests=[])
    assert not e['guestExecution'] and not e['productionNegotiation']
    blobs={row['key']:row for row in e['blobs']};assert len(blobs)==len(e['blobs'])
    for row in blobs.values():
        z=(directory/row['path']).read_bytes();assert sha(z)==row['gzipSha256'];raw=gzip.decompress(z);assert len(raw)==row['bytes'] and sha(raw)==row['sha256']
    def load(ref):
        row=blobs[ref['key']];assert row['sha256']==ref['sha256'] and row['bytes']==ref['bytes'];return gzip.decompress((directory/row['path']).read_bytes())
    counts=dict(runs=0,frames=0,colorWords=0,depthPixels=0,stencilPixels=0,publicBytes=0,draws=0,originalS8Values=0,wideClears=0,failures=0,consumedSyncs=0,disposalOnlySyncs=0,blitWriters=0,fencedCPUReads=0,synchronousCPUReads=0)
    differences=[];operations=set();functions=set();faces=set();paths=set();masks=set();formats=set();allS8=set();terminal=set()
    def same(observed,wanted,where):
        if observed==wanted:return
        if isinstance(observed,(bytes,bytearray)) and isinstance(wanted,(bytes,bytearray)):
            mismatches=[dict(offset=i,observed=a,expected=b) for i,(a,b) in enumerate(zip(observed,wanted)) if a!=b][:12]
            differences.append(dict(where=where,observedBytes=len(observed),expectedBytes=len(wanted),misses=mismatches))
        else:differences.append(dict(where=where,observed=observed,expected=wanted))
    def native_depth(fmt,p,raw,label):
        count=p['width']*p['height'];assert len(raw)==count*20;counts['depthPixels']+=count
        interval=p.get('clear');chosen=[]
        for i in range(count):
            bits=struct.unpack_from('<I',raw,i*16)[0];value=struct.unpack_from('<f',raw,i*16)[0];wanted=word(zget(fmt,p['raw'],i))
            if fmt==20 and interval is not None:
                lo,hi=math.floor(interval*0xffffff)/0xffffff,math.ceil(interval*0xffffff)/0xffffff
                if not max(0,word(lo)-1)<=bits<=min(0x3f800000,word(hi)+1):same(value,[lo,hi],label+'/clear-conversion/'+str(i))
                chosen.append(bits)
            elif fmt in [20,21]:
                if abs(bits-wanted)>1 or bits>0x3f800000:same(bits,wanted,label+'/normalized-depth/'+str(i))
            else:same(bits,wanted,label+'/floating-depth/'+str(i))
            same(raw[i*16+4:i*16+16],struct.pack('<III',0,0,1),label+'/constant-lanes/'+str(i))
        if chosen:assert len(set(chosen))==1,'one native full-plane clear choice'
        offset=so(fmt);wanted=bytes(v for i in range(count) for v in ([p['raw'][i*bpp(fmt)+offset],0,0,0] if offset is not None else [0,0,0,0]));same(raw[count*16:],wanted,label+'/exact-S8')
        if offset is not None:counts['stencilPixels']+=count
    def stencil(ctx,state,label):
        fs,refs,enabled=effective(ctx);same(state['enabled'],enabled,label+'/test');same(state['frontFace'],2304 if ctx['raster']>>15&1 else 2305,label+'/front-face')
        for side,(f,ref,observed) in enumerate(zip(fs,refs,state['faces'])):
            wanted={'STENCIL_FUNC':512+f['func'],'STENCIL_REF':ref,'STENCIL_VALUE_MASK':f['value'],'STENCIL_WRITEMASK':f['write'],'STENCIL_FAIL':OPS[f['fail']],'STENCIL_PASS_DEPTH_FAIL':OPS[f['zfail']],'STENCIL_PASS_DEPTH_PASS':OPS[f['zpass']]}
            same(observed,wanted,label+'/face'+str(side))
    for ri,ref in enumerate(e['runs']):
        if 'path' in ref:
            body=(directory/ref['path']).read_bytes();assert len(body)==ref['bytes'] and sha(body)==ref['sha256'];run=json.loads(body)
        else:run=ref
        counts['runs']+=1;fmt=run['format'];formats.add(fmt);prefix=f'{ri}/{run["name"]}'
        original={p['level']:dict(p,raw=bytearray(load(p['input']))) for p in run['planes']};planes=copy.deepcopy(original);backing=load(run['sourceBacking']);wanted=bytearray([0xb3]*len(backing))
        for p in planes.values():
            assert len(p['raw'])==p['width']*p['height']*bpp(fmt)
            for y in range(p['height']):wanted[p['offset']+y*p['stride']:p['offset']+y*p['stride']+p['width']*bpp(fmt)]=p['raw'][y*p['width']*bpp(fmt):(y+1)*p['width']*bpp(fmt)]
            if so(fmt) is not None:allS8.update(p['raw'][so(fmt)::bpp(fmt)])
        assert wanted==backing,'whole original source/padding custody'
        pos=struct.unpack('<24f',load(run['positions']));assert all(pos[i*4+3]==1 for i in range(6));assert len({pos[i*4+2] for i in range(6)})==1;incoming=pos[2]*.5+.5;assert incoming in [0,1]
        points=[(pos[i*4],pos[i*4+1]) for i in range(6)];area=lambda t:(t[1][0]-t[0][0])*(t[2][1]-t[0][1])-(t[1][1]-t[0][1])*(t[2][0]-t[0][0]);assert area(points[:3])*area(points[3:])>0
        assert sorted(points[:3]) in [sorted([(-1,-1),(1,-1),(-1,1)])] and sorted(points[3:])==sorted([(-1,1),(1,-1),(1,1)])
        contexts={};snapshots={};colors={};draws={}
        for row in run['draws']:draws.setdefault(row['label'],[]).append(row)
        for hi,history in enumerate(run['history']):
            ctx=contexts.setdefault(history['ctx'],dict(dsas={},dsa=dsa([0,0,0,0]),refs=[0,0],rasters={},raster=0,shaders={},stage={},surfaces={},color=None,depth=None,scissor=[0,0,0,0]))
            for ci,(opcode,kind,w,raw) in enumerate(packets(history['hex'])):
                if ci>=history['result'].get('appliedCommands',history.get('appliedBeforeDispose',0)):continue
                if opcode==1 and kind==3:ctx['dsas'][w[0]]=dsa(w)
                elif opcode==2 and kind==3:ctx['dsa']=ctx['dsas'][w[0]]
                elif opcode==13:ctx['refs']=[w[0]&255,w[0]>>8&255]
                elif opcode==1 and kind==2:ctx['rasters'][w[0]]=w[1]
                elif opcode==2 and kind==2:ctx['raster']=ctx['rasters'][w[0]]
                elif opcode==15:ctx['scissor']=[w[1]&65535,w[1]>>16,w[2]&65535,w[2]>>16]
                elif opcode==1 and kind==4:ctx['shaders'][w[0]]=raw[24:24+w[2]-1].decode('ascii')
                elif opcode==31:ctx['stage'][w[1]]=ctx['shaders'][w[0]]
                elif opcode==1 and kind==8:ctx['surfaces'][w[0]]=dict(resource=w[1],format=w[2],level=w[3])
                elif opcode==5:ctx['depth']=ctx['surfaces'].get(w[1]);ctx['color']=ctx['surfaces'].get(w[2]) if len(w)>2 else None
                elif opcode==7:
                    if w[0]>0 and w[7]>255:counts['wideClears']+=1
                    if w[0]&4 and ctx['color']:colors[ctx['color']['level']]=w[1:5]*(run['targetWidth']>>ctx['color']['level'])*(run['targetHeight']>>ctx['color']['level'])
                    if w[0]&3 and ctx['depth']:
                        target=ctx['depth'];assert target['resource']==6;p=planes[target['level']];z=struct.unpack_from('<d',raw,24)[0]
                        for i in range(p['width']*p['height']):
                            if w[0]&1:zset(fmt,p['raw'],i,z)
                            if w[0]&2 and so(fmt) is not None:p['raw'][i*bpp(fmt)+so(fmt)]=w[7]&255
                        if w[0]&1:p['clear']=z
                    if w[0]&2:
                        native=[s for s in run['stencilStates'] if s['label']==history['label'] and s['name']=='clear' and s['delivered'][0]&1024]
                        assert native,'actual native stencil clear executed'
                        for s in native:
                            same(s['before']['state']['faces'][0]['STENCIL_WRITEMASK'],255,prefix+'/full-clear-mask')
                            after=[n for n in run['stencilStates'] if n['label']==s['label'] and n['index']>s['index'] and n['name']=='stencilMaskSeparate'][:2]
                            assert len(after)==2;expectedMasks=[f['write'] for f in ctx['dsa']['faces']]
                            same([n['delivered'][1] for n in after],expectedMasks,prefix+'/literal-clear-mask-restore')
                elif opcode==8:
                    draw=draws[history['label']].pop(0);assert draw['args']==[4,0,6];counts['draws']+=1
                    states=[s for s in run['stencilStates'] if s['name']==draw['name'] and s['label']==draw['label'] and s['after']['eventSequence']==draw['sequence']];assert len(states)==1;stencil(ctx,states[0]['before']['state'],prefix+'/draw'+str(hi))
                    fs,refs,enabled=effective(ctx);front=(area(points[:3])>0)!=bool(ctx['raster']>>15&1);selected=fs[0 if front else 1];reference=refs[0 if front else 1];faces.add('front' if front else 'back');functions.add(selected['func']);masks.add(selected['write'])
                    nd=draw['native'];same(nd['depthTest'],ctx['dsa']['enabled'],prefix+'/depth-test');same(nd['depthMask'],ctx['dsa']['write'],prefix+'/depth-mask');same(nd['depthFunction'],512+ctx['dsa']['func'],prefix+'/depth-function');same(nd['scissor'],bool(ctx['raster']>>14&1),prefix+'/scissor')
                    target=ctx['depth'];present=target is not None and so(target['format']) is not None;p=planes[target['level']] if target else None;level=ctx['color']['level'];width=max(1,run['targetWidth']>>level);height=max(1,run['targetHeight']>>level)
                    same(nd['viewport'],[0,0,width,height],prefix+'/viewport');assert ctx['color']['resource']==1
                    m=re.search(r'IMM\[0\] UINT32 \{([^}]+)\}',ctx['stage'][1]);assert m and 'MOV OUT[0], IMM[0]' in ctx['stage'][1];words=list(map(int,m[1].split(',')));assert len(words)==4
                    assert ctx['stage'][0]=='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n'
                    pairs=[q for q in run['requests'] if q['method']=='pair' and q['request']['vertexText']==ctx['stage'][0] and q['request']['fragmentText']==ctx['stage'][1] and q['result']['ok']];assert pairs
                    for shader in draw['shaders']:
                        assert shader['glsl']==pairs[-1]['result']['vertex' if shader['type']==35633 else 'fragment']['glsl'],'actual queried native shader is complete compiler response'
                        assert any(ev['name']=='shaderSource' and ev['sequence']<draw['sequence'] and ev['args'][1]==shader['glsl'] for ev in run['events']),'actual preceding delivered shader source'
                    for i in range(width*height):
                        x,y=i%width,i//width;s=ctx['scissor'];inside=not (ctx['raster']>>14&1) or s[0]<=x<s[2] and s[1]<=y<s[3]
                        if not inside:continue
                        old=p['raw'][i*bpp(fmt)+so(fmt)] if present else 0;test=not(enabled and present) or cmp(selected['func'],reference&selected['value'],old&selected['value']);z=p.get('clear',zget(fmt,p['raw'],i)) if p else 0;depth=not ctx['dsa']['enabled'] or cmp(ctx['dsa']['func'],incoming,z)
                        path='fail' if not test else 'depth-pass' if depth else 'depth-fail';paths.add(path)
                        if enabled and present:
                            op=selected['fail'] if not test else selected['zpass'] if depth else selected['zfail'];operations.add(op);n=[old,0,reference,min(255,old+1),max(0,old-1),(old+1)&255,(old-1)&255,old^255][op];p['raw'][i*bpp(fmt)+so(fmt)]=(old&(~selected['write']&255))|(n&selected['write'])
                        if test and depth:
                            colors[level][i*4:i*4+4]=words
                            if p and ctx['dsa']['enabled'] and ctx['dsa']['write']:zset(fmt,p['raw'],i,incoming);p.pop('clear',None)
            snapshots[hi]=dict(planes=copy.deepcopy(planes),colors=copy.deepcopy(colors),ctx=copy.deepcopy(ctx))
        for frame in run['frames']:
            pred=snapshots[frame['historyIndex']];level=run['outputLevel'];values=pred['colors'][level];expected=struct.pack('<'+'I'*len(values),*values);same(load(frame['native']),expected,prefix+'/'+frame['label']+'/native-color');counts['frames']+=1;counts['colorWords']+=len(values)
            if 'publicHistoryIndex' not in frame:
                assert control and differences,'only a failed real control stops before public color'
                continue
            read=next(packets(run['history'][frame['publicHistoryIndex']]['hex']));op,kind,w,raw=read;assert op==43 and w[0]==1 and w[12]==2 and w[1]==level
            public=bytearray([0x2e]*run['targetBackingBytes']);width=max(1,run['targetWidth']>>level)
            for y in range(w[9]):public[w[11]+y*w[3]:w[11]+y*w[3]+w[8]*16]=expected[y*width*16:y*width*16+w[8]*16]
            same(load(frame['backing']),public,prefix+'/'+frame['label']+'/all-public-color');counts['publicBytes']+=len(public)
            for p in frame['depths']:native_depth(fmt,pred['planes'][p['level']],load(p['native']),prefix+'/'+frame['label']+'/depth'+str(p['level']))
        if run.get('publicBackingBefore'):
            same(load(run['publicBackingBefore']),backing,prefix+'/GPU-only-original-backing');wanted=bytearray(backing)
            for read in run['publicDepth']:
                hi=read['historyIndex'];op,kind,w,raw=next(packets(run['history'][hi]['hex']));assert op==43 and w[0]==6 and w[12]==2;p=snapshots[hi]['planes'][w[1]];tight=bytearray(p['raw'])
                if fmt==20 and 'clear' in p:
                    chosen=load(read['nativeChoice']);native_depth(fmt,p,chosen,prefix+'/public-choice');
                    for i in range(p['width']*p['height']):zset(fmt,tight,i,struct.unpack_from('<f',chosen,i*16)[0])
                if fmt==126:
                    for i in range(5,len(tight),8):tight[i:i+3]=b'\0'*3
                if fmt==21:
                    for i in range(3,len(tight),4):tight[i]=0
                for y in range(w[9]):wanted[w[11]+y*w[3]:w[11]+y*w[3]+w[8]*bpp(fmt)]=tight[y*w[8]*bpp(fmt):(y+1)*w[8]*bpp(fmt)]
                same(load(read['backing']),wanted,prefix+'/all-public-depth'+str(w[1]));counts['publicBytes']+=len(wanted)
        if run.get('replacement'):
            rr=run['replacement'];assert rr['generation']>run['sourceGeneration'] and rr['metadata']['format']!=fmt;same(load(rr['after']),load(rr['backing']),prefix+'/every-replacement-byte')
            terminal.add(run['terminalMode']);assert run['pending']['resources']['budgets']['imageHolds']>=2
            assert run['queued']['result'].get('gpuComplete') is True if run['terminalMode']=='complete' else run['queued']['result']['error']['code']==('cancelled' if run['terminalMode']=='cancel' else 'disposed')
            first,last=run['privateRange']['firstLevel'],run['privateRange']['lastLevel'];assert (first,last)==(1,2)
            clearHistory=next(hi for hi,h in enumerate(run['history']) if h['label']=='stencil-GPU-only-private-mip-clear')
            for p in run['privateNative']['depths']:native_depth(fmt,snapshots[clearHistory]['planes'][p['level']],load(p['native']),prefix+'/private-native'+str(p['level']))
            oldHistory=next(hi for hi,h in enumerate(run['history']) if h['label']=='stencil-retained-old-generation-clear')
            queuedHistory=next(hi for hi,h in enumerate(run['history']) if h['label'].startswith('stencil-queued-'))
            for p in run['queuedNative']['depths']:native_depth(fmt,snapshots[queuedHistory]['planes'][p['level']],load(p['native']),prefix+'/queued-original-S8'+str(p['level']))
            for p in run['oldGeneration']['depths']:native_depth(fmt,snapshots[oldHistory]['planes'][p['level']],load(p['native']),prefix+'/old-generation'+str(p['level']))
            stencil(snapshots[clearHistory]['ctx'],run['context1'],prefix+'/context1-restore')
            context2=next(s for s in snapshots.values() if s['ctx']['refs']==[93,93]);stencil(context2['ctx'],run['context2'],prefix+'/context2')
        if run.get('failurePhase'):
            counts['failures']+=1;phase=run['failurePhase'];failure=run['failure']['result'];assert not failure['ok']
            if phase in ['reference','value-mask','write-mask']:
                assert failure['error']['code']=='unsupported-stencil';assert not any(e['label']=='stencil-original-asymmetric-refusal' and (e['name'] in ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced','blitFramebuffer']) for e in run['events'])
            elif phase=='historical':assert failure['error']['code']=='unsupported-feature'
            else:assert run['faultEvents'] or run['stencilControls']
        lifetime=audit_lifetimes(run)
        for key in ['fencedCPUReads','synchronousCPUReads']:counts[key]+=lifetime[key]
        consumed=sum(any(p['delivered'] in [37146,37148] and p['actual'] in [37146,37148] for p in s['polls']) for s in run['fenceObjects']);counts['consumedSyncs']+=consumed;counts['disposalOnlySyncs']+=len(run['fenceObjects'])-consumed
        syncs={s['id']:s for s in run['fenceObjects']};lastWriter=0
        for event in run['events']:
            if event['name'] in ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced','blitFramebuffer','clear','clearBufferiv','clearBufferuiv','clearBufferfv','clearBufferfi','texSubImage2D','bufferSubData','copyBufferSubData']:
                lastWriter=event['sequence'];counts['blitWriters']+=int(event['name']=='blitFramebuffer')
            if event.get('cpu') and not event.get('synchronousReadback'):
                completion=event['completion'];fence=syncs[completion['sync']];assert fence['createdSequence']>lastWriter and completion['sequence']<event['sequence'];assert completion['delivered'] in [37146,37148] and completion['actual'] in [37146,37148]
        if run.get('corruption'):
            before,after=run['corruption']['before'],run['corruption']['after'];assert after['sync']!=before['sync'] and after['sequence']>before['sequence'] and after['delivered'] in [37146,37148] and after['actual'] in [37146,37148]
            writer=[v for v in run['events'] if before['sequence']<v['sequence']<after['sequence'] and (v['name']=='clear' and v['args'][0]&1024 or v['name']=='clearBufferfv')];assert writer and syncs[after['sync']]['createdSequence']>writer[-1]['sequence']
    counts['originalS8Values']=len(allS8)
    result=dict(schema='original-native-stencil-inverse-v1',status='refuted' if differences else 'passed',oracleImportsProductCode=False,sourceFieldsOnly=True,counts=counts,matrix=dict(operations=sorted(operations),functions=sorted(functions),faces=sorted(faces),paths=sorted(paths),masks=sorted(masks),formats=sorted(formats),terminalModes=sorted(terminal)),differences=differences[:100])
    (directory/'independent-values.json').write_text(json.dumps(result,indent=2)+'\n')
    if control:assert differences,'actual native control escaped original stencil inverse'
    else:assert not differences,str(differences[:3])
    return result
if __name__=='__main__':
    for directory in sys.argv[1:]:
        if directory=='--control':continue
        result=audit(directory,'--control' in sys.argv);print(json.dumps(dict(path=directory,status=result['status'],counts=result['counts'])))
