#!/usr/bin/env python3
"""Independent Python literal-wire/fetch/native-ID/full-pixel critic oracle."""
import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import struct


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def packets(raw):
    at = 0
    while at < len(raw):
        if len(raw) - at < 4:
            raise ValueError('short literal header')
        h = struct.unpack_from('<I', raw, at)[0]
        count = h >> 16
        if count > (len(raw) - at - 4) // 4:
            raise ValueError('short literal payload')
        words = list(struct.unpack_from('<' + 'I' * count, raw, at + 4))
        yield at, h & 255, (h >> 8) & 255, words
        at += 4 * (count + 1)


def literal(history):
    contexts = {}
    for record in history:
        state = contexts.setdefault(record['ctx'], {'elements': {}, 'buffers': [], 'index': None, 'shaders': {}, 'draws': []})
        raw = bytes.fromhex(record['hex'])
        for at, op, kind, w in packets(raw):
            if op == 1 and kind == 5:
                state['elements'][w[0]] = [dict(source=w[n], divisor=w[n+1], buffer=w[n+2], format=w[n+3])
                                            for n in range(1, len(w), 4)]
            elif op == 2 and kind == 5:
                state['selected'] = w[0]
            elif op == 6:
                state['buffers'] = [dict(stride=w[n], offset=w[n+1], id=w[n+2]) for n in range(0, len(w), 3)]
            elif op == 11:
                state['index'] = None if len(w) == 1 else dict(id=w[0], size=w[1], offset=w[2])
            elif op == 1 and kind == 4:
                state['shaders'][w[1]] = raw[at+24:at+24+w[2]-1].decode()
            elif op == 8:
                assert len(w) == 12
                state['draws'].append(dict(start=w[0], count=w[1], mode=w[2], indexed=bool(w[3]), instances=w[4],
                                           minHint=w[9], maxHint=w[10]))
    state['draw'] = state['draws'][-1]
    state['effective'] = max(1, state['draw']['instances'])
    state['active'] = state['elements'][state['selected']]
    vertex = state['shaders'][0]
    assert 'DCL SV[0], INSTANCEID' in vertex and 'DCL SV[1], VERTEXID' in vertex
    assert 'MOV OUT[1].x, IN[1].xxxx' in vertex and 'MOV OUT[1].w, IN[15].wwww' in vertex
    state['imm'] = [f32(float(x.strip())) for x in re.search(r'IMM\[0\] FLT32 \{([^}]+)\}', vertex).group(1).split(',')]
    return state


