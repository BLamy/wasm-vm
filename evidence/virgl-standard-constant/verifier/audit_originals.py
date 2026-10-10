"""Fresh D7 critic: literal wire, raw upload/GPU bytes and raster oracle; no runtime imports."""
import gzip, hashlib, json, math, re, struct
from pathlib import Path
BASE=Path(__file__).resolve().parent
sha=lambda raw:hashlib.sha256(raw).hexdigest()
f32=lambda n:struct.unpack('<f',struct.pack('<f',n))[0]
def need(ok,label):
    if not ok:raise AssertionError(label)
def packet_state(history):
    contexts={};s=None
    for record in history:
        s=contexts.setdefault(record['ctx'],{'elements':{},'shaders':{}})
        raw=bytes.fromhex(record['hex']);at=0
        while at<len(raw):
            h=struct.unpack_from('<I',raw,at)[0];op=h&255;kind=(h>>8)&255;n=h>>16
            need(at+4*(n+1)<=len(raw),'literal packet bound')
            w=struct.unpack_from('<'+'I'*n,raw,at+4)
            if (op,kind)==(1,5):s['elements'][w[0]]=[dict(zip(['source','divisor','slot','format'],w[x:x+4])) for x in range(1,n,4)]
            if (op,kind)==(2,5):s['active']=w[0]
            if op==6:s['buffers']=[dict(zip(['stride','offset','resource'],w[x:x+3])) for x in range(0,n,3)]
            if op==11:s['index']=dict(zip(['resource','size','offset'],w)) if n==3 else None
            if (op,kind)==(1,4):s['shaders'][w[1]]=raw[at+24:at+24+w[2]-1].decode()
            if op==8:s['draw']=dict(zip(['start','count','mode','indexed','instances'],w[:5]))
            at+=4*(n+1)
    return s

