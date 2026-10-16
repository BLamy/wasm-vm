"""Interrogate every N1/S1 byte from a model independent of the JS fixture."""
import gzip
import hashlib
import json
import struct
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
AUTHORITY = REPO / 'target/evidence/d64-final-authority/source'
sha = lambda b: hashlib.sha256(b).hexdigest()
citations = []
counts = dict(cleanRuns=0, redirectedRuns=0, fullImages=0, imageAndGuardBytes=0, nativeWriteStates=0)


def filled(fmt, pixels, value, stencil):
    if fmt == 20:
        return bytearray(struct.pack('<I', (0xffffff00 if value else 0) | stencil) * pixels)
    assert fmt == 126
    return bytearray(struct.pack('<IB3x', 0x3f800000 if value else 0, stencil) * pixels)


def planes(target, fmt, value, stencil):
    return [dict(level=m, width=max(1, 5 >> m), height=max(1, (5 if target == 4 else 3) >> m),
                 layers=6 if target == 4 else 5,
                 data=filled(fmt, max(1, 5 >> m) * max(1, (5 if target == 4 else 3) >> m) * (6 if target == 4 else 5), value, stencil)) for m in range(3)]


def image(record, p, wanted, bpp, resource, fill, negative, cite):
    actual = bytes.fromhex(record['denseActual'])
    assert len(actual) == len(wanted) and record['denseExpected'] == bytes(wanted).hex()
    padding = bytearray([fill] * 4096)
    observed_padding = bytearray(padding)
    stride = p['width'] * bpp + 7
    layer_stride = stride * p['height'] + 11
    for z in range(p['layers']):
        for y in range(p['height']):
            a = (z * p['height'] + y) * p['width'] * bpp
            b = 5 + z * layer_stride + y * stride
            padding[b:b + p['width'] * bpp] = wanted[a:a + p['width'] * bpp]
            observed_padding[b:b + p['width'] * bpp] = actual[a:a + p['width'] * bpp]
    assert record['backingExpected'] == padding.hex() and record['backingActual'] == observed_padding.hex()
    guards = record['guards']
    assert [g['length'] for g in guards] == [7, 17, 53, 101, 3918]
    assert all(g['before'] == g['after'] == 'a3' * 8 for g in guards)
    wire = bytes.fromhex(record['record']['request'])
    assert struct.unpack_from('<I', wire)[0] == 0x206
    assert struct.unpack_from('<6I', wire, 24) == (0, 0, 0, p['width'], p['height'], p['layers'])
    assert struct.unpack_from('<Q4I', wire, 48) == (5, resource, p['level'], stride, layer_stride)
    assert struct.unpack_from('<I', bytes.fromhex(record['record']['response']))[0] == 0x1100
    if not negative:
        assert actual == bytes(wanted)
    counts['fullImages'] += 1
    counts['imageAndGuardBytes'] += len(actual) + 4096 + 80
    citations.append(dict(**cite, expectedSha256=sha(wanted), actualSha256=sha(actual), equal=actual == bytes(wanted)))
    return actual != bytes(wanted)