def model(frame, blobs):
    state = literal(frame['history'])
    inputs = {row['resource']['id']: blobs[row['blob']['key']] for row in frame['inputs']}
    d, index = state['draw'], state['index']
    if d['indexed']:
        fmt = {1: '<B', 2: '<H', 4: '<I'}[index['size']]
        ids = [struct.unpack_from(fmt, inputs[index['id']], index['offset'] + n * index['size'])[0]
               for n in range(d['count'])]
    else:
        ids = list(range(d['start'], d['start'] + d['count']))
    fetches = []
    for attr in frame['used']:
        e = state['active'][attr]
        b = state['buffers'][e['buffer']]
        first, last = (0, (state['effective']-1)//e['divisor']) if e['divisor'] else (min(ids), max(ids))
        offset, components = b['offset']+e['source'], e['format']-27
        fetches.append(dict(attributeIndex=attr, resourceId=b['id'], divisor=e['divisor'], firstElement=first,
                            lastElement=last, stride=b['stride'], offset=offset, components=components,
                            firstByte=offset+first*b['stride'], requiredEnd=offset+last*b['stride']+4*components,
                            byteLength=len(inputs[b['id']])))

    def color(instance, ident):
        def read(attr, lane):
            e = state['active'][attr]
            b = state['buffers'][e['buffer']]
            n = instance // e['divisor'] if e['divisor'] else ident
            return struct.unpack_from('<f', inputs[b['id']], b['offset']+e['source']+n*b['stride']+4*lane)[0]
        rgba = [read(1, 0), f32((ident & 255)*state['imm'][2]),
                f32(f32((instance & 7)*state['imm'][3])+read(15, 2)), read(15, 3)]
        return [math.floor(max(0, min(1, value))*255 + .5) for value in rgba]

    def pixel(x, y):
        clip = 2*(x+.5)/frame['width']-1
        instance = math.floor((clip-state['imm'][1])/state['imm'][0])
        if not 0 <= instance < state['effective']:
            return [[0, 0, 0, 0]]
        local = (clip-state['imm'][1]-instance*state['imm'][0])/state['imm'][0]
        diagonal = local+(y+.5)/frame['height']
        a = color(instance, ids[2])
        b = color(instance, ids[5 if d['mode'] == 4 else 3])
        return [a, b] if abs(diagonal-1) < 1e-6 else [a if diagonal < 1 else b]
    return state, inputs, ids, fetches, pixel


def wire_prediction(row):
    standard = legacy = True
    try:
        for _, op, kind, w in packets(bytes.fromhex(row['hex'])):
            if op == 1 and kind == 5:
                assert len(w) == 5
                standard &= w[4] in [28, 29, 30, 31] and w[1] % 4 == 0
                legacy &= standard and w[2] == 0
            elif op == 11:
                assert len(w) == 3
                standard &= w[1] in [1, 2, 4] and w[2] % w[1] == 0
                legacy &= w[1] == 2 and w[2] % 2 == 0
            elif op == 8:
                if len(w) != 12:
                    return False, False
                standard &= w[2] in [4, 5] and w[5] == w[6] == w[7] == w[8] == w[11] == 0
                legacy &= standard and w[4] == 1
            else:
                raise ValueError('unexpected wire matrix opcode')
    except ValueError:
        return False, False
    return bool(standard), bool(legacy)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--critic', action='store_true')
    args = parser.parse_args()
    rows = []
    total = 0
    for name, fault in [('normal' if args.critic else 'hardware', False), ('fault-divisor', True)]:
        directory = args.directory / name
        report_raw = (directory / 'report.json').read_bytes()
        report = json.loads(report_raw)
        assert report['status'] == ('failed' if fault else 'passed')
        assert report['browserErrors'] == {'console': [], 'page': [], 'requests': []}
        assert not report['browser']['headless']
        assert report['browser']['gpu']['featureStatus'].get('webgl2', report['browser']['gpu']['featureStatus'].get('webgl')) == 'enabled'
        assert not any(re.search('swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu', arg, re.I)
                       for arg in report['browser']['commandLine'])
        for wire in report['wire']['records']:
            a, b = wire_prediction(wire)
            assert (a, b) == (wire['standard']['ok'], wire['legacy']['ok'])
        data = report['partial'] if fault else report['browserResult']['result']
        assert 'ANGLE Metal Renderer: Apple M4 Max' in data['gpu']
        assert not data['guestExecution'] and not data['productionNegotiation']
        blobs = {}
        for row in data['blobs']:
            raw = (directory / row['path']).read_bytes()
            assert sha(raw) == row['gzipSha256']
            unpacked = gzip.decompress(raw)
            assert len(unpacked) == row['bytes'] and sha(unpacked) == row['sha256']
            blobs[row['key']] = unpacked
        for ordinal, frame in enumerate(data['frames']):
            state, inputs, ids, fetches, expected_pixel = model(frame, blobs)
            d = state['draw']
            observed_pixels = blobs[frame['pixels']['key']]
            assert len(observed_pixels) == frame['width']*frame['height']*4
            misses, samples, max_error = [], [], 0
            for y in range(frame['height']):
                for x in range(frame['width']):
                    at = (y*frame['width']+x)*4
                    observed = list(observed_pixels[at:at+4])
                    expected = expected_pixel(x, y)
                    error = min(max(abs(a-b) for a, b in zip(observed, candidate)) for candidate in expected)
                    max_error = max(max_error, error)
                    point = dict(x=x, y=y, expected=expected, observed=observed, error=error)
                    if error > 1 and len(misses) < 4:
                        misses.append(point)
                    if y == 0 and x in [0, 8, 10, frame['width']-1]:
                        samples.append(point)
            native = frame['native']['calls'][-1]
            effective = state['effective']
            expected_name = ('drawElements' if d['indexed'] else 'drawArrays') + ('Instanced' if effective > 1 else '')
            expected_args = [d['mode'], d['count'], {1: 5121, 2: 5123, 4: 5125}[state['index']['size']], state['index']['offset']] if d['indexed'] else [d['mode'], d['start'], d['count']]
            if effective > 1:
                expected_args.append(effective)
            assert native['name'] == expected_name and native['args'] == expected_args
            recorded = frame['history'][-1]['result']['draws'][-1]
            assert recorded['vertexWork'] == d['count']*effective
            assert (recorded['actualMinIndex'], recorded['actualMaxIndex']) == (min(ids), max(ids))
            assert recorded['indexByteLength'] == (d['count']*state['index']['size'] if d['indexed'] else 0)
            assert frame['history'][-1]['result']['gpuComplete']
            assert frame['predicted']['ids'] == ids and frame['predicted']['fetches'] == fetches
            for f in fetches:
                native_attr = next(a for a in frame['native']['buffers'] if a['name'] == 'in_'+str(f['attributeIndex']))
                assert native_attr['enabled'] and native_attr['stride'] == f['stride'] and native_attr['offset'] == f['offset']
                assert native_attr['components'] == f['components']
                assert blobs[native_attr['blob']['key']] == inputs[f['resourceId']]
                assert f['requiredEnd'] <= f['byteLength']
                if not fault:
                    assert native_attr['divisor'] == min(f['divisor'], 65536)
                recorded_fetch = next(a for a in recorded['vertexFetches'] if a['attributeIndex'] == f['attributeIndex'])
                for k in ['divisor', 'firstByte', 'requiredEnd', 'firstElement', 'lastElement']:
                    assert recorded_fetch[k] == f[k]
            if d['indexed']:
                assert blobs[frame['native']['index']['blob']['key']] == inputs[state['index']['id']]
            programs = frame['dump']['programs']
            if programs:
                assert any('gl_InstanceID' in p['vertexESSL300'] and 'gl_VertexID' in p['vertexESSL300'] for p in programs)
            if fault:
                assert frame['label'] == ('critic-divisor-pixel-oracle' if args.critic else 'mixed-wide-0')
                assert misses and max_error > 1
                assert next(a for a in native['attributes'] if a['name'] == 'in_1')['divisor'] == 1
                assert 'independent physical pixel oracle' in report['browserResult']['error']['message']
            else:
                assert not misses, (frame['label'], misses)
                total += frame['width']*frame['height']
            rows.append(dict(kind='physical-fault' if fault else 'physical', recording=name, ordinal=ordinal,
                             reportSha256=sha(report_raw), label=frame['label'], ids=ids, effectiveInstances=effective,
                             work=d['count']*effective, fetches=fetches, nativeCall=dict(name=native['name'], args=native['args']),
                             pixels=frame['width']*frame['height'], pixelSha256=sha(observed_pixels), samples=samples,
                             maxError=max_error, misses=misses, result='HELD'))
        if not fault:
            assert all(row['held'] for row in data['predictions'])
            if args.critic:
                assert len(data['frames']) == 4 and len(data['rejections']) == 15
                assert all(plan['beforeSubmission'] for plan in data['plans'])
                for f in data['frames']:
                    plan = next(p for p in data['plans'] if p['label'] == f['label'])
                    expected = blobs[plan['expectedPixels']['key']]
                    physical = blobs[f['pixels']['key']]
                    ambiguous = {(p['x'], p['y']): p['colors'] for p in plan['ambiguous']}
                    for y in range(f['height']):
                        for x in range(f['width']):
                            at = (y*f['width']+x)*4
                            candidates = ambiguous.get((x, y), [list(expected[at:at+4])])
                            assert min(max(abs(a-b) for a, b in zip(physical[at:at+4], color)) for color in candidates) <= 1
                reset = data['suspensions'][0]
                assert reset['resetDuring']['error']['code'] == 'busy' and reset['resetAfter']['ok']
                assert reset['record']['result']['error']['code'] == 'cancelled' and reset['record']['result']['gpuComplete']
                assert reset['async']['reads'] == reset['async']['stagingBytes'] == 0
                rows.append(dict(kind='pending-reset', reportSha256=sha(report_raw), **reset, result='HELD'))
            else:
                assert len(data['frames']) == 37 and len(data['rejections']) == 11
                assert data['maxElementIndex'] == 4294967294
                for host in data['hostFaults']:
                    assert host['result']['error']['code'] == 'unsupported-host'
                    event = next(e for e in host['events'] if e.get('parameter') == 'MAX_ELEMENT_INDEX')
                    assert event['actual'] == 4294967294 and event['delivered'] == host['limit']
                    rows.append(dict(kind='invalid-host', reportSha256=sha(report_raw), **host))
                for suspended in data['suspensions']:
                    assert suspended['record']['result']['gpuComplete']
                    assert suspended['async']['reads'] == suspended['async']['stagingBytes'] == 0
                    if suspended['action'] == 'reuse':
                        assert suspended['newGeneration'] > suspended['oldGeneration']
                        assert suspended['record']['result']['draws'][0]['indexResourceGeneration'] == suspended['oldGeneration']
                    else:
                        assert not suspended['nativeDraws']
                        assert suspended['record']['result']['error']['code'] == ('cancelled' if suspended['action'] == 'cancel' else 'stale-storage')
                    rows.append(dict(kind='pending-read', reportSha256=sha(report_raw), **suspended))
            for rejection in data['rejections']:
                result = rejection['record']['result'] if args.critic else rejection['result']
                assert not result['ok'] and not rejection['nativeDraws']
                expected = ('limit-exceeded' if 'u32-work' in rejection['label'] else 'out-of-bounds') if args.critic else {
                    'instance-one-byte-short':'out-of-bounds', 'vertex-one-byte-short':'out-of-bounds', 'index-one-byte-short':'out-of-bounds',
                    'false-safe-hints':'out-of-bounds', 'max-native-index':'unsupported-draw', 'too-much-work':'limit-exceeded',
                    'signed-array-range':'unsupported-draw', 'fixed-sentinel-1':'unsupported-draw', 'fixed-sentinel-2':'unsupported-draw',
                    'fixed-sentinel-4':'unsupported-draw', 'malformed-whole-snapshot':'payload-length'}[rejection['label']]
                assert result['error']['code'] == expected
                rows.append(dict(kind='pre-draw-rejection', reportSha256=sha(report_raw), label=rejection['label'],
                                 expectedCode=expected, observed=result['error'], nativeDraws=0, result='HELD'))
            for run in data['runs']:
                for e in run['events']:
                    if e['name'] == 'clientWaitSync':
                        assert e['actual'] in [37146, 37147, 37148] and e['turn'] > 0
                        # WebGL TIMEOUT_EXPIRED is 37147; ALREADY_SIGNALED is 37146.
                        assert e['delivered'] == 37147 or e['delivered'] == e['actual']
        else:
            assert len(data['frames']) == 1
            mutation = report['mutation']
            mutated = (directory / 'mutation-source.mjs').read_bytes()
            assert sha(mutated) == mutation['servedSha256']
            assert mutation['replacement'] in mutated.decode()
            assert next(s for s in report['servedFiles'] if s['path'] == '/'+mutation['path'])['sha256'] == sha(mutated)
    assert total == (2240 if args.critic else 10296)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.with_suffix('.jsonl').write_text(''.join(json.dumps(row, separators=(',', ':'))+'\n' for row in rows))
    summary = dict(schema='standard-draw-independent-critic-audit-v1', status='passed', pixels=total,
                   rows=len(rows), critic=args.critic, pointsSha256=sha(args.output.with_suffix('.jsonl').read_bytes()))
    args.output.with_suffix('.json').write_text(json.dumps(summary, indent=2)+'\n')
    print(json.dumps(summary))


if __name__ == '__main__':
    main()
