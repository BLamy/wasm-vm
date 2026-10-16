#!/usr/bin/env python3
"""Reopen original fields, physical selection, completed DMA and source custody."""
import gzip,hashlib,json,math,struct,sys
from pathlib import Path
root=Path(sys.argv[1]).resolve();sha=lambda b:hashlib.sha256(b).hexdigest()
def load(p):return json.loads(p.read_bytes())
def public(fmt,expected,actual):
    size=2 if fmt==16 else 8 if fmt==126 else 4;assert len(actual)==len(expected)
    for at in range(0,len(expected),size):
        e=int.from_bytes(expected[at:at+min(size,4)],'little');a=int.from_bytes(actual[at:at+min(size,4)],'little')
        if fmt==16:assert a==e
        elif fmt==20:assert a==e
        elif fmt==21:assert a==e&0xffffff
        else:
            exponent=e>>23&255
            if exponent!=255:
                value=struct.unpack('<f',expected[at:at+4])[0]
                choices=[0,0x80000000] if (e&0x7fffffff)==0 or e>>31 else [e,0,0x80000000] if exponent==0 else [0x3f800000 if value>1 else e]
                assert a in choices,(fmt,at,e,a,choices)
            if fmt==126:assert actual[at+4:at+8]==bytes([expected[at+4],0,0,0])
def backing(fmt,expected,actual,original,box,layout):
    covered=set();tight=bytearray()
    for z in range(box['depth']):
        for y in range(box['height']):
            start=layout['offset']+z*layout['layerStride']+y*layout['rowStride'];end=start+layout['rowBytes'];covered.update(range(start,end));tight.extend(actual[start:end])
    assert len(actual)==len(original)
    assert all(actual[i]==original[i] for i in range(len(actual)) if i not in covered)
    public(fmt,expected,bytes(tight))
assert len(sys.argv)==2 or sys.argv[2:] == ['--self-validation']
hardware=root/'hardware';receipt=load(hardware/'report.json');assert receipt['status']=='passed';assert not receipt['trackedChanges'] or sys.argv[2:]==['--self-validation'];assert receipt['browserErrors']==dict(console=[],page=[],requests=[])
report=receipt['browserResult']['result'];assert report['status']=='passed' and report['seeds']==[27449,84131,176129]
assert len(report['runs'])==42 and len(report['direct']['rows'])==15 and len(report['failedFences'])==30
assert len(receipt['runs'])==42
recorded_rows=[];next_native=0
for pin,row in zip(receipt['runs'],report['runs']):
    packed=(hardware/pin['path']).read_bytes();assert len(packed)==pin['gzipBytes'] and sha(packed)==pin['gzipSha256'];raw=gzip.decompress(packed);assert len(raw)==pin['bytes'] and sha(raw)==pin['sha256'];saved=json.loads(raw)
    assert row['recording']==pin and row['metadata']==saved['metadata'] and row['seed']==saved['seed'] and row['exceptional']==saved['exceptional']
    assert row['nativeCallCount']==len(saved['nativeCalls']) and row['nativeBaseSequence']==saved['nativeBaseSequence']==next_native
    next_native+=len(saved['nativeCalls']);recorded_rows.append(saved)
assert report['nativeBaseSequence']==next_native and report['summary']['nativeCalls']==next_native+len(report['nativeCalls'])
for pin in receipt['sources']:
    raw=(hardware/'source'/pin['path']).read_bytes();assert len(raw)==pin['bytes'] and sha(raw)==pin['sha256']
for pin in receipt['servedFiles']:
    if pin['path']=='/':continue
    raw=(hardware/'source'/pin['path'].lstrip('/')).read_bytes();assert len(raw)==pin['bytes'] and sha(raw)==pin['sha256']
