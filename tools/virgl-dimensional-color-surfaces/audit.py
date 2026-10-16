"""Recompute whole original color images from seed/wire, independently of the renderer."""
import gzip
import json
import struct
import sys
from pathlib import Path
from custody import sha

root = Path(sys.argv[1]).resolve()
inner = '--self-validation' in sys.argv[2:]
results, faults = [], 0

def original(target, seed, binary=False, square=False, slot=None):
    planes = []
    for level in range(3):
        width = max(1, 5 // 2**level)
        height = width if square or target == 4 else max(1, 3 // 2**level)
        layers = max(1, 5 // 2**level) if target == 3 else 6 if target == 4 else 5 if target == 7 else 1
        data = bytearray()
        for z in range(layers):
            for y in range(height):
                for x in range(width):
                    for lane in range(4):
                        v = (seed + level * 43 + z * 31 + y * 17 + x * 7 + lane * 53) & 255 if slot is None else (seed + slot * 67 + level * 31 + len(data) * 13) & 255
                        data.append((v & 1) * 255 if binary else v)
        planes.append(dict(level=level, width=width, height=height, layers=layers, data=data))
    return planes

def paint(planes, level, layer, color=(0,255,0,255)):
    p = planes[level]
    for y in range(p['height']):
        for x in range(p['width']):
            at = ((layer * p['height'] + y) * p['width'] + x) * 4
            p['data'][at:at+4] = bytes([255,0,255,0])
    for x,y in [(0,0),(p['width']-1,p['height']-1)]:
        at = ((layer * p['height'] + y) * p['width'] + x) * 4
        p['data'][at:at+4] = bytes(color)

def guards(output):
    assert len(output['guards']) == 5
    assert [v['length'] for v in output['guards']] == [7,17,53,101,3918]
    assert all(v['before'] == v['after'] == 'a3'*8 for v in output['guards'])

def output_check(output, p, dense, pixel_bytes=4, negative=False, fill=0x4e):
    assert output['denseExpected'] == bytes(dense).hex()
    observed = bytes.fromhex(output['denseActual'])
    assert len(observed) == len(dense)
    if not negative:
        assert observed == bytes(dense)
    stride=p['width']*pixel_bytes+7
    layer_stride=stride*p['height']+11 if p.get('layers',1)>1 or pixel_bytes==4 else 0
    predicted=bytearray([fill]*4096)
    actual_padded=bytearray([fill]*4096)
    for z in range(p.get('layers',1)):
        for y in range(p['height']):
            first=(z*p['height']+y)*p['width']*pixel_bytes
            destination=5+z*layer_stride+y*stride
            predicted[destination:destination+p['width']*pixel_bytes]=dense[first:first+p['width']*pixel_bytes]
            actual_padded[destination:destination+p['width']*pixel_bytes]=observed[first:first+p['width']*pixel_bytes]
    assert output['backingExpected']==predicted.hex()
    assert output['backingActual']==actual_padded.hex()
    guards(output)
    raw=bytes.fromhex(output['record']['request'])
    assert struct.unpack_from('<I',raw)[0]==0x206
    assert struct.unpack_from('<6I',raw,24)==(0,0,0,p['width'],p['height'],p.get('layers',1))
    assert struct.unpack_from('<Q',raw,48)[0]==5
    assert struct.unpack_from('<I',raw,64)[0]==stride
    assert struct.unpack_from('<I',raw,60)[0]==p.get('level',0)
    return observed!=bytes(dense)

def packets(raw):
    at=0
    while at<len(raw):
        h=struct.unpack_from('<I',raw,at)[0]
        end=at+4+(h>>16)*4
        assert end<=len(raw)
        yield h&255,(h>>8)&255,struct.unpack_from('<'+'I'*(h>>16),raw,at+4)
        at=end
    assert at==len(raw)

def witness_dense(f, planes, refresh, zero=False):
    first,last=(1,2) if refresh else (0,2)
    lo,hi=(1,3) if refresh and f['target']==7 else (0, f['source']['arraySize']-1)
    texels,coords=[],[]
    for p in planes[first:last+1]:
        for z in range(lo if f['target']==7 else 0,(hi+1) if f['target']==7 else p['layers']):
            for y in range(p['height']):
                for x in range(p['width']):
                    u,v=(x+.5)/p['width'],(y+.5)/p['height']
                    if f['target']==4:
                        a,b=2*u-1,2*v-1
                        c=[(1,-b,-a),(-1,-b,a),(a,1,b),(a,-1,-b),(a,-b,1),(-a,-b,-1)][z]
                    else:
                        c=(u,v,(z+.5)/p['layers'] if f['target']==3 else z-lo)
                    coords.extend((*c,p['level']-first));texels.append((p,((z*p['height']+y)*p['width']+x)*4))
    height=(len(texels)+63)//64
    dense=bytearray(64*height*16)
    if not zero:
        for i,(p,at) in enumerate(texels):
            for lane in range(4):
                byte=p['data'][at+lane];assert byte in [0,255]
                struct.pack_into('<I',dense,i*16+lane*4,0x3f800000 if byte else 0)
    return dict(width=64,height=height,layers=1),dense,struct.pack('<'+'f'*len(coords),*coords)

for directory in sorted(root.iterdir()):
    if not directory.is_dir() or not (directory/'report.json').is_file():continue
    report=json.loads((directory/'report.json').read_bytes())
    if report.get('task')!='E6-T11d63' or 'runs' not in report:continue
    negative=directory.name.startswith('fault-')
    if inner and report['status']=='failed' and not negative:continue
    assert report['status']==('failed' if negative else 'passed')
    assert report['browserErrors']==dict(console=[],page=[],requests=[])
    assert not report['actualLinuxGuest'] and not report['productionAuthority']
    if not inner:assert not report['trackedChanges']
    assert 'Apple M4 Max' in report['browser']['gpu']['devices'][0].get('deviceString','') or 'Apple' in json.dumps(report['browser']['gpu'])
    for pin in report['sources']:
        body=(directory/'source'/pin['path']).read_bytes()
        assert len(body)==pin['bytes'] and sha(body)==pin['sha256']
    by_name={p['path']:p for p in report['sources']}
    for pin in report['servedFiles']:
        if pin['path']=='/':assert sha((directory/pin['bodyPath']).read_bytes())==pin['sha256']
        else:assert by_name[pin['path'].lstrip('/')]['sha256']==pin['sha256']
    completed=0
    for pin in report['runs']:
        packed=(directory/pin['path']).read_bytes();body=gzip.decompress(packed)
        assert len(body)==pin['bytes'] and sha(body)==pin['sha256'] and sha(packed)==pin['gzipSha256']
        row=json.loads(body)
        assert row['status']==('failed' if negative else 'passed')
        assert row['guestTrace'] and row['machineDigest']
        assert row['cleaned']['liveObjects']==row['cleaned']['liveSyncs']==0
        assert not any(c['name']=='finish' for c in row['calls'])
        for record in row['records']:
            wire,response=bytes.fromhex(record['request']),bytes.fromhex(record['response'])
            assert len(response)==24 and struct.unpack_from('<I',response)[0] in [0x1100,0x1205]
            assert response[4:]==wire[4:24]
        if 'refusals' in row and row['name'].startswith('historical-'):
            assert len(row['refusals'])==len(row['controls'])==3
            for refused in row['refusals']:
                assert struct.unpack_from('<I',bytes.fromhex(refused['record']['response']))[0]==0x1205
                assert refused['before']['store']==refused['after']['store']
            assert all(struct.unpack_from('<I',bytes.fromhex(v['response']))[0]==0x1100 for v in row['controls'])
        elif 'models' in row:
            models={m['meta']['id']:(m,original(m['meta']['target'],row['seed'],square=True,slot=m['slot'])) for m in row['models']}
            colors={0:(0,255,0,255),2:(0,0,255,255),3:(255,0,0,255)}
            for m,planes in models.values():paint(planes,row['level'],m['layer'],colors[m['slot']])
            for output in row['outputs']:
                m,planes=models[output['resource']];p=planes[output['level']];output_check(output,p,p['data']);completed+=1
            for state in row['attachmentStates']:
                assert state['state']['attachments'][1]['type']==0
                for m,planes in models.values():
                    a=state['state']['attachments'][m['slot']]
                    assert a['level']==row['level'] and (a['face']-34069 if m['meta']['target']==4 else a['layer'])==m['layer']
        elif 'witness' in row:
            f=row['fixture'];refresh=row['name'].startswith('private-refresh');planes=original(f['target'],row['seed'],binary=True)
            for p,uploaded in zip(planes,row['uploads']):assert uploaded['input']==p['data'].hex()
            p,dense,coords=witness_dense(f,planes,refresh)
            assert bytes(row['witness']['coordinates'])==coords
            for plane in row['planes']:
                if plane['label']=='same-view-after-layer-mip-rebind':paint(planes,0,0)
                if plane['label']=='old-view-observes-original-GPU-write':paint(planes,f['level'],f['layer'])
                p,dense,_=witness_dense(f,planes,refresh,plane['label']=='replacement-same-name-view')
                output_check(plane,p,dense,pixel_bytes=16,fill=0xc7);completed+=1
            source_cost=sum(len(p['data']) for p in planes)
            assert source_cost==row['costPrediction']['sourceCost']
            assert len({json.dumps(p['native']['state']['program'],sort_keys=True) for p in row['planes']})==1
            for output in row['outputs']:
                p=planes[output['level']];dense=p['data'] if refresh else bytes(len(p['data']))
                output_check(output,p,dense);completed+=1
            if not refresh:
                u=row['retainedUnref'];assert u['oldGeneration']!=u['newGeneration']
                assert u['oldNativeImage']!=u['replacementNativeImage']
                assert u['unref']['store']['budgets']['gpuBytes']==u['before']['store']['budgets']['gpuBytes']
                assert u['unref']['store']['budgets']['backingBytes']==u['before']['store']['budgets']['backingBytes']-4096
                assert u['reused']['store']['budgets']['gpuBytes']==u['unref']['store']['budgets']['gpuBytes']+source_cost
                cancelled=row['cancelled'];assert cancelled['pending']['syncs']>0 and cancelled['usedIndex']==0
                assert cancelled['response']==cancelled['pending']['response']=='a5'*64
                assert cancelled['after']['store']['budgets']['gpuBytes']==cancelled['after']['store']['budgets']['backingBytes']==0
                assert not {o['id'] for o in cancelled['resetOwners']}&{o['id'] for o in cancelled['pending']['owners']}
                assert sorted(o['kind'] for o in cancelled['resetOwners'])==['Framebuffer','VertexArray']
        else:
            f=row['fixture'];planes=original(f['target'],row['seed']);assert f['source']['format']==67 and f['source']['bind'] in [2,10]
            for p,uploaded in zip(planes,row['sourcePlanes']):assert uploaded['input']==p['data'].hex()
            object8=[words for opcode,obj,words in packets(bytes.fromhex(row['setup']['request'])[32:]) if opcode==1 and obj==8]
            assert object8==[(20,6,67,f['level'],f['layer']|f['layer']<<16)]
            paint(planes,f['level'],f['layer'])
            contradicted=False
            for output in row['outputs']:
                p=planes[output['level']];contradicted|=output_check(output,p,p['data'],negative=negative);completed+=1
            if negative:
                assert row['faultHits']>0 and contradicted and row['outputs']
                mutation=[v for v in row['calls'] if v.get('fault')=='physical-original-color-attachment'];assert mutation
                assert all(v['arguments']!=v['delivered'] for v in mutation)
                assert any(v['name'].startswith('draw') for v in row['calls']);faults+=1
            else:
                for state in row['attachmentStates']:
                    a=state['state']['attachments'][0];assert a['level']==f['level'] and (a['face']-34069 if f['target']==4 else a['layer'])==f['layer']
            if f.get('attack'):
                assert struct.unpack_from('<I',bytes.fromhex(row['attack']['record']['response']))[0]==0x1205
                assert row['attack']['after']['host']['store']==row['attack']['before']['host']['store']
    results.append(dict(directory=directory.name,rows=len(report['runs']),completeOriginalPlanes=completed,negative=negative))
assert results
if not inner:assert faults==2
result=dict(schema='dimensional-color-surface-physical-audit-v1',runs=results,completeOriginalPlanes=sum(r['completeOriginalPlanes'] for r in results),completedPhysicalRefutations=faults,actualLinuxGuest=False,productionAuthority=False)
(root/'physical-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
