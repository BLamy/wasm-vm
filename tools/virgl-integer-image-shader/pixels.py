#!/usr/bin/env python3
"""Independent complete original-byte/word inverse; never imports the emitter or fixture oracle."""
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


def need(value, why):
    if not value:
        raise ValueError(why)


def immediates(text):
    result = {}
    for m in re.finditer(r'^IMM\[(\d+)\] (FLT32|UINT32|INT32) \{([^}]+)\}$', text, re.M):
        values = m[3].split(',')
        result[int(m[1])] = [struct.unpack('<f', struct.pack('<f', float(v)))[0] if m[2] == 'FLT32' else int(v, 0) for v in values]
    return result


def sample(frame, original, x, y):
    text = frame['vertexText'] if frame['stage'] == 'vertex' else frame['fragmentText']
    m = re.search(r'^\d+: (TEX|TXL|TXF|TXD|TXB|TXQ)(_SAT)?(_PRECISE)? TEMP\[0\](?:\.([xyzw]+))?, (.*), SAMP\[(\d+)\], 2D$', text, re.M)
    need(m is not None and m[1] == frame['opcode'] and int(m[6]) == frame['slot'], 'literal original texture instruction')
    imm = immediates(text)
    mask = m[4] or 'xyzw'
    width, height, levels = frame['width'], frame['height'], frame['levels']
    if m[1] == 'TXQ':
        level = imm[0][0]
        need(isinstance(level, int) and 0 <= level < levels and 'z' not in mask, 'defined original query lanes/level')
        r = [max(1, width >> level), max(1, height >> level), None, levels]
    else:
        if m[1] == 'TXF':
            level, tx, ty = imm[0][3], imm[0][0], imm[0][1]
        else:
            if m[1] == 'TEX':
                level = 0  # constant fragment coordinates or vertex implicit base LOD
            elif m[1] == 'TXD':
                dx, dy = imm[2], imm[3]
                rho = max(math.hypot(width * dx[0], height * dx[1]), math.hypot(width * dy[0], height * dy[1]))
                level = math.floor(math.log2(rho) + .5)
            elif m[1] == 'TXB':
                level = math.floor(math.log2(max(width / frame['frameWidth'], height / frame['frameHeight'])) + imm[0][3] + .5)
            else:
                level = math.floor(imm[0][3] + .5)
            level = min(levels - 1, max(0, level))
            u, v = ((x + .5) / frame['frameWidth'], (y + .5) / frame['frameHeight']) if m[1] == 'TXB' else imm[0][:2]
            tx, ty = math.floor(u * max(1, width >> level)), math.floor(v * max(1, height >> level))
            tx, ty = min(max(1, width >> level) - 1, max(0, tx)), min(max(1, height >> level) - 1, max(0, ty))
        need(isinstance(level, int) and 0 <= level < levels, 'defined fetch/LOD')
        w, h, raw = original[level]
        need(0 <= tx < w and 0 <= ty < h, 'defined original texel coordinate')
        r = original_words(frame, raw, (ty * w + tx))
        if m[2]:
            r = [struct.unpack('<I', struct.pack('<f', min(1.0, max(0.0, struct.unpack('<f', struct.pack('<I', word))[0]))))[0] for word in r]
    r = [r[i] if lane in mask else (imm[1][i] & 0xffffffff) for i, lane in enumerate('xyzw')]
    need(all(word is not None for word in r), 'no undefined query z truth')
    if 'MOV TEMP[0], -|TEMP[0].zyxw|' in text:
        r = [((word & 0x7fffffff) ^ 0x80000000) for word in [r[2], r[1], r[0], r[3]]]
    return r


def original_words(frame, raw, pixel):
    lanes, size, signed = frame['components'], frame['bits'] // 8, frame['signed']
    result = [0, 0, 0, 1]
    for lane in range(lanes):
        at = (pixel * lanes + lane) * size
        result[lane] = int.from_bytes(raw[at:at+size], 'little', signed=signed) & 0xffffffff
    return result


