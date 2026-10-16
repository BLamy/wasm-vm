#!/usr/bin/env python3
"""Independent public-word, mip, cost, complete backing and recording audit."""
import hashlib
import json
from pathlib import Path
import struct
import sys
root=Path(sys.argv[1]).resolve()
repo=Path(__file__).resolve().parents[2]
sha=lambda b:hashlib.sha256(b).hexdigest()
report=json.loads((root/'hardware/report.json').read_bytes())
assert report['status']=='passed' and not report['trackedChanges']
assert report['browserErrors']=={'console':[],'page':[],'requests':[]}
r=report['browserResult']['result']
assert r['status']=='passed' and not r['guestExecution'] and not r['productionNegotiation'] and 'Metal' in r['gpu']
layouts={v['format']:v for v in json.loads((repo/'tools/virgl-native-image/original-layouts.json').read_bytes())['rows']}
seeds=sorted({v['seed'] for v in r['runs']})
assert len(layouts)==81 and len(seeds)==3
assert {(v['seed'],v['format']) for v in r['runs']}=={(s,f) for s in seeds for f in layouts}
assert len(r['runs'])==243

def canonical(f,data,bpp):
    # Original channel fields, independently expressed in Python. Ordinary
    # exact integer/normal-float inputs round-trip; only ignored/canonical bits
    # need an inverse rule. No product conversion or observed pixel is imported.
    out=bytearray(data)
    alpha={2:3,4:0,68:0,99:0,101:3,103:0,134:3,230:3}
    if f in alpha:
        for i in range(alpha[f],len(out),4):out[i]=255
    masks={122:0x8000,135:0xf000,407:0xf000,409:0x8000,233:0xc0000000,308:0xc0000000}
    if f in masks:
        for i in range(0,len(out),bpp):out[i:i+bpp]=(int.from_bytes(data[i:i+bpp],'little')|masks[f]).to_bytes(bpp,'little')
    if f==21:
        for i in range(0,len(out),4):out[i+3]=0
    if f==126:
        for i in range(0,len(out),8):out[i+5:i+8]=bytes(3)
    if f==125:
        for i in range(0,len(out),4):
            w=int.from_bytes(data[i:i+4],'little');fields=[w&511,w>>9&511,w>>18&511];e=w>>27
            ce=max(0,e+max(fields).bit_length()-1-8) if max(fields) else 0
            fields=[v<<(e-ce) for v in fields];assert all(v<=511 for v in fields)
            out[i:i+4]=(fields[0]|fields[1]<<9|fields[2]<<18|ce<<27).to_bytes(4,'little')
    return bytes(out)

def hashes(record):
    for kind in ['transport','submit']:
        assert sha(bytes.fromhex(record[kind+'Canonical']))==record[kind+'Digest']

def response(record):
    request=bytes.fromhex(record['request']);raw=bytes.fromhex(record['response'])
    if int.from_bytes(request[4:8],'little')&1:
        assert raw[4:16]==request[4:16]
    assert raw[16:21]==request[16:21]

planes=[];checkpoints=[];browser_records=0
for run in r['runs']:
    original=run['original'];m=original['metadata'];f=run['format'];l=layouts[f];bpp=l['publicPixelBytes']
    assert original['layout']==l and m['format']==f and [m[k] for k in ['width','height','lastLevel']]==[9,5,3]
    pixels=sum(max(1,9>>level)*max(1,5>>level) for level in range(4));assert pixels==56
    expected_cost={'pixels':pixels,'publicBytes':pixels*bpp,'gpuBytes':pixels*l['gpuPixelBytes']}
    assert original['costs']==expected_cost
    for point in run['states']+[run['recreated']]:
        assert point['expected']==expected_cost
        assert point['native']['logicalBytes']==expected_cost['publicBytes']
        assert point['native']['gpuBytes']==point['host']['store']['budgets']['gpuBytes']==expected_cost['gpuBytes']
        assert point['native']['resources'][0]['metadata']==m
        assert point['native']['resources'][0]['identity']==point['host']['resources'][0]['transport']
    backing=bytes.fromhex(original['backing']);complete=bytearray([0xc7]*len(backing))
    assert sum(v['length'] for v in run['entries'])==len(backing) and run['entries'][0]['length']==17
    assert len(original['planes'])==len(run['planes'])==4
    for p,observed in zip(original['planes'],run['planes']):
        level=p['level'];width=max(1,9>>level);height=max(1,5>>level);row=width*bpp
        assert [p['width'],p['height']]==[width,height]
        source=b''.join(backing[p['offset']+y*p['stride']:p['offset']+y*p['stride']+row] for y in range(height))
        assert source==bytes.fromhex(p['input'])==bytes.fromhex(observed['input']['bytes'])
        prediction=canonical(f,source,bpp)
        assert prediction==bytes.fromhex(p['expected'])==bytes.fromhex(observed['output']['bytes'])
        for y in range(height):complete[p['offset']+y*p['stride']:p['offset']+y*p['stride']+row]=prediction[y*row:(y+1)*row]
        assert bytes(complete)==bytes.fromhex(observed['backingAfter'])
        assert all(v['prefix']==v['suffix']=='a3'*8 for v in observed['guards'])
        packet=bytes(observed['upload']['request'])
        assert struct.unpack_from('<I',packet,60)[0]==level and struct.unpack_from('<I',packet,64)[0]==p['stride']
        assert int.from_bytes(packet[48:56],'little')==p['offset']
        args=observed['input']['args'];assert args[-3:]==[row,p['stride'],height]
        assert observed['output']['args'][-3:]==[row,p['stride'],height]
        planes.append({'format':f,'seed':run['seed'],'level':level,'width':width,'height':height,'inputSha256':sha(source),'outputSha256':sha(prediction)})
    for record in run['records']:
        hashes(record);response(record);assert record['responseGuard']=='a5'*40;browser_records+=1
    assert any(e['type']=='cancelJob' for e in run['events'])
    assert run['snapshot']['liveSyncs']==0 and run['snapshot']['pboReads']>=4
    if run['memoryCheckpoint']:
        checkpoint=run['memoryCheckpoint'];assert sha(bytes.fromhex(checkpoint['memory']))==checkpoint['sha256'];checkpoints.append(checkpoint['sha256'])
