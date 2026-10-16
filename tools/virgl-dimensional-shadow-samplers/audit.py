"""Independent original-depth oracle, whole DMA planes and physical custody."""
import gzip
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
self_validation = sys.argv[2:] == ['--self-validation']
sha = lambda body: hashlib.sha256(body).hexdigest()
bits = lambda value: struct.unpack('<I', struct.pack('<f', value))[0]
f32 = lambda value: struct.unpack('<f', struct.pack('<f', value))[0]


def extent(f, level):
    original = f['firstLevel'] + level
    return max(1, f['width'] // 2**original), max(1, f['height'] // 2**original), 6 if f['target'] == 'CUBE' else f['lastLayer'] - f['firstLayer'] + 1


def depth(f, level, layer, x, y, overrides):
    original = f['firstLevel'] + level
    if (original, layer) in overrides:
        return f32(overrides[original, layer][0])
    p = f['levels'][original]
    size = 2 if f['format'] == 16 else 8 if f['format'] == 126 else 4
    raw = bytes.fromhex(p['bytes'])
    at = ((layer * p['height'] + y) * p['width'] + x) * size
    word = int.from_bytes(raw[at:at + min(size, 4)], 'little')
    z = word / 65535 if f['format'] == 16 else (word >> 8) / 16777215 if f['format'] == 20 else (word & 0xffffff) / 16777215 if f['format'] == 21 else struct.unpack_from('<f', raw, at)[0]
    return f32(z)


def compare(reference, z, function):
    return int([False, reference < z, reference == z, reference <= z, reference > z, reference != z, reference >= z, True][function])


def oracle(f, x, y, overrides):
    sentinel = [0x12345678, 0x80000001, 0xdeadbeef, 0xffffffff]
    if f.get('pruned'):
        return sentinel
    op = f['opcode'].replace('_SAT', '').replace('_PRECISE', '')
    level = y if op in ['TXQ', 'TXD'] else (0 if f.get('bias', 2) == 0 else f['lastLevel'] - f['firstLevel']) if f.get('biasProbe') else 0
    w, h, layers = extent(f, level)
    if op == 'TXQ':
        values = [w, h, 0 if f['target'] == 'CUBE' else layers, f['lastLevel'] - f['firstLevel'] + 1]
    else:
        if f.get('biasProbe'):
            coordinates = bytes.fromhex(f['inputs'][1])
            assert all(struct.unpack_from('<f', coordinates, at + 12)[0] == .25 for at in range(0, len(coordinates), 16))
            c = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][f.get('face', 0)] + [.25]
        else:
            c = list(struct.unpack_from('<4f', bytes.fromhex(f['inputs'][1]), (y * f['grid']['width'] + x) * 16))
        source = f.get('sourceExpression') or ''
        if source.endswith('wzyx'):
            c.reverse()
        if source.startswith('|'):
            c = list(map(abs, c))
        if source.startswith('-|'):
            c = [-abs(v) for v in c]
        u, v = c[:2]
        if f['target'] == 'CUBE':
            major = max(map(abs, c[:3]))
            axis = next(k for k in range(3) if abs(c[k]) == major)
            layer = axis * 2 + int(c[axis] < 0)
            a, b = ((-c[2] if c[0] > 0 else c[2]), -c[1]) if axis == 0 else (c[0], c[2] if c[1] > 0 else -c[2]) if axis == 1 else (c[0] if c[2] > 0 else -c[0], -c[1])
            u, v = (a / major + 1) / 2, (b / major + 1) / 2
        else:
            layer = 0 if f['target'] == '2D' else max(0, min(layers - 1, math.floor(c[2] + .5))) + f['firstLayer']
        xx, yy = max(0, min(w - 1, math.floor(u * w))), max(0, min(h - 1, math.floor(v * h)))
        z = depth(f, level, layer, xx, yy, overrides)
        original_reference = c[2 if f['target'] == '2D' else 3]
        reference = max(0, min(1, original_reference)) if f['format'] in [16, 20, 21] else original_reference
        scalar = compare(reference, z, f['compareFunction'])
        sample = [z, 0, 0, 1] if f.get('ordinary') else [scalar] * 4
        if f.get('linear'):
            # The qualified matrix uses a constant PCF neighborhood. Read every
            # participating original texel rather than trusting the fixture flag.
            ix, iy = math.floor(u * w - .5), math.floor(v * h - .5)
            outcomes = [compare(reference, depth(f, level, layer, max(0, min(w - 1, ix + dx)), max(0, min(h - 1, iy + dy)), overrides), f['compareFunction']) for dy in [0, 1] for dx in [0, 1]]
            assert outcomes == [scalar] * 4
        values = [bits(0 if k == 4 else 1 if k == 5 else sample[k]) for k in f['swizzle']]
        if f.get('sameImage'):
            values = [values[0], bits(z), 0, bits(1)]
        if f.get('crossStage'):
            other = [bits(1), bits(compare(reference, z, 4)), 0, bits(compare(reference, z, 4))]
            values = [a ^ b for a, b in zip(values, other)]
    output = [values[k] if 'xyzw'[k] in f.get('mask', 'xyzw') else sentinel[k] for k in range(4)]
    if f.get('query'):
        _, h, layers = extent(f, 0)
        output[1:] = [h, 0 if f['target'] == 'CUBE' else layers, f['lastLevel'] - f['firstLevel'] + 1]
    return output


