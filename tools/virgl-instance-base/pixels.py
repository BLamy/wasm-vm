#!/usr/bin/env python3
"""Reconstruct original vertex/instance words from complete native byte bodies."""
import gzip
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

sha = lambda raw: hashlib.sha256(raw).hexdigest()
word = lambda raw, at=0: struct.unpack_from('<I', raw, at)[0]
flt = lambda raw, at=0: struct.unpack_from('<f', raw, at)[0]
float_word = lambda value: struct.unpack('<I', struct.pack('<f', value))[0]
MASK = 0xffffffff
CONSTANT = 0x12345678
DIMENSIONAL = 0xdeadbeef
IMAGE = 17


def audit(directory):
    report = json.loads((directory/'report.json').read_text())
    a = report['acceptance']
    assert a['guestExecution'] is False and a['productionNegotiation'] is False
    assert report['browserErrors'] == dict(console=[], page=[], requests=[])
    bodies = {}
    for item in a['blobs']:
        zipped = (directory/item['path']).read_bytes()
        assert sha(zipped) == item['gzipSha256']
        raw = gzip.decompress(zipped)
        assert len(raw) == item['bytes'] and sha(raw) == item['sha256']
        assert item['key'] not in bodies
        bodies[item['key']] = raw
    events = a['events']
    assert [e['id'] for e in events] == list(range(len(events)))
    for event in events:
        assert 'error' not in event
        for arg in event['args'] + event.get('after', []) + [event.get('result')]:
            if isinstance(arg, dict) and 'key' in arg:
                assert len(bodies[arg['key']]) == arg['byteLength']
    frames, mismatches, fenced = [], [], set()
    for f in a['frames']:
        subset = events[f['firstEvent']:f['lastEvent']+1]
        bound, buffers, pointers = {}, {}, {}
        for e in subset:
            args = e['args']
            if e['method'] == 'bindBuffer':
                bound[args[0]] = args[1]['handle'] if args[1] else None
            elif e['method'] == 'bufferData':
                assert bound.get(args[0]) and isinstance(args[1], dict)
                buffers[bound[args[0]]] = bodies[args[1]['key']]
            elif e['method'] == 'getBufferSubData':
                read = bodies[e['after'][2]['key']]
                assert read == buffers[bound[args[0]]][args[1]:args[1]+len(read)]
            elif e['method'] in ('vertexAttribPointer', 'vertexAttribIPointer'):
                pointers[args[0]] = dict(buffer=bound[34962], integer=e['method']=='vertexAttribIPointer', args=args)
            elif e['method'].startswith('draw') and e['method'] not in ('drawBuffers',):
                draw = e
                break
        args = draw['args']
        assert args[0] == 0  # POINTS, so every original vertex owns one pixel.
        indexed = draw['method'].startswith('drawElements')
        instances = args[4] if draw['method']=='drawElementsInstanced' else args[3] if draw['method']=='drawArraysInstanced' else 1
        count = args[1] if indexed else args[2]
        if indexed:
            element_bytes = {5121:1, 5123:2, 5125:4}[args[2]]
            assert args[3] % element_bytes == 0
            source = buffers[bound[34963]]
            vertices = [int.from_bytes(source[args[3]+i*element_bytes:args[3]+(i+1)*element_bytes], 'little') for i in range(count)]
        else:
            vertices = list(range(args[1], args[1]+count))
        assert vertices == f['vertices'] and instances == f['instances']
        assert f['ordinary'] == (draw['method'] in ['drawArrays','drawElements'])
        fence = f['gpuComplete']
        assert fence['fenced'] and fence['writerEvent'] == draw['id']
        created, consumed, read = (events[fence['createdEvent']], events[fence['consumedEvent']], events[f['output']['readEvent']])
        assert draw['id'] < created['id'] < consumed['id'] < read['id']
        assert created['method'] == 'fenceSync' and created['args'] == [37143, 0]
        handle = created['result']['handle']
        assert handle == fence['handle'] and handle not in fenced
        fenced.add(handle)
        assert consumed['method']=='clientWaitSync' and consumed['args']==[{'handle':handle,'type':'WebGLSync'},0,0]
        assert consumed['result'] == fence['status'] and fence['status'] in [37146,37148]
        assert any(e['method']=='deleteSync' and e['args'][0]['handle']==handle for e in subset)
        assert read['method']=='readPixels' and read['args'][:6]==[0,0,f['width'],f['height'],36249,5124 if f.get('signedOutput') else 5125]
        raw = bodies[read['after'][-1]['key']]
        assert read['after'][-1]['key'] == f['output']['bytesKey'] and len(raw)==f['width']*f['height']*16
        assert f['cleaned']
        offset = f['offset']
        writes = [e for e in subset if e['method']=='uniform1ui']
        if offset['active']:
            assert offset['default']==0 and offset['type']==5125
            assert len(writes)==1 and writes[0]['args'][1]==offset['actual']
            assert offset['actual']==((f['base']+1)&MASK if f['fault']=='wrong-offset' else f['base'])
        else:
            assert not writes and offset['default'] is None
        reflected = f['blocks'][0]
        assert reflected['name']=='VirglBlock' and reflected['bytes']==656
        assert reflected['members']==[dict(name='winsys_adjust_y',offset=640,type=5126,value=1)]
        attributes = {item['attribute']: item for item in f['attributes']}
        assert attributes[0]['divisor']==0 and attributes[1]['divisor']==1
        position = buffers[attributes[0]['bufferHandle']]
        per_instance = buffers[attributes[1]['bufferHandle']]
        own_pixels = set()
        for instance in range(instances):
            for vertex in vertices:
                x = math.floor((flt(position,vertex*16)+1)*f['width']/2)
                y = math.floor((flt(per_instance,instance*16+4)+1)*f['height']/2)
                assert 0<=x<f['width'] and 0<=y<f['height'] and (x,y) not in own_pixels
                own_pixels.add((x,y))
                expected = [0xdeadbeef,0x80000001,0x12345678,MASK]
                if f['variant'] not in ['vertex1','absent','unused']:
                    expected[0] = (f['base']+instance)&MASK
                    if f['variant']=='negabs': expected[0]=(expected[0]&0x7fffffff)^0x80000000
                if f['variant'] not in ['instance1','absent','unused']:
                    expected[1] = vertex
                if f['composition']!='none':
                    actual_attribute=buffers[attributes[2]['bufferHandle']]
                    if f['composition'] in ['uint','sint']:
                        attribute=word(actual_attribute,vertex*16)
                    else:
                        packed=word(actual_attribute,vertex*4)&1023
                        signed=packed-1024 if packed>=512 else packed
                        attribute=float_word(max(-1,signed/511) if f['composition']=='packed-normalized' else signed)
                    expected[2]=(attribute^CONSTANT^DIMENSIONAL^IMAGE)&MASK
                    assert any(e['method']=='texSubImage2D' and bodies[e['args'][-1]['key']]==struct.pack('<4I',17,MASK,0x87654321,0x80000001) for e in subset)
                for lane in range(4):
                    observed=word(raw,((y*f['width']+x)*4+lane)*4)
                    if observed!=expected[lane]:
                        mismatches.append(dict(frame=f['name'],x=x,y=y,lane=lane,originalVertex=vertex,originalInstance=instance,expected=expected[lane],observed=observed,readEvent=read['id']))
        assert len(own_pixels)==f['width']*f['height']
        frames.append(dict(name=f['name'],originalVertices=vertices,originalInstances=instances,drawEvent=draw['id'],fence=fence,readEvent=read['id'],outputSha256=sha(raw),words=f['width']*f['height']*4))
    fault = directory.name.startswith('fault-')
    assert report['status']==('failed' if fault else 'passed')
    if fault:
        assert len(frames)==1 and len(mismatches)==12 and all(m['lane']==0 for m in mismatches)
        assert 'original instance/vertex words after native fence' in a['error']
    else:
        assert len(frames)==60 and len(a['compiles'])>=2099 and not mismatches
        assert len(a['typeControls'])==1 and a['typeControls'][0]['okay'] is False
    return dict(status='refuted' if fault else 'passed',directory=directory.name,reportSha256=sha((directory/'report.json').read_bytes()),reopenedBodies=len(bodies),events=len(events),frames=frames,mismatches=mismatches)


def main(directory):
    directory=Path(directory).resolve()
    records=[audit(directory/name) for name in ['hardware','fault-wrong-offset']]
    result=dict(status='passed',schema='original-instance-native-reconstruction-v1',records=records,rawWordsIndependentOfESSL=True)
    (directory/'physical-audit.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(status='passed',frames=60,physicallyRefutedOffset=True)))


if __name__=='__main__':main(sys.argv[1])
