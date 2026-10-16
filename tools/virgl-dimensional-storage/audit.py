#!/usr/bin/env python3
"""Independent literal RGBA8, public span, native layer and lifetime audit."""
import hashlib
import json
from pathlib import Path
import struct
import sys
repo=Path(__file__).resolve().parents[2];root=Path(sys.argv[1]).resolve()
sha=lambda b:hashlib.sha256(b).hexdigest()
report=json.loads((root/'hardware/report.json').read_bytes());r=report['browserResult']['result'];calls=r['nativeCalls']
assert report['status']==r['status']=='passed' and not report['trackedChanges']
assert report['browserErrors']==dict(console=[],page=[],requests=[])
assert 'Metal' in json.dumps(report['browser']['gpu'])
assert not report['productionAuthority'] and not report['actualLinuxGuest'] and not r['productionAuthority']
assert len(report['seeds'])==len(set(report['seeds']))==3
for pin in report['sources']:
    raw=(root/'hardware/source'/pin['path']).read_bytes();assert len(raw)==pin['bytes'] and sha(raw)==pin['sha256']
    assert raw==(repo/pin['path']).read_bytes()
for pin in report['servedFiles']:
    if pin['path']=='/':continue
    raw=(root/'hardware/source'/pin['path'].lstrip('/')).read_bytes();assert len(raw)==pin['bytes'] and sha(raw)==pin['sha256']
