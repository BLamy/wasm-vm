#!/usr/bin/env python3
"""Independent complete F32/UP8/X24 native, public and segmented-backing inverse."""
import gzip
import hashlib
import json
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FORMATS = {row['originalFormat']: row for row in json.loads((ROOT/'tools/virgl-command/standard-floating-depth-formats.json').read_text())}
NORMAL = [0x3eaaab55,0x3f000001,0x3effffff,0x3f7fffff,0x35800000,0x3c012345,0x3f000000,0x3e800000,0,0x3f800000,0xbf800000,0x40000000,0x00800000,0x00900001]
EXCEPTIONAL = [0x80000000,1,0x007fffff,0x80000001,0x7f800000,0xff800000,0x7fc01234,0x7f812345,0xffc56789]
sha = lambda raw: hashlib.sha256(raw).hexdigest()

def need(value, message):
    if not value:
        raise ValueError(message)

def accepted(bits):
    exponent = bits >> 23 & 255
    if exponent == 255:
        return None
    if bits & 0x7fffffff == 0 or bits >> 31:
        return {0,0x80000000}
    if exponent == 0:
        return {bits,0,0x80000000}
    number = struct.unpack('<f',struct.pack('<I',bits))[0]
    return {struct.unpack('<I',struct.pack('<f',min(1.0,max(0.0,number))))[0]}

def canonical(fmt, raw):
    size = FORMATS[fmt]['guestPixelBytes']; out = bytearray(raw)
    for at in range(0,len(raw),size):
        bits = struct.unpack_from('<I',raw,at)[0]; choices = accepted(bits)
        if choices is not None:
            value = bits if bits in choices else 0 if 0 in choices else next(iter(choices))
            struct.pack_into('<I',out,at,value)
        if size == 8:
            out[at+5:at+8] = b'\0'*3
    return bytes(out)

