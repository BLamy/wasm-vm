#!/usr/bin/env python3
"""Independent full original-input audit of retained byte-color native captures."""
import gzip
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

sha = lambda b: hashlib.sha256(b).hexdigest()
profiles = {
    76: (3, True, False, [0, 1, 2, None]),
    77: (4, True, False, [0, 1, 2, 3]),
    103: (4, False, True, [1, 2, 3, None]),
    387: (3, False, True, [2, 1, 0, None]),
}

def packets(text):
    raw = bytes.fromhex(text)
    offset = 0
    result = []
    while offset < len(raw):
        header, = struct.unpack_from('<I', raw, offset)
        length = header >> 16
        assert offset + (length + 1) * 4 <= len(raw)
        result.append((header & 255, (header >> 8) & 255,
                       list(struct.unpack_from('<' + 'I' * length, raw, offset + 4))))
        offset += 4 * (length + 1)
    return result


def sample(profile, planes, inputs, first, last, lod, u, v):
    bpp, signed, srgb, order = profile
    def plane(level):
        shape = planes[first + level]
        raw = inputs[first + level]
        def texel(x, y):
            base = (min(shape['height']-1, max(0, y)) * shape['width']
                    + min(shape['width']-1, max(0, x))) * bpp
            result = []
            for k, lane in enumerate(order):
                if lane is None:
                    result.append(1)
                    continue
                byte = raw[base + lane]
                value = max(-1, (byte if byte < 128 else byte-256)/127) if signed else byte/255
                if srgb and k < 3:
                    value = value/12.92 if value <= .04045 else ((value+.055)/1.055)**2.4
                result.append(value)
            return result
        x, y = u*shape['width']-.5, v*shape['height']-.5
        a, b = math.floor(x), math.floor(y)
        dx, dy = x-a, y-b
        corners = [texel(a,b), texel(a+1,b), texel(a,b+1), texel(a+1,b+1)]
        weights = [(1-dx)*(1-dy), dx*(1-dy), (1-dx)*dy, dx*dy]
        return [sum(w*c[k] for w,c in zip(weights,corners)) for k in range(4)]
    lod = min(last-first, max(0, lod))
    lower = math.floor(lod)
    fraction = lod-lower
    left, right = plane(lower), plane(min(last-first, lower+1))
    return [a*(1-fraction)+b*fraction for a,b in zip(left,right)]


def pixels(profile, run, inputs):
    before = run['before']
    vr, fr, lod = before['vr'], before['fr'], before['lod']
    left = sample(profile, run['planes'], inputs, *vr, lod, .625, .375)
    right = sample(profile, run['planes'], inputs, *fr, lod, .375, .625)
    result = bytes(max(0, min(255, math.floor(((a+b)/4+.5 if profile[1] else (a+b)/2)*255+.5)))
                   for a,b in zip(left,right))
    return result * 64


def misses(actual, expected, tolerance=1):
    assert len(actual) == len(expected)
    return [dict(byte=k, observed=a, predicted=b) for k,(a,b) in enumerate(zip(actual, expected))
            if abs(a-b) > tolerance]