def bytes_(s):return bytes.fromhex(s)
def packet(s):
    raw=bytes_(s);assert len(raw)%4==0;w=list(struct.unpack('<'+'I'*(len(raw)//4),raw));assert w[0]>>16==len(w)-1;assert w[0]&0xff in [9,43,45];return w
def layout(dims,box,offset,stride,layer):
    row=box['width']*4;stride=stride or dims[0]*4;layer=layer or stride*dims[1]
    return dict(offset=offset,rowBytes=row,rowStride=stride,layerStride=layer,
                footprintBytes=(box['depth']-1)*layer+(box['height']-1)*stride+row,
                requiredEnd=offset+(box['depth']-1)*layer+(box['height']-1)*stride+row,
                tightBytes=row*box['height']*box['depth'])
def extract(raw,box,l):
    return b''.join(raw[l['offset']+z*l['layerStride']+y*l['rowStride']:l['offset']+z*l['layerStride']+y*l['rowStride']+l['rowBytes']]
                    for z in range(box['depth']) for y in range(box['height']))
def scatter(tight,box,l,original):
    out=bytearray(original)
    for z in range(box['depth']):
        for y in range(box['height']):
            a=l['offset']+z*l['layerStride']+y*l['rowStride'];b=(z*box['height']+y)*l['rowBytes'];out[a:a+l['rowBytes']]=tight[b:b+l['rowBytes']]
    return bytes(out)
def pattern(seed,tag,level,dims):
    return bytes((seed+tag*43+level*29+z*31+y*17+x*13+lane*53)&255 for z in range(dims[2]) for y in range(dims[1]) for x in range(dims[0]) for lane in range(4))
def patch(original,dims,box,tight):
    out=bytearray(original)
    for z in range(box['depth']):
        for y in range(box['height']):
            for x in range(box['width']):
                a=(((z+box['z'])*dims[1]+y+box['y'])*dims[0]+x+box['x'])*4;b=((z*box['height']+y)*box['width']+x)*4;out[a:a+4]=tight[b:b+4]
    return bytes(out)
def box(w):return dict(zip(['x','y','z','width','height','depth'],w[6:12]))
literal={3:[[5,3,7],[2,1,3],[1,1,1]],4:[[5,5,6],[2,2,6],[1,1,6]],7:[[5,3,7],[2,1,7],[1,1,7]]}
targets={3:32879,4:34067,7:35866};planes=[];pixels=0
assert {(v['seed'],v['metadata']['target']) for v in r['runs']}=={(s,t) for s in report['seeds'] for t in literal}
for run in r['runs']:
    m=run['metadata'];t=m['target'];tag=[3,4,7].index(t);seed=run['seed'];assert run['literalLevels']==literal[t]
    assert m['format']==67 and m['bind']==10 and m['lastLevel']==2 and m['flags']==m['nrSamples']==0
    cost=sum(w*h*d*4 for w,h,d in literal[t]);assert run['cost']==cost
    assert run['nativeStorage']['target']==targets[t]
    native_id=run['nativeStorage']['texture']['object'];bound=None;allocations=[]
    for c in calls[run['nativeCallsStart']:run['nativeCallsEnd']]:
        a=c['before']
        if c['name']=='bindTexture':bound=a[1]['object'] if isinstance(a[1],dict) else None
        if c['name'] in ['texStorage2D','texStorage3D'] and bound==native_id:allocations.append(c)
    assert len(allocations)==1
    a=allocations[0]['before'];assert a[:5]==[targets[t],3,32856,5,5 if t==4 else 3]
    if t!=4:assert a[5]==7
    expected_by_level={};previous=run['nativeCallsStart']
    for o in run['observations']:
        native=calls[previous:o['nativeCallsEnd']];previous=o['nativeCallsEnd'];kind=o.get('kind')
        if kind=='revocation':
            assert o['after']['budgets']['tickets']==o['after']['budgets']['scratchBytes']==0;continue
        level=o['level'];dims=literal[t][level];assert o['dimensions']==dims
        if kind in ['upload','inline','copy','async-upload']:
            w=packet(o['wire']);assert w[1:4]==[m['id'],level,0];b=box(w);l=layout(dims,b,0 if kind=='inline' else w[13] if kind=='copy' else w[12],w[4],w[5])
            assert all(o['layout'][k]==v for k,v in l.items()) if kind!='copy' else o['literalLayout']==l
            small=[b['width'],b['height'],b['depth']]
            if kind=='upload':tight=pattern(seed,tag,level,dims);assert extract(bytes_(o['source']),b,l)==tight;expected=tight
            else:
                mask,extra={'inline':(0x5973,7),'copy':(0x31c7,11),'async-upload':(0x7549,19)}[kind];tight=pattern(seed^mask,tag+extra,level,small)
                assert bytes_(o['tight'])==tight
                if kind=='inline':assert extract(bytes_(o['source']),b,l)==tight and bytes_(o['wire'])[48:48+len(bytes_(o['source']))]==bytes_(o['source'])
                if kind=='copy':
                    assert w[12]==200+tag and w[14]==1 and extract(bytes_(o['source']),b,l)==tight
                    inv=packet(o['inverseWire']);assert inv[:14]==w[:14] and inv[14]==3
                    assert bytes_(o['actualBacking'])==scatter(tight,b,l,bytes_(o['sentinel']))
                expected=patch(expected_by_level[level],dims,b,tight)
            assert bytes_(o['expected'])==expected;expected_by_level[level]=expected
            uploads=[c for c in native if c['name']==('texSubImage2D' if t==4 else 'texSubImage3D')]
            assert len(uploads)==(b['depth'] if t==4 else 1)
            for z,c in enumerate(uploads):
                a=c['before']
                if t==4:
                    assert a[:8]==[34069+b['z']+z,level,b['x'],b['y'],b['width'],b['height'],6408,5121]
                    assert bytes_(a[8]['bytes'])==tight[z*b['height']*b['width']*4:(z+1)*b['height']*b['width']*4]
                else:
                    assert a[:10]==[targets[t],level,b['x'],b['y'],b['z'],b['width'],b['height'],b['depth'],6408,5121]
                    assert bytes_(a[10]['bytes'])==tight
        elif kind=='gpu-only':
            colors=[[(19+z*13)&255,(47+level*23)&255,(91+tag*17)&255,255] for z in range(dims[2])]
            assert o['colors']==colors;expected=b''.join(bytes(color)*(dims[0]*dims[1]) for color in colors);assert bytes_(o['expected'])==expected;expected_by_level[level]=expected
            clears=[c for c in native if c['name']=='clearBufferfv'];assert len(clears)==dims[2]
            for c,color in zip(clears,colors):
                values=struct.unpack('<4f',bytes_(c['before'][2]['bytes']));assert all(abs(v-e/255)<1e-7 for v,e in zip(values,color))
        else:
            w=packet(o['wire']);b=box(w);l=layout(dims,b,w[12],w[4],w[5]);assert w[13]==2 and o['literalLayout']==l
            assert bytes_(o['actual'])==bytes_(o['expected'])==expected_by_level[level]
            assert bytes_(o['backing'])==scatter(expected_by_level[level],b,l,bytes_(o['sentinel']))
            reads=[c for c in native if c['name']=='readPixels'];assert len(reads)==dims[2]*2
            attachments=[c for c in native if c['name']==('framebufferTexture2D' if t==4 else 'framebufferTextureLayer') and c['before'][3 if t==4 else 2]==run['nativeStorage']['texture']]
            assert len(attachments)==dims[2]*2
            for i,c in enumerate(attachments):
                a=c['before'];z=i%dims[2]
                assert (a[2],a[4])==(34069+z,level) if t==4 else (a[3],a[4])==(level,z)
            for z,c in enumerate(reads):
                assert c['before'][:6]==[0,0,dims[0],dims[1],6408,5121]
                if z<dims[2]:assert bytes_(c['after'][6]['bytes'])==expected_by_level[level][z*dims[0]*dims[1]*4:(z+1)*dims[0]*dims[1]*4]
                else:assert c['before'][6]==(z-dims[2])*dims[0]*dims[1]*4
            names=[c['name'] for c in native];assert names.index('fenceSync')<names.index('flush')<names.index('clientWaitSync')<names.index('getBufferSubData')<names.index('deleteSync')<names.index('deleteBuffer')
            assert o['polls']>=1 and o['turns']>=o['polls'];pixels+=len(expected_by_level[level])//4
            planes.append(dict(seed=seed,target=t,level=level,label=o['label'],bytes=len(expected_by_level[level]),sha256=sha(expected_by_level[level]),nativeCallsEnd=o['nativeCallsEnd']))
    assert bytes_(run['retained'])==expected_by_level[0]
    assert run['actualGuards']==run['initialGuards'] and all(set(bytes_(v))=={0xa3} for v in run['actualGuards'])
    for k in ['resources','contexts','backingBytes','gpuBytes','scratchBytes','tickets','leases']:assert run['final']['budgets'][k]==0
assert len(planes)==135
live=set()
for i,c in enumerate(calls):
    assert c['sequence']==i
    if (c['name'].startswith('create') or c['name']=='fenceSync') and c['result'] is not None:
        id_=c['result']['object'];assert id_ not in live;live.add(id_)
    if c['name'].startswith('delete') and c['before'][0] is not None:
        id_=c['before'][0]['object'];assert id_ in live;live.remove(id_)
assert not live
assert len(r['faults'])==15
for t in literal:
    f=[v for v in r['faults'] if v.get('metadata',v.get('input',{}))['target']==t]
    assert {v['phase'] for v in f}=={'allocate','upload','sync-read','pbo-read','pending-dispose'}
    for v in f:
        if v['phase']!='pending-dispose':assert not v['result']['ok'] and v['result']['error']['code']=='backend-error'
        assert v['after']['budgets']['scratchBytes']==v['after']['budgets']['tickets']==0
fault=json.loads((root/'fault-cube-layer/report.json').read_bytes());p=fault['browserResult']['point'];partial=fault['browserResult']['partial']
assert fault['status']==fault['browserResult']['status']=='failed' and fault['sabotage']['kind']=='cube-async-layer'
assert fault['browserErrors']==dict(console=[],page=[],requests=[])
assert p['metadata']['target']==4 and p['level']==0 and p['label']=='full initial inverse'
assert bytes_(p['expected'])!=bytes_(p['actual']) and len(bytes_(p['expected']))==len(bytes_(p['actual']))==600
fc=partial['nativeCalls'][:p['nativeCallsEnd']];names=[v['name'] for v in fc]
assert names.index('fenceSync')<max(i for i,n in enumerate(names) if n=='getBufferSubData')
assert any(v['name']=='clientWaitSync' and v['result'] in [37146,37148] for v in fc)
assert sha((root/'fault-cube-layer/mutant-resource-source.mjs').read_bytes())==fault['sabotage']['servedSha256']
default=json.loads((root/'default-demo/report.json').read_bytes());assert default['status']=='passed' and (default['passed'],default['failed'])==(127,0) and default['errors']==[] and default['proofExportAbsent']
out=dict(schema='dimensional-storage-independent-audit-v1',status='passed',seeds=report['seeds'],shapes=9,mipLevels=27,fullInversePlanes=planes,
         physicalPixels=pixels,nativeCalls=len(calls),boundaryCases=len(r['boundaries']),failureCases=len(r['faults']),terminalNativeObjects=0,
         sabotage=dict(target=4,level=0,expectedSha256=sha(bytes_(p['expected'])),observedSha256=sha(bytes_(p['actual'])),nativeCallsEnd=p['nativeCallsEnd']),
         productionAuthority=False,guestExecution=False)
(root/'integration-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({k:v for k,v in out.items() if k!='fullInversePlanes'}))