calls=report['nativeCalls'];observations=pixels=0;internal={16:33189,18:36012,20:35056,21:33190,126:36013}
for row in recorded_rows:
    meta=row['metadata'];fmt=meta['format'];size=2 if fmt==16 else 8 if fmt==126 else 4;cost=(180 if meta['target']==4 else 294)*size
    assert row['allocation']['publicCost']==cost and row['allocation']['gpuCost']==cost*(2 if fmt==126 else 1)
    native=row['nativeCalls'][row['nativeCallsStart']:row['nativeCallsEnd']];texture=row['gpuTexture'];target=34067 if meta['target']==4 else 35866
    allocations=[v for v in native if v['name']==('texStorage2D' if meta['target']==4 else 'texStorage3D') and v['before'][0]==target]
    # The final reset/reuse allocation has an unequal format; inspect the first.
    assert allocations[0]['before']==[target,3,internal[fmt],meta['width'],meta['height']]+([] if meta['target']==4 else [meta['arraySize']])
    for level in row['levels']:
        mip=level['level'];w,h,layers=level['extent'];assert layers==meta['arraySize']
        copies=[v for v in native if v['name']==('framebufferTexture2D' if meta['target']==4 else 'framebufferTextureLayer') and v['before'][0]==36008 and (v['before'][3]==texture if meta['target']==4 else v['before'][2]==texture) and (v['before'][4]==mip if meta['target']==4 else v['before'][3]==mip)]
        selected={v['before'][2]-34069 if meta['target']==4 else v['before'][4] for v in copies};assert selected==set(range(layers)),(meta,mip,selected)
        for phase in level['phases']:
            expected=bytes.fromhex(phase['input']);read=phase['read'];actual=bytes.fromhex(read['output']);public(fmt,expected,actual)
            sentinel={'outer':0xc7,'inline':0xd3,'staging':0xa7}[phase['kind']]
            backing(fmt,expected,bytes.fromhex(read['backing']),bytes([sentinel])*4096,level['box'],level['layout'])
            assert read['after']['collections']-read['before']['collections']==1 and read['after']['fences']-read['before']['fences']==1
            assert read['after']['liveSyncs']==0 and read['budgets']['gpuBytes']==cost*(2 if fmt==126 else 1)
            observations+=1;pixels+=w*h*layers
        part=level['partial'];public(fmt,bytes.fromhex(part['expectedFull']),bytes.fromhex(part['read']['output']));observations+=1;pixels+=w*h*layers
        clear=level['gpuOverwrite'];expected=bytearray()
        for depth,stencil in clear['clear']['values']:
            if fmt==16:word=struct.pack('<H',65535 if depth==1 else 0)
            elif fmt==20:word=struct.pack('<I',((0xffffff if depth==1 else 0)<<8)|stencil)
            elif fmt==21:word=struct.pack('<I',0xffffff if depth==1 else 0)
            else:word=struct.pack('<f',depth)+(bytes([stencil,0,0,0]) if fmt==126 else b'')
            expected.extend(word*(w*h))
        assert expected==bytes.fromhex(clear['input']);public(fmt,expected,bytes.fromhex(clear['read']['output']));observations+=1;pixels+=w*h*layers
    assert row['final']['native']['gpuBytes']==0 and row['final']['host']['store']['budgets']['gpuBytes']==0
    assert row['reset']['pending']['physical']['liveSyncs']==1
    assert row['records'] and all(v['transportCanonical'] and v['transportDigest'] and v['submitCanonical'] and v['submitDigest'] for v in row['records'])
for row in report['failedFences']:
    assert row['native']['poisoned'] and row['host']['poisoned'] and row['before']==row['after']
for row in report['direct']['faults']:assert not row['result']['ok']
assert len(report['direct']['faults'])==92 and len(report['direct']['lifetimes'])==30 and len(report['direct']['budgets'])==115
assert len(report['boundaries']['metadata'])==215 and len(report['boundaries']['transfers'])==110
fault=root/'fault-wrong-layer';bad=load(fault/'report.json');assert bad['status']=='failed' and bad['browserResult']['status']=='failed' and bad['sabotage']
partial=bad['browserResult']['partial'];point=bad['browserResult']['point'];assert not bad['browserErrors']['console'] and not bad['browserErrors']['page'] and not bad['browserErrors']['requests']
assert 'exact UN16 pixel' in bad['browserResult']['error']['message']
exchanges=point['current']['exchanges'];assert len(exchanges)==2 and exchanges[0]['kind']=='layered-input' and exchanges[1]['kind']=='layered-output';assert exchanges[0]['bytes']!=exchanges[1]['bytes']
assert point['current']['records'][-1]['case']=='inner43 depth inverse mip0' and point['current']['records'][-1]['response'].startswith('00110000')
native=partial['nativeCalls'];names=[v['name'] for v in native];collection=max(i for i,v in enumerate(native) if v['name']=='getBufferSubData');fence=max(i for i,v in enumerate(native[:collection]) if v['name']=='fenceSync');assert any(v['name']=='blitFramebuffer' for v in native[:fence]);assert fence<collection
pin=bad['sabotage'];assert sha((fault/'source'/pin['source']).read_bytes())==pin['originalSha256'];assert sha((fault/'served-source'/pin['source']).read_bytes())==pin['servedSha256'];assert pin['originalSha256']!=pin['servedSha256']
result=dict(schema='dimensional-depth-physical-audit-v1',task='E6-T11d59',runs=42,synchronousRuns=15,failedFences=30,driverFaults=92,lifetimeRuns=30,budgetPredictions=115,metadataRefusals=215,spanRefusals=110,observations=observations,originalPixels=pixels,nativeCalls=report['summary']['nativeCalls'],completedPhysicalRefutations=1,actualLinuxGuest=False,productionAuthority=False)
(root/'physical-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
