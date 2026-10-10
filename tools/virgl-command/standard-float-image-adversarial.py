#!/usr/bin/env python3
"""Generate independent original bits, then audit physical partial/range captures."""
import argparse
import hashlib
import json
from pathlib import Path
import struct

FORMATS = {**{91+i: (16, i+1) for i in range(4)}, **{28+i: (32, i+1) for i in range(4)}}
NATIVE_FORMATS = {91: 33325, 92: 33327, 93: 34842, 94: 34842, 28: 33326, 29: 33328, 30: 34836, 31: 34836}
sha = lambda data: hashlib.sha256(data).hexdigest()


def generate(seed, fmt, width, height, last, decorated=True):
    precision, components = FORMATS[fmt]
    size = precision//8
    native_components = 4 if components == 3 else components
    state = seed ^ fmt
    planes, offset = [], 5

    def bits():
        nonlocal state
        state = (1664525*state+1013904223) & 0xffffffff
        if precision == 16:
            return (state & 0x8000) | (((state >> 23) % 28+1) << 10) | (state & 1023)
        return (state & 0x80000000) | (((state >> 23) % 28+112) << 23) | (state & 0x7fffff)

    def dense(w, h):
        return b''.join(bits().to_bytes(size, 'little') for _ in range(w*h*components))

    for level in range(last+1):
        w, h = max(1, width//2**level), max(1, height//2**level)
        input_bytes = dense(w, h)
        stride = w*components*size+5
        planes.append(dict(level=level, width=w, height=h, offset=offset, stride=stride, input=input_bytes.hex()))
        offset += (h-1)*stride+w*components*size+9
    records = list(planes)
    if decorated:
        patch = dict(level=1, box=dict(x=2, y=1, z=0, width=5, height=3, depth=1),
                     offset=offset+3, stride=5*components*size+3, input=dense(5, 3).hex())
        offset = patch['offset']+2*patch['stride']+5*components*size+17
        records.append(patch)
    backing = bytearray([0x93]*offset)
    for plane in records:
        w, h = plane.get('width', 5), plane.get('height', 3)
        raw = bytes.fromhex(plane['input'])
        row_bytes = w*components*size
        for y in range(h):
            at = plane['offset']+y*plane['stride']
            backing[at:at+row_bytes] = raw[y*row_bytes:(y+1)*row_bytes]
    pixels = sum(p['width']*p['height'] for p in planes)
    spec = dict(seed=seed, format=fmt, precision=precision, components=components,
                nativeComponents=native_components, size=size,
                metadata=dict(id=37, target=2, format=fmt, bind=10, width=width, height=height,
                              depth=1, arraySize=1, lastLevel=last, nrSamples=0, flags=0),
                planes=planes, backing=backing.hex(), backingSha256=sha(backing),
                predicted=dict(pixels=pixels, logicalBytes=pixels*components*size,
                               physicalBytes=pixels*native_components*size))
    if decorated:
        view_pixels = sum(p['width']*p['height'] for p in planes[1:4])
        spec.update(patch=patch, mutation=dict(level=2, x=1, y=1, width=1, height=1, input=dense(1, 1).hex()))
        spec['predicted'].update(viewPixels=view_pixels, viewLogicalBytes=view_pixels*components*size,
                                 viewPhysicalBytes=view_pixels*native_components*size,
                                 patchScratchBytes=15*native_components*size, readScratchBytes=720,
                                 readStagingBytes=720, oldReadScratchBytes=448, oldReadStagingBytes=448,
                                 queuedOldGpuBytes=(pixels+view_pixels)*native_components*size+448)
    return spec


def make_inputs(path):
    specs = []
    for seed in [0x6d3ac291, 0xb71854e3]:
        for fmt in FORMATS:
            spec = generate(seed, fmt, 19, 11, 4)
            spec['replacement'] = generate(seed ^ 0xf63ac749, fmt, 7, 3, 2, False)
            specs.append(spec)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(dict(schema='independent-floating-original-inputs-v1', specs=specs), indent=2)+'\n')
    print(json.dumps(dict(specs=len(specs), inputSha256=sha(path.read_bytes()), recordedBeforeNative=True)))


def half32(word):
    sign, exponent, fraction = (word & 0x8000) << 16, word >> 10 & 31, word & 1023
    if exponent:
        return sign | ((exponent+112) << 23) | (fraction << 13)
    if not fraction:
        return sign
    high = fraction.bit_length()-1
    return sign | ((high+103) << 23) | ((fraction-(1 << high)) << (23-high))


