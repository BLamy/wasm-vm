#!/usr/bin/env python3
"""Independently reconstruct the critic's full original mip/query outputs."""
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import sys


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def smaller(n, level):
    return max(1, n // (1 << level))


def immediates(text):
    result = {}
    for index, kind, values in re.findall(r'^IMM\[(\d+)\] (FLT32|INT32|UINT32) \{([^}]+)\}$', text, re.M):
        value = [float(v) if kind == 'FLT32' else int(v) for v in values.split(',')]
        if kind == 'FLT32':
            value = list(struct.unpack('<4f', struct.pack('<4f', *value)))
        result[int(index)] = value
    return result


def operand(term, values):
    negative = term.startswith('-')
    term = term.removeprefix('-')
    absolute = term.startswith('|')
    term = term[1:-1] if absolute else term
    index, swizzle = re.fullmatch(r'IMM\[(\d+)\](?:\.([xyzw]+))?', term).groups()
    swizzle = swizzle or 'xyzw'
    swizzle = swizzle * 4 if len(swizzle) == 1 else swizzle
    result = [values[int(index)]['xyzw'.index(lane)] for lane in swizzle]
    if absolute:
        result = [abs(v) for v in result]
    return [-v for v in result] if negative else result


def image_bytes(seed, slot, index, width, height, levels):
    state = (seed ^ (slot * 0x9e3779b9) ^ (index * 0x85ebca6b)) & 0xffffffff
    result = []
    for level in range(levels):
        raw = bytearray()
        for _ in range(smaller(width, level) * smaller(height, level) * 4):
            state ^= (state << 13) & 0xffffffff
            state ^= state >> 17
            state ^= (state << 5) & 0xffffffff
            state &= 0xffffffff
            raw.append((state >> 19) & 255)
        result.append(bytes(raw))
    return result


def audit(directory, fault):
    directory = Path(directory)
    raw_report = (directory / 'report.json').read_bytes()
    report = json.loads(raw_report)
    assert report['status'] == ('failed' if fault else 'passed')
    assert report['browserErrors'] == {'console': [], 'page': [], 'requests': []}
    assert not report['browser']['launch']['headless']
    assert report['browser']['gpu']['featureStatus'][report['browser']['webglFeature']] == 'enabled'
    assert not any(any(word in argument.lower() for word in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe'])
                   or argument.startswith('--disable-gpu') for argument in report['browser']['actualCommandLine'])
    acceptance = report['acceptance']
    assert 'Apple M4 Max' in acceptance['gl']['renderer'] and 'Metal' in acceptance['gl']['renderer']
    assert not acceptance['guestExecution'] and not acceptance['productionNegotiation']
    original = json.loads((directory / 'original-inputs.json').read_text())
    assert original['seed'] == report['seed']
    cases = json.loads((directory / 'cases.json').read_text())['cases']
    native = [json.loads(line) for line in (directory / 'native.jsonl').read_text().splitlines()]
    assert len(cases) == len(native) == len(original['frames']) == 16
    blobs = {}
    for blob in acceptance['blobs']:
        zipped = (directory / blob['path']).read_bytes()
        assert sha(zipped) == blob['gzipSha256']
        raw = gzip.decompress(zipped)
        assert sha(raw) == blob['sha256'] and len(raw) == blob['bytes'] and blob['key'] not in blobs
        blobs[blob['key']] = raw
    audited = []
    for index, frame in enumerate(acceptance['frames']):
        which = frame['nativeIndex']
        source = original['frames'][which]
        case = cases[which]
        assert frame['pair'] == native[which]['result'] and frame['name'] == source['name']
        assert source['vertexText'] == frame['vertexText'] == case['a']
        assert source['fragmentText'] == frame['fragmentText'] == case['b']
        assert source['selectors'] == frame['selectors'] == case['selectors']
        assert frame['slot'] == (7 if frame['stage'] == 'vertex' else 14)
        assert (frame['resourceWidth'], frame['resourceHeight'], frame['firstLevel'], frame['lastLevel']) == (23, 11, 1, 4)
        assert (frame['width'], frame['height'], frame['levels']) == (11, 5, 4)
        planes = image_bytes(report['seed'], frame['slot'], which % 8, 11, 5, 4)
        assert len(frame['planes']) == 4
        for level, plane in enumerate(frame['planes']):
            assert (plane['width'], plane['height'], plane['level']) == (smaller(11, level), smaller(5, level), level)
            assert plane['internal'] == 32856 and plane['type'] == plane['readType'] == 5121
            assert plane['arrayType'] == 'Uint8Array'
            assert blobs[plane['original']] == blobs[plane['native']] == planes[level] == bytes.fromhex(source['planes'][level]['hex'])
        attributes = {}
        for attribute in frame['attributes']:
            assert blobs[attribute['original']] == blobs[attribute['native']]
            assert attribute['type'] == 5126 and attribute['offset'] == 0
            value = struct.unpack('<24f', blobs[attribute['original']])
            assert list(value) == source['positions' if attribute['index'] == 0 else 'coordinates']
            attributes[attribute['index']] = value
        text = source['vertexText' if frame['stage'] == 'vertex' else 'fragmentText']
        values = immediates(text)
        operation = re.search(r'^\d+: (TXL|TXF|TXD|TXB|TXQ) (.*)$', text, re.M)
        opcode = operation[1] if operation else 'CONSTANT'
        assert opcode == frame['opcode']
        terms = operation[2].split(', ') if operation else []
        if operation:
            assert terms[-2:] == ['SAMP[' + str(frame['slot']) + ']', '2D']
        pixels = struct.unpack('<256f', blobs[frame['pixels']])
        mismatches, maximum = [], 0.0

        def texel(level, x, y):
            width, height = smaller(11, level), smaller(5, level)
            assert 0 <= x < width and 0 <= y < height
            at = (y * width + x) * 4
            return [byte / 255 for byte in planes[level][at:at + 4]]

        for y in range(8):
            for x in range(8):
                if opcode == 'CONSTANT':
                    assert frame['eliminated'] == {'sampler': True, 'query': True}
                    assert frame['pair']['vertex']['metadata']['samplers'] == frame['pair']['vertex']['metadata']['textureQueries'] == []
                    expected = values[0]
                elif opcode == 'TXQ':
                    lod = operand(terms[1], values)[0]
                    assert lod == 1
                    mask = terms[0].split('.')[1]
                    assert mask in ['xyw', 'x', 'w']
                    expected = list(values[1])
                    query = [smaller(11, lod), smaller(5, lod), None, 4]
                    for lane in mask:
                        expected['xyzw'.index(lane)] = query['xyzw'.index(lane)]
                    assert len(frame['queries']) == int('w' in mask)
                    for binding in frame['queries']:
                        assert binding['index'] == frame['slot'] and binding['type'] == 'int'
                        assert binding['semantic'] == 'TEXTURE_LEVELS' and binding['nativeType'] == 5124
                        assert binding['expected'] == binding['actual'] == binding['readback'] == 4
                elif opcode == 'TXF':
                    ix, iy, _, lod = operand(terms[1], values)
                    assert (ix, iy, lod) == (1, 0, 2)
                    expected = texel(lod, ix, iy)
                else:
                    if opcode == 'TXB':
                        assert terms[1] == '|IN[0].yxzw|' and frame['stage'] == 'fragment'
                        attribute = attributes[1]
                        assert all(attribute[at] == 1 for at in [3, 7, 11, 15, 19, 23])
                        u, v = (y + .5) / 8, (x + .5) / 8
                        lod = math.log2(max(11 / 8, 5 / 8)) + 1
                    else:
                        u, v, _, lod = operand(terms[1], values)
                        assert (u, v) == (.3125, .6875)
                        if opcode == 'TXD':
                            dx, dy = operand(terms[2], values), operand(terms[3], values)
                            rho = max(math.hypot(dx[0] * 11, dx[1] * 5), math.hypot(dy[0] * 11, dy[1] * 5))
                            assert rho > 0
                            lod = math.log2(rho)
                    level = max(0, min(3, math.floor(lod + .5)))
                    width, height = smaller(11, level), smaller(5, level)
                    expected = texel(level, max(0, min(width - 1, math.floor(u * width))), max(0, min(height - 1, math.floor(v * height))))
                for lane, predicted in enumerate(expected):
                    observed = pixels[(y * 8 + x) * 4 + lane]
                    error = abs(observed - predicted)
                    maximum = max(maximum, error)
                    tolerance = 0 if opcode == 'TXQ' else .00002
                    if not math.isfinite(observed) or error > tolerance:
                        if len(mismatches) < 12:
                            mismatches.append(dict(x=x, y=y, lane=lane, predicted=predicted, observed=observed, tolerance=tolerance))
        fence = frame['gpuComplete']
        assert fence['submitted'] and fence['fenced'] and fence['status'] in [37146, 37148] and fence['waits'] >= 1
        assert frame['cleaned'] and frame['calls'] == [dict(name='drawArrays', mode=4, first=0, count=6)]
        assert bool(mismatches) == fault
        if fault:
            assert opcode == 'TXL' and frame['nativeFault'] == dict(name='TEXTURE_BASE_LEVEL', actual=1)
            assert 'original texture pixels after consumed fence' in acceptance['error']
        audited.append(dict(name=frame['name'], originalIndex=which, opcode=opcode, stage=frame['stage'], slot=frame['slot'], pixels=64, words=256, nativeTexels=68,
                            held=not mismatches, maxError=maximum, mismatches=mismatches, fence=fence, queries=frame['queries']))
    assert len(audited) == (1 if fault else 16)
    if not fault:
        assert len(acceptance['compiles']) == 32
        for observed in acceptance['compiles']:
            body = native[observed['case']]['result'][observed['stage']]
            assert observed['source'] == body['glsl'] and observed['metadata'] == body['metadata']
            assert observed['okay'] and observed['log'] == ''
    return dict(record=str(directory / 'report.json'), sha256=sha(raw_report), seed=report['seed'], fault=fault, frames=audited,
                pixels=sum(row['pixels'] for row in audited), words=sum(row['words'] for row in audited), nativeTexels=sum(row['nativeTexels'] for row in audited))


def main(directory):
    directory = Path(directory)
    rows = [audit(directory / name, name == 'fault-lod-selection') for name in ['seed-826366247', 'seed-655894553', 'fault-lod-selection']]
    result = dict(status='passed', independentOriginalInputOracle=True, regeneratedFullImageWords=True, undefinedQueryZClaim=False,
                  reports=rows, frames=sum(len(row['frames']) for row in rows), pixels=sum(row['pixels'] for row in rows),
                  words=sum(row['words'] for row in rows), nativeTexels=sum(row['nativeTexels'] for row in rows))
    (directory / 'independent-audit.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: value for key, value in result.items() if key != 'reports'}))


if __name__ == '__main__':
    main(sys.argv[1])
