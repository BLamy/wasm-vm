#!/usr/bin/env python3
"""Derive whole consumer planes from literal original enums, TGSI and packet bytes.

This inverse imports the unchanged, independently verified D32 Python texture
semantics. It never imports the JavaScript fixture oracle, emitter or renderer.
"""
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct
import sys
ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('original_texture_inverse', ROOT/'tools/virgl-integer-image-shader/pixels.py')
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)
need, sha = original.need, original.sha


def fmt(number):
    if number==31:return dict(bits=32,signed=False,components=4,integer=False)
    n = number-177
    need(0 <= n < 24, 'original qualified integer enum')
    return dict(bits=[8,16,32][n//8],signed=bool((n%8)//4),components=n%4+1,integer=True)


def owned_blobs(directory, a):
    class Blobs(dict):
        def __getitem__(self,key):return super().__getitem__(key['key'] if isinstance(key,dict) else key)
    blobs = Blobs()
    for item in a['blobs']:
        need(item['key'] not in blobs, 'unique complete blob identity')
        compressed = (directory/item['path']).read_bytes()
        need(sha(compressed) == item['gzipSha256'], 'complete compressed native bytes')
        raw = gzip.decompress(compressed)
        need(len(raw) == item['bytes'] and sha(raw) == item['sha256'], 'complete source/native blob bytes')
        blobs[item['key']] = raw
    return blobs


def sources(run, blobs, update=None):
    desc = fmt(run['source']['format'])
    planes = {}
    backing = blobs[run['backing']]
    for p in run['planes']:
        level,w,h = p['level'],p['width'],p['height']
        need(w == max(1,run['source']['width'] >> level) and h == max(1,run['source']['height'] >> level), 'literal source mip extent')
        raw = blobs[p['input']]
        row = w*desc['components']*desc['bits']//8
        need(len(raw) == row*h, 'entire original tightly packed mip')
        for y in range(h):
            need(backing[p['offset']+y*p['stride']:p['offset']+y*p['stride']+row] == raw[y*row:(y+1)*row], 'original padded CPU transfer backing')
        if update and level == update['level']:
            raw = b''.join((word & ((1 << desc['bits'])-1)).to_bytes(desc['bits']//8,'little') for word in update['words'][:desc['components']])*(w*h)
        planes[level] = (w,h,raw)
    return desc,planes


def inverse(run, frame, blobs, previous=None):
    desc,planes = sources(run,blobs,frame.get('sourceUpdate'))
    output = fmt(frame.get('outputFormat',run['outputFormat']))
    first,last = run['range']
    local = {level-first:value for level,value in planes.items() if first <= level <= last}
    args = dict(run['fixture'],**desc,stage=run['stage'],opcode=run['opcode'],slot=run['slot'],
                vertexText=run['vertex'],fragmentText=run['fragment'],width=local[0][0],height=local[0][1],
                levels=last-first+1,frameWidth=run['width'],frameHeight=run['height'])
    if run.get('constants'):
        bank=blobs[run['constants']];need(len(bank)==16 and 'MOV TEMP[0], CONST[0]' in run['fragment'], 'literal original constant0 storage/read')
        init=struct.unpack('<4I',bank[:16])
        args['fragmentText']=re.sub(r'^IMM\[1\] UINT32 \{[^}]+\}$','IMM[1] UINT32 {'+','.join(map(str,init))+'}',args['fragmentText'],flags=re.M)
    text = run['vertex'] if run['stage'] == 'vertex' else run['fragment']
    declaration = re.search(r'^DCL SVIEW\[(\d+)\], 2D, (SINT|UINT|FLOAT)$',text,re.M)
    need(declaration is not None and int(declaration[1]) == run['slot'] and declaration[2] == ('SINT' if desc['signed'] else 'UINT' if desc['integer'] else 'FLOAT'), 'literal original sampler type/slot')
    words = []
    for y in range(run['height']):
        for x in range(run['width']):
            lanes = run['clearWords'][:] if frame['kind'] == 'clear' else original.sample(args,local,x,y)
            if frame['kind'] != 'clear' and run['opcode'] != 'TXQ':
                lanes = [0 if lane == 4 else (1 if desc['integer'] else 0x3f800000) if lane == 5 else lanes[lane] for lane in run['swizzle']]
            # Every narrow target draw in this task receives its own storage-width
            # words. Assert representability instead of asserting undefined clamp.
            if output['bits'] < 32:
                for word in lanes[:output['components']]:
                    value = word-(1<<32) if output['signed'] and word & (1<<31) else word
                    need(-(1<<(output['bits']-1)) <= value < (1<<(output['bits']-1)) if output['signed'] else 0 <= value < (1<<output['bits']), 'defined narrow integer output')
            lanes = [word & 0xffffffff if lane < output['components'] else 1 if lane == 3 else 0 for lane,word in enumerate(lanes)]
            words += lanes
    if previous is not None and frame['kind'] != 'clear':
        old = struct.unpack('<'+'I'*(len(previous)//4),previous)
        mask = frame.get('mask',15)
        words = [word if mask & (1<<(i%4)) else old[i] for i,word in enumerate(words)]
    return struct.pack('<'+'I'*len(words),*words),desc,planes,output


def native_audit(run):
    events = run['events']
    need([e['sequence'] for e in events] == list(range(1,len(events)+1)), 'complete monotonic native operation recording')
    ids = set()
    for sync in run['fenceObjects']:
        need(sync['id'] not in ids and sync['identity'] == 'WebGLSync', 'distinct actual native sync identities')
        ids.add(sync['id'])
        creates = [e for e in events if e['name'] == 'fenceSync' and e['sync'] == sync['id']]
        polls = [e for e in events if e['name'] == 'clientWaitSync' and e['sync'] == sync['id']]
        deletes = [e for e in events if e['name'] == 'deleteSync' and e['sync'] == sync['id']]
        need(len(creates) == 1 and creates[0]['sequence'] == sync['createdSequence'] and polls == sync['polls'], 'every physical poll recorded for its real object')
        need(len(deletes) == 1 and sync['deleted'] == 1, 'every owned sync retires once')
        need(all(creates[0]['sequence'] < p['sequence'] < deletes[0]['sequence'] and p['args'] == [0,0] for p in polls), 'native nonblocking poll ownership/order')
        for p in polls:
            need(p['actual'] in [0x911a,0x911b,0x911c] and (p['delivered'] == 0x911b or p['delivered'] == p['actual']), 'schedule delays never invent native completion')
        if sync.get('completed'):
            completed = sync['completed']
            need(any(p['sequence'] == completed['sequence'] and p['delivered'] in [0x911a,0x911c] and p['actual'] in [0x911a,0x911c] for p in polls), 'completion references genuine native signaled poll')
    for e in events:
        if e['name'] not in ['readPixels','getBufferSubData'] or not e['cpu']:
            continue
        point = e['completion']
        need(point and point['sequence'] < e['sequence'], 'all CPU collection follows actual physical completion')
        need(any(p['name'] == 'clientWaitSync' and p['sync'] == point['sync'] and p['sequence'] == point['sequence'] and p['actual'] in [0x911a,0x911c] and p['delivered'] in [0x911a,0x911c] for p in events), 'read completion references native poll')
    need(all(o['deleted'] == 1 for o in run['nativeObjects']), 'native handle retirement')
    for owner in ['renderer','resources']:
        need(run['final'][owner]['disposed'] and all(v == 0 for v in run['final'][owner]['budgets'].values()), 'terminal owned native budgets drain')
    allocations = {a['texture']:a['metadata'] for a in run['allocations'] if a['texture']}
    for d in run['draws']:
        need(not d['native']['blend'], 'actual integer COLOR0 bypasses blending')
        target = fmt(allocations[d['native']['attachment']]['format'])
        need(d['native']['componentType'] == (0x1404 if target['signed'] else 0x1405 if target['integer'] else 0x1406), 'original retained target controls native component class')
        fragment = next(s['glsl'] for s in d['shaders'] if s['type'] == 0x8b30)
        output_type = 'ivec4' if target['signed'] else 'uvec4' if target['integer'] else 'vec4'
        need(re.search(r'layout\s*\(\s*location\s*=\s*0\s*\)\s*out\s+(?:highp\s+)?'+output_type+r'\s+fsout_c0\b',fragment) is not None, 'original COLOR0 has matching native signed output at location0')
        for s in d['samplers']:
            source = fmt(s['metadata']['format'])
            need(s['type'] == (0x8dca if source['signed'] else 0x8dd2 if source['integer'] else 0x8b5e), 'actual native sampler reflection agrees retained range storage')
            need(s['parameters']['TEXTURE_MIN_FILTER'] == 0x2700 and s['parameters']['TEXTURE_MAG_FILTER'] == 0x2600, 'defined native nearest integer sampling')
    return dict(syncs=len(ids),polls=sum(len(s['polls']) for s in run['fenceObjects']),cpuReads=sum(e['name'] in ['readPixels','getBufferSubData'] and e['cpu'] for e in events),draws=len(run['draws']))


def inspect(directory,fault=False):
    report = json.loads((directory/'report.json').read_text())
    need(report['status'] == ('failed' if fault else 'passed'), 'acceptance/control terminal status')
    need(report['browserErrors'] == dict(console=[],page=[],requests=[]), 'zero browser errors')
    browser = report['browser']
    need(not browser['headless'] and browser['gpu']['featureStatus'].get('webgl2',browser['gpu']['featureStatus'].get('webgl')) == 'enabled', 'headed native enabled GPU')
    need(not any(re.search(r'swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu',argument,re.I) for argument in browser['commandLine']), 'hardware qualification flags')
    a = report.get('partial') if fault else report['browserResult']['result']
    need('Apple M4 Max' in a['gpu'] and 'Metal' in a['gpu'] and not a['guestExecution'] and not a['productionNegotiation'], 'isolated actual native hardware consumer')
    blobs = owned_blobs(directory,a)
    totals = dict(frames=0,outputWords=0,sourceWords=0,sourcePlanes=0,transferBytes=0,syncs=0,polls=0,cpuReads=0,draws=0)
    for run in a['runs']:
        stats = native_audit(run)
        for key,value in stats.items(): totals[key]+=value
    planes_expected = {}
    mismatches = []
    for index,frame in enumerate(a['frames']):
        run = a['runs'][frame['run']]
        previous = planes_expected.get(frame.get('previous'))
        expected,desc,planes,output = inverse(run,frame,blobs,previous)
        planes_expected[index] = expected
        actual = blobs[frame['native']]
        need(len(actual) == len(expected), 'entire native output plane recorded')
        need(blobs[frame['expected']] == expected, 'JS pre-check agrees independent original-word inverse')
        if actual != expected: mismatches.append(dict(run=run['name'],frame=index,kind='output',expected=sha(expected),observed=sha(actual)))
        if frame['kind'] == 'draw':
            draw = next(d for d in run['draws'] if d['label'] == frame['label'])
            point = frame['completion']
            need(point['sequence'] > draw['sequence'], 'full original output captured after its own native draw completion')
        if frame.get('beforeSabotage'):
            need(blobs[frame['beforeSabotage']] == expected and frame['sabotageCompletion']['sync'] != frame['originalCompletion']['sync'], 'post-completion actual output corruption has distinct completed fence')
        if run.get('constants') and frame['kind']=='draw':
            need(len(frame['uniformBlocks'])==1 and frame['uniformBlocks'][0]['size']==16 and blobs[frame['uniformBlocks'][0]['native']]==blobs[run['constants']], 'full actual native original UBO bytes')
            need(any(request['method']=='pair' and request['request']['bufferZeroMask']==2 and request['request']['signedMask']==int(run['vertexFormat']==200) and request['request']['unsignedMask']==int(run['vertexFormat']==196) for request in run['requests']), 'literal typed-vertex and retained constant selectors reach actual C pair')
            draw=next(d for d in run['draws'] if d['label']==frame['label'])
            need(draw['attributes'][0]['integer'] and draw['attributes'][0]['type']==(0x8b55 if run['vertexFormat']==200 else 0x8dc8), 'actual native integer vertex reflection/pointer')
        for binding in frame['bindings']:
            for p in binding['planes']:
                w,h,raw = planes[p['original']]
                want = b''.join(struct.pack('<4I',*original.original_words(desc,raw,pixel)) for pixel in range(w*h))
                got = blobs[p['native']]
                if got != want: mismatches.append(dict(run=run['name'],frame=index,kind='source',level=p['original'],expected=sha(want),observed=sha(got)))
                totals['sourceWords']+=w*h*4;totals['sourcePlanes']+=1
        for p in frame['outputs']:
            init = [0,0,0,1 if output['components'] < 4 else 0]
            wanted = expected if p['level'] == run['outputLevel'] else struct.pack('<4I',*init)*(p['width']*p['height'])
            need(blobs[p['native']] == wanted, 'entire attached and untouched native target levels')
        if frame.get('outputBacking'):
            backing = bytearray([0x2e]*20000)
            words = struct.unpack('<'+'I'*(len(expected)//4),expected)
            pixel_bytes = output['components']*output['bits']//8
            stride = run['width']*pixel_bytes+3
            for y in range(run['height']):
                row = b''.join((words[(y*run['width']+x)*4+lane] & ((1<<output['bits'])-1)).to_bytes(output['bits']//8,'little') for x in range(run['width']) for lane in range(output['components']))
                backing[5+y*stride:5+y*stride+len(row)] = row
            need(blobs[frame['outputBacking']] == backing, 'full original public transfer bytes and padding')
            history = run['history'][frame['publicHistory']]
            raw = bytes.fromhex(history['hex']);words_wire = struct.unpack('<'+'I'*(len(raw)//4),raw)
            need(words_wire[0] == 43 | (13<<16) and words_wire[1:5] == (1,run['outputLevel'],0,stride) and words_wire[-2:] == (5,2), 'actual original public read packet dimensions/offset/direction')
            totals['transferBytes']+=len(backing)
        totals['frames']+=1;totals['outputWords']+=len(actual)//4
    if fault:
        need(mismatches and any(m['kind'] == 'output' for m in mismatches), 'physical sabotage is caught by unchanged complete-word oracle')
        need(a['sabotage']['fenceCompleted'] and not a['sabotage']['held'], 'sabotage detection follows genuine submitted job completion')
    else:
        need(not mismatches, 'complete original-word inverse: '+str(mismatches[:3]))
        need(all(p['held'] for p in a['predictions']), 'recorded deterministic predictions held')
    return dict(path=directory.name,status='refuted' if fault else 'passed',mode=a['mode'],seed=a['seed'],**totals,mismatches=mismatches)


def main(directory):
    directory=Path(directory).resolve()
    names=['hardware','boundary-1030219','boundary-2882400001','boundary-1629686191','fault-original-level','fault-original-words','fault-completed-output']
    result=dict(schema='original-integer-consumer-full-inverse-v1',status='passed',guestExecution=False,productionNegotiation=False,
                records=[inspect(directory/name,name.startswith('fault-')) for name in names])
    (directory/'physical-audit.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))
if __name__ == '__main__':main(sys.argv[1])