assert len(checkpoints)==3
assert len(r['boundaries']['rows'])==23 and len(r['boundaries']['transfers'])==9 and len(r['boundaries']['roles'])==20
assert len(r['owners']['accepted']['resources'])==64 and len(r['owners']['historical']['events'][-1]['resources'])==16
names=[v['name'] for v in r['nativeCalls']]
for name in ['texStorage2D','texSubImage2D','readPixels','fenceSync','clientWaitSync','getBufferSubData','deleteSync']:assert name in names,name
assert 'finish' not in names
native=(root/'native-submit.stderr').read_text()
records=[json.loads(l.removeprefix('SUBMIT3D_PORTABLE_RECORD ')) for l in native.splitlines() if l.startswith('SUBMIT3D_PORTABLE_RECORD ')]
guards=[json.loads(l.removeprefix('NATIVE_IMAGE_GUARD_POINT ')) for l in native.splitlines() if l.startswith('NATIVE_IMAGE_GUARD_POINT ')]
image_records=[v for v in records if v['case'].startswith('image-')]
assert len(image_records)==len(guards) and all(v['guard']=='a5'*40 for v in guards)
for v in records:hashes(v)
creates=[v for v in image_records if v['case']=='image-create'];assert len(creates)==81
for v in creates:
    packet=bytes.fromhex(v['request']);f=struct.unpack_from('<I',packet,32)[0];l=layouts[f]
    control=bytes.fromhex(v['transportCanonical']);assert struct.unpack_from('<QQ',control,32)==(56*l['publicPixelBytes'],56*l['gpuPixelBytes'])
role_records=[v for v in image_records if v['case']=='image-bind-boundary'];assert len(role_records)==81*18
for v in role_records:
    packet=bytes.fromhex(v['request']);f,bind=struct.unpack_from('<II',packet,32);kind=layouts[f]['kind']
    masks={'depth':[1,8,9],'snorm':[8,262152,1048584,1310728],'shared':[8],
           'color':[2,8,10,262146,262152,262154,1048578,1048584,1048586,1310722,1310728,1310730]}
    assert int.from_bytes(bytes.fromhex(v['response'])[:4],'little')==(0x1100 if bind in masks[kind] else 0x1205)
points=[json.loads(l.removeprefix('NATIVE_IMAGE_DMA_POINT ')) for l in native.splitlines() if l.startswith('NATIVE_IMAGE_DMA_POINT ')]
assert len(points)==81*4
for p in points:
    f=p['format'];level=p['level'];bpp=layouts[f]['publicPixelBytes'];w=max(1,9>>level);h=max(1,5>>level);row=w*bpp
    assert [p['width'],p['height'],p['publicPixelBytes']]==[w,h,bpp]
    stride=row+(7 if level%2 else 0);assert p['rowStride']==stride
    source=bytes.fromhex(p['source']);assert source==bytes(((i*71)^f^(level*43))&255 for i in range(len(source)))
    tight=b''.join(source[5+y*stride:5+y*stride+row] for y in range(h));assert tight==bytes.fromhex(p['gathered'])
    output=bytes(v^0x57 for v in tight);assert output==bytes.fromhex(p['output'])
    complete=bytearray(source)
    for y in range(h):complete[5+y*stride:5+y*stride+row]=output[y*row:(y+1)*row]
    assert bytes(complete)==bytes.fromhex(p['completeBacking'])
cp=[json.loads(l.removeprefix('NATIVE_IMAGE_MEMORY_CHECKPOINT ')) for l in native.splitlines() if l.startswith('NATIVE_IMAGE_MEMORY_CHECKPOINT ')]
assert len(cp)==1 and sha(bytes.fromhex(cp[0]['memory']))==cp[0]['sha256']
traces=[l for l in native.splitlines() if l.startswith('SUBMIT3D_GUEST_TRACE ')]
assert len(traces)>=len(image_records)
audit={'schema':'native-image-integration-audit-v1','planes':planes,'pixels':13608,'mipPlanes':972,'formats':sorted(layouts),'seeds':seeds,
       'browserCanonicalRecords':browser_records,'nativeCanonicalRecords':len(records),'nativeImageRecords':len(image_records),
       'nativeGuardPoints':len(guards),'nativeDmaPoints':len(points),'nativeRetiredLoopTraces':len(traces),'memoryCheckpoints':checkpoints+[cp[0]['sha256']],
       'hardwareCalls':len(names),'guestExecution':False,'productionAuthority':False,
       'changedJsRuntime':'none; host image storage, compiler and DMA ownership remain held at authenticated dependency boundaries',
       'fixtureDomain':'exact ordinary words, finite normal floats, unambiguous SNORM -127; original endpoint/exception semantics remain held'}
(root/'integration-audit.json').write_text(json.dumps(audit,indent=2)+'\n');print(json.dumps({k:audit[k] for k in ['pixels','mipPlanes','nativeImageRecords','nativeGuardPoints','hardwareCalls']}))