def packets(raw):
    at = 0
    while at < len(raw):
        header = int.from_bytes(raw[at:at + 4], 'little')
        end = at + 4 + 4 * (header >> 16)
        assert end <= len(raw)
        yield header & 255, header >> 8 & 255, raw[at + 4:end]
        at = end
    assert at == len(raw)


results, faults = [], 0
for directory in sorted(root.iterdir()):
    if not directory.is_dir() or not (directory / 'report.json').is_file():
        continue
    report = json.loads((directory / 'report.json').read_bytes())
    if report.get('task') != 'E6-T11d62' or 'runs' not in report:
        continue
    negative = directory.name.startswith('fault-')
    assert report['status'] == ('failed' if negative else 'passed')
    assert self_validation or not report['trackedChanges']
    for pin in report['sources']:
        body = (directory / 'source' / pin['path']).read_bytes()
        assert len(body) == pin['bytes'] and sha(body) == pin['sha256']
    for pin in report['servedFiles']:
        if pin['path'] == '/':
            if self_validation and 'bodyPath' not in pin:
                # Earlier inner-loop records stored the complete literal in
                # the runner; final submissions require the served HTML body.
                text = (directory / 'source/tools/virgl-dimensional-shadow-samplers/browser.mjs').read_text()
                body = text.split("const html=Buffer.from('", 1)[1].split("');", 1)[0].encode()
            else:
                body = (directory / pin['bodyPath']).read_bytes()
        else:
            body = (directory / 'source' / pin['path'].lstrip('/')).read_bytes()
        assert len(body) == pin['bytes'] and sha(body) == pin['sha256']
    assert report['browserErrors'] == dict(console=[], page=[], requests=[])
    counts = dict(runs=0, planes=0, words=0)
    for pin in report['runs']:
        packed = (directory / pin['path']).read_bytes()
        assert len(packed) == pin['gzipBytes'] and sha(packed) == pin['gzipSha256']
        body = gzip.decompress(packed)
        assert len(body) == pin['bytes'] and sha(body) == pin['sha256']
        r = json.loads(body)
        f = r['fixture']
        counts['runs'] += 1
        assert r['cleaned']['liveObjects'] == r['cleaned']['liveSyncs'] == 0
        assert r['commandTrace'] and r['machineDigest']
        setup = bytes.fromhex(r['setup']['request'])
        assert int.from_bytes(setup[:4], 'little') == 0x207
        assert int.from_bytes(setup[24:28], 'little') == len(setup) - 32
        texts = {}
        for operation, object_type, payload in packets(setup[32:]):
            if operation == 1 and object_type == 4:
                handle, stage, length, tokens, offsets = struct.unpack_from('<5I', payload)
                assert tokens == 8192 and offsets == 0 and payload[20 + length - 1] == 0
                assert not any(payload[20 + length:])
                texts[stage] = payload[20:20 + length - 1].decode()
        assert texts == {0: f['vertexText'], 1: f['fragmentText']}
        for source in r['sourcePlanes']:
            assert bytes.fromhex(source['input']) == bytes.fromhex(f['levels'][source['level']]['bytes'])
            control = int.from_bytes(bytes.fromhex(source['record']['request'])[:4], 'little')
            assert control == (0x205 if source['producer'] == 'outer205' else 0x207)
            if source['producer'] != 'inline9':
                assert any(e['kind'] in ['input', 'layered-input'] and e['bytes'] == source['input'] for e in r['exchanges'])
        if r.get('afterView'):
            commands = list(packets(bytes.fromhex(r['view']['request'])[32:]))
            assert [(operation, kind) for operation, kind, _ in commands] == [(1, 7), (1, 6), (10, 0), (18, 0)]
            sampler_words = struct.unpack('<9I', commands[0][2])
            flags = 2 | 2 << 3 | 2 << 6 | int(bool(f.get('linear'))) << 9 | int(bool(f.get('linear'))) << 13 | int(not f.get('ordinary')) << 15 | f['compareFunction'] << 16
            assert sampler_words == (50, flags, 0, bits(0), bits(1000), 0, 0, 0, 0)
            view_words = struct.unpack('<6I', commands[1][2])
            target = 4 if f['target'] == 'CUBE' else 2 if f['target'] == '2D' else 7
            assert view_words == (51, 6, f['format'] | target << 24, f['firstLayer'] | f['lastLayer'] << 16,
                                  f['firstLevel'] | f['lastLevel'] << 8, sum(k << (3 * i) for i, k in enumerate(f['swizzle'])))
            stage = int(f['stage'] == 'fragment')
            assert struct.unpack('<3I', commands[2][2]) == (stage, f['slot'], 51)
            assert struct.unpack('<3I', commands[3][2]) == (stage, f['slot'], 50)
            charge = 2 if f['format'] == 16 else 16 if f['format'] == 126 else 4
            source_cost = sum(p['width'] * p['height'] * p['layers'] * charge for p in f['levels'])
            base = source_cost + f['grid']['width'] * f['grid']['height'] * 16 + sum(len(bytes.fromhex(b)) for b in f['inputs'])
            extra = r['costPrediction'].get('twoDDepthSurfaceCost', 0)
            base += extra
            private = 0 if f['firstLevel'] == 0 and f['lastLevel'] == 2 and f['firstLayer'] == 0 and f['lastLayer'] == f['source']['arraySize'] - 1 else sum(math.prod(extent(f, level)) * charge for level in range(f['lastLevel'] - f['firstLevel'] + 1))
            assert r['costPrediction'] == dict(sourceCost=source_cost, baseCost=base, privateCost=private, nativePixelBytes=charge, **(dict(twoDDepthSurfaceCost=extra) if extra else {}))
            assert r['afterView']['store']['budgets']['gpuBytes'] == base + private
        assert all(v['usedIndex'] == i + 1 for i, v in enumerate(r['records']))
        if r.get('retainedUnref'):
            retained = r['retainedUnref']
            assert retained['sourceTexture'] != retained['replacementTexture']
            assert retained['before']['store']['budgets']['gpuBytes'] == retained['after']['store']['budgets']['gpuBytes'] == base + 2 * private
            assert retained['replacement']['store']['budgets']['gpuBytes'] == base + 2 * private + source_cost
            assert not r['cancelled']['host']['resources']
            for upload in r['replacementUploads']:
                p = f['levels'][upload['level']]
                size = p['width'] * p['height'] * p['layers'] * (2 if f['format'] == 16 else 8 if f['format'] == 126 else 4)
                assert upload['input'] == '00' * size
                request = bytes.fromhex(upload['record']['request'])
                assert int.from_bytes(request[:4], 'little') == 0x205
                assert int.from_bytes(request[56:60], 'little') == 6
                assert int.from_bytes(request[60:64], 'little') == upload['level']
                assert any(e['kind'] in ['input', 'layered-input'] and e['bytes'] == upload['input'] for e in r['exchanges'])
            labels = {p['label']: p for p in r['planes']}
            before = labels['original-new-shader-generation']['native']['state']['samplers']
            for label in ['original-retained-after-unref', 'original-retained-after-resource-name-reuse']:
                assert labels[label]['native']['state']['samplers'] == before
        syncs = {}
        for event in r['physical']:
            name = event['name']
            if name == 'fenceSync':
                assert event['sync'] not in syncs
                syncs[event['sync']] = dict(native=False, delivered=False)
            elif name == 'clientWaitSync':
                s = syncs[event['sync']]
                s['native'] |= event['actual'] in [37146, 37148]
                s['delivered'] |= event['delivered'] in [37146, 37148]
            elif name == 'getBufferSubData':
                assert syncs[event['sync']]['native'] and syncs[event['sync']]['delivered']
            elif name == 'deleteSync':
                del syncs[event['object']]
        assert not syncs
        assert not any(call['name'] == 'finish' for call in r['nativeCalls'])
        for plane in r['planes']:
            overrides = {(v['level'], v['layer']): v['value'] for v in r.get('gpuOnlyWrites', [])} if plane['label'] == 'GPU-only-source-refresh' else {}
            wanted = [word for y in range(f['grid']['height']) for x in range(f['grid']['width']) for word in oracle(f, x, y, overrides)]
            expected = struct.pack('<' + 'I' * len(wanted), *wanted)
            assert bytes.fromhex(plane['expected']) == expected, (r['name'], plane['label'], 'independent oracle')
            actual = bytes.fromhex(plane['observed'])
            assert len(actual) == len(expected)
            words = struct.unpack('<' + 'I' * len(wanted), actual)
            missing = []
            for i, (a, b) in enumerate(zip(words, wanted)):
                ordinary = f.get('ordinary') and f['opcode'] != 'TXQ' and 'xyzw'[i % 4] in f.get('mask', 'xyzw') and f['swizzle'][i % 4] == 0 or f.get('sameImage') and i % 4 == 1
                okay = a <= 0x3f800000 and b <= 0x3f800000 and abs(a - b) <= 1 if ordinary and f['format'] in [16, 20, 21] else a == b
                if not okay:
                    missing.append(dict(word=i, expected=b, actual=a))
            if missing:
                assert negative and plane['label'] == 'physically-corrupted-comparison' and r['faults']
                faults += 1
            else:
                assert not (negative and plane['label'] == 'physically-corrupted-comparison')
            for sampler in plane['native']['state']['samplers']:
                owner = f.get('expectedSamplers', {}).get(sampler['name'], {})
                shadow = owner.get('comparison', not f.get('ordinary'))
                assert sampler['parameters']['TEXTURE_COMPARE_MODE'] == (34894 if shadow else 0)
                assert sampler['type'] == ({2: 35682, 4: 36293, 7: 36292} if shadow else {2: 35678, 4: 35680, 7: 36289})[f['source']['target']]
                if not missing:
                    assert sampler['parameters']['TEXTURE_COMPARE_FUNC'] == 512 + owner.get('compareFunction', f['compareFunction'])
                assert sampler['unit'] == (16 if sampler['name'].startswith('vs') else 0) + int(sampler['name'][6:])
                assert sampler['originalTarget'] == f['source']['target'] and sampler['base'] == 0 and sampler['last'] == f['lastLevel'] - f['firstLevel']
                slot = sampler['name'][6:]
                uniforms = {u['name']: u for u in plane['native']['state']['uniforms']}
                swizzle = owner.get('swizzle', f['swizzle'])
                prefix = sampler['name'][:2]
                for suffix, value in [('shadmask', [float(k < 4) for k in swizzle]), ('shadadd', [float(k == 5) for k in swizzle])]:
                    uniform = uniforms.get(prefix + suffix + slot)
                    if shadow and f['opcode'] != 'TXQ':
                        assert uniform and uniform['type'] == 35666 and uniform['size'] == 1
                        actual_uniform = uniform['value']
                        assert actual_uniform['type'] == 'Float32Array'
                        if not (missing and suffix == 'shadmask' and any(v['kind'] == 'physical-owned-comparison-mask' for v in r['faults'])):
                            assert bytes.fromhex(actual_uniform['bytes']) == struct.pack('<4f', *value)
                    else:
                        assert uniform is None
            backing = bytes.fromhex(plane['wholeBacking'])
            assert len(backing) == 4096
            occupied, stride = set(), f['grid']['width'] * 16 + 3
            for y in range(f['grid']['height']):
                at, size = 5 + y * stride, f['grid']['width'] * 16
                occupied.update(range(at, at + size))
                assert backing[at:at + size] == actual[y * size:(y + 1) * size]
            assert all(byte == 0xc7 for i, byte in enumerate(backing) if i not in occupied)
            assert all(guard['before'] == guard['after'] == 'a3' * 8 for guard in plane['guards'])
            assert any(e['kind'] == 'output' and e['bytes'] == plane['observed'] for e in plane['exchanges'])
            for completion in [plane['record'], plane['read']]:
                assert int.from_bytes(bytes.fromhex(completion['response'])[:4], 'little') == 0x1100
            counts['planes'] += 1
            counts['words'] += len(words)
    results.append(dict(record=directory.name, reportSha256=sha((directory / 'report.json').read_bytes()), **counts))

assert results and (self_validation or faults == 2)
receipt = dict(schema='dimensional-shadow-sampler-original-plane-audit-v1', status='passed', results=results, completedPhysicalRefutations=faults)
(root / 'physical-audit.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(dict(status='passed', records=len(results), completedPhysicalRefutations=faults, planes=sum(row['planes'] for row in results))))
