#!/usr/bin/env python3
"""Independent original UP8/UN24 and UN24/X8 native/public/backing inverse."""
import gzip,hashlib,json,math,re,struct,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
FORMATS={row['originalFormat']:row for row in json.loads((ROOT/'tools/virgl-packed-depth/formats.json').read_text())}
EDGES=[0x5555a7,0,1,2,127,128,255,256,257,65535,65536,65537,0x3fffff,0x400000,0x400001,0x7ffffe,0x7fffff,0x800000,0x800001,0xfffffd,0xfffffe,0xffffff]
sha=lambda raw:hashlib.sha256(raw).hexdigest()
def need(value,message):
    if not value:raise ValueError(message)
def z(fmt,bits):return bits>>8 if fmt==20 else bits&0xffffff
def f32(value):return struct.unpack('<f',struct.pack('<f',value))[0]
def word(value):return struct.unpack('<I',struct.pack('<f',value))[0]
def canonical(fmt,raw):
    if fmt==20:return raw
    return b''.join(struct.pack('<I',bits&0xffffff) for bits, in struct.iter_unpack('<I',raw))
def native_upload(fmt,raw):
    if fmt==20:return raw
    return b''.join(struct.pack('<I',min(0xffffffff,math.floor(f32((bits&0xffffff)/0xffffff)*2**32+.5))) for bits, in struct.iter_unpack('<I',raw))