def inspect(directory, fault):
    report = json.loads((directory / 'report.json').read_text())
    need(report['status'] == ('failed' if fault else 'passed'), 'native proof/control status')
    need(report['browserErrors'] == dict(console=[], page=[], requests=[]), 'zero browser errors')
    browser = report['browser']
    need(not browser['launch']['headless'] and browser['gpu']['featureStatus'][browser['webglFeature']] == 'enabled', 'actual headed hardware')
    need(not any(re.search(r'swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu', argument, re.I) for argument in browser['actualCommandLine']), 'no software/native-disable flag')
    a = report['acceptance']
    need(not a['guestExecution'] and not a['productionNegotiation'], 'isolated compiler evidence')
    need('Apple M4 Max' in a['gl']['renderer'] and 'Metal' in a['gl']['renderer'], 'actual native renderer')
    need(len(a['frames']) == (1 if fault else 542), 'complete original frames')
    blobs = {}
    for item in a['blobs']:
        compressed = (directory / item['path']).read_bytes()
        need(sha(compressed) == item['gzipSha256'], 'compressed blob identity')
        raw = gzip.decompress(compressed)
        need(len(raw) == item['bytes'] and sha(raw) == item['sha256'], 'complete native blob identity')
        blobs[item['key']] = raw
    words = planes = original_bytes = pixel_words = 0
    mismatches = []
    for frame in a['frames']:
        n = frame['format'] - 177
        need(0 <= n < 24 and frame['bits'] == [8, 16, 32][n // 8] and frame['signed'] == bool((n % 8) // 4) and frame['components'] == n % 4 + 1, 'literal original integer enum representation')
        need(frame['gpuComplete']['submitted'] and frame['gpuComplete']['fenced'] and frame['cleaned'], 'consumed native draw fence and cleanup')
        original = {}
        for plane in frame['planes']:
            w, h, level = plane['width'], plane['height'], plane['level']
            need(w == max(1, frame['width'] >> level) and h == max(1, frame['height'] >> level), 'original mip extent')
            raw = blobs[plane['original']]
            need(len(raw) == w * h * frame['components'] * frame['bits'] // 8, 'complete original plane bytes')
            original_bytes += len(raw)
            original[level] = (w, h, raw)
            native = blobs[plane['native']]
            wanted = b''.join(struct.pack('<4I', *original_words(frame, raw, pixel)) for pixel in range(w*h))
            need(len(native) == len(wanted), 'full native plane size')
            if native != wanted:
                mismatches.append(dict(frame=frame['name'],plane=level,kind='native-source',expected=sha(wanted),actual=sha(native)))
            native_lanes = 4 if frame['components'] == 3 else frame['components']
            uploaded = blobs[plane['uploaded']]
            expanded = bytearray()
            for pixel in range(w*h):
                at = pixel * frame['components'] * frame['bits'] // 8
                expanded += raw[at:at+frame['components']*frame['bits']//8]
                if native_lanes > frame['components']:
                    expanded += (1).to_bytes(frame['bits']//8, 'little')
            need(uploaded == expanded, 'original RGB expansion/matching signed-width upload')
            words += w*h*4
            planes += 1
        for output in frame['outputs']:
            location, kind = output['location'], output['kind']
            mask = frame['selectors']['signedColorMask'] if kind == 'sint' else frame['selectors']['unsignedColorMask'] if kind == 'uint' else 0
            need(kind == 'float' or mask & (1 << location), 'format-selected native color type')
            need(output['internal'] == {'sint':0x8d82,'uint':0x8d70,'float':0x8814}[kind], 'native matching output format')
            wanted = b''.join(struct.pack('<4I', *sample(frame, original, x, y)) for y in range(frame['frameHeight']) for x in range(frame['frameWidth']))
            actual = blobs[output['native']]
            need(len(actual) == len(wanted), 'whole native typed output size')
            if kind == 'float':
                need(frame['bits'] == 32 and all(math.isfinite(v) for v in struct.unpack('<'+'f'*(len(wanted)//4),wanted)), 'only defined finite FLOAT output truth')
            if actual != wanted:
                mismatches.append(dict(frame=frame['name'],location=location,kind='native-output',expected=sha(wanted),actual=sha(actual)))
            pixel_words += len(actual)//4
        for attribute in frame['attributes']:
            need(blobs[attribute['original']] == blobs[attribute['native']], 'actual original attribute bytes')
    if fault:
        need(mismatches and any(row['kind'] == 'native-output' for row in mismatches), 'physical corruption caught by unchanged complete output oracle')
    else:
        need(not mismatches, 'whole original source/output inverse: '+str(mismatches[:3]))
        need(len(a['typeControls']) == 1 and not a['typeControls'][0]['okay'], 'separate native type-emission refusal')
        need(len(a['compiles']) >= 1962 and all(c['okay'] for c in a['compiles']), 'every admitted native shader compile')
    return dict(name=directory.name,status='refuted' if fault else 'passed',frames=len(a['frames']),originalBytes=original_bytes,nativeSourceWords=words,nativeSourcePlanes=planes,outputWords=pixel_words,mismatches=mismatches)


def main(directory):
    directory = Path(directory).resolve()
    records = [inspect(directory / name, name != 'hardware') for name in ['hardware','fault-wrong-level','fault-wrong-words']]
    result = dict(schema='original-integer-shader-full-inverse-v1',status='passed',records=records,guestExecution=False,productionNegotiation=False)
    (directory / 'physical-audit.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main(sys.argv[1])
