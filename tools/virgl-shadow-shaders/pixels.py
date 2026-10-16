#!/usr/bin/env python3
"""Replay original TGSI words against authenticated native inputs and whole planes.

This oracle does not read generated ESSL or the JavaScript fixture's expectedWords.
Its tiny TGSI interpreter is deliberately restricted to the recorded physical probes.
Comparison-linear probes have constant depth in each complete level: every filter tap
therefore has the same result, including on implementations with different PCF rules.
"""
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import sys

sha = lambda raw: hashlib.sha256(raw).hexdigest()
u32 = lambda raw, at=0: struct.unpack_from('<I', raw, at)[0]
f32 = lambda raw, at=0: struct.unpack_from('<f', raw, at)[0]
fw = lambda value: struct.unpack('<I', struct.pack('<f', value))[0]
wf = lambda value: struct.unpack('<f', struct.pack('<I', value & 0xffffffff))[0]
handle = lambda value: value['handle'] if value else None
MASK = 0xffffffff


def declarations(text, direction):
    return {int(m[1]): int(m[2]) for m in re.finditer(
        r'^DCL '+direction+r'\[(\d+)\], GENERIC\[(\d+)\]', text, re.M)}


def source(expression, registers):
    negative = expression.startswith('-')
    expression = expression.removeprefix('-')
    absolute = expression.startswith('|')
    if absolute:
        assert expression.endswith('|')
        expression = expression[1:-1]
    match = re.fullmatch(r'(IN|OUT|TEMP|IMM|SV)\[(\d+)\](?:\.([xyzw]{4}))?', expression)
    assert match, expression
    words = registers[(match[1], int(match[2]))]
    words = [words['xyzw'.index(c)] for c in (match[3] or 'xyzw')]
    if absolute:
        words = [w & 0x7fffffff for w in words]
    if negative:
        words = [w ^ 0x80000000 for w in words]
    return words


def execute(text, inputs, vertex, instance, base, sampler, depth, view, derivatives=None):
    regs = {('IN', index): words for index, words in inputs.items()}
    for match in re.finditer(r'^IMM\[(\d+)\] (UINT32|INT32) \{([^}]+)\}', text, re.M):
        regs[('IMM', int(match[1]))] = [int(n.strip()) & MASK for n in match[3].split(',')]
    for match in re.finditer(r'^DCL SV\[(\d+)\], (INSTANCEID|VERTEXID)', text, re.M):
        regs[('SV', int(match[1]))] = [((base + instance) if match[2] == 'INSTANCEID' else vertex) & MASK] * 4
    for match in re.finditer(r'^\d+: (\w+)(?: (.*))?$', text, re.M):
        opcode, operands = match[1], match[2]
        if opcode == 'END':
            continue
        args = operands.split(', ')
        dest = re.fullmatch(r'(OUT|TEMP)\[(\d+)\](?:\.([xyzw]+))?', args[0])
        assert dest, args[0]
        key = (dest[1], int(dest[2]))
        if opcode == 'MOV':
            value = source(args[1], regs)
        elif opcode == 'ADD':
            value = [fw(wf(a) + wf(b)) for a, b in zip(source(args[1], regs), source(args[2], regs))]
        elif opcode == 'XOR':
            value = [(a ^ b) & MASK for a, b in zip(source(args[1], regs), source(args[2], regs))]
        elif opcode == 'TXQ':
            assert source(args[1], regs) == [0, 0, 0, 0]
            assert args[-1] in ['2D', 'SHADOW2D']
            value = [depth[0]['width'], depth[0]['height'], 0, len(depth)]
        else:
            assert opcode in ['TEX', 'TXL', 'TXD', 'TXP', 'TXB'] and args[-1] == 'SHADOW2D'
            coord = [wf(w) for w in source(args[1], regs)]
            if opcode == 'TXP':
                assert coord[3] != 0
                coord = [v / coord[3] for v in coord[:3]] + [coord[3]]
            lod = 0
            if opcode == 'TXL':
                lod = coord[3]
            elif opcode == 'TXD':
                dx, dy = ([wf(w) for w in source(arg, regs)] for arg in args[2:4])
                rho = max(math.hypot(dx[0]*depth[0]['width'], dx[1]*depth[0]['height']),
                          math.hypot(dy[0]*depth[0]['width'], dy[1]*depth[0]['height']))
                lod = math.log2(rho) if rho else -math.inf
            elif opcode == 'TXB' and derivatives:
                rho = max(math.hypot(derivatives[0][0]*depth[0]['width'], derivatives[0][1]*depth[0]['height']),
                          math.hypot(derivatives[1][0]*depth[0]['width'], derivatives[1][1]*depth[0]['height']))
                lod = (math.log2(rho) if rho else -math.inf) + coord[3]
            else:
                # Point derivatives are not the oracle. These original probes make
                # every accessible level identical, so any legal implicit LOD agrees.
                assert len({level['value'] for level in depth.values()}) == 1
            lod = min(sampler['maxLod'], max(sampler['minLod'], lod))
            level = min(len(depth)-1, max(0, math.floor(lod + .5)))
            z, ref = depth[level]['value'], coord[2]
            compare = [False, ref < z, ref == z, ref <= z, ref > z, ref != z, ref >= z, True][sampler['function']]
            value = [fw(0 if c == 4 else 1 if c == 5 else int(compare)) for c in view]
        out = regs.setdefault(key, [0, 0, 0, 0]).copy()
        for lane in dest[3] or 'xyzw':
            i = 'xyzw'.index(lane)
            out[i] = value[i]
        regs[key] = out
    return {index: words for (kind, index), words in regs.items() if kind == 'OUT'}


