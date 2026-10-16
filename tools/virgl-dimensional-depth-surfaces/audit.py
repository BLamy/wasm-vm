"""Independent original-depth packet and full-image oracle over recorded hardware bodies."""
import gzip
import hashlib
import json
import struct
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
inner = '--self-validation' in sys.argv[2:]
sha = lambda b: hashlib.sha256(b).hexdigest()
results, faults = [], 0
size = lambda fmt: 2 if fmt == 16 else 8 if fmt == 126 else 4
stencil = lambda fmt: 0 if fmt == 20 else 4 if fmt == 126 else None


def depth(fmt, out, pixel, value):
    at = pixel * size(fmt)
    if fmt == 16:
        struct.pack_into('<H', out, at, int(value * 65535))
    elif fmt == 20:
        struct.pack_into('<I', out, at, (int(value * 0xffffff) << 8) | out[at])
    elif fmt == 21:
        struct.pack_into('<I', out, at, int(value * 0xffffff))
    else:
        struct.pack_into('<f', out, at, value)


def original(f, seed, canonical=False):
    planes = []
    for level in range(3):
        w = max(1, 5 >> level)
        h = max(1, (5 if f['target'] == 4 else 3) >> level)
        layers = 6 if f['target'] == 4 else 5 if f['target'] == 7 else 1
        b = bytearray(w * h * layers * size(f['format']))
        for z in range(layers):
            for y in range(h):
                for x in range(w):
                    pixel = (z * h + y) * w + x
                    at = pixel * size(f['format'])
                    s = (seed + level * 43 + z * 31 + y * 17 + x * 7) & 255
                    depth(f['format'], b, pixel, (seed + level + z + y + x) & 1)
                    offset = stencil(f['format'])
                    if offset is not None:
                        b[at + offset] = s
                    if not canonical and f['format'] == 126:
                        b[at + 5:at + 8] = bytes([s ^ 0xa7]) * 3
                    if not canonical and f['format'] == 21:
                        b[at + 3] = s ^ 0x71
        planes.append(dict(level=level, width=w, height=h, layers=layers, data=b))
    return planes


def points(p):
    return list(dict.fromkeys([(0, 0), (p['width'] - 1, p['height'] - 1)]))


def draw_model(f, seed):
    planes = original(f, seed, True)
    p = planes[f['level']]
    for y in range(p['height']):
        for x in range(p['width']):
            pixel = (f['layer'] * p['height'] + y) * p['width'] + x
            depth(f['format'], p['data'], pixel, 1)
            offset = stencil(f['format'])
            if offset is not None:
                p['data'][pixel * size(f['format']) + offset] = seed & 255
    for x, y in points(p):
        pixel = (f['layer'] * p['height'] + y) * p['width'] + x
        depth(f['format'], p['data'], pixel, 0)
        offset = stencil(f['format'])
        if offset is not None:
            p['data'][pixel * size(f['format']) + offset] = ((seed + 97) & 255) ^ 255
    layers = f['color']['arraySize']
    color = bytearray(bytes([11, 29, 47, 83]) * (p['width'] * p['height'] * layers))
    for pixel in range(p['width'] * p['height']):
        at = (f['colorLayer'] * p['width'] * p['height'] + pixel) * 4
        color[at:at + 4] = bytes([255, 0, 255, 0])
    for x, y in points(p):
        at = ((f['colorLayer'] * p['height'] + y) * p['width'] + x) * 4
        color[at:at + 4] = bytes([0, 255, 0, 255])
    return planes, color


def guards(out):
    assert [g['length'] for g in out['guards']] == [7, 17, 53, 101, 3918]
    assert all(g['before'] == g['after'] == 'a3' * 8 for g in out['guards'])


def padded(p, dense, bpp, fill):
    out = bytearray([fill] * 4096)
    stride = p['width'] * bpp + 7
    layer_stride = stride * p['height'] + 11
    for z in range(p['layers']):
        for y in range(p['height']):
            a = ((z * p['height'] + y) * p['width']) * bpp
            b = 5 + z * layer_stride + y * stride
            out[b:b + p['width'] * bpp] = dense[a:a + p['width'] * bpp]
    return out