def main(directory):
    root = Path(directory).resolve()
    rows = []
    controls = []
    pixel_count = 0
    texel_count = 0
    for home in sorted(root.iterdir()):
        if not home.is_dir() or not (home/'report.json').exists():
            continue
        report_raw = (home/'report.json').read_bytes()
        report = json.loads(report_raw)
        if report.get('role') != 'fresh-adversarial-verifier':
            continue
        assert report['task'] == 'E6-T11d22'
        assert report['browserErrors'] == dict(console=[], page=[], requests=[])
        assert not report['browser']['headless'] and report['fixedMemory']['bytes'] == 16777216
        assert sha((home/'critic-module.mjs').read_bytes()) == report['verifierSources'][0]['sha256']
        result = report['browserResult'].get('result', report.get('partial'))
        assert 'M4' in result['gpu'] and 'Metal' in result['gpu']
        bodies = {}
        for blob in result['blobs']:
            packed = (home/blob['path']).read_bytes()
            raw = gzip.decompress(packed)
            assert sha(packed) == blob['gzipSha256'] and len(raw) == blob['bytes'] and sha(raw) == blob['sha256']
            assert blob['key'] not in bodies
            bodies[blob['key']] = raw
        def body(ref):
            raw = bodies[ref['key']]
            assert sha(raw) == ref['sha256'] and len(raw) == ref['bytes']
            return raw
        for index,run in enumerate(result['runs']):
            profile = profiles[run['format']]
            bpp,signed,srgb,order = profile
            backing = body(run['backing'])
            inputs = [body(plane['input']) for plane in run['planes']]
            for plane,raw in zip(run['planes'], inputs):
                dense = b''.join(backing[plane['offset']+y*plane['stride']:
                                        plane['offset']+y*plane['stride']+plane['width']*bpp]
                                 for y in range(plane['height']))
                assert dense == raw and plane['stride'] == plane['width']*bpp+5
            assert sum(p['width']*p['height'] for p in run['planes']) == 95
            assert body(run['fresh']['backing']) != backing
            before = run['before']
            original = packets(run['history'][before['historyIndex']]['hex'])
            views = [w for op,kind,w in original if op==1 and kind==6]
            assert [(w[4]&255,w[4]>>8) for w in views] == [(1,3),(2,3)]
            assert [w[2]&0xffffff for w in views] == [run['format']]*2
            expected = pixels(profile, run, inputs)
            assert body(before['expected']) == expected
            observed = body(before['pixels'])
            point = home.name+'/report.json#/'+('partial' if report['fault'] else 'browserResult/result')+'/runs/'+str(index)
            differences = misses(observed, expected)
            assert before['fenceCompleted'] and run['history'][before['historyIndex']]['result']['gpuComplete']
            create = {e['sync']: e for e in run['events'] if e['name']=='fenceSync'}
            done = [e for e in run['events'] if e['name']=='clientWaitSync' and e['delivered'] in [37146,37148]]
            assert done and all(e['actual'] in [37146,37148] and e['turn']>create[e['sync']]['turn'] for e in done)
            if report['fault']:
                assert report['status']=='failed' and differences and result['sabotage']['fenceCompleted']
                assert 'independent original color-space oracle after physical fence' in report['browserResult']['error']['message']
                assert any(e['name']=='texStorage2D' and e['original']==35907 and e['delivered']==32856
                           for e in run['faultEvents'])
                controls.append(dict(point=point, reportSha256=sha(report_raw), mismatches=differences[:8]))
            else:
                assert report['status']=='passed' and not differences
                state = run['actions'][0]
                assert state['before']['budgets']['gpuBytes']==768 and state['before']['budgets']['imageHolds']==3
                assert state['after']['budgets']['gpuBytes']==1160
                resources = [r for r in state['after']['resources'] if r['id']==6]
                assert len(resources)==2 and len({r['generation'] for r in resources})==2
                assert sorted((r['width'],r['height']) for r in resources)==[(9,3),(11,7)]
                retired = next(r for r in run['retiredPlanes'] if r['texture']==run['oldTarget'])
                assert retired['fencePoint']['actual'] in [37146,37148] and retired['fencePoint']['delivered'] in [37146,37148]
                assert not misses(body(retired['pixels']), expected)
                pixel_count += 128
                for d in run['draws']:
                    for sampler in d['samplers']:
                        level = 1 if sampler['unit']==16 else 2
                        native = body(sampler['texels'])
                        wanted = bytearray()
                        for at in range(0, len(inputs[level]), bpp):
                            for lane in order:
                                byte = (127 if signed else 255) if lane is None else inputs[level][at+lane]
                                wanted.append(byte)
                        assert len(native)==len(wanted) and all(a==b or signed and a in [128,129] and b in [128,129]
                                                              for a,b in zip(native,wanted))
                        texel_count += len(native)//4
                rows.append(dict(point=point,reportSha256=sha(report_raw),seed=result['seed'],format=run['format'],
                                 cancellation=run['cancellation'],status='HELD'))
            assert all(v==0 for v in run['final']['resources']['budgets'].values())
            assert all(v==0 for v in run['final']['renderer']['budgets'].values())
            assert all(o['deleted']==1 for o in run['nativeObjects'])
    assert len(rows)==16 and len({r['seed'] for r in rows})==2 and len(controls)==1
    result = dict(task='E6-T11d22',status='HELD',runs=len(rows),pixels=pixel_count,nativeTexels=texel_count,
                  rows=rows,controls=controls,oracle='independent Python original backing, packet, signed and sRGB reconstruction')
    (root/'independent-audit.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k not in ['rows','controls']}))


if __name__ == '__main__':
    main(sys.argv[1])