def audit_record(directory,fault=False):
    report=json.loads((directory/'report.json').read_text());r=report.get('partial') if fault else report['browserResult']['result'];blobs={b['key']:b for b in r['blobs']}
    def raw(ref):
        b=blobs[ref['key']];packed=(directory/b['path']).read_bytes();out=gzip.decompress(packed)
        need(sha(packed)==b['gzipSha256'] and sha(out)==b['sha256']==ref['sha256'] and len(out)==b['bytes'],'blob custody')
        return out
    rows=[]
    for fi,frame in enumerate(r['frames']):
        s=packet_state(frame['history']);d=s['draw'];effective=max(1,d['instances']);elems=s['elements'][s['active']]
        gpu={b['resourceId']:raw(b['blob']) for b in frame['native']['buffers']};buffers={id:bytearray(len(b)) for id,b in gpu.items()}
        for x in frame['inputs']:
            payload=raw(x['blob']);l=x['layout'];need(l['rowCount']==1 and len(payload)==l['rowBytes'],'input layout')
            buffers[x['resource']['id']][l['offset']:l['offset']+len(payload)]=payload
        need(all(bytes(buffers[i])==b for i,b in gpu.items()),'original uploads match actual retained GPU storage')
        ix=s.get('index');ids=[]
        for i in range(d['count']):
            if not d['indexed']:ids.append(d['start']+i)
            else:ids.append(struct.unpack_from('<'+{1:'B',2:'H',4:'I'}[ix['size']],buffers[ix['resource']],ix['offset']+i*ix['size'])[0])
        need(d['mode'] in [4,5] and ids[-1]&3==3 and ids[0]&3==0,'rectangle fixture geometry')
        draw=frame['history'][-1]['result']['draws'][-1];call=frame['native']['calls'][-1];need(frame['history'][-1]['result']['gpuComplete'],'real fence')
        need(draw['actualMinIndex']==min(ids) and draw['actualMaxIndex']==max(ids) and draw['vertexWork']==d['count']*effective,'native wide IDs/total-work')
        expectname=('drawElements' if d['indexed'] else 'drawArrays')+('Instanced' if effective>1 else '')
        args=[d['mode'],d['count'],{1:5121,2:5123,4:5125}[ix['size']],ix['offset']] if d['indexed'] else [d['mode'],d['start'],d['count']]
        if effective>1:args+=[effective]
        need((call['name'],call['args'])==(expectname,args),'real native draw arguments')
        fetches=[]
        for i in frame['used']:
            e=elems[i];b=s['buffers'][e['slot']];c=e['format']-27;offset=b['offset']+e['source'];first=0 if b['stride']==0 or e['divisor'] else min(ids);last=0 if b['stride']==0 else (effective-1)//e['divisor'] if e['divisor'] else max(ids)
            expected=dict(resourceId=b['resource'],stride=b['stride'],offset=offset,components=c,firstByte=offset+first*b['stride'],requiredEnd=offset+last*b['stride']+4*c,divisor=e['divisor'],nativeDivisor=0 if b['stride']==0 else min(e['divisor'],65536),firstElement=first,lastElement=last)
            observed=next(v for v in draw['vertexFetches'] if v['attributeIndex']==i);native=next(v for v in call['attributes'] if v['name']=='in_'+str(i))
            need(all(observed[k]==v for k,v in expected.items()),'independent complete fetch extent')
            need(native['enabled']==(b['stride']!=0) and native['divisor']==expected['nativeDivisor'],'native array/divisor query')
            if b['stride']==0:
                values=list(struct.unpack_from('<'+'f'*c,buffers[b['resource']],offset))+[0]*(4-c)
                if c<4:values[3]=1
                words=list(struct.unpack_from('<'+'I'*c,buffers[b['resource']],offset))
                need(observed['genericValues']==values and observed['componentWords']==words,'raw words and missing lanes')
                if not fault:need(native['genericValues']==values,'native generic')
                expected.update(values=values,words=words)
            else:need([native['stride'],native['offset'],native['components']]==[b['stride'],offset,c],'ordinary array preserved')
            fetches.append(expected)
        vertex=s['shaders'][0];fragment=s['shaders'][1]
        need('CONSTANT' in fragment and '0: MOV OUT[0], IN[0]' in fragment,'actual flat fragment source')
        need(all(t in vertex for t in ['AND TEMP[1].x, SV[1].xxxx, IMM[1].xxxx','USHR TEMP[1].x, SV[1].xxxx, IMM[1].yyyy','MOV OUT[1], TEMP[2]']),'actual native-ID TGSI geometry')
        c0=[f32(float(n)) for n in re.search(r'IMM\[0\] FLT32 \{([^}]+)\}',vertex)[1].split(',')]
        c2=[f32(float(n)) for n in re.search(r'IMM\[2\] FLT32 \{([^}]+)\}',vertex)[1].split(',')]
        need(c0==[f32(2/effective),-1.,2.,1.] and c2==[f32(.5/len(frame['used'])),.03125,.0009765625,0.],'bounded coefficients')
        def color(inst,id):
            accum=[0.,0.,0.,0.]
            for i in frame['used']:
                e=elems[i];b=s['buffers'][e['slot']];n=0 if b['stride']==0 else inst//e['divisor'] if e['divisor'] else id;c=e['format']-27
                vals=list(struct.unpack_from('<'+'f'*c,buffers[b['resource']],b['offset']+e['source']+n*b['stride']))+[0.]*(4-c)
                if c<4:vals[3]=1.
                accum=[f32(a+v) for a,v in zip(accum,vals)]
            out=[f32(a*c2[0]) for a in accum];out[1]=f32(f32((id&255)*c2[2])+out[1]);out[2]=f32(f32((inst&7)*c2[1])+out[2])
            return [math.floor(max(0,min(1,v))*255+.5) for v in out]
        pixels=raw(frame['pixels']);w=frame['width'];h=frame['height'];misses=[];maxerr=0
        for y in range(h):
            for x in range(w):
                inst=x//10;local=(x%10+.5)/10;diagonal=local+(y+.5)/h
                candidates=[color(inst,ids[2]),color(inst,ids[5] if d['mode']==4 else ids[3])] if abs(diagonal-1)<1e-6 else [color(inst,ids[2] if diagonal<1 else (ids[5] if d['mode']==4 else ids[3]))]
                observed=list(pixels[(y*w+x)*4:(y*w+x+1)*4]);err=min(max(abs(a-b) for a,b in zip(observed,p)) for p in candidates);maxerr=max(maxerr,err)
                if err>1 and len(misses)<8:misses.append(dict(x=x,y=y,observed=observed,expected=candidates,error=err))
        need(bool(misses)==fault,'independent physical pixels '+frame['label'])
        rows.append(dict(label=frame['label'],reportDigest=sha((directory/'report.json').read_bytes()),jsonPointer='/'+('partial' if fault else 'browserResult/result')+'/frames/'+str(fi),pixelDigest=frame['pixels']['sha256'],pixels=w*h,ids=ids,fetches=fetches,maxError=maxerr,misses=misses,held=not misses))
    if not fault:
        for run in r['runs']:
            need(run['inspection']['jobs']['reads']==run['inspection']['jobs']['stagingBytes']==0,'final ownership')
            live={};seen=set()
            for ei,event in enumerate(run['events']):
                if event['name']=='fenceSync':live[event['sync']]=event['turn']
                if event['name']=='clientWaitSync':
                    key=(event['sync'],event['turn']);need(key not in seen and event['sync'] in live and event['turn']>live[event['sync']] and event['actual'] in [37146,37147,37148],'one native zero-timeout poll per later task');seen.add(key)
                if event['name']=='deleteSync':need(event['sync'] in live,'known fence deletion');del live[event['sync']]
            need(not live,'all native fences deleted')
        for rejection in r['rejections']:
            outcome=rejection['record']['result'];copies=[e for e in rejection['events'] if e['name']=='copyBufferSubData']
            expected=1 if rejection['label']=='partial-ticket-allocation' else 0
            need(not outcome['ok'] and not outcome['draws'] and len(copies)==expected,'bounded negative before draw/real partial copy')
        for row in r['suspensions']:
            p=row['point'];result=row['record']['result'];need(p['inspection']['jobs']['reads']==5 and p['inspection']['jobs']['stagingBytes']==56 and row['async']['reads']==row['async']['stagingBytes']==0,'suspended full batch retained/drained')
            if row['action']=='collected-revision':need(len(p['collected'])==1 and result['error']['code']=='stale-storage' and not result['draws'] and result['gpuComplete'],'already collected revalidation')
            if row['action'] in ['reuse','cpu-backing']:need(result['ok'] and all(f['resourceGeneration']==row['oldGeneration'] for f in result['draws'][0]['vertexFetches']),'prior generation/CPU backing independent')
            else:need(not result['ok'] and not result['draws'] and result['gpuComplete']==(row['action']!='store-dispose'),'cancel versus explicit invalidation')
        inv=r['invalidations'][0];need(inv['before']['jobs']['reads']==5 and inv['after']['reads']==inv['after']['stagingBytes']==inv['nativeDraws']==0,'renderer disposal')
    return rows

out={'schema':'D7-independent-critic-original-audit-v1','status':'HELD','noRuntimeOrWorkerOracleImports':True,'originals':{}}
for side in ['hot','cold']:
    frames=audit_record(BASE/'unpacked'/side/'hardware');faults=audit_record(BASE/'unpacked'/side/'fault-generic',True)
    need(len(frames)==31 and sum(f['pixels'] for f in frames)==12500,'whole recording matrix')
    need(faults[0]['misses'][0]['observed']==[121,61,21,116] and faults[0]['misses'][0]['expected']==[[57,61,21,116]],'qualified original sabotage point')
    out['originals'][side]={'frames':frames,'fault':faults,'pixels':sum(f['pixels'] for f in frames)}
(BASE/'original-audit.json').write_text(json.dumps(out,indent=2)+'\n')
print('HELD: independent raw-wire/input/GPU/lane/native/fence audit of62 frames/25000 pixels; both completed real generic sabotages rejected')