def unpack(raw, size):
    return struct.unpack('<'+('H' if size == 2 else 'I')*(len(raw)//size), raw)


def native_misses(spec, original, native):
    actual, expected = unpack(native, 4), unpack(original, spec['size'])
    assert len(actual) == len(expected)//spec['components']*4
    misses = []
    for i, observed in enumerate(actual):
        pixel, lane = divmod(i, 4)
        if lane < spec['components']:
            word = expected[pixel*spec['components']+lane]
            wanted = half32(word) if spec['precision'] == 16 else word
        else:
            wanted = 0x3f800000 if lane == 3 else 0
        held = observed == wanted or wanted & 0x7fffffff == 0 and observed & 0x7fffffff == 0
        if not held:
            misses.append(dict(component=i, expected=hex(wanted), observed=hex(observed)))
    return misses


def updated_plane(spec, level, native_mutation):
    plane = spec['planes'][level]
    result = bytearray.fromhex(plane['input'])
    changes = [spec['patch']] if level == 1 else [spec['mutation']] if level == 2 and native_mutation else []
    for change in changes:
        box = change.get('box', change)
        source = bytes.fromhex(change['input'])
        row_bytes = box['width']*spec['components']*spec['size']
        for y in range(box['height']):
            target = ((box['y']+y)*plane['width']+box['x'])*spec['components']*spec['size']
            result[target:target+row_bytes] = source[y*row_bytes:(y+1)*row_bytes]
    return bytes(result)


def audit(inputs, healthy, control, output):
    data = json.loads(inputs.read_text())
    specs = {(s['seed'], s['format']): s for s in data['specs']}
    counts = dict(runs=0, nativeComponents=0, publicComponents=0, pboAllocations=0, copies=0,
                  uploads=0, layouts=0, snapshots=0, completedPhysicalWaits=0)
    rows = []
    for path in [healthy, control]:
        capture = json.loads((path/'report.json').read_text())
        assert capture['originalInputSha256'] == sha(inputs.read_bytes())
        assert capture['productBefore'] == capture['productAfter']
        assert capture['browserErrors'] == dict(console=[], page=[], requests=[])
        assert not capture['browser']['headless'] and 'Metal' in capture['result']['gpu'] and 'M4' in capture['result']['gpu']
        assert sha((path/'coverage.json').read_bytes()) == capture['coverageSha256']
        sources = {r['path']: r['sha256'] for r in capture['sources']}
        for served in capture['served']:
            if served['path'] in sources:
                assert served['sha256'] == sources[served['path']]
        result = capture['result']
        assert not result['guestExecution'] and not result['productionDrawAuthority']
        for run in result['runs']:
            spec = specs[run['seed'], run['format']]
            initial = bytes.fromhex(run['initialNative'])
            assert not native_misses(spec, bytes(spec['planes'][0]['width']*spec['planes'][0]['height']*spec['components']*spec['size']), initial)
            for observation in run['observations']:
                level = observation['level']
                original = bytes.fromhex(spec['planes'][level]['input']) if observation['kind'].startswith('initial') else updated_plane(spec, level, True)
                native = bytes.fromhex(observation['native'])
                misses = native_misses(spec, original, native)
                if path == control:
                    assert misses and run['faults'] and result['control']['fenceCompleted']
                    assert observation['fence']['actual'] in [37146, 37148]
                    rows.append(dict(record=str(path), kind='physical-control', status='refuted', nativeMisses=misses[:8], fence=observation['fence']))
                else:
                    assert not misses, (run['seed'], run['format'], observation['kind'], level, misses[:4])
                    counts['nativeComponents'] += len(native)//4
            assert all(value == 0 for value in run['final']['budgets'].values())
            assert all(obj['deletes'] == 1 for obj in run['objects'])
            if path == control:
                continue
            counts['runs'] += 1
            assert bytes.fromhex(run['publicRead']['native']) == updated_plane(spec, 1, False)
            counts['publicComponents'] += len(bytes.fromhex(run['publicRead']['native']))//spec['size']
            assert run['backingBeforeMutation'] == run['backingAfterMutation'] == spec['backing']
            old = run['oldPublicRead']
            box, base = old['box'], bytes.fromhex(spec['planes'][0]['input'])
            original = b''.join(base[((box['y']+y)*19+box['x'])*spec['components']*spec['size']:
                                    ((box['y']+y)*19+box['x']+box['width'])*spec['components']*spec['size']]
                                for y in range(box['height']))
            assert bytes.fromhex(old['native']) == original
            counts['publicComponents'] += len(original)//spec['size']
            assert old['generation'] == run['originalGeneration'] < run['newGeneration']
            for allocation in run['allocations']:
                meta = allocation['metadata']
                pixels = sum(max(1, meta['width']//2**k)*max(1, meta['height']//2**k) for k in range(meta['lastLevel']+1))
                assert meta['byteLength'] == pixels*spec['components']*spec['size']
                assert meta['gpuByteLength'] == pixels*spec['nativeComponents']*spec['size']
                events = [e for e in run['events'] if e['name'] == 'texStorage2D' and e['texture'] == allocation['texture']]
                assert len(events) == 1
                assert events[0]['args'] == [3553, meta['lastLevel']+1, NATIVE_FORMATS[spec['format']], meta['width'], meta['height']]
            for operation in run['operations']:
                layout, fields = operation['layout'], operation['command']['fields']
                pixels = fields['box']['width']*fields['box']['height']
                assert layout['scratchBytes'] == pixels*spec['nativeComponents']*spec['size']
                assert layout['tightBytes'] == pixels*spec['components']*spec['size']
                assert operation['queued']['budgets']['scratchBytes'] == layout['scratchBytes']
                counts['layouts'] += 1
            pbo_sizes = {}
            for event in run['events']:
                if event['name'] == 'bufferData':
                    assert event['args'][0] == 35051 and event['args'][2] == 35041
                    pbo_sizes[event['buffer']] = event['args'][1]
                    counts['pboAllocations'] += 1
                if event['name'] == 'readPixels' and event['buffer'] is not None:
                    assert event['args'][4:7] == [6408, 5126, 0]
                    assert pbo_sizes[event['buffer']] == event['args'][2]*event['args'][3]*16
                if event['name'] == 'clientWaitSync' and event['actual'] in [37146, 37148]:
                    counts['completedPhysicalWaits'] += 1
                if event['name'] == 'blitFramebuffer':
                    assert event['sourceLevel'] == event['targetLevel']+1
                    counts['copies'] += 1
                if event['name'] == 'texSubImage2D':
                    assert event['args'][7] == (5131 if spec['precision'] == 16 else 5126)
                    counts['uploads'] += 1
            for snapshot in run['snapshots']:
                state, staged = snapshot['state'], snapshot['async']['stagingBytes']
                physical = sum(r['gpuByteLength'] for r in state['resources'])
                view = spec['predicted']['viewPhysicalBytes'] if state['budgets']['imageViews'] else 0
                assert state['budgets']['gpuBytes'] == physical+view+staged
                assert state['budgets']['scratchBytes'] == staged
                assert state['budgets']['cpuBytes'] == state['budgets']['backingBytes']+staged
                if snapshot['point'] == 'queued-old-read':
                    assert state['budgets']['gpuBytes'] == spec['predicted']['queuedOldGpuBytes'] and staged == 448
                if snapshot['point'] == 'only-hold-retains-old':
                    assert any(r['generation'] == run['originalGeneration'] for r in state['resources'])
                counts['snapshots'] += 1
            rows.append(dict(record=str(path), seed=run['seed'], format=run['format'], status='held',
                             oldGeneration=run['originalGeneration'], newGeneration=run['newGeneration']))
    assert counts['runs'] == 16 and sum(row.get('kind') == 'physical-control' for row in rows) == 1
    result = dict(schema='independent-floating-partial-range-audit-v1', status='passed', counts=counts, rows=rows)
    output.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(dict(status='passed', counts=counts, controls=[r for r in rows if r.get('kind')])))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    gen = sub.add_parser('generate')
    gen.add_argument('output', type=Path)
    check = sub.add_parser('audit')
    for name in ['inputs', 'healthy', 'control', 'output']:
        check.add_argument(name, type=Path)
    args = parser.parse_args()
    if args.command == 'generate':
        make_inputs(args.output)
    else:
        audit(args.inputs, args.healthy, args.control, args.output)


if __name__ == '__main__':
    main()
