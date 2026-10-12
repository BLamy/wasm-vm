#!/usr/bin/env python3
"""Reopen whole bodies and derive the pixel oracle from original literal bytes."""
import gzip,hashlib,json,math,struct,sys
from pathlib import Path
root=Path(sys.argv[1]).resolve();self_validation=sys.argv[2:]==['--self-validation'];sha=lambda b:hashlib.sha256(b).hexdigest()
bits=lambda x:struct.unpack('<I',struct.pack('<f',x))[0]
float32=lambda x:struct.unpack('<f',struct.pack('<I',x))[0]
def extent(f,l):
    level=f['firstLevel']+l
    return max(1,f['width']//2**level),max(1,f['height']//2**level),max(1,f['depth']//2**level) if f['target']=='3D' else 6 if f['target']=='CUBE' else f['lastLayer']-f['firstLayer']+1
def wrap(i,n,mode):
    if mode==2:return max(0,min(n-1,i))
    if mode==0:return i%n
    j=i%(2*n);return j if j<n else 2*n-1-j
def literal(f):
    w,h,n=extent(f,0);t=f['target'];x=w//2 if t=='CUBE' else math.floor(.625*w);y=h//2 if t=='CUBE' else math.floor(.375*h)
    z=0 if t=='CUBE' else math.floor(.75*n) if t=='3D' else max(0,min(n-1,1))+f['firstLayer'];code=5*f['firstLevel']+3*z+7*x+11*y
    return [bits((code//2**k)%2) for k in range(4)]
def oracle(f,x,y,overrides):
    t=f['target'];op=f['opcode'];mask=f.get('mask','xyzw');sentinel=[0x12345678,0x80000001,0xdeadbeef,0xffffffff]
    if f.get('literalOracle'):
        a=literal(f);b=literal(f['extraViews'][0]['fixture']);return [a[k]^b[k] for k in range(4)]
    if op=='TXQ':
        w,h,n=extent(f,y);values=[w,h,0 if t in ['CUBE','2D'] else n,f['lastLevel']-f['firstLevel']+1]
    else:
        level=f.get('fixedLod',y) if op in ['TXL','TXF','TXD'] else f['lastLevel']-f['firstLevel'] if f.get('biasProbe') else 0
        if op!='TXF':level=max(0,min(f['lastLevel']-f['firstLevel'],max(f['minLod'],min(f['maxLod'],level))))
        if f.get('mipFilter')==2 and op!='TXF':level=0
        raw=bytes.fromhex(f['inputs'][1]);c=[0,0,0] if f.get('biasProbe') else list(struct.unpack_from('<4I' if op=='TXF' else '<4f',raw,(y*f['grid']['width']+x)*16))
        if f.get('biasProbe'):c=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]][f.get('face',0)] if t=='CUBE' else [.5,.5,.875 if t=='3D' else extent(f,0)[2]-1]
        source=f.get('sourceExpression') or ''
        if source.endswith('wzyx'):c.reverse()
        if source.startswith('|'):c=list(map(abs,c))
        if source.startswith('-|'):c=[-abs(v) for v in c]
        if op=='TXP':c=[v/c[3] if k<3 else v for k,v in enumerate(c)]
        def sample(local):
            w,h,n=extent(f,local);u,v,z=c[:3];layer=None
            if t=='CUBE':
                major=max(map(abs,c[:3]));axis=next(k for k in range(3) if abs(c[k])==major);layer=axis*2+int(c[axis]<0)
                a,b=((-c[2] if c[0]>0 else c[2]),-c[1]) if axis==0 else (c[0],c[2] if c[1]>0 else -c[2]) if axis==1 else (c[0] if c[2]>0 else -c[0],-c[1])
                u,v=(a/major+1)/2,(b/major+1)/2
            elif op=='TXF':layer=z
            elif t!='3D':layer=max(0,min(n-1,math.floor(z+.5)))
            def texel(xx,yy,zz):
                originalLayer=zz+(f['firstLayer'] if t=='2D_ARRAY' else 0);originalLevel=f['firstLevel']+local
                if (originalLevel,originalLayer) in overrides:return overrides[originalLevel,originalLayer]
                p=f['levels'][originalLevel];fmt=f['format'];size=2 if fmt==16 else 8 if fmt==126 else 4;at=((originalLayer*p['height']+yy)*p['width']+xx)*size;raw=bytes.fromhex(p['bytes']);word=int.from_bytes(raw[at:at+min(size,4)],'little')
                z=word/65535 if fmt==16 else (word>>8)/16777215 if fmt==20 else (word&0xffffff)/16777215 if fmt==21 else struct.unpack_from('<f',raw,at)[0]
                return [float32(bits(z)),0,0,1]
            if op=='TXF':return texel(c[0],c[1],layer)
            if not f.get('linear'):return texel(wrap(math.floor(u*w),w,f['wrap']),wrap(math.floor(v*h),h,f['wrap']),layer if layer is not None else wrap(math.floor(z*n),n,f['wrap']))
            a,b,d=u*w-.5,v*h-.5,z*n-.5;ix,iy,iz=map(math.floor,[a,b,d]);fx,fy,fz=a-ix,b-iy,d-iz;out=[0.,0.,0.,0.]
            for k in range(2 if layer is None else 1):
                for j in range(2):
                    for i in range(2):
                        vals=texel(wrap(ix+i,w,2 if t=='CUBE' else f['wrap']),wrap(iy+j,h,2 if t=='CUBE' else f['wrap']),layer if layer is not None else wrap(iz+k,n,f['wrap']))
                        weight=(fx if i else 1-fx)*(fy if j else 1-fy)*((fz if k else 1-fz) if layer is None else 1)
                        for lane in range(4):out[lane]+=vals[lane]*weight
            return out
        first=math.floor(level) if f.get('linear') else math.floor(level+.5);fraction=level-first if f.get('linear') else 0
        a=sample(first);b=sample(first+1) if fraction else a;vals=[a[k]*(1-fraction)+b[k]*fraction for k in range(4)]
        values=[bits(0 if k==4 else 1 if k==5 else vals[k]) for k in f['swizzle']]
    return [values[k] if 'xyzw'[k] in mask else sentinel[k] for k in range(4)]
results=[];failedPhysical=0
for directory in sorted(root.glob('*')):
    if not directory.is_dir() or not (directory/'report.json').is_file():continue
    report=json.loads((directory/'report.json').read_bytes())
    if report.get('task')!='E6-T11d60' or 'runs' not in report:continue
    negative=directory.name.startswith('fault-');assert report['status']==('failed' if negative else 'passed')
    assert self_validation or not report['trackedChanges'],'final hardware source must be frozen'
    for pin in report['sources']:
        raw=(directory/'source'/pin['path']).read_bytes();assert len(raw)==pin['bytes'] and sha(raw)==pin['sha256']
    for pin in report['servedFiles']:
        if pin['path']=='/':continue
        raw=(directory/'source'/pin['path'].lstrip('/')).read_bytes();assert len(raw)==pin['bytes'] and sha(raw)==pin['sha256']
    assert report['browserErrors']=={'console':[],'page':[],'requests':[]};counts=dict(runs=0,planes=0,words=0,sourceBytes=0)
    for pin in report['runs']:
        packed=(directory/pin['path']).read_bytes();assert len(packed)==pin['gzipBytes'] and sha(packed)==pin['gzipSha256'];body=gzip.decompress(packed)
        assert len(body)==pin['bytes'] and sha(body)==pin['sha256'];r=json.loads(body);f=r['fixture'];counts['runs']+=1
        assert r['cleaned']['liveObjects']==r['cleaned']['liveSyncs']==0
        for source in r['sourcePlanes']:
            raw=bytes.fromhex(source['input']);size=2 if f['format']==16 else 8 if f['format']==126 else 4
            assert len(raw)==source['width']*source['height']*source['layers']*size
            assert raw==bytes.fromhex(f['levels'][source['level']]['bytes'])
            wire=bytes.fromhex(source['record']['request']);control=int.from_bytes(wire[:4],'little');form=source['producer']
            assert control==(0x205 if form=='outer205' else 0x207)
            if form=='inline9':assert wire[32]==9
            else:
                if form=='staging45':assert wire[32]==45
                assert any(e['kind'] in ['input','layered-input'] and e['bytes']==source['input'] for e in r['exchanges'])
            counts['sourceBytes']+=len(raw)
        if not r.get('refusals') or r['fixture'].get('attack')!='budget':
            cost=r['costPrediction'];fmt=f['format'];charge=2 if fmt==16 else 16 if fmt==126 else 4
            source=sum(p['width']*p['height']*p['layers']*charge for p in f['levels'])
            base=source+f['grid']['width']*f['grid']['height']*16+sum(len(bytes.fromhex(b)) for b in f['inputs']);control=cost.get('twoDDepthSurfaceCost',0)
            if control:assert control==f['grid']['width']*f['grid']['height']*charge and r['twoDDepthControl']['metadata']['target']==2
            base+=control
            private=0 if f['firstLevel']==0 and f['lastLevel']==2 and f['firstLayer']==0 and f['lastLayer']==f['source']['arraySize']-1 else sum(math.prod(extent(f,l))*charge for l in range(f['lastLevel']-f['firstLevel']+1))
            predicted=dict(sourceCost=source,baseCost=base,privateCost=private,nativePixelBytes=charge)
            if control:predicted['twoDDepthSurfaceCost']=control
            assert cost==predicted
            assert r['afterView']['store']['budgets']['gpuBytes']==base+private
        assert all(v['usedIndex']==i+1 for i,v in enumerate(r['records']))
        syncs={}
        for event in r['physical']:
            name=event['name']
            if name=='fenceSync':assert event['sync'] not in syncs;syncs[event['sync']]={'native':False,'delivered':False}
            elif name=='clientWaitSync':
                s=syncs[event['sync']];s['native']|=event['actual'] in [37146,37148];s['delivered']|=event['delivered'] in [37146,37148]
            elif name=='getBufferSubData':assert syncs[event['sync']]['native'] and syncs[event['sync']]['delivered']
            elif name=='deleteSync':del syncs[event['object']]
        assert not syncs
        assert r['commandTrace'] and r['machineDigest']
        assert not any(v['name']=='finish' for v in r['nativeCalls'])
        assert len([v for v in r['nativeCalls'] if v['name'] in ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']])==len(r['drawStates'])
        for plane in r['planes']:
            overrides={(v['level'],v['layer']):v['value'] for v in r.get('gpuOnlyWrites',[])} if plane['label']=='GPU-only-source-refresh' else {}
            words=[w for y in range(f['grid']['height']) for x in range(f['grid']['width']) for w in oracle(f,x,y,overrides)];expected=struct.pack('<'+'I'*len(words),*words)
            assert bytes.fromhex(plane['expected'])==expected,(r['name'],plane['label'],'independent original oracle differs')
            raw=bytes.fromhex(plane['observed']);assert len(raw)==len(expected);observed=struct.unpack('<'+'I'*len(words),raw);miss=[]
            for i,(a,b) in enumerate(zip(observed,words)):
                lane=i%4;value=float32(b);filtered=f.get('linear') and f['opcode']!='TXQ' and 'xyzw'[lane] in f.get('mask','xyzw') and f['swizzle'][lane]<4 and 0<value<1
                if filtered:
                    assert math.isfinite(float32(a)) and abs(float32(a)-value)<=1/255
                elif f['opcode']!='TXQ' and 'xyzw'[lane] in f.get('mask','xyzw') and f['swizzle'][lane]==0 and f['format'] in [16,20,21]:
                    if not (a<=0x3f800000 and b<=0x3f800000 and abs(a-b)<=1):miss.append(dict(word=i,expected=b,actual=a))
                elif a!=b:miss.append(dict(word=i,expected=b,actual=a))
            if miss:
                assert negative and plane['label']=='physically-wrong-layer' and r['faults'];failedPhysical+=1
            else:assert not (negative and plane['label']=='physically-wrong-layer')
            whole=bytes.fromhex(plane['wholeBacking']);assert len(whole)==4096
            occupied=set();stride=f['grid']['width']*16+3
            for y in range(f['grid']['height']):
                at=5+y*stride;n=f['grid']['width']*16;occupied.update(range(at,at+n));assert whole[at:at+n]==raw[y*n:(y+1)*n]
            assert all(v==0xc7 for i,v in enumerate(whole) if i not in occupied)
            for guard in plane['guards']:assert guard['before']==guard['after']=='a3'*8
            assert any(e['kind']=='output' and e['bytes']==plane['observed'] for e in plane['exchanges'])
            assert int.from_bytes(bytes.fromhex(plane['record']['response'])[:4],'little')==0x1100
            assert int.from_bytes(bytes.fromhex(plane['read']['response'])[:4],'little')==0x1100
            assert plane['native']['sequence']<max(v['sequence'] for v in r['nativeCalls'] if v['name']=='getBufferSubData')
            counts['planes']+=1;counts['words']+=len(words)
    if report['browserResult'].get('result',{}).get('ownerAttacks'):
        for row in report['browserResult']['result']['ownerAttacks']:assert row['status']=='passed' and row['caller']['scissor'] and len(row['refusals'])==7
    results.append(dict(record=directory.name,reportSha256=sha((directory/'report.json').read_bytes()),**counts))
privateResults=[]
for directory in sorted(root.glob('private-*')):
    r=json.loads((directory/'report.json').read_bytes());assert r['status']=='passed' and (self_validation or not r['trackedChanges']);assert r['browserErrors']==dict(console=[],page=[],requests=[])
    result=r['browserResult']['result'];assert result['summary']['liveObjects']==0 and result['summary']['cases']==result['summary']['boundaryCases']==10
    for pin in r['sources']:
        raw=(directory/'source'/pin['path']).read_bytes();assert len(raw)==pin['bytes'] and sha(raw)==pin['sha256']
    for row in result['result']['rows']:
        meta=row['metadata'];fmt=meta['format'];size=2 if fmt==16 else 8 if fmt==126 else 4;charge=2 if fmt==16 else 16 if fmt==126 else 4
        base=180 if meta['target']==4 else 294;private=30 if meta['target']==4 else 21
        assert row['prediction']==dict(completePixels=base,privatePixels=private,publicBytes=base*size,nativeBytes=base*charge,privatePublicBytes=private*size,privateNativeBytes=private*charge)
        assert row['final']['budgets']['gpuBytes']==0
        for plane in row['views'][0]['inverse']:
            actual=bytes.fromhex(plane['observed']);expected=bytes.fromhex(plane['expected']);assert len(actual)==len(expected)
            for at in range(0,len(expected),size):
                e=int.from_bytes(expected[at:at+min(size,4)],'little');a=int.from_bytes(actual[at:at+min(size,4)],'little')
                if fmt in [16,20]:assert a==e
                elif fmt==21:assert a==e&0xffffff
                else:
                    exponent=e>>23&255
                    if exponent!=255:
                        value=struct.unpack_from('<f',expected,at)[0];choices=[0,0x80000000] if (e&0x7fffffff)==0 or e>>31 else [e,0,0x80000000] if exponent==0 else [0x3f800000 if value>1 else e];assert a in choices
                    if fmt==126:assert actual[at+4:at+8]==bytes([expected[at+4],0,0,0])
    for row in result['boundaries']['rows']:
        assert len(row['budgetCases'])==3 and row['budgetCases'][0]['callsBefore']==row['budgetCases'][0]['callsAfter']
        assert all(not x['result']['ok'] and x['fault']['hits']==1 for x in row['faults'])
        assert all(not x['result']['ok'] and x['at']==x['after'] for x in row['ranges'])
        assert all(not x['result']['ok'] for x in row['historical'])
    privateResults.append(dict(record=directory.name,reportSha256=sha((directory/'report.json').read_bytes()),summary=result['summary']))
assert results and failedPhysical==1
(root/'physical-audit.json').write_text(json.dumps(dict(schema='dimensional-depth-view-independent-whole-body-v1',status='passed',results=results,privateResults=privateResults,completedPhysicalRefutations=failedPhysical),indent=2)+'\n')
print(json.dumps(dict(status='passed',records=len(results),completedPhysicalRefutations=failedPhysical,planes=sum(r['planes'] for r in results))))