def prepare(fmt,w,h,last,seed,exceptional=False):
    size=FORMATS[fmt]['guestPixelBytes']; original_seed=seed; planes=[]; offset=5
    def random():
        nonlocal seed
        seed ^= seed << 13 & 0xffffffff; seed ^= seed >> 17; seed ^= seed << 5 & 0xffffffff; seed &= 0xffffffff
        return seed
    for level in range(last+1):
        raw=bytearray()
        for i in range(w*h):
            bits=EXCEPTIONAL[(i+level)%len(EXCEPTIONAL)] if exceptional else NORMAL[(i+level+(0 if i==0 else random()))%len(NORMAL)]
            raw.extend(struct.pack('<I',bits))
            if size==8:
                raw.extend(struct.pack('<I',(random()&0xffffff00)|((i*73+level*29+original_seed)&255)))
        stride=w*size+7; planes.append(dict(level=level,width=w,height=h,stride=stride,offset=offset,input=bytes(raw)))
        offset+=(h-1)*stride+w*size+11; w=max(1,w//2); h=max(1,h//2)
    backing=bytearray([0xa7]*(offset+9))
    for p in planes:
        n=p['width']*size
        for y in range(p['height']):
            at=p['offset']+y*p['stride']; backing[at:at+n]=p['input'][y*n:(y+1)*n]
    return planes,bytes(backing)

def assert_public(fmt, expected, actual, label):
    size=FORMATS[fmt]['guestPixelBytes']; need(len(actual)==len(expected),label+' complete public byte count')
    for at in range(0,len(expected),size):
        bits=struct.unpack_from('<I',expected,at)[0]; word=struct.unpack_from('<I',actual,at)[0]; choices=accepted(bits)
        need(choices is None or word in choices,label+f' original depth pixel {at//size}: 0x{word:08x} outside {choices}')
        if size==8:
            need(actual[at+4:at+8]==bytes([expected[at+4],0,0,0]),label+f' original stencil or canonical X24 at pixel {at//size}')

def assert_plane(fmt, expected, actual, label):
    size=FORMATS[fmt]['guestPixelBytes']; count=len(expected)//size
    need(len(actual)==count*20,label+' complete native plane count')
    for i in range(count):
        word,zero,zero2,one=struct.unpack_from('<4I',actual,i*16); bits=struct.unpack_from('<I',expected,i*size)[0]; choices=accepted(bits)
        need(choices is None or word in choices,label+f' original native depth pixel {i}: 0x{word:08x} outside {choices}')
        need((zero,zero2,one)==(0,0,1),label+' complete independent integer diagnostic lanes')
        wanted=expected[i*size+4] if size==8 else 0
        need(actual[count*16+i*4:count*16+i*4+4]==bytes([wanted,0,0,0]),label+f' independently selected stencil at pixel {i}')

def cleared(fmt,p,values):
    pixel=struct.pack('<f',values[0])+(bytes([values[1],0,0,0]) if fmt==126 else b'')
    return pixel*(p['width']*p['height'])

def packet(wire,p,fmt,opcode,direction=1,resource=6,staging=8):
    raw=bytes.fromhex(wire); words=list(struct.unpack('<'+'I'*(len(raw)//4),raw)); size=FORMATS[fmt]['guestPixelBytes']
    need(words[0]&0xffff==opcode and words[0]>>16==len(words)-1,'complete original packet header')
    common=[resource,p['level'],0,p['stride'],0,p.get('x',0),p.get('y',0),0,p['width'],p['height'],1]
    need(words[1:12]==common,'every original packet geometry/identity field')
    if opcode==43:
        need(words[12:]==[p['offset'],direction],'original transfer offset and direction')
    elif opcode==45:
        need(words[12:]==[staging,p['offset'],direction],'original staging ID/offset/flags')
    else:
        span=(p['height']-1)*p['stride']+p['width']*size; input_bytes=bytearray([0x6d]*((span+3)//4*4))
        for y in range(p['height']):
            n=p['width']*size; input_bytes[y*p['stride']:y*p['stride']+n]=p['input'][y*n:(y+1)*n]
        need(raw[48:]==input_bytes,'complete original inline rows and padding')

def primary():
    manifest=json.loads((ROOT/'tools/virgl-floating-depth/primary.json').read_text())
    for row in manifest['sources']:
        raw=(ROOT/row['path']).read_bytes(); need(len(raw)==row['bytes'] and sha(raw)==row['sha256'],'complete pinned primary source '+row['path'])
    original=(ROOT/'tools/virgl-floating-depth/primary/u_format.yaml').read_text(); excerpt=(ROOT/'tools/virgl-command/standard-floating-depth-mesa-formats.yaml').read_text(); header=(ROOT/'renderer/virgl-shader/vendor/src/virgl_hw.h').read_text()
    for fmt,f in FORMATS.items():
        block=original.split('- name: '+f['originalName']+'\n',1)[1].split('- name:',1)[0]
        need('- name: '+f['originalName']+'\n'+block in excerpt,'complete literal original Mesa descriptor')
        channels=re.search(r'channels: \[([^\]]+)\]',block)[1].split(', '); swizzles=re.search(r'swizzles: \[([^\]]+)\]',block)[1].split(', ')
        need(channels==(['F32'] if fmt==18 else ['F32','UP8','X24']) and f['channels']==channels and f['swizzles']==swizzles,'original little endian depth/stencil/padding fields')
        need(re.search(r'VIRGL_FORMAT_'+f['originalName']+r'\s*=\s*'+str(fmt)+r'\b',header),'original literal VirGL enum')
        need(f['guestPixelBytes']==(4 if fmt==18 else 8) and f['ownedPixelBytes']==(4 if fmt==18 else 16),'declared complete public/native/upload ownership costs')
    return manifest

def main(directory):
    directory=Path(directory).resolve(); primary(); totals=dict(runs=0,nativePixels=0,publicBytes=0,paddingBytes=0); faults=[]; citations=[]; stencil_values=set()
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
            if kind=='matrix':
                planes,backing=prepare(fmt,m['width'],m['height'],m['lastLevel'],row['seed'],row.get('exceptional',False)); expected=[canonical(fmt,p['input']) for p in planes]
                need(blob(row['backing'])==backing and len(planes)==len(row['planes']),'complete independently predicted original segmented input')
                for p,saved in zip(planes,row['planes']):
                    need(all(p[k]==saved[k] for k in ('level','width','height','stride','offset')) and blob(saved['input'])==p['input'],'complete original geometry and finite/undefined words')
                    if fmt==126: stencil_values.update(p['input'][4::8])
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
                need(not any(e['label']=='original-floating-depth-range-copy' for e in row['readbacks']),'range refresh never downloads to CPU')
                for allocation in row['allocations']:
                    meta=allocation['metadata']
                    if meta['target']!=2: continue
                    pixels=sum(max(1,meta['width']//2**level)*max(1,meta['height']//2**level) for level in range(meta['lastLevel']+1)); need(meta['byteLength']==pixels*size and meta['gpuByteLength']==pixels*f['ownedPixelBytes'],'complete logical and physical mip allocation')
                    call=next(e for e in row['nativeEvents'] if e['name']=='texStorage2D' and e['texture']==allocation['texture']); need(call['args'][1:]==[meta['lastLevel']+1,report['nativeEnums'][f['plannedNativeInternal']],meta['width'],meta['height']],'actual original native depth storage')
                    need(call['budgets']['gpuBytes']>=meta['gpuByteLength'],'physical depth and upload allocation is reserved before work')
                    if fmt==126:
                        buffer=next(e for e in row['nativeEvents'] if e['name']=='bufferData' and e['buffer']==allocation['uploadBuffer']); need(buffer['args'][1]==meta['byteLength'] and buffer['budgets']['gpuBytes']>=meta['gpuByteLength'],'persistent upload PBO is fully precharged')
                    else: need(allocation['uploadBuffer'] is None,'float-only depth has no upload PBO')
                for p in planes:
                    uploads=[u for u in row['uploads'] if u['label']=='original-floating-depth-upload-'+str(p['level'])]
                    native=next(u for u in uploads if u.get('name')!='bufferSubData'); need(native['args'][1]==p['level'] and native['args'][6:8]==[report['nativeEnums'][f['plannedUploadFormat']],report['nativeEnums'][f['plannedUploadType']]],'actual original native upload level/format/type')
                    data=next(u for u in uploads if u.get('name')=='bufferSubData') if fmt==126 else native
                    need(blob(data['bytes'])==p['input'],'complete actual native upload words are unaltered, including X24 and exceptional floats')
                    if fmt==126: need(native['type']=='PBO' and native['unpackBuffer']==data['unpackBuffer'] and native['unpackBuffer']==row['allocations'][0]['uploadBuffer'],'numeric-offset persistent PBO packed upload')
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
                        scratch=p['width']*p['height']*(16 if fmt==126 else 4); stage=p['width']*p['height']*(24 if fmt==126 else 8)
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
                opposite=126 if fmt==18 else 18; _,replacement=prepare(opposite,m['width'],m['height'],m['lastLevel'],report['seed']^0xabcdef); need(blob(row['replacementBacking'])==replacement,'opposite-format replacement original words')
                for p in row['heldPlanes']: plane(fmt,planes[p['original']]['input'],p['native'],'held old range after opposite format ID and context reuse')
            elif kind=='queued-complete': fence(row['fence']); assert_public(fmt,blob(row['input']),blob(row['output']),'queued old retained native fields')
            elif kind.startswith('native-budget-'):
                budget,short=kind.removeprefix('native-budget-').rsplit('-',1); need(row['before']['budgets']==row['after']['budgets'],'bounded issue/cleanup preserves original budgets')
                if int(short): need(not (row['issued'] if budget=='gpuBytes' else row['prepared'])['ok'],'one-byte-short refusal')
                else: fence(row['fence']); assert_public(fmt,blob(row['input']),blob(row['output']),'exact-bound native fields'); b=row['afterIssue']['budgets']; need(b['scratchBytes']==row['charge'] and b['gpuBytes']==row['base']+24*7*5,'exact physical conversion and staging bound')
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
                fence(row['scratchFence']); need(len(row['refusals'])==5 and all(r['error'] for r in row['refusals']) and len(set(row['ownedScratch'].values()))==3,'direct helper rejects foreign/invalid/disposed ownership and retires every owned scratch')
            elif kind.startswith('private-allocation-error-'): need(not row['result']['ok'] and row['result']['error']['code']=='backend-error' and row['before']['budgets']==row['after']['budgets'] and row['faultEvents'],'actual private allocation failure and precharge rollback')
            elif kind.startswith('native-error-'): need(not row['result']['ok'] and row['result']['error']['code']=='backend-error' and row['faultEvents'],'actual native failure and explicit refusal')
            if 'final' in row: need(all(v==0 for v in row['final']['budgets'].values()) and all(o['deleted']==1 for o in row['nativeObjects']),'all terminal charges zero and native objects retire once')
        if fault:
            need(refuted and report['sabotage']['fenceCompleted'] and not report['sabotage']['held'],'unchanged independent inverse refutes actual completed native control'); faults.append(dict(name=path.parent.name,status='refuted',fenceCompleted=True))
    need(stencil_values==set(range(256)),'complete original stencil field values')
    result=dict(schema='independent-original-floating-depth-values-v1',status='passed',**totals,faults=faults,citations=citations,oracleImportsProductCode=False,nonfiniteGuarantee='bounded complete custody, no value or payload promise',zeroDenormalGuarantee='defined alternatives only',stencilValues=len(stencil_values))
    (directory/'independent-values.json').write_text(json.dumps(result,indent=2)+'\n'); print(json.dumps(result))

if __name__=='__main__':
    main(sys.argv[1])
