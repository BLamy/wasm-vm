#!/usr/bin/env python3
"""Independent packed unsigned word/plane/SG inverse, derived only from original descriptors."""
import gzip,hashlib,json,re,struct,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sha=lambda b:hashlib.sha256(b).hexdigest()
def need(value,message):
    if not value:raise ValueError(message)
FORMATS={row['originalFormat']:row for row in json.loads((ROOT/'tools/virgl-command/standard-packed-unsigned-formats.json').read_text())['records']}
def canonical(fmt,raw):
    f=FORMATS[fmt];size=f['guestPixelBytes'];a=f['rgbaFields'][3];mask=((1<<a['bits'])-1)<<a['offset'] if a.get('implicit') else 0
    return b''.join((int.from_bytes(raw[i:i+size],'little')|mask).to_bytes(size,'little') for i in range(0,len(raw),size))
def prepare(fmt,w,h,last,seed,bind=10,dense=False):
    f=FORMATS[fmt];size=f['guestPixelBytes'];planes=[];offset=5
    def next_word():
        nonlocal seed
        seed^=(seed<<13)&0xffffffff;seed^=seed>>17;seed^=(seed<<5)&0xffffffff;seed&=0xffffffff;return seed
    for level in range(last+1):
        raw=bytearray()
        for i in range(w*h):
            word=i if dense and size==2 else next_word()
            if dense and size==4:word=(i%1024)|((i//4%1024)<<10)|((1023-i%1024)<<20)|((i%4)<<30)
            raw.extend((word&((1<<(size*8))-1)).to_bytes(size,'little'))
        stride=w*size+7;planes.append(dict(level=level,width=w,height=h,stride=stride,offset=offset,input=bytes(raw)));offset+=(h-1)*stride+w*size+11;w=max(1,w//2);h=max(1,h//2)
    backing=bytearray([0xa7]*(offset+9))
    for p in planes:
        row=p['width']*size
        for y in range(p['height']):backing[p['offset']+y*p['stride']:p['offset']+y*p['stride']+row]=p['input'][y*row:(y+1)*row]
    return planes,bytes(backing)
def fields(fmt,raw):
    f=FORMATS[fmt];size=f['guestPixelBytes']
    for at in range(0,len(raw),size):
        word=int.from_bytes(raw[at:at+size],'little')
        yield [((1<<field['bits'])-1 or 1) if field.get('implicit') else (word>>field['offset'])&((1<<field['bits'])-1) for field in f['rgbaFields']]
def native_upload(fmt,raw):
    f=FORMATS[fmt];size=f['guestPixelBytes'];result=bytearray()
    for pixel in fields(fmt,raw):
        word=sum((value if f['rgbaFields'][lane]['bits'] else 0)<<f['nativeOffsets'][lane] for lane,value in enumerate(pixel));result.extend(word.to_bytes(size,'little'))
    return bytes(result)
def assert_plane(fmt,expected,actual,label):
    need(len(actual)==len(expected)*4,label+' complete integer component count')
    for i,pixel in enumerate(fields(fmt,expected)):
        observed=struct.unpack_from('<4I',actual,i*16)
        need(list(observed)==pixel,label+f' original integer fields at pixel {i}: {observed} != {pixel}')
def cleared(fmt,p,values):
    word=sum((int(values[lane])&((1<<field['bits'])-1))<<field['offset'] for lane,field in enumerate(FORMATS[fmt]['rgbaFields']))
    return word.to_bytes(4,'little')*(p['width']*p['height'])
def main(directory):
    directory=Path(directory).resolve();native=public=padding=runs=0;faults=[];citations=[]
    descriptor=json.loads((ROOT/'tools/virgl-command/standard-packed-unsigned-formats.json').read_text());header=(ROOT/'renderer/virgl-shader/vendor/src/virgl_hw.h').read_bytes();mesa=(ROOT/'tools/virgl-command/standard-packed-unsigned-mesa-formats.yaml').read_bytes()
    need(sha(header)==descriptor['originalHeaderSha256'] and sha(mesa)==descriptor['mesaExcerptSha256'],'original primary descriptor pins')
    for f in FORMATS.values():need(re.search(r'VIRGL_FORMAT_'+f['originalName']+r'\s*=\s*'+str(f['originalFormat'])+r'\b',header.decode()),'literal original VirGL enum');need('- name: '+f['originalName']+'\n' in mesa.decode(),'original Mesa layout')
    for f in FORMATS.values():
        block=mesa.decode().split('- name: '+f['originalName']+'\n',1)[1].split('- name:',1)[0]
        channels=re.search(r'channels: \[([^\]]+)\]',block)[1].split(', ')
        swizzles=re.search(r'swizzles: \[([^\]]+)\]',block)[1].split(', ')
        need(channels==['UP10','UP10','UP10','UP2'] and swizzles==f['swizzles'],'primary integer channel/swizzle identity')
        widths=[int(channel[2:]) for channel in channels];offsets=[sum(widths[:i]) for i in range(4)]
        expected=[dict(bits=widths['XYZW'.index(lane)],offset=offsets['XYZW'.index(lane)],ignored=False) for lane in swizzles]
        need(f['rgbaFields']==expected,'original UINT fields independently derived from physical primary layout')
    paths=sorted(directory.glob('hardware-*/report.json'))+sorted(directory.glob('fault-*/report.json'))
    for path in paths:
        envelope=json.loads(path.read_text());fault=path.parent.name.startswith('fault-');report=envelope['partial'] if fault else envelope['browserResult']['result'];blobs={b['key']:b for b in report['blobs']}
        def blob(b):
            row=blobs[b['key']];raw=(path.parent/row['path']).read_bytes();need(sha(raw)==row['gzipSha256'],'compressed native byte custody');raw=gzip.decompress(raw);need(sha(raw)==row['sha256'] and len(raw)==row['bytes'],'full original native/public byte custody');return raw
        def fence(point):need(point['name']=='clientWaitSync' and point['actual'] in (37146,37148) and point['delivered'] in (37146,37148),'physical native fence completion')
        def plane(fmt,expected,record,label):
            nonlocal native
            actual=blob(record);native+=len(expected)//FORMATS[fmt]['guestPixelBytes']*4
            assert_plane(fmt,expected,actual,label)
        refuted=False
        for index,row in enumerate(report['runs']):
            runs+=1;m=row['metadata'];fmt=m['format'];f=FORMATS[fmt];kind=row.get('kind','matrix')
            if kind=='matrix':
                planes,backing=prepare(fmt,m['width'],m['height'],m['lastLevel'],row['seed'],m['bind'],row.get('dense',False));expected=[canonical(fmt,p['input']) for p in planes];need(blob(row['backing'])==backing,'entire original input/SG padding declared before native upload')
                if row.get('dense'):
                    pixels=list(fields(fmt,planes[0]['input']))
                    for lane,field in enumerate(f['rgbaFields']):need({pixel[lane] for pixel in pixels}==set(range(1<<field['bits'])),'dense independent input covers every integer lane value')
                for p,saved in zip(planes,row['planes']):
                    need(all(p[key]==saved[key] for key in ('level','width','height','stride','offset')) and blob(saved['input'])==p['input'],'original seeded packed unsigned fields before GPU')
                fence(row['uploadFence']);
                if 'sabotageFence' in row:fence(row['sabotageFence']);need(row['sabotageFence']['sync']!=row['uploadFence']['sync'],'real post-completion corruption has a distinct physical fence')
                if f['implicitAlpha'] and 'initialNative' in row:fence(row['initialFence']);plane(fmt,bytes(len(expected[0])),row['initialNative'],'RGB packed unsigned alpha initialization')
                for p,saved in zip(planes,row['planes']):
                    try:plane(fmt,p['input'],saved['observed']['native'],'whole initial native packed unsigned plane')
                    except ValueError:
                        if not fault:raise
                        refuted=True;citations.append(dict(file=path.relative_to(directory).as_posix(),run=index,point='planes/'+str(p['level'])+'/observed/native'));break
                if refuted:continue
                for patch in row['patches']:
                    raw=blob(patch['input']);prepared,_=prepare(fmt,patch['width'],patch['height'],0,(row['seed']^0x987612)&0xffffffff);need(raw==prepared[0]['input'],'independent original subrect words');p=planes[patch['level']];patched=bytearray(expected[p['level']]);count=patch['width']*f['guestPixelBytes']
                    for y in range(patch['height']):at=((patch['y']+y)*p['width']+patch['x'])*f['guestPixelBytes'];patched[at:at+count]=canonical(fmt,raw[y*count:(y+1)*count])
                    expected[p['level']]=bytes(patched);fence(patch['fence']);plane(fmt,expected[0],row['afterPatchNative'],'whole native subrect/untouched packed unsigned plane')
                clear_index=0
                for view in row['views']:
                    fence(view['fence']);need(view['callerState']['before']==view['callerState']['after'],'packed unsigned copy caller FBO/scissor restoration')
                    for p in view['planes']:
                        try:plane(fmt,expected[p['original']],p['native'],'complete private packed unsigned range')
                        except ValueError:
                            if not fault:raise
                            refuted=True;citations.append(dict(file=path.relative_to(directory).as_posix(),run=index,point='views/planes/native'));break
                    if refuted:break
                    if 'refresh' in view:
                        clear=row['clears'][clear_index];clear_index+=1;values=[1023,17,683,3];need(clear['values']==values,'literal original typed clear values');fence(clear['fence']);need(blob(clear['backingBefore'])==backing,'GPU-only clear leaves complete original SG unchanged');expected[clear['level']]=cleared(fmt,planes[clear['level']],values);fence(view['refresh']['fence'])
                        for p in view['refresh']['planes']:plane(fmt,expected[p['original']],p['native'],'GPU-only original packed unsigned clear and adjacent range levels')
                if fault:continue
                need(not any(r['label']=='original-packed-unsigned-range-copy' for r in row['readbacks']),'native range GPU copies have no CPU download')
                need(row['initializationState']['before']==row['initializationState']['after'],'actual global and indexed masks/scissor survive packed initialization')
                physical=sum(len(p['input']) for p in planes)
                storage=[e for e in row['nativeEvents'] if e['name']=='texStorage2D']
                for allocation in row['allocations']:
                    meta=allocation['metadata']
                    if meta['target']!=2:continue
                    total=sum(max(1,meta['width']//2**level)*max(1,meta['height']//2**level)*f['guestPixelBytes'] for level in range(meta['lastLevel']+1))
                    need(meta['byteLength']==total and meta['gpuByteLength']==total and allocation['copyScratch'] is None,'full original/native packed allocations with no shadow')
                    call=next(e for e in storage if e['texture']==allocation['texture'])
                    need(call['args'][1:]==[meta['lastLevel']+1,report['nativeEnums'][f['plannedNativeInternal']],meta['width'],meta['height']],'actual immutable native packed internal format and dimensions')
                upload_index=0
                for upload in row['uploads']:
                    if upload['label'].startswith('original-packed-unsigned-upload-'):
                        level=int(upload['label'].rsplit('-',1)[1]);need(blob(upload['bytes'])==native_upload(fmt,planes[level]['input']),'complete actual native packed unsigned upload representation');need(upload['args'][6]==report['nativeEnums'][f['plannedUploadFormat']] and upload['args'][7]==report['nativeEnums'][f['plannedUploadType']],'actual native packed unsigned upload format/type');upload_index+=1
                need(upload_index==len(planes),'every original mip reaches native upload')
                final=bytearray(backing);staged=bytearray([0x2e]*len(backing));need(blob(row['stagingBacking'])==staged,'original staged SG input')
                for p,transfer in zip(planes,row['transfers']):
                    raw=expected[p['level']];need(blob(transfer['sync'])==raw,'complete exact public packed unsigned sync bytes');public+=len(raw)
                    for read in transfer['reads']:fence(read['fence']);need(blob(read['nativeBytes'])==raw,'complete exact public packed unsigned PBO bytes');public+=len(raw)
                    for read in transfer['reads']:
                        charge=p['width']*p['height']*16;base_gpu=physical;base_cpu=2*len(backing)
                        for point in ('beforeRead','afterPrepare','afterIssue','afterReady','afterRelease'):
                            budget=read[point];scratch=charge if point in ('afterPrepare','afterIssue','afterReady') else 0;staging=charge if point in ('afterIssue','afterReady') else 0
                            need(budget['gpuBytes']==base_gpu+staging and budget['scratchBytes']==scratch and budget['cpuBytes']==base_cpu+scratch and budget['backingBytes']==base_cpu,'exact original/native/PBO/scratch charge at '+point)
                    count=p['width']*f['guestPixelBytes']
                    for y in range(p['height']):at=p['offset']+y*p['stride'];final[at:at+count]=raw[y*count:(y+1)*count];staged[at:at+count]=raw[y*count:(y+1)*count]
                need(blob(row['finalBacking'])==final and blob(row['finalStagingBacking'])==staged,'every original/output SG byte including untouched padding');padding+=2*(len(backing)-sum(len(p['input']) for p in planes))
            elif kind=='generation-context-held-range':
                planes,backing=prepare(fmt,m['width'],m['height'],m['lastLevel'],report['seed']^fmt);need(blob(row['backing'])==backing,'original held-range SG');fence(row['uploadFence']);fence(row['copyFence']);fence(row['discarded']['fence']);need(row['sourceGeneration']==row['privateGeneration'] and row['replacementGeneration']!=row['sourceGeneration'] and row['replacementTexture']!=row['sourceTexture'] and row['privateTexture']!=row['sourceTexture'],'actual source/private/replacement generation identities')
                for p in row['heldPlanes']:plane(fmt,planes[p['original']]['input'],p['native'],'old native packed unsigned range survives source/context reuse')
            elif kind=='queued-complete':fence(row['fence']);need(blob(row['output'])==canonical(fmt,blob(row['input'])),'queued old packed unsigned source exact words');public+=len(blob(row['output']))
            elif kind.startswith('native-budget-'):
                budget,short=kind.removeprefix('native-budget-').rsplit('-',1);short=int(short);need(row['before']['budgets']==row['after']['budgets'],'native packed budget refusal/completion returns original accounting')
                if not short:
                    fence(row['fence']);need(blob(row['output'])==blob(row['input']),'exact-bound original packed read words')
                    issued=row['afterIssue']['budgets'];need(issued['scratchBytes']==row['charge'] and issued['gpuBytes']==row['base']+row['charge'] and issued['cpuBytes']==len(blob(row['backing']))+row['charge'],'exact-bound physical scratch/PBO/backing charges')
                else:need(not row['prepared']['ok'] if budget!='gpuBytes' else not row['issued']['ok'],'one-byte-short native packed bound rejects')
            elif kind=='deliberately-masked-indexed-extension':
                fence(row['uploadFence']);need(row['before']==row['after'],'actual fallback global mask/scissor state');plane(fmt,blob(row['input']),row['native'],'actual masked-extension packed image');need(any(e.get('deliberatelyMasked') and e['actualAvailable'] for e in row['nativeEvents']),'test explicitly masks an available actual indexed extension')
            if 'final' in row:need(all(v==0 for v in row['final']['budgets'].values()) and all(o['deleted']==1 for o in row['nativeObjects']),'exact once native object retirement and all terminal budgets')
        if fault:need(refuted and report['sabotage']['fenceCompleted'] and not report['sabotage']['held'],'real native wrong words fail independent full-plane inverse after fence');faults.append(dict(name=path.parent.name,status='refuted',fenceCompleted=True))
    result=dict(schema='original-packed-unsigned-image-independent-values-v1',status='passed',runs=runs,nativeComponents=native,publicBytes=public,untouchedPaddingBytes=padding,faults=faults,citations=citations,oracleImportsProductCode=False)
    (directory/'independent-values.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__':main(sys.argv[1])