def sample(model, target, fmt):
    out = bytearray(64 * 16)
    i = 0
    texels = []
    bpp = 4 if fmt == 20 else 8
    for p in model[1:]:
        for layer in range(0 if target == 4 else 1, 6 if target == 4 else 5):
            for y in range(p['height']):
                for x in range(p['width']):
                    offset = ((layer * p['height'] + y) * p['width'] + x) * bpp
                    depth = struct.unpack_from('<I', p['data'], offset)[0]
                    depth = depth >> 8 if fmt == 20 else depth
                    assert depth in [0, 0xffffff if fmt == 20 else 0x3f800000]
                    struct.pack_into('<4I', out, i * 16, 0x3f800000 if depth else 0, 0, 0, 0x3f800000)
                    # This inherited coordinate fixture labels a four-byte color
                    # offset; the depth oracle above uses the actual format size.
                    texels.append(dict(level=p['level'], layer=layer, x=x, y=y, byteOffset=offset // bpp * 4))
                    i += 1
    return dict(level=0, width=64, height=1, layers=1), out, texels


for name, negative in [('generations-clean', False), ('generations-redirected', True)]:
    directory = OUT / name
    report = json.loads((directory / 'report.json').read_bytes())
    assert report['status'] == ('failed' if negative else 'passed')
    assert report['browserErrors'] == dict(console=[], page=[], requests=[])
    assert report['runtimeSourceHead'] == 'cb04190a0fd8d989fb54fb7b2caf39cc86a8a0e7'
    assert not report['trackedChanges'] and not report['browser']['headless']
    assert report['browser']['gpu']['featureStatus'].get('webgl2', report['browser']['gpu']['featureStatus'].get('webgl')) == 'enabled'
    assert not any(any(bad in arg.lower() for bad in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe', '--disable-gpu']) for arg in report['browser']['commandLine'])
    assert len(report['runs']) == (1 if negative else 6)
    assert sha((directory / report['screenshot']['path']).read_bytes()) == report['screenshot']['sha256']
    for pin in report['sources']:
        body = (directory / 'source' / pin['path']).read_bytes()
        assert (len(body), sha(body)) == (pin['bytes'], pin['sha256'])
        if pin['path'].endswith(('native-dimensional-depth-surface-generations.mjs', 'generations-browser.mjs')):
            assert body == (REPO / pin['path']).read_bytes()
        else:
            assert body == (AUTHORITY / pin['path']).read_bytes()
    for pin in report['runs']:
        compressed = (directory / pin['path']).read_bytes()
        raw = gzip.decompress(compressed)
        assert (len(compressed), sha(compressed), len(raw), sha(raw)) == (pin['gzipBytes'], pin['gzipSha256'], pin['bytes'], pin['sha256'])
        row = json.loads(raw)
        cite = dict(file=(directory / pin['path']).relative_to(REPO).as_posix(), line=1, sha256=sha(raw), name=row['name'], seed=row['seed'])
        f = row['fixture']
        target, old_format = f['target'], f['format']
        assert (target, old_format) in [(4, 20), (7, 126)]
        assert f['bind'] == 9 and f['level'] == 1 and f['layer'] == (5 if target == 4 else 4)
        fresh_format = 126 if old_format == 20 else 20
        old = planes(target, old_format, 1, 29)
        fresh = planes(target, fresh_format, 0, 166)
        assert row['freshMeta'] == dict(f['source'], format=fresh_format)
        assert f['source'] == dict(id=6, target=target, format=old_format, bind=9, width=5, height=5 if target == 4 else 3, depth=1, arraySize=6 if target == 4 else 5, lastLevel=2, nrSamples=0, flags=0)
        for p, recorded, exchange in zip(old, f['levels'], row['exchanges'][:3]):
            assert recorded['bytes'] == list(p['data']) and exchange['bytes'] == p['data'].hex()
        before, after = row['reuse']['before'], row['reuse']['after']
        old_resource = next(v for v in before['store']['resources'] if v['id'] == 6 and v['public'])
        fresh_resource = next(v for v in after['store']['resources'] if v['id'] == 6 and v['public'])
        retained_resource = next(v for v in after['store']['resources'] if v['id'] == 6 and not v['public'])
        sub_before = before['renderer']['contexts'][0]['subContexts'][0]
        sub_after = after['renderer']['contexts'][0]['subContexts'][0]
        old_object = next(v for v in sub_before['objects'] if v['handle'] == 21)
        fresh_object = next(v for v in sub_after['objects'] if v['handle'] == 21 and v['public'])
        assert old_resource['generation'] == retained_resource['generation'] == row['reuse']['oldResourceGeneration']
        assert fresh_resource['generation'] == row['reuse']['freshResourceGeneration'] != old_resource['generation']
        assert sub_after['bindings']['depthSurface']['generation'] == old_object['generation'] == row['reuse']['oldObjectGeneration']
        assert fresh_object['generation'] == row['reuse']['freshObjectGeneration'] != old_object['generation']
        assert fresh_object['resourceGeneration'] == fresh_resource['generation']
        assert all(v['resourceGeneration'] == old_resource['generation'] for v in sub_after['objects'] if v['handle'] in [22, 65])
        assert row['refusal']['before']['store'] == row['refusal']['after']['store']
        assert struct.unpack_from('<I', bytes.fromhex(row['refusal']['record']['response']))[0] == 0x1205
        p, expected, texels = sample(old, target, old_format)
        assert row['witness']['texels'] == texels
        mismatch = image(row['samples'][0], p, expected, 16, 2, 0xc7, negative, dict(**cite, pointer='/samples/0'))
        selected = old[1]
        start = f['layer'] * selected['width'] * selected['height'] * (4 if old_format == 20 else 8)
        cleared = filled(old_format, selected['width'] * selected['height'], 0, 55)
        selected['data'][start:start + len(cleared)] = cleared
        p, expected, _ = sample(old, target, old_format)
        mismatch |= image(row['samples'][1], p, expected, 16, 2, 0xc7, negative, dict(**cite, pointer='/samples/1'))
        selected = fresh[1]
        bpp = 4 if fresh_format == 20 else 8
        start = f['layer'] * selected['width'] * selected['height'] * bpp
        cleared = filled(fresh_format, selected['width'] * selected['height'], 1, 73)
        selected['data'][start:start + len(cleared)] = cleared
        points = [[0, 0], [selected['width'] - 1, selected['height'] - 1]]
        assert f['points'] == points and f['reference'] == ((row['seed'] + 97) & 255)
        for x, y in points:
            offset = ((f['layer'] * selected['height'] + y) * selected['width'] + x) * bpp
            selected['data'][offset:offset + bpp] = filled(fresh_format, 1, 0, (row['seed'] + 97) & 255)
        for i, (p, result) in enumerate(zip(fresh, row['outputs'][:3])):
            mismatch |= image(result, p, p['data'], bpp, 6, 0x4e, negative, dict(**cite, pointer='/outputs/' + str(i)))
        color = bytearray(bytes([11, 29, 47, 83]) * selected['width'] * selected['height'])
        for x, y in points:
            offset = (y * selected['width'] + x) * 4
            color[offset:offset + 4] = bytes([0, 255, 0, 255])
        cp = dict(level=0, width=selected['width'], height=selected['height'], layers=1)
        mismatch |= image(row['outputs'][3], cp, color, 4, 1, 0x4e, negative, dict(**cite, pointer='/outputs/3'))
        assert row['completedOriginalReadbacks'] == 6
        identities = {}
        bound = {}
        for call in row['calls']:
            args = call['delivered']
            if call['name'] == 'bindTexture':
                bound[args[0]] = args[1]
            elif call['name'] in ['texStorage2D', 'texStorage3D'] and args[:2] == [34067 if target == 4 else 35866, 3] and args[3:5] == [5, 5 if target == 4 else 3]:
                if args[2] in [35056, 36013]:
                    identities[20 if args[2] == 35056 else 126] = bound[args[0]]['object']
        assert identities[old_format] == row['nativeTextures']['old']['object']
        assert identities[fresh_format] == row['nativeTextures']['fresh']['object'] != identities[old_format]
        native_sequences = []
        for state in row['attachmentStates']:
            if not (state['phase'].startswith('old-write') or state['phase'] == 'fresh-write'):
                continue
            if row['calls'][state['sequence']]['name'] not in ['clear', 'drawArrays', 'drawArraysInstanced']:
                continue
            wanted = identities[fresh_format] if negative or state['phase'] == 'fresh-write' else identities[old_format]
            for aspect in ['depth', 'stencil']:
                assert state[aspect]['type'] == 5890 and state[aspect]['texture']['object'] == wanted
                assert state[aspect]['level'] == 1 and (state[aspect]['face'] - 34069 if target == 4 else state[aspect]['layer']) == f['layer']
            native_sequences.append(state['sequence'])
            counts['nativeWriteStates'] += 1
        assert native_sequences and any(row['calls'][s]['name'].startswith('draw') for s in native_sequences)
        assert not any(c['name'].startswith('texSubImage') for c in row['calls'] if c['phase'].startswith(('old-write', 'fresh-write', 'refresh-old')))
        assert before['renderer']['work']['programLinks'] == row['beforeDispose']['renderer']['work']['programLinks']
        for record in row['records']:
            request, response = bytes.fromhex(record['request']), bytes.fromhex(record['response'])
            assert len(response) == 24
            assert struct.unpack_from('<I', response, 4)[0] == struct.unpack_from('<I', request, 4)[0] & 1
            assert response[8:16] == (request[8:16] if request[4] & 1 else bytes(8))
            assert response[16:20] == request[16:20] and response[20] == request[20]
            assert sha(bytes.fromhex(record['transportCanonical'])) == record['transportDigest']
            assert sha(bytes.fromhex(record['submitCanonical'])) == record['submitDigest']
        assert row['guestTrace'] and len(row['machineDigest']) == 64
        assert row['cleaned']['liveObjects'] == row['cleaned']['liveSyncs'] == 0
        assert all(c['result'] == 0 for c in row['calls'] if c['name'] == 'getError')
        if negative:
            assert mismatch and row['faultHits'] > 0 and row['status'] == 'failed'
            assert 'independent generation byte oracle' in row['failure']['message']
            assert len(row['mismatches']) == 4
            assert any(c.get('fault') == 'retained-old-to-same-target-fresh-texture' and c['arguments'] != c['delivered'] for c in row['calls'])
            counts['redirectedRuns'] += 1
        else:
            assert not mismatch and row['mismatches'] == [] and row['status'] == 'passed'
            counts['cleanRuns'] += 1
        citations.append(dict(**cite, prediction='S1' if negative else 'N1', pointer='/reuse',
                              nativeWriteSequences=native_sequences, oldTexture=identities[old_format],
                              freshTexture=identities[fresh_format], originalReadbacks=6, faultHits=row['faultHits']))

assert counts['cleanRuns'] == 6 and counts['redirectedRuns'] == 1 and counts['fullImages'] == 42
(OUT / 'generation-citations.jsonl').write_text(''.join(json.dumps(c) + '\n' for c in citations))
result = dict(schema='dimensional-depth-surfaces-independent-generation-interrogation-v1', status='passed',
              N1='HELD', S1='HELD', counts=counts, citationsSha256=sha((OUT / 'generation-citations.jsonl').read_bytes()),
              physicalRedirectDetectedAfterCompleteReadbacks=True, noImplementationMutation=True)
(OUT / 'generation-interrogation.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
