#!/usr/bin/env python3
"""Independent integer word/plane/SG inverse, derived only from original descriptors."""
import gzip,hashlib,json,re,struct,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sha=lambda b:hashlib.sha256(b).hexdigest()
def need(value,message):
    if not value:raise ValueError(message)
FORMATS={row['originalFormat']:row for row in json.loads((ROOT/'tools/virgl-command/standard-integer-image-formats.json').read_text())['records']}
def prepare(fmt,w,h,last,seed,bind=10):
    f=FORMATS[fmt];size=f['bits']//8;components=f['components'];mask=(1<<f['bits'])-1;high=1<<(f['bits']-1);edges=[0,1,mask,high,high-1,high+1,mask-1,17,63];planes=[];offset=5
    def next_word():
        nonlocal seed
        seed^=(seed<<13)&0xffffffff;seed^=seed>>17;seed^=(seed<<5)&0xffffffff;seed&=0xffffffff;return seed
    for level in range(last+1):
        raw=bytearray()
        for i in range(w*h*components):
            word=edges[(i//components+i%components+level)%len(edges)] if i<len(edges)*components else next_word()%(1<<f['bits'])
            raw.extend((word&mask).to_bytes(size,'little'))
        stride=w*f['guestPixelBytes']+7;planes.append(dict(level=level,width=w,height=h,stride=stride,offset=offset,input=bytes(raw)));offset+=(h-1)*stride+w*f['guestPixelBytes']+11;w=max(1,w//2);h=max(1,h//2)
    backing=bytearray([0xa7]*(offset+9))
    for p in planes:
        row=p['width']*f['guestPixelBytes']
        for y in range(p['height']):backing[p['offset']+y*p['stride']:p['offset']+y*p['stride']+row]=p['input'][y*row:(y+1)*row]
    return planes,bytes(backing)
def rgba(fmt,raw):
    f=FORMATS[fmt];size=f['bits']//8;out=bytearray()
    for i in range(0,len(raw),f['guestPixelBytes']):
        for lane in range(4):
            value=int.from_bytes(raw[i+lane*size:i+(lane+1)*size],'little',signed=f['signed']) if lane<f['components'] else 1 if lane==3 else 0
            out.extend(value.to_bytes(4,'little',signed=f['signed']))
    return bytes(out)
def native_upload(fmt,raw):
    f=FORMATS[fmt]
    if f['components']!=3:return raw
    size=f['bits']//8;out=bytearray()
    for i in range(0,len(raw),f['guestPixelBytes']):out.extend(raw[i:i+f['guestPixelBytes']]);out.extend((1).to_bytes(size,'little'))
    return bytes(out)
def cleared(fmt,p,values):
    f=FORMATS[fmt];mask=(1<<f['bits'])-1;pixel=b''.join((v&mask).to_bytes(f['bits']//8,'little') for v in values[:f['components']]);return pixel*(p['width']*p['height'])
def main(directory):
    directory=Path(directory).resolve();native=public=padding=runs=0;faults=[];citations=[]
    descriptor=json.loads((ROOT/'tools/virgl-command/standard-integer-image-formats.json').read_text());header=(ROOT/'renderer/virgl-shader/vendor/src/virgl_hw.h').read_bytes();mesa=(ROOT/'tools/virgl-command/standard-float-image-mesa-formats.yaml').read_bytes()
    need(sha(header)==descriptor['originalHeaderSha256'] and sha(mesa)==descriptor['mesaFormatSha256'],'original primary descriptor pins')
    for f in FORMATS.values():need(re.search(r'VIRGL_FORMAT_'+f['originalName']+r'\s*=\s*'+str(f['originalFormat'])+r'\b',header.decode()),'literal original VirGL enum');need('- name: '+f['originalName']+'\n' in mesa.decode(),'original Mesa layout')
    paths=sorted(directory.glob('hardware-*/report.json'))+sorted(directory.glob('fault-*/report.json'))
    for path in paths:
        envelope=json.loads(path.read_text());fault=path.parent.name.startswith('fault-');report=envelope['partial'] if fault else envelope['browserResult']['result'];blobs={b['key']:b for b in report['blobs']}
        def blob(b):
            row=blobs[b['key']];raw=(path.parent/row['path']).read_bytes();need(sha(raw)==row['gzipSha256'],'compressed native byte custody');raw=gzip.decompress(raw);need(sha(raw)==row['sha256'] and len(raw)==row['bytes'],'full original native/public byte custody');return raw
        def fence(point):need(point['name']=='clientWaitSync' and point['actual'] in (37146,37148) and point['delivered'] in (37146,37148),'physical native fence completion')
        def plane(fmt,expected,record,label):
            nonlocal native
            actual=blob(record);want=rgba(fmt,expected);native+=len(want)//4
            need(actual==want,label)
        refuted=False
        for index,row in enumerate(report['runs']):
            runs+=1;m=row['metadata'];fmt=m['format'];f=FORMATS[fmt];kind=row.get('kind','matrix')
            if kind=='matrix':
                planes,backing=prepare(fmt,m['width'],m['height'],m['lastLevel'],row['seed'],m['bind']);expected=[p['input'] for p in planes];need(blob(row['backing'])==backing,'entire original input/SG padding declared before native upload')
                for p,saved in zip(planes,row['planes']):
                    need(all(p[key]==saved[key] for key in ('level','width','height','stride','offset')) and blob(saved['input'])==p['input'],'original seeded integer fields before GPU')
                fence(row['uploadFence'])
                if f['components']==3 and 'initialNative' in row:fence(row['initialFence']);plane(fmt,bytes(len(expected[0])),row['initialNative'],'RGB integer alpha initialization')
                for p,saved in zip(planes,row['planes']):
                    try:plane(fmt,p['input'],saved['observed']['native'],'whole initial native integer plane')
                    except ValueError:
                        if not fault:raise
                        refuted=True;citations.append(dict(file=path.relative_to(directory).as_posix(),run=index,point='planes/'+str(p['level'])+'/observed/native'));break
                if refuted:continue
                for patch in row['patches']:
                    raw=blob(patch['input']);prepared,_=prepare(fmt,patch['width'],patch['height'],0,(row['seed']^0x987612)&0xffffffff);need(raw==prepared[0]['input'],'independent original subrect words');p=planes[patch['level']];patched=bytearray(expected[p['level']]);count=patch['width']*f['guestPixelBytes']
                    for y in range(patch['height']):at=((patch['y']+y)*p['width']+patch['x'])*f['guestPixelBytes'];patched[at:at+count]=raw[y*count:(y+1)*count]
                    expected[p['level']]=bytes(patched);fence(patch['fence']);plane(fmt,expected[0],row['afterPatchNative'],'whole native subrect/untouched integer plane')
                clear_index=0
                for view in row['views']:
                    fence(view['fence']);need(view['callerState']['before']==view['callerState']['after'],'integer copy caller FBO/scissor restoration')
                    for p in view['planes']:
                        try:plane(fmt,expected[p['original']],p['native'],'complete private integer range')
                        except ValueError:
                            if not fault:raise
                            refuted=True;citations.append(dict(file=path.relative_to(directory).as_posix(),run=index,point='views/planes/native'));break
                    if refuted:break
                    if 'refresh' in view:
                        clear=row['clears'][clear_index];clear_index+=1;values=[-3,7,-11,1] if f['signed'] else [17,31,63,1];need(clear['values']==values,'literal original typed clear values');fence(clear['fence']);need(blob(clear['backingBefore'])==backing,'GPU-only clear leaves complete original SG unchanged');expected[clear['level']]=cleared(fmt,planes[clear['level']],values);fence(view['refresh']['fence'])
                        for p in view['refresh']['planes']:plane(fmt,expected[p['original']],p['native'],'GPU-only original integer clear and adjacent range levels')
                if fault:continue
                need(not any(r['label']=='original-integer-range-copy' for r in row['readbacks']),'native range GPU copies have no CPU download')
                upload_index=0
                for upload in row['uploads']:
                    if upload['label'].startswith('original-integer-upload-'):
                        level=int(upload['label'].rsplit('-',1)[1]);need(blob(upload['bytes'])==native_upload(fmt,planes[level]['input']),'complete actual native integer upload representation');need(upload['args'][6]==report['nativeEnums'][f['plannedUploadFormat']] and upload['args'][7]==report['nativeEnums'][f['plannedUploadType']],'actual native integer upload format/type');upload_index+=1
                need(upload_index==len(planes),'every original mip reaches native upload')
                final=bytearray(backing);staged=bytearray([0x2e]*len(backing));need(blob(row['stagingBacking'])==staged,'original staged SG input')
                for p,transfer in zip(planes,row['transfers']):
                    raw=expected[p['level']];need(blob(transfer['sync'])==raw,'complete exact public integer sync bytes');public+=len(raw)
                    for read in transfer['reads']:fence(read['fence']);need(blob(read['nativeBytes'])==raw,'complete exact public integer PBO bytes');public+=len(raw)
                    count=p['width']*f['guestPixelBytes']
                    for y in range(p['height']):at=p['offset']+y*p['stride'];final[at:at+count]=raw[y*count:(y+1)*count];staged[at:at+count]=raw[y*count:(y+1)*count]
                need(blob(row['finalBacking'])==final and blob(row['finalStagingBacking'])==staged,'every original/output SG byte including untouched padding');padding+=2*(len(backing)-sum(len(p['input']) for p in planes))
            elif kind=='generation-context-held-range':
                planes,backing=prepare(fmt,m['width'],m['height'],m['lastLevel'],report['seed']^fmt);need(blob(row['backing'])==backing,'original held-range SG');fence(row['uploadFence']);fence(row['copyFence']);fence(row['discarded']['fence']);need(row['sourceGeneration']==row['privateGeneration'] and row['replacementGeneration']!=row['sourceGeneration'] and row['replacementTexture']!=row['sourceTexture'] and row['privateTexture']!=row['sourceTexture'],'actual source/private/replacement generation identities')
                for p in row['heldPlanes']:plane(fmt,planes[p['original']]['input'],p['native'],'old native integer range survives source/context reuse')
            elif kind=='queued-complete':fence(row['fence']);need(blob(row['output'])==blob(row['input']),'queued old integer source exact words');public+=len(blob(row['output']))
            if 'final' in row:need(all(v==0 for v in row['final']['budgets'].values()) and all(o['deleted']==1 for o in row['nativeObjects']),'exact once native object retirement and all terminal budgets')
        if fault:need(refuted and report['sabotage']['fenceCompleted'] and not report['sabotage']['held'],'real native wrong words fail independent full-plane inverse after fence');faults.append(dict(name=path.parent.name,status='refuted',fenceCompleted=True))
    result=dict(schema='original-integer-image-independent-values-v1',status='passed',runs=runs,nativeComponents=native,publicBytes=public,untouchedPaddingBytes=padding,faults=faults,citations=citations,oracleImportsProductCode=False)
    (directory/'independent-values.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__':main(sys.argv[1])