def output_check(out, p, wanted, bpp, fill=0x4e, negative=False, resource=6):
    assert out['denseExpected'] == bytes(wanted).hex()
    actual = bytes.fromhex(out['denseActual'])
    assert len(actual) == len(wanted)
    assert out['backingExpected'] == padded(p, wanted, bpp, fill).hex()
    assert out['backingActual'] == padded(p, actual, bpp, fill).hex()
    guards(out)
    wire = bytes.fromhex(out['record']['request'])
    assert struct.unpack_from('<I', wire)[0] == 0x206
    assert struct.unpack_from('<6I', wire, 24) == (0, 0, 0, p['width'], p['height'], p['layers'])
    assert struct.unpack_from('<Q', wire, 48)[0] == 5
    assert struct.unpack_from('<4I', wire, 56) == (resource, p['level'], p['width'] * bpp + 7, (p['width'] * bpp + 7) * p['height'] + 11)
    assert struct.unpack_from('<I', bytes.fromhex(out['record']['response']))[0] == 0x1100
    if not negative:
        assert actual == bytes(wanted), 'independent full depth/stencil/color pixel oracle'
    return actual != bytes(wanted)


def sampler(f, planes):
    texels = []
    for p in planes[1:3]:
        for z in range(1 if f['target'] == 7 else 0, 5 if f['target'] == 7 else 6):
            for y in range(p['height']):
                for x in range(p['width']):
                    texels.append((p, ((z * p['height'] + y) * p['width'] + x) * size(f['format'])))
    h = (len(texels) + 63) // 64
    out = bytearray(64 * h * 16)
    for i, (p, at) in enumerate(texels):
        if f['format'] == 16:
            v = struct.unpack_from('<H', p['data'], at)[0] / 65535
        elif f['format'] == 20:
            v = (struct.unpack_from('<I', p['data'], at)[0] >> 8) / 0xffffff
        elif f['format'] == 21:
            v = (struct.unpack_from('<I', p['data'], at)[0] & 0xffffff) / 0xffffff
        else:
            v = struct.unpack_from('<f', p['data'], at)[0]
        assert v in (0, 1)
        struct.pack_into('<4I', out, i * 16, 0x3f800000 if v else 0, 0, 0, 0x3f800000)
    return dict(level=0, width=64, height=h, layers=1), out


