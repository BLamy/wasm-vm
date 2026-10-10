#!/usr/bin/env python3
"""Reconstruct full native images from independent original packets and seed formulas."""
from pathlib import Path
import argparse
import copy
from datetime import datetime, timezone
import gzip
import hashlib
import json
import math
import re
import struct

sha = lambda raw: hashlib.sha256(raw).hexdigest()
f32 = lambda word: struct.unpack('<f', struct.pack('<I', word))[0]


def packets(hexadecimal):
    raw, at, out = bytes.fromhex(hexadecimal), 0, []
    while at < len(raw):
        head = struct.unpack_from('<I', raw, at)[0]
        length, end = head >> 16, at + 4 * ((head >> 16) + 1)
        assert end <= len(raw)
        out.append((head & 255, (head >> 8) & 255,
                    list(struct.unpack_from('<' + 'I' * length, raw, at + 4))))
        at = end
    return out


def original_planes(metadata, seed):
    planes, offset = [], 7
    for level in range(metadata['lastLevel'] + 1):
        width = max(1, metadata['width'] // 2**level)
        height = max(1, metadata['height'] // 2**level)
        raw = bytearray()
        for y in range(height):
            for x in range(width):
                channels = [(seed + dx*x + dy*y + dl*level) & 0xffffffff
                            for dx, dy, dl in [(29, 43, 61), (47, 17, 89),
                                              (73, 31, 37), (19, 53, 23)]]
                if metadata['format'] == 233:
                    raw.extend(struct.pack('<I', (channels[0] % 1024) * 2**20
                                           + (channels[1] % 1024) * 2**10
                                           + channels[2] % 1024 + (channels[3] % 4) * 2**30))
                else:
                    order = [2, 1, 0, 3] if metadata['format'] == 2 else [0, 1, 2, 3]
                    raw.extend(channels[k] % 256 for k in order)
        planes.append(dict(level=level, width=width, height=height, input=bytes(raw),
                           offset=offset, stride=width*4+5))
        offset += (height-1)*(width*4+5)+width*4+7
    backing = bytearray([0xa9] * offset)
    for plane in planes:
        for y in range(plane['height']):
            start = plane['offset'] + y * plane['stride']
            backing[start:start+plane['width']*4] = plane['input'][y*plane['width']*4:(y+1)*plane['width']*4]
    return planes, bytes(backing)


def rgba(format_id, plane, x, y):
    x, y = max(0, min(plane['width']-1, x)), max(0, min(plane['height']-1, y))
    at = 4*(y*plane['width']+x)
    if format_id == 233:
        word = struct.unpack_from('<I', plane['input'], at)[0]
        return [(word >> 20 & 1023)/1023, (word >> 10 & 1023)/1023, (word & 1023)/1023, 1]
    values = list(plane['input'][at:at+4])
    if format_id == 2:
        values = [values[2], values[1], values[0], 255]
    return [value/255 for value in values]


def sample(format_id, planes, view, parameters, coordinate, vertex=False):
    lam = 0 if vertex else -math.inf
    lam = min(parameters['maxLod'], max(parameters['minLod'], lam))
    linear = parameters['mag'] if lam <= 0 else parameters['min']
    maximum = view['range'][1]-view['range'][0]

    def plane_at(local):
        plane = planes[view['range'][0]+local]
        u, v = coordinate[0]*plane['width'], coordinate[1]*plane['height']
        if not linear:
            return rgba(format_id, plane, math.floor(u), math.floor(v))
        u, v = u-.5, v-.5
        x, y, a, b = math.floor(u), math.floor(v), u-math.floor(u), v-math.floor(v)
        neighbors = [rgba(format_id, plane, x, y), rgba(format_id, plane, x+1, y),
                     rgba(format_id, plane, x, y+1), rgba(format_id, plane, x+1, y+1)]
        return [(1-a)*(1-b)*neighbors[0][k]+a*(1-b)*neighbors[1][k]
                +(1-a)*b*neighbors[2][k]+a*b*neighbors[3][k] for k in range(4)]

    if lam <= 0 or parameters['mip'] == 2:
        color = plane_at(0)
    elif parameters['mip'] == 0:
        color = plane_at(min(maximum, max(0, math.floor(lam+.5))))
    else:
        lam = min(maximum, max(0, lam))
        a, b, fraction = plane_at(math.floor(lam)), plane_at(min(maximum, math.floor(lam)+1)), lam-math.floor(lam)
        color = [x*(1-fraction)+y*fraction for x, y in zip(a, b)]
    return [0 if k == 4 else 1 if k == 5 else color[k] for k in view['swizzle']]


def format_pixels(format_id, color, width, height, guest=False):
    values = [math.floor(max(0, min(1, value))*(3 if format_id == 233 and k == 3
                                             else 1023 if format_id == 233 else 255)+.5)
              for k, value in enumerate(color)]
    if format_id == 233:
        shifts = [20, 10, 0] if guest else [0, 10, 20]
        pixel = struct.pack('<I', sum(values[k] << shifts[k] for k in range(3)) + (3 << 30))
    elif format_id == 2:
        pixel = bytes([values[2], values[1], values[0], 255] if guest else [values[0], values[1], values[2], 255])
    else:
        pixel = bytes(values)
    return pixel*(width*height)


def normalize(format_id, raw):
    if format_id == 233:
        return b''.join(struct.pack('<I', (word >> 20 & 1023) + (word >> 10 & 1023)*2**10
                                    + (word & 1023)*2**20 + (3 << 30))
                        for (word,) in struct.iter_unpack('<I', raw))
    if format_id == 2:
        return b''.join(bytes([raw[i+2], raw[i+1], raw[i], 255]) for i in range(0, len(raw), 4))
    return raw


def predict(directory, seeds):
    """Write complete input/output predictions before starting the native process."""
    parameters = dict(s=2, t=2, r=2, min=1, mip=1, mag=1, minLod=.75, maxLod=.75,
                      compare=0, compareFunction=0)
    cases = []
    for seed in seeds:
        index = 0
        for format_id, width, height, control in [(f,w,h,False) for f in [2,67,233] for w,h in [(8,4),(7,5)]]+[(67,8,4,True)]:
                original_seed = seed if control else (seed + index*0x9e3779b9) & 0xffffffff
                if not control:
                    index += 1
                metadata = dict(id=6, target=2, format=format_id, bind=10, width=width,
                                height=height, lastLevel=int(math.log2(max(width, height))),
                                depth=1, arraySize=1, nrSamples=0, flags=0)
                planes, backing = original_planes(metadata, original_seed)

                def mixed(selected_planes, vs, fs, v_sw=[0, 1, 2, 3], f_sw=[0, 1, 2, 3]):
                    a = sample(format_id, selected_planes, dict(range=vs, swizzle=v_sw),
                               parameters, [.375, .625], True)
                    b = sample(format_id, selected_planes, dict(range=fs, swizzle=f_sw),
                               parameters, [.625, .375])
                    return [(x+y)/2 for x, y in zip(a, b)]

                same = mixed(planes, [1, 1], [2, 2])
                original_planes_record = [dict(level=p['level'], width=p['width'], height=p['height'],
                                               inputHex=p['input'].hex(), inputSha256=sha(p['input']),
                                               nativeHex=normalize(format_id, p['input']).hex()) for p in planes]
                planes[0]['input'] = format_pixels(format_id, same, width, height, True)
                old = format_pixels(67, mixed(planes, [1, 1], [0, 0]), 8, 8)
                replacement = (original_seed ^ 0xf3b4a291) & 0xffffffff
                fresh, fresh_backing = original_planes(metadata, replacement)
                queued = format_pixels(67, mixed(fresh, [1, 2], [0, 0], [2, 1, 0, 3], [0, 4, 2, 5]), 8, 8)
                cases.append(dict(seed=seed, case=index-1, negativeControl=control, originalSeed=original_seed,
                                  metadata=metadata, backingHex=backing.hex(), backingSha256=sha(backing),
                                  planes=original_planes_record, replacementSeed=replacement,
                                  replacementBackingHex=fresh_backing.hex(),
                                  expectedOutputHex={
                                      'same-image-disjoint-level0':format_pixels(format_id, same, width, height).hex(),
                                      'copy-GPU-drawn-level0':old.hex(), 'old-after-public-reuse':old.hex(),
                                      'queued-old-new-generation':queued.hex()}))
    directory.mkdir(parents=True, exist_ok=True)
    result = dict(schema='fresh-original-image-numeric-predictions-v1',
                  created=datetime.now(timezone.utc).isoformat(), beforeNativeExecution=True,
                  seeds=seeds, cases=cases, nativeRoundingTolerance={2:1, 67:1, 233:0},
                  runtimeOracleImports=False)
    (directory/'predictions.json').write_text(json.dumps(result, indent=2)+'\n')
    print('Full original image predictions written before native execution')


def sampler(words):
    bits = words[1]
    return dict(s=bits & 7, t=bits >> 3 & 7, r=bits >> 6 & 7,
                min=bits >> 9 & 1, mip=bits >> 11 & 3, mag=bits >> 13 & 1,
                minLod=f32(words[3]), maxLod=f32(words[4]), compare=bits >> 15 & 1,
                compareFunction=bits >> 16 & 7)


def native_parameters(parameters):
    address = {0:10497, 2:33071, 4:33648}
    return dict(TEXTURE_WRAP_S=address[parameters['s']], TEXTURE_WRAP_T=address[parameters['t']],
                TEXTURE_WRAP_R=address[parameters['r']], TEXTURE_MIN_FILTER=[[9984,9986,9728],[9985,9987,9729]][parameters['min']][parameters['mip']],
                TEXTURE_MAG_FILTER=9728+parameters['mag'], TEXTURE_COMPARE_MODE=0,
                TEXTURE_COMPARE_FUNC=512+parameters['compareFunction'],
                TEXTURE_MIN_LOD=parameters['minLod'], TEXTURE_MAX_LOD=parameters['maxLod'])


def interpret(run):
    metadata = run['metadata']
    created = [row for row in run['created'] if row['metadata']['id'] == 6]
    initial_generation = created[0]['generation']
    planes, _ = original_planes(metadata, run['originalSeed'])
    generations = {initial_generation: planes}
    if run.get('replacement'):
        generations[created[1]['generation']] = original_planes(metadata, run['originalSeed'] ^ 0xf3b4a291)[0]
    public_generation, objects, views, samplers, surface, events = initial_generation, {}, [None,None], [None,None], None, {}
    for hi, record in enumerate(run['history']):
        for resource in created:
            if resource['beforeSubmission'] == hi:
                public_generation = resource['generation']
        commands = packets(record['hex'])
        applied = record.get('appliedBeforeDispose', record['result'].get('appliedCommands', len(commands)))
        for op, kind, words in commands[:applied]:
            if op == 1:
                entry = dict(kind=kind, handle=words[0])
                if kind == 6:
                    entry.update(resource=words[1], format=words[2] & 0xffffff,
                                 range=[words[4] & 255, words[4] >> 8], swizzle=[words[5] >> (3*k) & 7 for k in range(4)],
                                 resourceGeneration=public_generation)
                elif kind == 7:
                    entry['sampler'] = sampler(words)
                elif kind == 8:
                    entry.update(resource=words[1], format=words[2], level=words[3], resourceGeneration=public_generation)
                elif kind == 4:
                    entry['text'] = struct.pack('<'+'I'*(len(words)-5), *words[5:])[:words[2]-1].decode()
                objects[words[0]] = entry
            elif op == 3:
                objects.pop(words[0], None)
            elif op == 10:
                views[words[0]] = objects[words[2]] if words[2] else None
            elif op == 18:
                samplers[words[0]] = objects[words[2]]['sampler'] if words[2] else None
            elif op == 5:
                surface = objects[words[2]] if len(words)>2 and words[2] else None
            elif op == 8:
                assert samplers[0] == samplers[1]
                assert objects[1]['text'].count('IMM[1] FLT32 {0.625,0.375,0,0}') == 1
                assert objects[1]['text'].count('IMM[2] FLT32 {0.375,0.625,0,0}') == 1
                assert objects[2]['text'].count('IMM[0] FLT32 {0.5,0.5,0.5,0.5}') == 1
                event = dict(record=hi, vs=copy.deepcopy(views[0]), fs=copy.deepcopy(views[1]),
                             sampler=samplers[0].copy(), surface=copy.deepcopy(surface), generations=copy.deepcopy(generations),
                             vertex=objects[1]['text'], fragment=objects[2]['text'])
                colors = [sample(metadata['format'], generations[view['resourceGeneration']], view, samplers[k],
                                 [.375,.625] if k == 0 else [.625,.375], k == 0)
                          for k, view in enumerate(views)]
                event['color'] = [(a+b)/2 for a,b in zip(*colors)]
                events.setdefault(record['label'], []).append(event)
                if surface['resource'] == 6:
                    destination = generations[surface['resourceGeneration']][surface['level']]
                    assert all(not (view['range'][0] <= surface['level'] <= view['range'][1]) for view in views
                               if view['resourceGeneration'] == surface['resourceGeneration'])
                    destination['input'] = format_pixels(metadata['format'], event['color'], destination['width'], destination['height'], True)
    return events


def audit(directory, expect_fault=False):
    report_bytes = (directory/'report.json').read_bytes()
    report = json.loads(report_bytes)
    result = report.get('partial') or report['browserResult']['result']
    assert report['task'] == 'E6-T11d21'
    assert report['browserErrors'] == dict(console=[],page=[],requests=[])
    assert not report['browser']['headless'] and 'M4' in result['gpu'] and 'Metal' in result['gpu']
    assert report['fixedMemory']['bytes'] == 16777216
    assert not result['guestExecution'] and not result['productionNegotiation']
    assert report['status'] == ('failed' if expect_fault else 'passed')
    prediction_path = directory.parent/'predictions.json'
    predictions = json.loads(prediction_path.read_text()) if prediction_path.exists() else None
    if predictions:
        assert predictions['beforeNativeExecution'] and result['seed'] in predictions['seeds']
        assert datetime.fromisoformat(predictions['created']) < datetime.fromisoformat(report['startedAt'].replace('Z','+00:00'))
        prediction_cases = [row for row in predictions['cases'] if row['seed']==result['seed']]
    if expect_fault:
        assert result['sabotage']['fenceCompleted'] and not result['sabotage']['held']
        assert 'independent retained generation original oracle after completed physical fence' in report['browserResult']['error']['message']
    blobs = {}
    for row in result['blobs']:
        packed = (directory/row['path']).read_bytes()
        assert sha(packed) == row['gzipSha256']
        raw = gzip.decompress(packed)
        assert len(raw) == row['bytes'] and sha(raw) == row['sha256']
        blobs[row['key']] = raw

    def blob(reference):
        raw = blobs[reference['key']]
        assert len(raw) == reference['bytes'] and sha(raw) == reference['sha256']
        return raw

    def mismatch(actual, expected, tolerance=0):
        assert len(actual) == len(expected)
        return [dict(at=i, observed=a, predicted=b) for i,(a,b) in enumerate(zip(actual, expected)) if abs(a-b)>tolerance]

    points, faults, texels, pixels, draws, fences = [], [], 0, 0, 0, 0
    for ri, run in enumerate(result['runs']):
        metadata = run['metadata']
        planes, backing = original_planes(metadata, run['originalSeed'])
        assert blob(run['backing']) == backing
        predicted_case = None
        if predictions and run['kind']=='novel':
            predicted_case = next(row for row in prediction_cases if row['metadata']==metadata and row['negativeControl']==expect_fault)
            assert run['originalSeed']==predicted_case['originalSeed']
            assert backing.hex()==predicted_case['backingHex']
        for observed, predicted in zip(run['planes'], planes):
            assert blob(observed['input']) == predicted['input']
        if run.get('replacement'):
            assert run['replacement']['seed'] == (run['originalSeed'] ^ 0xf3b4a291) & 0xffffffff
            assert blob(run['replacement']['backing']) == original_planes(metadata, run['replacement']['seed'])[1]
        events = interpret(run)
        textures = [row['id'] for row in run['nativeObjects'] if row['name'] == 'createTexture']
        allocations = [event for event in run['imageEvents'] if event['name'] == 'texStorage2D']
        assert len(textures) == len(allocations)
        source_textures = [texture for texture, allocation in zip(textures, allocations)
                           if allocation['args'][1] == metadata['lastLevel']+1
                           and allocation['args'][3:5] == [metadata['width'],metadata['height']]]
        source_generations = [row['generation'] for row in run['created'] if row['metadata']['id'] == 6]
        source_identity = dict(zip(source_generations, source_textures))
        assert len(source_identity) == len(source_generations)
        for hi, history in enumerate(run['history']):
            if not history['result'].get('gpuComplete'):
                continue
            issued = [event for event in run['events'] if event.get('label') == history['label'] and event['name'] == 'fenceSync']
            ready = [event for event in run['events'] if event.get('label') == history['label'] and event['name'] == 'clientWaitSync'
                     and event['actual'] in [37146,37148] and event['delivered'] in [37146,37148]]
            assert issued and ready and all(any(f['sync'] == e['sync'] and e['turn'] > f['turn'] for f in issued) for e in ready)
            fences += 1
        draw_occurrence = {}
        for di, draw in enumerate(run['draws']):
            point = f'report.json#/browserResult/result/runs/{ri}/draws/{di}'
            occurrence = draw_occurrence.get(draw['label'], 0)
            event = events[draw['label']][occurrence]
            draw_occurrence[draw['label']] = occurrence+1
            surface = event['surface']
            assert draw['native']['level'] == surface['level']
            assert draw['native']['attachment'] == (source_identity[surface['resourceGeneration']] if surface['resource'] == 6 else textures[0])
            for observed in draw['samplers']:
                view = event['vs'] if observed['unit'] == 16 else event['fs']
                assert observed['parameters'] == native_parameters(event['sampler'])
                assert observed['base'] == 0 and observed['last'] == view['range'][1]-view['range'][0]
                original = event['generations'][view['resourceGeneration']][view['range'][0]]
                assert observed['metadata']['width'] == original['width'] and observed['metadata']['height'] == original['height']
                copies = [e for e in run['imageEvents'] if e['name']=='blitFramebuffer' and e['label']==draw['label'] and e['draw']==observed['texture']]
                assert copies
                assert all(e['read'] == source_identity[view['resourceGeneration']] for e in copies)
                corrupted = expect_fault and draw['label'] == 'old-after-public-reuse' and observed['unit'] == 16
                if not corrupted:
                    assert not mismatch(blob(observed['texels']), normalize(metadata['format'], original['input']), 0 if metadata['format']==233 else 1)
                    assert all(e['readLevel'] == view['range'][0]+e['drawLevel'] and e['args'][:4]==e['args'][4:8] and e['args'][-2:]==[16384,9728] for e in copies)
                else:
                    assert any(e['readLevel'] == 0 for e in copies)
                    assert mismatch(blob(observed['texels']), normalize(metadata['format'], original['input']), 1)
            program_rows = [p for h in run['history'] for p in (h.get('dump')or{}).get('programs',[])]
            bodies = {s['stage']:s['glsl'] for s in draw['shaders']}
            if not program_rows:
                program_rows = [dict(vertexTGSI=q['request']['vertexText'],fragmentTGSI=q['request']['fragmentText'],vertexESSL300=q['result']['vertex']['glsl'],fragmentESSL300=q['result']['fragment']['glsl']) for q in run['requests']]
            assert any(p['vertexTGSI']==event['vertex'] and p['fragmentTGSI']==event['fragment'] and p['vertexESSL300']==bodies[35633] and p['fragmentESSL300']==bodies[35632] for p in program_rows), (ri, di, draw['label'], len(program_rows))
            for attribute in draw['attributes']:
                assert blob(attribute['bytes']) == struct.pack('<12f',-1,-1,0,1,3,-1,0,1,-1,3,0,1)
            draws += 1
            points.append(dict(point=point, result='HELD', sourceGenerations=[event[k]['resourceGeneration'] for k in ['vs','fs']], targetLevel=surface['level']))
        for oi, observation in enumerate(run['observations']):
            if not observation.get('native'):
                continue
            point = f'report.json#/browserResult/result/runs/{ri}/observations/{oi}'
            event = events[observation['label']][-1]
            predicted = format_pixels(observation['format'], event['color'], observation['width'], observation['height'])
            if predicted_case:
                assert predicted.hex()==predicted_case['expectedOutputHex'][observation['label']]
            assert blob(observation['predicted']) == predicted, 'stored oracle is independent original-packet reconstruction'
            misses = mismatch(blob(observation['native']), predicted, 0 if observation['format']==233 else 1)
            if expect_fault and observation['label'] == 'old-after-public-reuse':
                assert misses and observation['gpuComplete']
                assert run['sabotage'] and all(e['source'] == source_identity[source_generations[0]] and e['originalLevel']>0 and e['actualLevel']==0 for e in run['sabotage'])
                faults.append(dict(point=point,result='FAILED AS PREDICTED',misses=misses[:12],fenceCompleted=True))
            else:
                assert not misses
                for binding in observation['selectedBindings']:
                    view = event['vs'] if binding['stage']==0 else event['fs']
                    assert binding['base']==0 and binding['last']==view['range'][1]-view['range'][0]
                    for p in binding['planes']:
                        original = event['generations'][view['resourceGeneration']][view['range'][0]+p['local']]
                        assert blob(p['native'])==normalize(metadata['format'],original['input'])
                        texels += p['width']*p['height']
            pixels += observation['width']*observation['height']
            points.append(dict(point=point,result='FAILED AS PREDICTED' if misses else 'HELD',nativeSha256=observation['native']['sha256'],pixels=observation['width']*observation['height']))
        if run.get('queuedPoint'):
            point=run['queuedPoint']
            assert point['renderer']['jobs']['imageHolds']==4 and point['renderer']['jobs']['imageSources']==1
            assert point['images']['holds']==5
            old_source=run['created'][2]['generation']
            assert run['replacement']['generation']>old_source
        if run['kind']=='dispose-source-holds':
            point=run['observations'][0]['point']
            assert point['before']['resources']['budgets']['imageHolds']==3
            assert point['before']['renderer']['jobs']['status']=='finishing'
            assert all(n==0 for n in point['after']['budgets'].values())
            assert run['observations'][0]['disposed']['result']['error']['code']=='disposed'
        assert all(o['deleted']==1 for o in run['nativeObjects'])
        assert all(n==0 for n in run['final']['resources']['budgets'].values())
        assert all(n==0 for n in run['final']['renderer']['budgets'].values())
    if expect_fault:
        assert len(faults)==1
    else:
        cleanup=result['cleanup']
        assert cleanup['record']['result']['error']['code']=='backend-error'
        assert cleanup['captureEvents'][0]['captured']
        assert sum(e['actual']==1280 for e in cleanup['nativeEvents'])==1
        assert cleanup['point']['images']['views']==cleanup['point']['images']['allocations']==0
        assert cleanup['point']['resources']['budgets']['gpuBytes']==172
        assert cleanup['point']['resources']['budgets']['leases']==0
        assert all(o['deleted']==1 for o in cleanup['nativeObjects'])
        assert all(n==0 for n in cleanup['final']['resources']['budgets'].values())
        assert all(n==0 for n in cleanup['final']['renderer']['budgets'].values())
    audit_record=dict(schema='fresh-original-image-retention-audit-v1',task='E6-T11d21',status='passed',
                      seed=result['seed'],reportSha256=sha(report_bytes),draws=draws,fullPixels=pixels,nativeTexels=texels,
                      completedPhysicalFences=fences,points=points,faults=faults,
                      productOrWorkerOracleImports=False,authority='isolated-original-image-retained-generation')
    if predictions:
        audit_record['predictionsSha256']=sha(prediction_path.read_bytes())
        audit_record['predictionsMadeBeforeNativeExecution']=True
    (directory/'independent-audit.json').write_text(json.dumps(audit_record,indent=2)+'\n')
    print(json.dumps({k:audit_record[k] for k in ['status','seed','draws','fullPixels','nativeTexels','completedPhysicalFences']}))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory',type=Path)
    parser.add_argument('--fault',action='store_true')
    parser.add_argument('--predict',action='store_true')
    parser.add_argument('--seed',type=int,action='append')
    arguments=parser.parse_args()
    if arguments.predict:
        predict(arguments.directory.resolve(), arguments.seed or [1779033703,3144134277,1013904242])
    else:
        audit(arguments.directory.resolve(),arguments.fault)
