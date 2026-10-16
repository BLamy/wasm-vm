#!/usr/bin/env python3
"""Independent original wire, guest byte, physical GPU and lifetime predictions."""
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
assert not report['productionAuthority'] and not report['actualLinuxGuest'] and not r['actualLinuxGuest'] and not r['productionNegotiation']
assert 'Metal' in r['gpu'] and len(report['seeds'])==len(set(report['seeds']))==3
for pin in report['sources']:
    raw=(root/'hardware/source'/pin['path']).read_bytes();assert len(raw)==pin['bytes'] and sha(raw)==pin['sha256'] and raw==(repo/pin['path']).read_bytes()
for pin in report['servedFiles']:
    if pin['path']=='/':continue
    raw=(root/'hardware/source'/pin['path'].lstrip('/')).read_bytes();assert len(raw)==pin['bytes'] and sha(raw)==pin['sha256']
def b(value):return bytes.fromhex(value)
def words(value):
    raw=b(value);assert len(raw)%4==0;return list(struct.unpack('<'+'I'*(len(raw)//4),raw))
def pattern(seed,target,level,dims):return bytes((seed+target*43+level*29+z*31+y*17+x*13+c*53)&255 for z in range(dims[2]) for y in range(dims[1]) for x in range(dims[0]) for c in range(4))
def rows(tight,box,layout,pad):
    result=bytearray(pad)
    for z in range(box[2]):
        for y in range(box[1]):
            at=layout['offset']+z*layout['layerStride']+y*layout['rowStride'];start=(z*box[1]+y)*box[0]*4
            result[at:at+box[0]*4]=tight[start:start+box[0]*4]
    return bytes(result)
def patch(full,dims,box,tight):
    result=bytearray(full)
    for z in range(box['depth']):
        for y in range(box['height']):
            start=(((box['z']+z)*dims[1]+box['y']+y)*dims[0]+box['x'])*4;src=(z*box['height']+y)*box['width']*4
            result[start:start+box['width']*4]=tight[src:src+box['width']*4]
    return bytes(result)
def record(row):
    for key in ['transport','submit']:assert sha(b(row[key+'Canonical']))==row[key+'Digest']
    w=words(row['request']);response=words(row['response']);assert len(response)==6 and response[4:6]==w[4:6]
    assert response[1]==w[1]&1 and response[2:4]==(w[2:4] if w[1]&1 else [0,0])
    assert response[0] in [0x1100,0x1200,0x1201,0x1205]
    ring=b(row['ring']['used']);index=struct.unpack_from('<H',ring,2)[0];assert index>=row['usedIndex']
    at=4+((row['usedIndex']-1)%256)*8;head,length=struct.unpack_from('<II',ring,at);assert length==24
    assert head==((row['usedIndex']-1)%128)*2
literal={3:[[5,3,7],[2,1,3],[1,1,1]],4:[[5,5,6],[2,2,6],[1,1,6]],7:[[5,3,7],[2,1,7],[1,1,7]]};costs={3:448,4:720,7:504}
assert {(v['seed'],v['metadata']['target']) for v in r['runs']}=={(seed,t) for seed in report['seeds'] for t in literal}
planes=[];records=0
for run in r['runs']:
    t=run['metadata']['target'];seed=run['seed'];assert run['shape']['levels']==literal[t]
    for state in run['states']:
        assert state['native']['gpuBytes']==state['native']['logicalBytes']==state['host']['store']['budgets']['gpuBytes']==costs[t]
        assert state['prediction']['cost']==costs[t]
    assert len(run['levels'])==3
    for o in run['levels']:
        level=o['level'];dims=literal[t][level];assert o['extent']==dims
        tight=pattern(seed,t,level,dims);assert b(o['input'])==tight
        padded=level%2==0;stride=dims[0]*4+(7 if padded else 0);layer=stride*dims[1]+(11 if padded else 0)
        l=o['layout'];assert l['offset']==5 and l['rowBytes']==dims[0]*4 and l['rowStride']==stride and l['layerStride']==layer and l['tightBytes']==len(tight)
        assert b(o['source'])==rows(tight,dims,l,bytes([0x8d])*4096)
        up=words(o['upload']['record']['request']);assert up[0]==0x205 and up[6:12]==[0,0,0,*dims] and up[12:14]==[5,0] and up[14:18]==[6,level,stride if padded else 0,layer if padded else 0]
        down=words(o['readback']['record']['request']);inner=down[8:];assert down[0]==0x207 and inner[0]&255==43 and inner[0]>>16==13
        assert inner[1:6]==[6,level,0,stride if padded else 0,layer if padded else 0] and inner[6:12]==[0,0,0,*dims] and inner[12:]==[5,2]
        for entry,kind in [(o['upload'],'layered-input'),(o['readback'],'layered-output')]:
            assert len(entry['exchanges'])==1;exchange=entry['exchanges'][0];assert exchange['kind']==kind and b(exchange['bytes'])==tight
            a=exchange['args'];assert len(a)==12 and a[3]==6 and int(a[6],16)==5 and a[7:]==[dims[0]*4,stride,dims[1],layer,dims[2]]
            accepted=entry['owner'];assert accepted['resources'][0]['metadata']==run['metadata'];assert accepted['epoch']==a[0] and accepted['sequence']==a[1]
        assert b(o['fullBacking'])==rows(tight,dims,l,bytes([0xc7])*4096)
        assert all(v['prefix']==v['suffix']=='a3'*8 for v in o['guards']);planes.append(dict(seed=seed,target=t,level=level,bytes=len(tight),sha256=sha(tight)))
    dims=literal[t][0];p=run['partial'][0];box=p['box'];assert box==dict(x=1,y=1,z=dims[2]-2,width=2,height=2,depth=2)
    first=pattern(seed,t,19,[2,2,2]);second=pattern(seed,t,23,[2,2,2]);expected=patch(patch(pattern(seed,t,0,dims),dims,box,first),dims,box,second)
    assert b(p['expectedFullPlane'])==expected and b(p['full']['exchanges'][0]['bytes'])==expected
    assert not p['inlined']['exchanges'] and words(p['inlined']['record']['request'])[8]&255==9
    assert b(p['staged']['exchanges'][0]['bytes'])==b(p['reverse']['exchanges'][0]['bytes'])==second
    assert p['staged']['exchanges'][0]['args'][3]==p['reverse']['exchanges'][0]['args'][3]==200
    change=run['lifecycle']['exchanges'];new=pattern(seed,t,31,dims)
    assert len(change)==3 and b(change[0]['bytes'])==expected and b(change[1]['bytes'])==b(change[2]['bytes'])==new and change[0]['args'][5]!=change[1]['args'][5]
    assert run['snapshot']['liveSyncs']==0
    for row in run['records']:record(row);records+=1
for row in r['boundaries']['records']:record(row);records+=1
f=r['failure'];record(f['record']);assert f['before']==f['after'] and f['native']['poisoned'] and f['host']['poisoned'];assert f['completions'][-1]['args'][3:5]==[6,False]
assert any(e['name']=='clientWaitSync' and e['delivered']==37149 for e in f['physical'])
# Trace custody, native original DMA byte bodies and canonical state digests.
text=(root/'native-submit.stderr').read_text();native_points=0
for line in text.splitlines():
    if line.startswith('SUBMIT3D_PORTABLE_RECORD '):
        row=json.loads(line.removeprefix('SUBMIT3D_PORTABLE_RECORD '));native_points+=1
        for key in ['transport','submit']:assert sha(b(row[key+'Canonical']))==row[key+'Digest']
assert native_points>100 and text.count('NATIVE_DIMENSIONAL_DMA_POINT ')==27 and text.count('SUBMIT3D_GUEST_TRACE ')>100
unit=(root/'native-gpu.stderr').read_text();assert unit.count('NATIVE_DIMENSIONAL_MIP_SPANS ')==9 and 'result=Err(OutOfMemory) publishedSpans=0' in unit
live=set();fences=0;collections=0
for i,call in enumerate(calls):
    assert call['sequence']==i and call['name']!='finish'
    if (call['name'].startswith('create') or call['name']=='fenceSync') and call['result'] is not None:
        obj=call['result']['object'];assert obj not in live;live.add(obj)
    if call['name'].startswith('delete') and call['before'][0] is not None:
        obj=call['before'][0]['object'];assert obj in live;live.remove(obj)
    if call['name']=='fenceSync':fences+=1
    if call['name']=='getBufferSubData':collections+=1
assert not live and fences>50 and collections>30
fault=json.loads((root/'fault-cube-layer/report.json').read_bytes());partial=fault['browserResult']['point'];assert fault['status']==fault['browserResult']['status']=='failed' and fault['sabotage']['kind']=='cube-async-layer'
assert fault['browserErrors']==dict(console=[],page=[],requests=[])
assert partial['native']['resources'][0]['metadata']['target']==4
exchange=partial['exchanges'][-1];expected=pattern(report['seeds'][0],4,0,literal[4][0]);assert exchange['kind']=='layered-output' and len(b(exchange['bytes']))==600 and b(exchange['bytes'])!=expected
assert sha((root/'fault-cube-layer/mutant-resource-source.mjs').read_bytes())==fault['sabotage']['servedSha256']
assert any(v['name']=='getBufferSubData' for v in fault['browserResult']['partial']['nativeCalls'])
default=json.loads((root/'default-demo/report.json').read_bytes());assert default['status']=='passed' and (default['passed'],default['failed'])==(127,0) and default['errors']==[] and default['proofExportAbsent']
coverage=json.loads((root/'coverage-audit.json').read_bytes());held=json.loads((root/'held-dimensional-receipt.json').read_bytes())
for region in coverage['carriedRegions']:assert held['sources'][region['source']]['sha256']==region['baseSourceSha256']
out=dict(schema='native-dimensional-independent-audit-v1',status='passed',originalMipPlanes=planes,originalQueueRecords=records,nativeCanonicalPoints=native_points,nativeCalls=len(calls),physicalFences=fences,physicalCollections=collections,terminalNativeObjects=0,sabotage=dict(target=4,bytes=600,expectedSha256=sha(expected),observedSha256=sha(b(exchange['bytes']))),productionAuthority=False,actualLinuxGuest=False)
(root/'integration-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({k:v for k,v in out.items() if k!='originalMipPlanes'}))