directories = [root] if (root / 'report.json').is_file() else sorted(p.parent for p in root.glob('*/report.json') if (p.parent / 'browser-coverage.json').is_file())
for directory in directories:
    report = json.loads((directory / 'report.json').read_bytes())
    if report.get('task') != 'E6-T11d64' and not (inner and report.get('schema') == 'dimensional-depth-surface-browser-receipt-v1'):
        continue
    negative = report['status'] == 'failed'
    if not inner:
        assert not report['trackedChanges']
        assert negative == directory.name.startswith('fault-')
    assert report['browserErrors'] == dict(console=[], page=[], requests=[])
    for pin in report['sources']:
        b = (directory / 'source' / pin['path']).read_bytes()
        assert len(b) == pin['bytes'] and sha(b) == pin['sha256']
    for pin in report['servedFiles']:
        b = (directory / ('served/root.html' if pin['path'] == '/' else 'source/' + pin['path'].lstrip('/'))).read_bytes()
        assert len(b) == pin['bytes'] and sha(b) == pin['sha256']
    tuples, count, completed = set(), 0, 0
    for pin in report['runs']:
        packed = (directory / pin['path']).read_bytes()
        assert len(packed) == pin['gzipBytes'] and sha(packed) == pin['gzipSha256']
        b = gzip.decompress(packed)
        assert len(b) == pin['bytes'] and sha(b) == pin['sha256']
        row = json.loads(b)
        assert row['guestTrace'] and len(row['machineDigest']) == 64
        assert row['cleaned']['liveSyncs'] == 0
        for v in row['records']:
            for kind in ['transport', 'submit']:
                assert sha(bytes.fromhex(v[kind + 'Canonical'])) == v[kind + 'Digest'], 'original control/submission canonical state digest'
        if row['name'] == 'historical-base-Z16-surface':
            assert row['status'] == 'passed' and len(row['controls']) == 1 and row['metadata']['format'] == 16
            assert all(struct.unpack_from('<I',bytes.fromhex(v['response']))[0] == 0x1100 for v in row['controls'])
            continue
        f, seed = row['fixture'], row['seed']
        assert f['format'] in [16, 18, 20, 21, 126]
        if row['name'].startswith('historical-'):
            assert len(row['refusals']) == 6 and len(row['controls']) == 3
            for refusal in row['refusals']:
                assert refusal['before']['store'] == refusal['after']['store']
                assert struct.unpack_from('<I', bytes.fromhex(refusal['record']['response']))[0] == 0x1205
            continue
        assert f['bind'] in [1, 9] and f['target'] in [2, 4, 7]
        tuples.add((seed, f['target'], f['format'], f['bind'], f['level'], f['layer']))
        raw_planes = original(f, seed)
        assert len(raw_planes) == len(row['sourcePlanes'])
        for p, uploaded in zip(raw_planes, row['sourcePlanes']):
            assert uploaded['input'] == p['data'].hex()
            guards(uploaded)
        planes, color = draw_model(f, seed)
        assert f['points'] == [list(v) for v in points(planes[f['level']])]
        changed = False
        for out in row['outputs']:
            if out['kind'] == 'depth':
                p = planes[out['level']]
                changed |= output_check(out, p, p['data'], size(f['format']), negative=negative)
            else:
                p = dict(level=0, width=f['width'], height=f['height'], layers=f['color']['arraySize'])
                changed |= output_check(out, p, color, 4, negative=negative, resource=1)
            completed += 1
        if negative:
            assert changed and row['faultHits'] > 0 and row['status'] == 'failed'
            faults += 1
            assert any(c.get('fault') == 'physical-original-depth-attachment' and c['arguments'] != c['delivered'] for c in row['calls'])
            assert any(c['name'].startswith('draw') for c in row['calls'][row['operationNativeStart']:row['operationNativeEnd']])
        else:
            assert row['status'] == 'passed' and len(row['outputs']) == 4
            if 'attack' in row:
                attack = row['attack']
                assert attack['before']['host']['store'] == attack['after']['host']['store']
                assert struct.unpack_from('<I', bytes.fromhex(attack['record']['response']))[0] == 0x1205
            if 'lifecycle' in row:
                life = row['lifecycle']
                p, wanted = sampler(f, planes)
                output_check(life['samples'][0], p, wanted, 16, 0xc7, resource=2)
                selected = planes[f['level']]
                for y in range(selected['height']):
                    for x in range(selected['width']):
                        pixel = (f['layer'] * selected['height'] + y) * selected['width'] + x
                        depth(f['format'], selected['data'], pixel, 0)
                        offset = stencil(f['format'])
                        if offset is not None:
                            selected['data'][pixel * size(f['format']) + offset] = 55
                p, wanted = sampler(f, planes)
                output_check(life['samples'][1], p, wanted, 16, 0xc7, resource=2)
                if life['mode'] == 'private-refresh-aspect':
                    a = life['aspectOutput']
                    p = {k: a[k] for k in ['level', 'width', 'height', 'layers']}
                    wanted = bytearray(p['width'] * p['height'] * size(a['format']))
                    for pixel in range(p['width'] * p['height']):
                        depth(a['format'], wanted, pixel, 1)
                        offset = stencil(a['format'])
                        if offset is not None:
                            wanted[pixel * size(a['format']) + offset] = 117
                    output_check(a, p, wanted, size(a['format']), resource=8)
                    for out in life['refreshedPlanes']:
                        p = planes[out['level']]
                        output_check(out, p, p['data'], size(f['format']))
                else:
                    keep = life['retention']
                    assert keep['oldGeneration'] != keep['newGeneration']
                    assert keep['replacement']['target'] != f['target'] and keep['replacement']['format'] != f['format']
                    assert keep['before']['store']['budgets']['gpuBytes'] == keep['retired']['store']['budgets']['gpuBytes']
                    for out in life['replacementOutputs']:
                        p = {k: out[k] for k in ['level', 'width', 'height', 'layers']}
                        output_check(out, p, bytearray(p['width'] * p['height'] * p['layers'] * size(out['format'])), size(out['format']))
                    reset = life['reset']
                    assert reset['pending']['syncs'] == 1 and reset['pending']['guestTrace'] and reset['pending']['machineDigest']
                    assert reset['usedIndex'] == 0 and reset['response'] == reset['responseBeforeReset']
                    assert reset['after']['store']['budgets']['gpuBytes'] == reset['after']['store']['budgets']['backingBytes'] == 0
                    if f.get('waitFailed'):
                        assert life['waitFailure']['host']['poisoned'] and life['waitFailure']['native']['poisoned']
                        assert struct.unpack_from('<I', bytes.fromhex(life['waitFailure']['record']['response']))[0] == 0x1200
        count += 1
    if directory.name.startswith('hardware-'):
        expected = {(seed, target, fmt, role, mip, layer) for seed in report['seeds'] for target in [4, 7] for fmt in [16, 18, 20, 21, 126] for role in [1, 9] for mip in [0, 1, 2] for layer in range(6 if target == 4 else 5)}
        assert tuples == expected and count == len(expected)
    results.append(dict(directory=directory.name, head=report['head'], status=report['status'], runs=len(report['runs']), wholeImages=completed, reportSha256=sha((directory / 'report.json').read_bytes())))
assert results
if not inner:
    assert faults == 2
result = dict(schema='dimensional-depth-surface-independent-full-image-audit-v1', recordings=results, completedPhysicalRefutations=faults, images=sum(r['wholeImages'] for r in results), actualLinuxGuest=False, productionAuthority=False)
(root / 'physical-audit.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(dict(status='passed', recordings=len(results), images=result['images'], completedPhysicalRefutations=faults)))
