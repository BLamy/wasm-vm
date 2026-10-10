#!/usr/bin/env python3
"""Reconstruct defined original texture results from full recorded input bodies."""
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


def shrink(n, level):
    return max(1, n // 2 ** level)


def original_immediates(text):
    values = {}
    for index, kind, data in re.findall(r'^IMM\[(\d+)\] (FLT32|UINT32|INT32) \{([^}]+)\}$', text, re.M):
        parsed = [float(value) if kind == 'FLT32' else int(value) for value in data.split(',')]
        if kind == 'FLT32':
            parsed = list(struct.unpack('<4f', struct.pack('<4f', *parsed)))
        values[int(index)] = parsed
    return values


def frame_audit(frame, blobs):
    source = frame['vertexText'] if frame['stage'] == 'vertex' else frame['fragmentText']
    op, suffix, operands = re.search(r'^\d+: (TXL|TXF|TXD|TXB|TXQ)(_SAT)? (.*)$', source, re.M).groups()
    assert op == frame['opcode']
    assert operands.endswith('SAMP[' + str(frame['slot']) + '], 2D')
    imm = original_immediates(source)
    if re.search(r', -IMM\[0\],', operands):
        imm[0] = [-value for value in imm[0]]
    width, height, levels = frame['width'], frame['height'], frame['levels']
    assert width == shrink(frame['resourceWidth'], frame['firstLevel'])
    assert height == shrink(frame['resourceHeight'], frame['firstLevel'])
    assert levels == frame['lastLevel'] - frame['firstLevel'] + 1
    assert len(frame['planes']) == levels
    planes = []
    native_texels = 0
    for level, plane in enumerate(frame['planes']):
        assert plane['level'] == level and plane['width'] == shrink(width, level) and plane['height'] == shrink(height, level)
        original, native = blobs[plane['original']], blobs[plane['native']]
        assert len(original) == len(native) == plane['width'] * plane['height'] * 4
        if frame['kind'] == 'snorm':
            normalize = lambda byte: max(-1, (byte - 256 if byte >= 128 else byte) / 127)
            assert all(normalize(a) == normalize(b) for a, b in zip(original, native))
        else:
            assert native == original
        assert plane['arrayType'] == ('Int8Array' if frame['kind'] == 'snorm' else 'Uint8Array')
        planes.append((plane['width'], plane['height'], original))
        native_texels += plane['width'] * plane['height']
    attributes = {}
    for attribute in frame['attributes']:
        raw = blobs[attribute['original']]
        assert blobs[attribute['native']] == raw
        assert len(raw) == 96 and attribute['type'] == 5126 and attribute['offset'] == 0
        attributes[attribute['index']] = struct.unpack('<24f', raw)
    assert attributes[0] == (-1., -1., 0., 1., 1., -1., 0., 1., -1., 1., 0., 1., -1., 1., 0., 1., 1., -1., 0., 1., 1., 1., 0., 1.)

    def texel(level, x, y):
        w, _, raw = planes[level]
        result = []
        for lane, byte in enumerate(raw[(y * w + x) * 4:(y * w + x) * 4 + 4]):
            if frame['kind'] == 'snorm':
                result.append(max(-1., (byte - 256 if byte >= 128 else byte) / 127))
            elif frame['kind'] == 'srgb' and lane < 3:
                n = byte / 255
                result.append(n / 12.92 if n <= .04045 else ((n + .055) / 1.055) ** 2.4)
            else:
                result.append(byte / 255)
        return result

    def sample(level, u, v):
        w, h, _ = planes[level]
        clamp = lambda n, maximum: max(0, min(maximum - 1, n))
        if not frame['linear']:
            return texel(level, clamp(math.floor(u * w), w), clamp(math.floor(v * h), h))
        px, py = u * w - .5, v * h - .5
        x, y = math.floor(px), math.floor(py)
        dx, dy = px - x, py - y
        a, b = texel(level, clamp(x, w), clamp(y, h)), texel(level, clamp(x + 1, w), clamp(y, h))
        c, d = texel(level, clamp(x, w), clamp(y + 1, h)), texel(level, clamp(x + 1, w), clamp(y + 1, h))
        return [(a[i] * (1 - dx) + b[i] * dx) * (1 - dy) + (c[i] * (1 - dx) + d[i] * dx) * dy for i in range(4)]

    fw, fh = frame['frameWidth'], frame['frameHeight']
    pixels = struct.unpack('<' + str(fw * fh * 4) + 'f', blobs[frame['pixels']])
    mismatch, max_error = [], 0
    for y in range(fh):
        for x in range(fw):
            if op == 'TXQ':
                lod = imm[0][0]
                assert 0 <= lod < levels
                result = list(imm[1])
                mask = re.match(r'TEMP\[0\]\.([xyw]+),', operands)[1]
                defined = [shrink(width, lod), shrink(height, lod), None, levels]
                for lane in mask:
                    index = 'xyzw'.index(lane)
                    result[index] = defined[index]
                expected_queries = 1 if 'w' in mask else 0
                assert len(frame['queries']) == expected_queries
                for query in frame['queries']:
                    assert query['index'] == frame['slot'] and query['nativeType'] == 5124
                    assert query['expected'] == levels and query['readback'] == query['actual']
            elif op == 'TXF':
                ix, iy, _, lod = imm[0]
                assert 0 <= lod < levels and 0 <= ix < shrink(width, lod) and 0 <= iy < shrink(height, lod)
                result = texel(lod, ix, iy)
            else:
                if op == 'TXB':
                    coords = attributes[1]
                    assert coords[0:2] == (0., 0.) and coords[4:6] == (1., 0.) and coords[8:10] == (0., 1.)
                    bias = coords[3]
                    assert all(coords[at] == bias for at in [7, 11, 15, 19, 23])
                    level = math.floor(math.log2(max(width / fw, height / fh)) + bias + .5)
                    u, v = (x + .5) / fw, (y + .5) / fh
                else:
                    u, v, _, lod = imm[0]
                    if op == 'TXD':
                        dx, dy = imm[1], imm[2]
                        rho = max(math.hypot(dx[0] * width, dx[1] * height), math.hypot(dy[0] * width, dy[1] * height))
                        assert rho > 0
                        lod = math.log2(rho)
                    level = math.floor(lod + .5)
                result = sample(max(0, min(levels - 1, level)), u, v)
            if suffix:
                result = [max(0, min(1, value)) for value in result]
            tolerance = 0 if op == 'TXQ' else .005 if frame['kind'] == 'srgb' else .0003 if frame['linear'] else .00002
            for lane, expected in enumerate(result):
                actual = pixels[(y * fw + x) * 4 + lane]
                error = abs(actual - expected)
                max_error = max(max_error, error)
                if not math.isfinite(actual) or error > tolerance:
                    if len(mismatch) < 12:
                        mismatch.append(dict(x=x, y=y, lane=lane, expected=expected, actual=actual, tolerance=tolerance))
    fence = frame['gpuComplete']
    assert fence['submitted'] and fence['fenced'] and fence['waits'] >= 1 and fence['status'] in [37146, 37148]
    assert frame['cleaned'] and frame['calls'] == [dict(name='drawArrays', mode=4, first=0, count=6)]
    return dict(name=frame['name'], pixels=fw * fh, checkedWords=len(pixels), nativeTexels=native_texels,
                held=not mismatch, maxError=max_error, mismatches=mismatch)


def main(directory):
    directory = Path(directory).resolve()
    healthy, faults = [], []
    for name in ['hardware', 'fault-lod-selection', 'fault-gradient-state', 'fault-query-levels']:
        base = directory / name
        report = json.loads((base / 'report.json').read_text())
        acceptance = report['acceptance']
        fault = name != 'hardware'
        assert report['status'] == ('failed' if fault else 'passed')
        assert report['browserErrors'] == dict(console=[], page=[], requests=[])
        assert not acceptance['guestExecution'] and not acceptance['productionNegotiation']
        blobs = {}
        for blob in acceptance['blobs']:
            zipped = (base / blob['path']).read_bytes()
            assert sha(zipped) == blob['gzipSha256']
            raw = gzip.decompress(zipped)
            assert len(raw) == blob['bytes'] and sha(raw) == blob['sha256']
            assert blob['key'] not in blobs
            blobs[blob['key']] = raw
        audits = [frame_audit(frame, blobs) for frame in acceptance['frames']]
        if fault:
            assert len(audits) == 1 and not audits[0]['held']
            assert 'original texture pixels after consumed fence' in acceptance['error']
            faults.append(dict(control=name, **audits[0]))
        else:
            assert len(audits) == 246 and all(row['held'] for row in audits)
            healthy = audits
    result = dict(status='passed', frames=healthy, faults=faults, pixels=sum(row['pixels'] for row in healthy),
                  checkedWords=sum(row['checkedWords'] for row in healthy), nativeTexels=sum(row['nativeTexels'] for row in healthy),
                  nativeDraws=len(healthy), originalInputReconstruction=True, noUndefinedQueryDimensions=True)
    (directory / 'physical-audit.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key:value for key,value in result.items() if key not in ['frames', 'faults']}))


if __name__ == '__main__':
    main(sys.argv[1])
