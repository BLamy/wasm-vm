#!/usr/bin/env python3
"""Independently invert the promoted original dual-stage/range/depth attack.

No product module, emitted GLSL or controller expected image supplies an oracle.
The original wire shaders, resources, inputs and validated native fields do.
"""
import copy,gzip,hashlib,json,math,re,struct,sys
from pathlib import Path
sha=lambda b:hashlib.sha256(b).hexdigest()
word=lambda f:struct.unpack('<I',struct.pack('<f',f))[0]
def need(value,message):
    if not value:raise AssertionError(message)
def packets(hexadecimal):
    body=bytes.fromhex(hexadecimal);at=0
    while at<len(body):
        h=struct.unpack_from('<I',body,at)[0];length=h>>16;raw=body[at:at+4+length*4]
        need(len(raw)==4+length*4,'whole original packet');yield h&255,h>>8&255,struct.unpack_from('<'+'I'*length,raw,4),raw;at+=len(raw)
    need(at==len(body),'whole original submission')
def audit(directory):
    directory=Path(directory);envelope=json.loads((directory/'report.json').read_text());need(envelope['status']=='passed','hardware attack passed');need(envelope['browserErrors']==dict(console=[],page=[],requests=[]),'clean browser capture');e=envelope['browserResult']['result'];blobs={b['key']:b for b in e['blobs']};need(len(blobs)==len(e['blobs']),'unique blob IDs')
    def load(ref):
        row=blobs[ref['key']];need(row['sha256']==ref['sha256'],'blob reference identity');compressed=(directory/row['path']).read_bytes();need(sha(compressed)==row['gzipSha256'],'complete compressed blob');raw=gzip.decompress(compressed);need(len(raw)==row['bytes'] and sha(raw)==row['sha256'],'complete native/public/input blob');return raw
    counts=dict(runs=0,draws=0,refusals=0,nativeDepthPixels=0,outputWords=0,publicBytes=0,ownedSyncs=0,consumedSyncs=0,disposalOnlySyncs=0,fencedCPUReads=0,maximumUploadedUlp=0,clearPixels=0)
    citations=[]
    def normalized(bits,expected,where):
        need(0<=bits<=0x3f800000 and abs(bits-expected)<=1,where+' FLOAT normalization');counts['maximumUploadedUlp']=max(counts['maximumUploadedUlp'],abs(bits-expected))
    def interval(bits,z,where):
        lo=math.floor(z*0xffffff)/0xffffff;hi=math.ceil(z*0xffffff)/0xffffff;need(max(0,word(lo)-1)<=bits<=min(0x3f800000,word(hi)+1),where+' original clear conversion interval')
    def depth(fmt,p,native,where):
        n=p['width']*p['height'];need(len(native)==n*20,where+' native field length');counts['nativeDepthPixels']+=n
        if 'clear' in p:need(len({struct.unpack_from('<I',native,i*16)[0] for i in range(n)})==1,where+' uniform original clear choice')
        for i in range(n):
            bits,b,c,d=struct.unpack_from('<IIII',native,i*16);need((b,c,d)==(0,0,1),where+' constant lanes')
            if 'clear' in p:interval(bits,p['clear'],where);counts['clearPixels']+=1
            else:
                original=struct.unpack_from('<I',p['input'],i*4)[0];fixed=original>>8 if fmt==20 else original&0xffffff;normalized(bits,word(fixed/0xffffff),where)
            need(native[n*16+i*4:n*16+(i+1)*4]==bytes([p['input'][i*4] if fmt==20 else 0,0,0,0]),where+' exact original S8')
    for ri,ref in enumerate(e['runs']):
        raw=(directory/ref['path']).read_bytes();need(len(raw)==ref['bytes'] and sha(raw)==ref['sha256'],'complete run');r=json.loads(raw);fmt=r['format'];need(fmt in [20,21],'original format');counts['runs']+=1
        src=r['source'];need(src['id']==6 and src['format']==fmt and src['target']==2 and src['lastLevel']==3 and src['bind']==9,'original resource descriptor');planes={p['level']:dict(p,input=load(p['input'])) for p in r['planes']};sourceBacking=load(r['sourceBacking']);originalBacking=bytearray([0xa7]*len(sourceBacking))
        for p in planes.values():
            need((p['width'],p['height'])==(max(1,src['width']>>p['level']),max(1,src['height']>>p['level'])),'original mip dimensions')
            for y in range(p['height']):originalBacking[p['offset']+y*p['stride']:p['offset']+y*p['stride']+p['width']*4]=p['input'][y*p['width']*4:(y+1)*p['width']*4]
        need(bytes(originalBacking)==sourceBacking,'every original input and padding byte');need(struct.unpack('<24f',load(r['positions']))==tuple(v for x,y in [(-1,-1),(1,-1),(-1,1),(-1,1),(1,-1),(1,1)] for v in [x,y,0,1]),'original fullscreen geometry')
        originalTexture=next(a['texture'] for a in r['allocations'] if a['metadata']['id']==6);targetTexture=next(a['texture'] for a in r['allocations'] if a['metadata']['id']==1);shaders={};stages={};views={};bound={};surfaces={};depthSurface=None;dsa=None;sampleStates={};stateObjects={};drawByLabel={d['label']:d for d in r['draws']};predictions={};snapshots={}
        for hi,h in enumerate(r['history']):
            applied=h['result'].get('appliedCommands',h.get('appliedBeforeDispose',0))
            for ci,(op,kind,w,body) in enumerate(packets(h['hex'])):
                if ci>=applied:continue
                if op==1 and kind==4:shaders[w[0]]=body[24:24+w[2]-1].decode('ascii')
                elif op==31:stages[w[1]]=shaders[w[0]]
                elif op==1 and kind==6:
                    need(w[1]==6 and w[2]==(2<<24|fmt),'original view format and resource');views[w[0]]=dict(first=w[4]&255,last=w[4]>>8&255,swizzle=[w[5]>>(i*3)&7 for i in range(4)])
                elif op==10:bound[w[0],w[1]]=views[w[2]]
                elif op==1 and kind==7:stateObjects[w[0]]=dict(min=w[1]>>9&1,mag=w[1]>>13&1,mip=w[1]>>11&3)
                elif op==18:sampleStates[w[0],w[1]]=stateObjects[w[2]]
                elif op==1 and kind==8:surfaces[w[0]]=dict(resource=w[1],format=w[2],level=w[3])
                elif op==5:depthSurface=surfaces.get(w[1])
                elif op==1 and kind==3:dsa=dict(enabled=bool(w[1]&1),write=bool(w[1]&2),func=w[1]>>2&7)
                elif op==7 and w[0]&1:
                    z=struct.unpack_from('<d',body,24)[0];need(depthSurface['resource']==6 and depthSurface['level']==2 and z==.3125,'original upper-only GPU clear');planes[2]['clear']=z
                elif op==8:
                    native=drawByLabel[h['label']];need(native['args']==[4,0,6] and native['native']['viewport']==[0,0,r['width'],r['height']],'original native draw geometry');need(native['native']['colors'][0]['attachment']==targetTexture,'actual native color attachment');need(native['native']['depth']==[dict(attachment=36096,texture=originalTexture,level=1),dict(attachment=36128,texture=originalTexture if fmt==20 else None,level=1 if fmt==20 else None)],'actual depth/stencil middle attachment');need(not native['native']['stencilTest'] and native['native']['depthTest']==dsa['enabled'] and native['native']['depthMask']==dsa['write'] and native['native']['depthFunction']==512+dsa['func'] and dsa==dict(enabled=True,write=False,func=7),'original depth state')
                    need(len(native['samplers'])==2,'both compiled native sampler stages survived');selected={}
                    for stage,slot in [(0,15),(1,0)]:
                        text=stages[stage];needle=re.search(r'TXL TEMP\[0\], IMM\[0\], SAMP\[(\d+)\], 2D',text);need(needle and int(needle[1])==slot and 'DCL SVIEW['+str(slot)+'], 2D, FLOAT' in text,'original TGSI sampler operation');coords=list(map(float,re.search(r'IMM\[0\] FLT32 \{([^}]+)\}',text)[1].split(',')));v=bound[stage,slot];need(v['swizzle']==[0,1,2,3] and sampleStates[stage,slot]==dict(min=0,mag=0,mip=0),'original nearest and swizzle');need(not v['first']<=1<=v['last'],'all sampled original ranges disjoint from attachment');level=v['first']+int(coords[3]);p=planes[level];x,y=math.floor(coords[0]*p['width']),math.floor(coords[1]*p['height']);need(0<=x<p['width'] and 0<=y<p['height'],'original TEX coordinate');selected[stage]=dict(level=level,pixel=y*p['width']+x,view=copy.deepcopy(v))
                        q=next(q for q in native['samplers'] if q['unit']==(16 if stage==0 else 0)+slot);need(q['type']==35678 and q['base']==0 and q['last']==v['last']-v['first'] and q['parameters']['TEXTURE_MIN_FILTER']==9984 and q['parameters']['TEXTURE_MAG_FILTER']==9728,'native original range and nearest sampler');need(q['metadata']['format']==fmt and q['texture']!=originalTexture,'private native depth range');selected[stage]['native']=q
                    need(selected[0]['native']['texture']!=selected[1]['native']['texture'],'independent native ranges');need('MOV OUT[0], IN[0]' in stages[0] and 'MOV OUT[1], TEMP[0]' in stages[0] and 'DCL IN[0], GENERIC[0], CONSTANT' in stages[1],'original vertex and interpolation authority')
                    for instruction in ['MOV TEMP[1], IN[0]','MOV TEMP[1].y, TEMP[0].xxxx','MOV TEMP[1].zw, IMM[1]','MOV OUT[0], TEMP[1]']:need(instruction in stages[1],'original fragment lane construction')
                    need(list(map(float,re.search(r'IMM\[1\] FLT32 \{([^}]+)\}',stages[1])[1].split(',')))==[0,0,0,1],'original literal z/w lanes');predictions[hi]=dict(selected=selected,planes=copy.deepcopy(planes),draw=native);counts['draws']+=1
            snapshots[hi]=copy.deepcopy(planes)
        for fi,f in enumerate(r['frames']):
            pred=predictions[f['historyIndex']];need(f['completion']['sequence']>pred['draw']['sequence'] and f['completion']['actual'] in [37146,37148],'original native draw consumed fence');nativePlanes={p['level']:load(p['native']) for p in f['depths']}
            for p in f['depths']:depth(fmt,pred['planes'][p['level']],nativePlanes[p['level']],f'{ri}/{fi}/native-depth{p["level"]}')
            for q in f['samplers']:
                selected=next(s for s in pred['selected'].values() if s['native']['unit']==q['unit']);need(q['texture']==selected['native']['texture'],'captured native sampler identity')
                for p in q['planes']:
                    original=selected['view']['first']+p['local'];need((p['width'],p['height'])==(pred['planes'][original]['width'],pred['planes'][original]['height']),'native private field geometry');depth(fmt,pred['planes'][original],load(p['native']),f'{ri}/{fi}/native-private{original}')
            expected=[]
            for stage in [0,1]:
                s=pred['selected'][stage];p=pred['planes'][s['level']];bits=struct.unpack_from('<I',nativePlanes[s['level']],s['pixel']*16)[0]
                if 'clear' not in p:
                    fixed=struct.unpack_from('<I',p['input'],s['pixel']*4)[0];expected.append(word((fixed>>8 if fmt==20 else fixed&0xffffff)/0xffffff))
                else:expected.append(bits)
            expected.extend([0,word(1)]);image=load(f['native']);need(len(image)==r['width']*r['height']*16,'complete native image')
            for i,bits in enumerate(struct.unpack('<'+'I'*(len(image)//4),image)):
                if i%4<2:need(abs(bits-expected[i%4])<=1,'native sampled original depth lane')
                else:need(bits==expected[i%4],'native exact literal lane')
            counts['outputWords']+=len(image)//4;wanted=bytearray([0x2e]*20000);op,kind,w,body=next(packets(r['history'][f['publicHistory']]['hex']));need(op==43 and w[0]==1 and w[12]==2,'original public color read')
            for y in range(w[9]):wanted[w[11]+y*w[3]:w[11]+y*w[3]+w[8]*16]=image[y*w[8]*16:(y+1)*w[8]*16]
            need(load(f['backing'])==wanted,'all native/public output words and padding exactly identical');counts['publicBytes']+=len(wanted)
            citations.append(dict(run=ref['path'],runSha256=ref['sha256'],frame=fi,label=f['label'],historyIndex=f['historyIndex'],nativeSha256=f['native']['sha256'],completion=f['completion']))
        refusal=r['history'][r['refusal']['historyIndex']];need(not refusal['result']['ok'] and refusal['result']['error']['code']=='framebuffer-feedback' and r['refusal']['before']==r['refusal']['after'],'overlap rejected before native draw/private copy');counts['refusals']+=1
        wanted=bytearray(load(r['depthPublic']['backingBefore']))
        for read in r['depthPublic']['reads']:
            hi=read['historyIndex'];h=r['history'][hi];op,kind,w,body=next(packets(h['hex']));need(op==43 and w[0]==6 and w[1]==read['level'] and w[12]==2,'original public depth packet');p=snapshots[hi][w[1]];n=p['width']*p['height'];collection=next(v for v in r['readbacks'] if v['label']==h['label'] and v['name']=='getBufferSubData' and v['cpu']);raw=load(collection['bytes']);need(len(raw)==n*(8 if fmt==20 else 4),'actual native public collection fields');out=bytearray()
            for i in range(n):
                bits=struct.unpack_from('<I',raw,i*4)[0];z=struct.unpack_from('<f',raw,i*4)[0];original=struct.unpack_from('<I',p['input'],i*4)[0]
                if 'clear' in p:interval(bits,p['clear'],'public clear choice')
                else:normalized(bits,word((original>>8 if fmt==20 else original&0xffffff)/0xffffff),'public original normalized choice')
                fixed=math.floor(z*0xffffff+.5);stencil=original&255 if fmt==20 else 0
                if fmt==20:need(raw[n*4+i*4:n*4+(i+1)*4]==bytes([stencil,0,0,0]),'native collected exact original S8')
                value=(fixed<<8|stencil) if fmt==20 else fixed
                if 'clear' not in p:need(value==(original if fmt==20 else original&0xffffff),'exact original public fixed fields')
                out+=struct.pack('<I',value)
            for y in range(w[9]):wanted[w[11]+y*w[3]:w[11]+y*w[3]+w[8]*4]=out[y*w[8]*4:(y+1)*w[8]*4]
            need(load(read['backing'])==wanted,'every public depth/S8/X8 and untouched padding byte');counts['publicBytes']+=len(wanted)
        syncs={s['id']:s for s in r['fenceObjects']};counts['ownedSyncs']+=len(syncs);need(len(syncs)==len(r['fenceObjects']),'unique owned native fences');writer=0
        for s in syncs.values():need(s['identity']=='WebGLSync' and s['deleted']==1,'native sync retires once');counts['consumedSyncs']+=int('completed' in s);counts['disposalOnlySyncs']+=int(not s['polls'])
        for event in r['events']:
            if event['name'] in ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced','clearBufferiv','clearBufferuiv','clearBufferfv','clearBufferfi','clear','texSubImage2D','bufferSubData','copyBufferSubData','blitFramebuffer']:writer=event['sequence']
            if event['name'] in ['readPixels','getBufferSubData'] and event['cpu']:
                need(not event['synchronousReadback'],'no synchronous collection disguised as a fence');completion=event['completion'];s=syncs[completion['sync']];need(event['sequence']>completion['sequence']>writer and s['createdSequence']>writer,'actual writer then newly consumed fence then CPU collection');need(completion['actual'] in [37146,37148] and completion['delivered'] in [37146,37148] and any(p['sequence']==completion['sequence'] and p['actual']==completion['actual'] and p['delivered']==completion['delivered'] for p in s['polls']),'actual consumed native poll');counts['fencedCPUReads']+=1
        need(all(o['deleted']==1 for o in r['nativeObjects']),'native objects retire once');need(all(v==0 for n in ['resources','renderer'] for v in r['final'][n]['budgets'].values()),'terminal accounting drained')
    need(counts['runs']==2 and counts['draws']==6 and counts['refusals']==2,'complete both original packed formats')
    result=dict(schema='packed-depth-fresh-critic-original-dual-stage-inverse-v1',status='passed',sourceHead=envelope['gitHead'],oracleImportsProductCode=False,counts=counts,citations=citations);(directory/'critic-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(dict(status='passed',counts=counts)))
    return result
if __name__=='__main__':
    if '--control' not in sys.argv:audit(sys.argv[1])
    else:
        directory=Path(sys.argv[1]);envelope=json.loads((directory/'report.json').read_text());e=envelope['browserResult']['result'];need(e['fault']=='completed-stencil','actual native completed-S8 control selected');ref=e['runs'][0];body=(directory/ref['path']).read_bytes();need(len(body)==ref['bytes'] and sha(body)==ref['sha256'],'complete control run');r=json.loads(body);control=r['corruption'];before,after=control['before'],control['after'];need(before['sync']!=after['sync'] and after['sequence']>before['sequence'] and after['actual'] in [37146,37148] and after['delivered'] in [37146,37148],'distinct consumed second physical native fence');second=next(s for s in r['fenceObjects'] if s['id']==after['sync']);need(any(p['sequence']==after['sequence'] and p['actual']==after['actual'] and p['delivered']==after['delivered'] for p in second['polls']),'actual second poll consumed');writes=[v for v in r['events'] if v['name']=='clear' and v['args']==[1024] and before['sequence']<v['sequence']<second['createdSequence']];need(len(writes)==1,'actual native stencil writer between first and second fence')
        try:audit(directory)
        except AssertionError as error:
            need('exact original S8' in str(error),'unchanged original field inverse specifically detects native S8 corruption');result=dict(schema='packed-depth-fresh-critic-native-sabotage-v1',status='refuted',unchangedInverse=True,observedFailure=str(error),run=ref['path'],runSha256=ref['sha256'],physicalControl=dict(before=before,after=after,writer=writes[0],distinctSecondConsumedFence=True));(directory/'critic-control-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
        else:raise AssertionError('completed actual native S8 corruption escaped the unchanged inverse')