def audit(directory, matrix_directory):
    report = json.loads((directory/'report.json').read_text())
    a = report['acceptance']
    assert not a['guestExecution'] and not a['productionNegotiation']
    assert report['browserErrors'] == dict(console=[], page=[], requests=[])
    matrix = json.loads((matrix_directory/'cases.json').read_text())['cases']
    native = [json.loads(row) for row in (matrix_directory/'native.jsonl').read_text().splitlines()]
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
    bound, buffers, pointers, divisors, locations, values, textures, texbound, samplers, sampbound = {}, {}, {}, {}, {}, {}, {}, {}, {}, {}
    program = None
    unit = 0
    cursor = 0
    records, mismatches, fenced = [], [], set()
    for f in a['frames']:
        case = matrix[f['nativeIndex']]
        assert case['kind'] == 31 and case['a'] == f['vertexText'] and case['b'] == f['fragmentText'] and case['selectors'] == f['selectors']
        assert native[f['nativeIndex']]['result'] == f['pair'] and f['pair']['ok']
        sampler_words, view_words = f['originalSamplerWords'], f['originalViewWords']
        assert len(sampler_words) == 10 and sampler_words[0] == (9 << 16 | 7 << 8 | 1)
        bits = sampler_words[2]
        assert bits & 511 == 2 | 2 << 3 | 2 << 6 and bits >> 11 & 3 == 0 and bits >> 15 & 1 == 1
        sampler = dict(function=bits >> 16 & 7, minLod=wf(sampler_words[4]), maxLod=wf(sampler_words[5]))
        assert len(view_words) == 7 and view_words[0] == (6 << 16 | 6 << 8 | 1)
        assert view_words[3] == 18 | 2 << 24 and view_words[4] == 0 and view_words[5] == 2 << 8
        view = [view_words[6] >> (3*i) & 7 for i in range(4)]
        assert all(c <= 5 for c in view) and view_words[6] >> 12 == 0
        writer = events[f['gpuComplete']['writerEvent']]
        while cursor <= writer['id']:
            e = events[cursor]
            cursor += 1
            args, method = e['args'], e['method']
            if method == 'useProgram': program = handle(args[0])
            elif method == 'bindBuffer': bound[args[0]] = handle(args[1])
            elif method == 'bufferData': buffers[bound[args[0]]] = bodies[args[1]['key']]
            elif method == 'getBufferSubData':
                raw = bodies[e['after'][2]['key']]
                assert raw == buffers[bound[args[0]]][args[1]:args[1]+len(raw)]
            elif method == 'bindVertexArray':
                pointers, divisors = {}, {}
            elif method == 'vertexAttribPointer': pointers[args[0]] = (bound[34962], args)
            elif method == 'vertexAttribDivisor': divisors[args[0]] = args[1]
            elif method == 'getUniformLocation' and e['result']:
                locations[handle(e['result'])] = (handle(args[0]), args[1])
            elif method in ['uniform1i', 'uniform1ui', 'uniform4fv']:
                value = args[1]
                if isinstance(value, dict): value = list(struct.unpack('<4f', bodies[value['key']]))
                values[locations[handle(args[0])]] = value
            elif method == 'activeTexture': unit = args[0] - 33984
            elif method == 'bindTexture': texbound[unit] = handle(args[1])
            elif method == 'texStorage2D':
                textures[texbound[unit]] = dict(storage=args[1:], levels={})
            elif method == 'texSubImage2D':
                assert args[2:4] == [0, 0] and args[6:8] == [6402, 5126]
                raw = bodies[args[8]['key']]
                zs = struct.unpack('<'+'f'*(len(raw)//4), raw)
                assert len(zs) == args[4]*args[5] and len(set(zs)) == 1
                textures[texbound[unit]]['levels'][args[1]] = dict(width=args[4], height=args[5], value=zs[0], bytesKey=args[8]['key'])
            elif method in ['samplerParameteri', 'samplerParameterf']: samplers.setdefault(handle(args[0]), {})[args[1]] = args[2]
            elif method == 'bindSampler': sampbound[args[0]] = handle(args[1])
        assert writer['method'] in ['drawArrays', 'drawArraysInstanced']
        assert writer['args'][1] == 0
        mode, _, count = writer['args'][:3]
        instances = writer['args'][3] if writer['method'] == 'drawArraysInstanced' else 1
        uniforms = {name: value for (owner, name), value in values.items() if owner == program}
        prefix = 'vs' if f['vertexText'].find('SHADOW2D') >= 0 else 'fs'
        slots = set(int(m[1]) for m in re.finditer(r'SAMP\[(\d+)\], SHADOW2D', case['a'] + case['b']))
        assert len(slots) == 1
        slot = next(iter(slots))
        assert uniforms[prefix+'samp'+str(slot)] == 8
        expected_mask, expected_add = [int(c < 4) for c in view], [int(c == 5) for c in view]
        actual_mask = uniforms[prefix+'shadmask'+str(slot)]
        if f.get('fault'):
            assert actual_mask == [0] + expected_mask[1:]
        else:
            assert actual_mask == expected_mask
        assert uniforms[prefix+'shadadd'+str(slot)] == expected_add
        depth = textures[texbound[8]]
        assert depth['storage'] == [3, 36012, 4, 2] and set(depth['levels']) == {0, 1, 2}
        params = samplers[sampbound[8]]
        assert params == {10241: 9984 if bits >> 9 & 1 == 0 else 9985, 10240: 9728 if bits >> 13 & 1 == 0 else 9729,
                          10242: 33071, 10243: 33071, 34892: 34894, 34893: 512 + sampler['function'],
                          33082: sampler['minLod'], 33083: sampler['maxLod']}
        for name, key in f['originalInputs'].items():
            if name == 'offsets': index = 4
            else: index = dict(positions=0, coordinates=1, dx=2, dy=3)[name]
            attribute = next(item for item in f['attributes'] if item['index'] == index)
            if attribute['location'] >= 0:
                assert buffers[pointers[attribute['location']][0]] == bodies[key]
        assert f['block'] == dict(index=0, size=656, offset=640, type=5126)
        assert any(len(raw) == 656 and raw == bytes(640) + struct.pack('<f', 1) + bytes(12) for raw in buffers.values())
        def attributes(vertex, instance):
            inputs = {}
            for item in f['attributes']:
                index, location = item['index'], item['location']
                if location < 0:
                    continue
                buffer, args = pointers[location]
                assert args[1] == 4 and args[3:] == [False, 0, 0]
                original_index = instance if divisors[location] else vertex
                if args[2] == 5126:
                    raw = buffers[buffer]
                    inputs[index] = [u32(raw, original_index*16+i*4) for i in range(4)]
                else:
                    assert args[2] == 33640 and case['selectors']['packedSignedMask'] & (1 << index) and case['selectors']['packedNormalizedMask'] & (1 << index)
                    packed = u32(buffers[buffer], original_index*4)
                    fields = [(packed >> (10*i)) & 1023 for i in range(3)] + [packed >> 30]
                    signed = [v-(1 << bits) if v >= (1 << (bits-1)) else v for v, bits in zip(fields, [10, 10, 10, 2])]
                    inputs[index] = [fw(max(-1, v/scale)) for v, scale in zip(signed, [511, 511, 511, 1])]
            return inputs
        own = {}
        base = uniforms.get('wv_instance_base', 0)
        vout, fin = declarations(case['a'], 'OUT'), declarations(case['b'], 'IN')
        def run_vertex(vertex, instance):
            return execute(case['a'], attributes(vertex, instance), vertex, instance, base, sampler, depth['levels'], view)
        def fragment(outputs, derivative=None):
            varyings = {semantic: outputs[index] for index, semantic in vout.items()}
            inputs = {index: varyings[semantic] for index, semantic in fin.items()}
            return execute(case['b'], inputs, 0, 0, 0, sampler, depth['levels'], view, derivative)[0]
        if mode == 0:
            for instance in range(instances):
                for vertex in range(count):
                    outputs = run_vertex(vertex, instance)
                    pos = [wf(w) for w in outputs[0]]
                    x = math.floor((pos[0]/pos[3]+1)*f['width']/2)
                    y = math.floor((pos[1]/pos[3]+1)*f['height']/2)
                    assert 0 <= x < f['width'] and 0 <= y < f['height'] and (x, y) not in own
                    own[x, y] = fragment(outputs)
        else:
            assert mode == 4 and count == 6 and instances == 1
            vertices = [run_vertex(i, 0) for i in range(count)]
            # The original two triangles have w=1 and the same affine plane.
            assert all(out[0][3] == fw(1) for out in vertices)
            v = [[wf(w) for w in out[1]] for out in vertices]
            assert v[2] == v[3] and v[1] == v[4]
            assert v[5] == [v[1][i]+v[2][i]-v[0][i] for i in range(4)]
            assert [[wf(w) for w in out[0]][:2] for out in vertices] == [[-1,-1],[1,-1],[-1,1],[-1,1],[1,-1],[1,1]]
            dx = [(v[1][i]-v[0][i])/f['width'] for i in range(4)]
            dy = [(v[2][i]-v[0][i])/f['height'] for i in range(4)]
            for y in range(f['height']):
                for x in range(f['width']):
                    outputs = {0: [fw(0), fw(0), fw(0), fw(1)], 1: [fw(v[0][i]+(x+.5)*dx[i]+(y+.5)*dy[i]) for i in range(4)], 2: [0]*4, 3: [0]*4}
                    own[x, y] = fragment(outputs, (dx, dy))
        assert len(own) == f['width']*f['height']
        fence = f['gpuComplete']
        created, consumed, read = (events[fence['createdEvent']], events[fence['consumedEvent']], events[f['output']['readEvent']])
        assert fence['fenced'] and writer['id'] < created['id'] < consumed['id'] < read['id']
        assert created['method'] == 'fenceSync' and created['args'] == [37143, 0]
        token = handle(created['result'])
        assert token == fence['handle'] and token not in fenced
        fenced.add(token)
        assert consumed['method'] == 'clientWaitSync' and consumed['args'] == [{'handle': token, 'type': 'WebGLSync'}, 0, 0]
        assert consumed['result'] == fence['status'] and fence['status'] in [37146, 37148]
        assert any(e['method'] == 'deleteSync' and handle(e['args'][0]) == token for e in events[consumed['id']:read['id']])
        assert read['method'] == 'readPixels' and read['args'][:6] == [0, 0, f['width'], f['height'], 36249, 5125]
        raw = bodies[read['after'][-1]['key']]
        assert read['after'][-1]['key'] == f['output']['bytesKey'] and len(raw) == len(own)*16 and f['cleaned']
        for (x, y), expected in own.items():
            for lane in range(4):
                observed = u32(raw, ((y*f['width']+x)*4+lane)*4)
                if observed != expected[lane]:
                    mismatches.append(dict(frame=f['name'], x=x, y=y, lane=lane, expected=expected[lane], observed=observed, writerEvent=writer['id'], readEvent=read['id']))
        records.append(dict(name=f['name'], nativeIndex=f['nativeIndex'], originalShaderSha256=sha((case['a']+case['b']).encode()),
                            originalSamplerWords=sampler_words, originalViewWords=view_words, outputSha256=sha(raw),
                            writerEvent=writer['id'], fence=fence, readEvent=read['id'], pixels=len(own), words=len(own)*4))
    fault = directory.name.startswith('fault-')
    if fault:
        assert report['status'] == 'failed' and len(records) == 2 and len(mismatches) == 3
        assert all(m['lane'] == 0 and m['frame'].endswith('/completed-wrong-mask') and m['expected'] == fw(1) and m['observed'] == 0 for m in mismatches)
        assert 'original shadow/view words after completion' in a['error']
    else:
        assert report['status'] == 'passed' and len(records) == 896 and len(a['compiles']) == 4081 and not mismatches
        assert len(a['typeControls']) == 1 and a['typeControls'][0]['okay'] is False
    return dict(status='refuted' if fault else 'passed', directory=directory.name, reportSha256=sha((directory/'report.json').read_bytes()),
                reopenedBodies=len(bodies), events=len(events), frames=records, mismatches=mismatches)


def main(directory):
    directory = Path(directory).resolve()
    records = [audit(directory/name, directory/'native') for name in ['hardware', 'fault-wrong-mask']]
    result = dict(status='passed', schema='original-shadow-native-reconstruction-v1', records=records, rawWordsIndependentOfESSL=True)
    (directory/'physical-audit.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(dict(status='passed', frames=len(records[0]['frames']), pixels=sum(f['pixels'] for f in records[0]['frames']),
                          words=sum(f['words'] for f in records[0]['frames']), physicallyRefutedMask=True)))


if __name__ == '__main__':
    main(sys.argv[1])