def prepare(fmt,w,h,last,seed,exceptional=False,domain_start=None):
    original_seed=seed;planes=[];offset=5
    def random():
        nonlocal seed
        seed^=seed<<13&0xffffffff;seed^=seed>>17;seed^=seed<<5&0xffffffff;seed&=0xffffffff;return seed
    for level in range(last+1):
        raw=bytearray()
        for i in range(w*h):
            bits=random();n=domain_start+i if domain_start is not None else (i*541+level*739+original_seed)&0xffffff if exceptional else EDGES[(i+level)%len(EDGES)] if i<len(EDGES) else bits&0xffffff
            original=(n<<8)|((i*73+level*29+original_seed)&255) if fmt==20 else n|(((bits>>24)^0xa7)<<24)
            raw.extend(struct.pack('<I',original))
        stride=w*4+7;planes.append(dict(level=level,width=w,height=h,stride=stride,offset=offset,input=bytes(raw)))
        offset+=(h-1)*stride+w*4+11;w=max(1,w//2);h=max(1,h//2)
    backing=bytearray([0xa7]*(offset+9))
    for p in planes:
        for y in range(p['height']):
            at=p['offset']+y*p['stride'];n=p['width']*4;backing[at:at+n]=p['input'][y*n:(y+1)*n]
    return planes,bytes(backing)
def assert_public(fmt,expected,actual,label):
    wanted=canonical(fmt,expected)
    if actual!=wanted:raise ValueError(label+' exact canonical public UN24/S8/X8; first mismatch '+str(next((i for i,(a,b) in enumerate(zip(wanted,actual)) if a!=b),None)))
MAX_ULP=0
def assert_plane(fmt,expected,actual,label,depth_only=False):
    global MAX_ULP
    count=len(expected)//4;need(len(actual)==count*20,label+' complete native plane count')
    for i in range(count):
        bits=struct.unpack_from('<I',expected,i*4)[0];wanted=word(z(fmt,bits)/0xffffff);observed,zero,zero2,one=struct.unpack_from('<4I',actual,i*16)
        MAX_ULP=max(MAX_ULP,abs(observed-wanted));need(abs(observed-wanted)<=1,label+f' native FLOAT depth pixel{i}: {observed} vs{wanted} exceeds one ULP')
        need((zero,zero2,one)==(0,0,1),label+' exact independent integer diagnostic lanes')
        stencil=bits&255 if fmt==20 and not depth_only else 0
        need(actual[count*16+i*4:count*16+i*4+4]==bytes([stencil,0,0,0]),label+f' independently selected stencil pixel{i}')
def cleared(fmt,p,values):
    n=math.floor(values[0]*0xffffff+.5);bits=(n<<8)|(values[1]&255) if fmt==20 else n
    return struct.pack('<I',bits)*(p['width']*p['height'])
def packet(wire,p,fmt,opcode,direction=1,resource=6,staging=8):
    raw=bytes.fromhex(wire);words=list(struct.unpack('<'+'I'*(len(raw)//4),raw));need(words[0]&0xffff==opcode and words[0]>>16==len(words)-1,'complete original packet header')
    need(words[1:12]==[resource,p['level'],0,p['stride'],0,p.get('x',0),p.get('y',0),0,p['width'],p['height'],1],'every original packet geometry/identity field')
    if opcode==43:need(words[12:]==[p['offset'],direction],'original transfer offset and direction')
    elif opcode==45:need(words[12:]==[staging,p['offset'],direction],'original staging ID/offset/flags')
    else:
        span=(p['height']-1)*p['stride']+p['width']*4;input_bytes=bytearray([0x6d]*((span+3)//4*4))
        for y in range(p['height']):input_bytes[y*p['stride']:y*p['stride']+p['width']*4]=p['input'][y*p['width']*4:(y+1)*p['width']*4]
        need(raw[48:]==input_bytes,'complete original inline rows and padding')
def primary():
    manifest=json.loads((ROOT/'tools/virgl-packed-depth/primary.json').read_text())
    for row in manifest['sources']:
        raw=(ROOT/row['path']).read_bytes();need(len(raw)==row['bytes'] and sha(raw)==row['sha256'],'complete pinned primary '+row['path'])
    original=(ROOT/'tools/virgl-floating-depth/primary/u_format.yaml').read_text();header=(ROOT/'renderer/virgl-shader/vendor/src/virgl_hw.h').read_text();mapping=(ROOT/'tools/virgl-floating-depth-consumer/primary/vrend_formats.c').read_text()
    for fmt,f in FORMATS.items():
        block=original.split('- name: '+f['originalName']+'\n',1)[1].split('- name:',1)[0];channels=re.search(r'channels: \[([^\]]+)\]',block)[1].split(', ');swizzles=re.search(r'swizzles: \[([^\]]+)\]',block)[1].split(', ')
        need(channels==(['UP8','UN24'] if fmt==20 else ['UN24','X8']) and f['channels']==channels and f['swizzles']==swizzles,'original little-endian packed fields')
        need(re.search(r'VIRGL_FORMAT_'+f['originalName']+r'\s*=\s*'+str(fmt)+r'\b',header),'original literal VirGL enum')
        need(f['guestPixelBytes']==f['ownedPixelBytes']==4,'complete public/native costs')
        need(re.search(r'VIRGL_FORMAT_'+f['originalName']+r',\s*GL_'+f['plannedNativeInternal']+(r'(?:_EXT)?' if fmt==20 else '')+r',\s*GL_'+f['plannedUploadFormat']+r',\s*GL_'+f['plannedUploadType']+r',\s*NO_SWIZZLE',mapping),'whole original native mapping')
    return manifest

def main(directory,allow_partial=False):
    directory=Path(directory).resolve(); primary(); totals=dict(runs=0,nativePixels=0,publicBytes=0,paddingBytes=0); faults=[]; citations=[]; stencil_values=set();domain_chunks={20:set(),21:set()}
    paths=sorted(directory.glob('hardware-*/report.json'))+sorted(directory.glob('fault-*/report.json'))
    need(paths,'original native recordings are required')
    for path in paths:
        envelope=json.loads(path.read_text()); fault=path.parent.name.startswith('fault-'); report=envelope['partial'] if fault else envelope['browserResult']['result']; blobs={b['key']:b for b in report['blobs']}; refuted=False
        def blob(point):
            row=blobs[point['key']]; packed=(path.parent/row['path']).read_bytes(); need(sha(packed)==row['gzipSha256'],'compressed custody'); raw=gzip.decompress(packed); need(len(raw)==row['bytes'] and sha(raw)==row['sha256'],'complete original/native/public custody'); return raw
        def fence(point):
            need(point['name']=='clientWaitSync' and point['actual'] in (37146,37148) and point['delivered'] in (37146,37148),'consumed physical fence completion')
        def plane(fmt,expected,point,label):
            totals['nativePixels']+=len(expected)//FORMATS[fmt]['guestPixelBytes']; assert_plane(fmt,expected,blob(point),label)
        for index,row in enumerate(report['runs']):
            totals['runs']+=1; m=row['metadata']; fmt=m['format']; kind=row.get('kind','matrix')
            if kind=='raw-buffer-read':
                original=bytes((i*73+report['seed'])&255 for i in range(37)); need(blob(row['input'])==original and blob(row['sync'])==original and blob(row['async'])==original,'inherited complete raw buffer upload/sync/PBO bypass'); fence(row['uploadFence']); fence(row['fence']); need(all(v==0 for v in row['final']['budgets'].values()) and all(o['deleted']==1 for o in row['nativeObjects']),'raw buffer terminal ownership'); continue
            f=FORMATS[fmt]; size=f['guestPixelBytes']
            if 'final' in row: need(all(v==0 for v in row['final']['budgets'].values()) and all(o['deleted']==1 for o in row['nativeObjects']),'all terminal charges zero and native objects retire once')
            if kind=='domain':
                planes,backing=prepare(fmt,512,512,0,row['seed'],domain_start=row['domainStart']);p=planes[0]
                need(blob(row['backing'])==backing and blob(row['input'])==p['input'],'complete original UN24 domain chunk and padding')
                need(row['plane']=={k:p[k] for k in ('level','width','height','stride','offset')},'domain geometry')
                packet(row['upload']['wire'],p,fmt,43);fence(row['uploadFence']);fence(row['fence'])
                assert_plane(fmt,p['input'],blob(row['native']),'complete independent domain depth',depth_only=True)
                for key in ('sync','async'):assert_public(fmt,p['input'],blob(row[key]),'all domain canonical UN24/S8/X8');totals['publicBytes']+=len(p['input'])
                uploads=[u for u in row['uploads'] if u['label']=='original-packed-depth-domain-upload' and u.get('name')!='bufferSubData']
                need(len(uploads)==1 and blob(uploads[0]['bytes'])==native_upload(fmt,p['input']),'complete actual domain original native upload words')
                native_diagnostic=blob(row['native']);depth_words=b''.join(native_diagnostic[i*16:i*16+4] for i in range(512*512))
                synchronous=[r for r in row['readbacks'] if r['label']=='original-packed-depth-domain-sync-read'];collected=[r for r in row['readbacks'] if r['label']=='original-packed-depth-domain-PBO-read' and r['name']=='getBufferSubData']
                need(blob(synchronous[0]['bytes'])==depth_words and len(collected)==1,'full actual native depth packing plane matches independent diagnostic')
                packed=blob(collected[0]['bytes']);need(packed[:len(depth_words)]==depth_words,'full PBO depth plane before public conversion')
                if fmt==20:
                    stencil=b''.join(bytes([bits&255,0,0,0]) for bits, in struct.iter_unpack('<I',p['input']))
                    need(blob(synchronous[1]['bytes'])==stencil and packed[len(depth_words):]==stencil,'full original S8 plane in actual synchronous/PBO collections')
                totals['nativePixels']+=len(p['input'])//4
                domain_chunks[fmt].add(row['domainStart'])
                if fmt==20:stencil_values.update(p['input'][0::4])
                continue
            if kind=='matrix':
                planes,backing=prepare(fmt,m['width'],m['height'],m['lastLevel'],row['seed'],row.get('exceptional',False)); expected=[canonical(fmt,p['input']) for p in planes]
                need(blob(row['backing'])==backing and len(planes)==len(row['planes']),'complete independently predicted original segmented input')
                for p,saved in zip(planes,row['planes']):
                    need(all(p[k]==saved[k] for k in ('level','width','height','stride','offset')) and blob(saved['input'])==p['input'],'complete original geometry and finite/undefined words')
                    if fmt==20: stencil_values.update(p['input'][0::4])
                for p,operation in zip(planes,row['operations']):
                    packet(operation['wire'],p,fmt,9 if p['level']%3==0 else 43)
                fence(row['uploadFence'])
                if 'sabotageFence' in row: fence(row['sabotageFence']); need(row['sabotageFence']['sync']!=row['uploadFence']['sync'],'distinct native corruption fence')
                for p,saved in zip(planes,row['planes']):
                    try: plane(fmt,p['input'],saved['observed']['native'],'initial native fields')
                    except ValueError:
                        if not fault: raise
                        refuted=True; citations.append(dict(file=path.relative_to(directory).as_posix(),run=index,point='planes/'+str(p['level'])+'/observed/native')); break
                if refuted: continue
                for patch in row['patches']:
                    p=planes[patch['level']]; seed=row['seed']^(0x987612 if patch['level']==0 else 0x651832); original,_=prepare(fmt,patch['width'],patch['height'],0,seed)
                    raw=blob(patch['input']); need(raw==original[0]['input'],'independent original partial mip words'); packet(patch['wire'],dict(patch,input=raw),fmt,9); fence(patch['fence']); result=bytearray(expected[p['level']]); n=patch['width']*size
                    for y in range(patch['height']):
                        at=((patch['y']+y)*p['width']+patch['x'])*size; result[at:at+n]=canonical(fmt,raw[y*n:(y+1)*n])
                    expected[p['level']]=bytes(result); plane(fmt,expected[p['level']],patch.get('native',row.get('afterPatchNative')),'complete partial mip and adjacent fields')
                clear_index=0
                for view in row['views']:
                    fence(view['fence']); need(view['callerState']['before']==view['callerState']['after'],'native depth copy preserves FBO/scissor state')
                    for p in view['planes']: plane(fmt,expected[p['original']],p['native'],'complete original retained range')
                    if 'refresh' in view:
                        clear=row['clears'][clear_index]; clear_index+=1; need(clear['values']==[0.6875,173] and blob(clear['backingBefore'])==backing,'literal GPU-only clear with unchanged full backing'); fence(clear['fence']); expected[clear['level']]=cleared(fmt,planes[clear['level']],clear['values']); fence(view['refresh']['fence'])
                        for p in view['refresh']['planes']: plane(fmt,expected[p['original']],p['native'],'GPU-only refresh and adjacent native levels')
                need(not any(e['label']=='original-packed-depth-range-copy' for e in row['readbacks']),'range refresh never downloads to CPU')
                for allocation in row['allocations']:
                    meta=allocation['metadata']
                    if meta['target']!=2: continue
                    pixels=sum(max(1,meta['width']//2**level)*max(1,meta['height']//2**level) for level in range(meta['lastLevel']+1)); need(meta['byteLength']==pixels*size and meta['gpuByteLength']==pixels*f['ownedPixelBytes'],'complete logical and physical mip allocation')
                    call=next(e for e in row['nativeEvents'] if e['name']=='texStorage2D' and e['texture']==allocation['texture']); need(call['args'][1:]==[meta['lastLevel']+1,report['nativeEnums'][f['plannedNativeInternal']],meta['width'],meta['height']],'actual original native depth storage')
                    need(call['budgets']['gpuBytes']>=meta['gpuByteLength'],'physical depth and upload allocation is reserved before work')
                    need(allocation['uploadBuffer'] is None,'packed fixed depth has no persistent upload PBO')
                for p in planes:
                    uploads=[u for u in row['uploads'] if u['label']=='original-packed-depth-upload-'+str(p['level'])]
                    native=next(u for u in uploads if u.get('name')!='bufferSubData'); need(native['args'][1]==p['level'] and native['args'][6:8]==[report['nativeEnums'][f['plannedUploadFormat']],report['nativeEnums'][f['plannedUploadType']]],'actual original native upload level/format/type')
                    need(blob(native['bytes'])==native_upload(fmt,p['input']),'complete independently derived original native upload words')
                if 'control' in row:
                    control=row['control']; fence(control['fence'])
                    try: assert_public(fmt,blob(control['input']),blob(control['public']),'wrong stencil native selection')
                    except ValueError:
                        need(fault,'unintended public field refutation'); refuted=True; citations.append(dict(file=path.relative_to(directory).as_posix(),run=index,point='control/public')); continue
                if fault: continue
                covered=set(); physical=sum(len(p['input']) for p in planes)*f['ownedPixelBytes']//size
                for p,transfer in zip(planes,row['transfers']):
                    packet(transfer['wire'],p,fmt,43,2); assert_public(fmt,expected[p['level']],blob(transfer['sync']),'complete public sync fields'); totals['publicBytes']+=len(expected[p['level']])
                    for read in transfer['reads']:
                        fence(read['fence']); packet(read['wire'],p,fmt,read['opcode'],2 if read['opcode']==43 else 3); assert_public(fmt,expected[p['level']],blob(read['nativeBytes']),'complete public PBO fields'); totals['publicBytes']+=len(expected[p['level']])
                        scratch=p['width']*p['height']*(8 if fmt==20 else 4); stage=p['width']*p['height']*(20 if fmt==20 else 8)
                        for point in ('beforeRead','afterPrepare','afterIssue','afterReady','afterRelease'):
                            b=read[point]; cpu=scratch if point in ('afterPrepare','afterIssue','afterReady') else 0; gpu=stage if point in ('afterIssue','afterReady') else 0
                            need(b['gpuBytes']==physical+gpu and b['scratchBytes']==cpu and b['cpuBytes']==2*len(backing)+cpu and b['backingBytes']==2*len(backing),'exact original/native/PBO/conversion accounting at '+point)
                    for y in range(p['height']):
                        at=p['offset']+y*p['stride']; n=p['width']*size; covered.update(range(at,at+n))
                for key,original in [('finalBacking',backing),('finalStagingBacking',bytes([0x2e])*len(backing))]:
                    out=blob(row[key]); need(len(out)==len(original),'complete final segmented backing')
                    need(all(out[i]==v for i,v in enumerate(original) if i not in covered),'all untouched segmented and row padding bytes')
                    for p in planes:
                        tight=b''.join(out[p['offset']+y*p['stride']:p['offset']+y*p['stride']+p['width']*size] for y in range(p['height'])); assert_public(fmt,expected[p['level']],tight,'complete final public rows')
                    totals['paddingBytes']+=len(backing)-len(covered)
                need(all(p['before']==p['after'] for p in row['packStates']),'packing restores all caller state')
            elif kind=='generation-context-held-range':
                planes,backing=prepare(fmt,m['width'],m['height'],m['lastLevel'],report['seed']^fmt); need(blob(row['backing'])==backing,'complete original held SG input'); fence(row['uploadFence']); fence(row['copyFence']); fence(row['discarded']['fence']); need(row['sourceGeneration']==row['privateGeneration'] and row['replacementGeneration']!=row['sourceGeneration'] and row['replacementTexture']!=row['sourceTexture'] and row['privateTexture']!=row['sourceTexture'],'original/private/unequal replacement native identities')
                opposite=20 if fmt==21 else 21; _,replacement=prepare(opposite,m['width'],m['height'],m['lastLevel'],report['seed']^0xabcdef); need(blob(row['replacementBacking'])==replacement,'opposite-format replacement original words')
                for p in row['heldPlanes']: plane(fmt,planes[p['original']]['input'],p['native'],'held old range after opposite format ID and context reuse')
            elif kind=='queued-complete': fence(row['fence']); assert_public(fmt,blob(row['input']),blob(row['output']),'queued old retained native fields')
            elif kind.startswith('native-budget-'):
                budget,short=kind.removeprefix('native-budget-').rsplit('-',1); need(row['before']['budgets']==row['after']['budgets'],'bounded issue/cleanup preserves original budgets')
                if int(short): need(not (row['issued'] if budget=='gpuBytes' else row['prepared'])['ok'],'one-byte-short refusal')
                else: fence(row['fence']); assert_public(fmt,blob(row['input']),blob(row['output']),'exact-bound native fields'); b=row['afterIssue']['budgets']; need(b['scratchBytes']==row['charge'] and b['gpuBytes']==row['base']+20*7*5,'exact physical conversion and staging bound')
            elif kind=='deliberately-masked-indexed-extension':
                fence(row['uploadFence']); need(row['before']==row['after'] and any(e.get('deliberatelyMasked') and e['actualAvailable'] for e in row['nativeEvents']),'explicit actual available extension masking and global state restoration'); assert_public(fmt,blob(row['input']),blob(row['output']),'bounded fallback original public fields'); plane(fmt,blob(row['input']),row['native'],'bounded fallback original native fields')
            elif kind.startswith('private-range-budget-'):
                short=int(kind.rsplit('-',1)[1]); need(row['before']['budgets']==row['after']['budgets'],'bounded private range accounting restored'); fence(row['uploadFence'])
                if short: need(not row['capture']['ok'] and row['capture']['error']['code']=='limit-exceeded','one-byte short private texture/upload reservation')
                else:
                    fence(row['copyFence']); need(row['allocated']['budgets']['gpuBytes']==row['sourceBytes']+row['viewBytes'],'exact full private range reservation')
                    for p in row['planes']: plane(fmt,blob(row['inputPlanes'][p['original']]['input']),p['native'],'exact-bound private original depth range')
            elif kind=='current-helper-program-disposal':
                fence(row['uploadFence']); assert_public(fmt,blob(row['input']),blob(row['output']),'own helper program native public fields'); need(row['currentBefore'] is not None and row['currentAfter'] is None,'own current native program unbound before retirement')
            elif kind=='private-helper-ownership-guards':
                fence(row['scratchFence']); need(len(row['refusals'])==6 and all(r['error'] for r in row['refusals']) and len(set(row['ownedScratch'].values()))==3,'direct helper rejects foreign/invalid/disposed ownership and retires every owned scratch')
            elif kind.startswith('private-allocation-error-'): need(not row['result']['ok'] and row['result']['error']['code']=='backend-error' and row['before']['budgets']==row['after']['budgets'] and row['faultEvents'],'actual private allocation failure and precharge rollback')
            elif kind.startswith('native-error-'): need(not row['result']['ok'] and row['result']['error']['code']=='backend-error' and row['faultEvents'],'actual native failure and explicit refusal')
            if 'final' in row: need(all(v==0 for v in row['final']['budgets'].values()) and all(o['deleted']==1 for o in row['nativeObjects']),'all terminal charges zero and native objects retire once')
        if fault:
            need(refuted and report['sabotage']['fenceCompleted'] and not report['sabotage']['held'],'unchanged independent inverse refutes actual completed native control'); faults.append(dict(name=path.parent.name,status='refuted',fenceCompleted=True))
    need(stencil_values==set(range(256)),'complete original stencil field values')
    if not allow_partial:need(all(v==set(range(0,16777216,262144)) for v in domain_chunks.values()),'full original UN24 domain for each format')
    result=dict(scope='inner-loop' if allow_partial else 'full-domain',domainWordsPerFormat={str(k):len(v)*262144 for k,v in domain_chunks.items()},schema='independent-original-packed-depth-values-v1',status='passed',**totals,faults=faults,citations=citations,oracleImportsProductCode=False,maxObservedNativeUlp=MAX_ULP,nativeDepthUlpBound=1,publicFixedFieldsExact=True,stencilValues=len(stencil_values))
    (directory/'independent-values.json').write_text(json.dumps(result,indent=2)+'\n'); print(json.dumps(result))

if __name__=='__main__':
    main(sys.argv[1])
