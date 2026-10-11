#!/usr/bin/env python3
"""Independent critic checks on raw wire, finest coverage and handwritten pixels."""
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
BASE = '5a0d9fc9655f1e0956154763bda420aec721865a'
FREEZE = 'de736cd109a092b59c82a83dd9520ee5928b8c2a'
sha = lambda raw: hashlib.sha256(raw).hexdigest()
RUNTIME = ['renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/state.mjs']


def packets(hex_body):
    raw = bytes.fromhex(hex_body)
    at = 0
    while at < len(raw):
        h, = struct.unpack_from('<I', raw, at)
        n = h >> 16
        end = at+4*(n+1)
        assert end <= len(raw)
        yield h & 255, (h >> 8) & 255, list(struct.unpack_from('<'+'I'*n, raw, at+4)), raw[at:end]
        at = end
    assert at == len(raw)


def audit_wire(directory):
    report = json.loads((directory/'wire/report.json').read_text())
    source = subprocess.check_output(['git', 'show', FREEZE+':renderer/virgl-command/decoder.mjs'], cwd=ROOT, text=True)
    historical = set(re.findall(r'export function (decode\w*Submission)\(', source)) - {'decodeStandardStencilSubmission'}
    out = []
    for row in report['wire']['rows']:
        opcode, kind, words, raw = list(packets(row['hex']))[0]
        result = row['result']
        assert result['ok'] == (row['kind'] != 'refusal')
        if row['kind'] == 'DSA':
            assert opcode == 1 and kind == 3
            faces = [dict(enabled=bool(w & 1), function=(w >> 1) & 7, failOperation=(w >> 4) & 7,
                          depthPassOperation=(w >> 7) & 7, depthFailOperation=(w >> 10) & 7,
                          valueMask=(w >> 13) & 255, writeMask=(w >> 21) & 255) for w in words[2:4]]
            f = result['commands'][0]['fields']
            assert f['stencil'] == faces
            assert f['alphaEnable'] is False and f['alphaFunction'] == (words[1] >> 9) & 7
            assert f['alphaReference'] == struct.unpack_from('<f', raw, 20)[0]
        elif row['kind'] in ['CLEAR', 'wide-CLEAR']:
            assert opcode == 7 and kind == 0 and result['commands'][0]['fields']['stencil'] == words[7]
        if 'refusals' in row:
            assert {r['name'] for r in row['refusals']} == historical and all(not r['result']['ok'] for r in row['refusals'])
        out.append(dict(kind=row['kind'], name=row.get('name'), opcode=opcode, words=words,
                        ok=result['ok'], byteBodySha256=sha(raw)))
    assert len(out) == 20
    return out


def coverage(directory):
    diff = subprocess.check_output(['git', 'diff', '--unified=0', BASE, FREEZE, '--', *RUNTIME], cwd=ROOT, text=True)
    additions, name, line = {}, None, 0
    for row in diff.splitlines():
        if row.startswith('+++ b/'):
            name = row[6:]
        elif row.startswith('@@'):
            line = int(re.search(r'\+(\d+)', row)[1])
        elif row.startswith('+') and name:
            additions.setdefault(name, []).append(line)
            line += 1
        elif row.startswith(' '):
            line += 1
    scripts = []
    bodies = {n: subprocess.check_output(['git', 'show', FREEZE+':'+n], cwd=ROOT) for n in RUNTIME}
    for path in sorted(directory.glob('*/browser-coverage.json')):
        if path.parent.name.startswith('fault-'):
            continue
        for script in json.loads(path.read_text())['scripts']:
            if script['source'] in RUNTIME:
                assert script['sourceBody'].encode() == bodies[script['source']]
                assert script['sha256'] == sha(bodies[script['source']])
                scripts.append(dict(record=path.relative_to(directory).as_posix(), **script))
    for path in sorted((directory/'node-coverage').glob('coverage-*.json')):
        for script in json.loads(path.read_text())['result']:
            matched = [n for n in RUNTIME if script['url'].startswith('file:') and script['url'].endswith('/'+n)]
            if matched:
                name = matched[0]
                assert (directory/'wire/source'/name).read_bytes() == bodies[name]
                scripts.append(dict(source=name, record=path.relative_to(directory).as_posix(), coverage=script))
    waivers = {(r['source'], r['startOffset'], r['endOffset']): r for r in json.loads((ROOT/'tools/virgl-stencil/coverage-waivers.json').read_text())['waivers']}
    partitions = []
    for name, lines in additions.items():
        text = bodies[name].decode()
        offsets = [0]
        for row in text.splitlines(keepends=True):
            offsets.append(offsets[-1]+len(row.encode('utf-16-le'))//2)
        for line in lines:
            a, b = offsets[line-1], offsets[line]
            cuts = {a, b}
            applicable = [s for s in scripts if s['source'] == name]
            for script in applicable:
                for fn in script['coverage']['functions']:
                    for r in fn['ranges']:
                        cuts.update(o for o in [r['startOffset'], r['endOffset']] if a < o < b)
            for start, end in zip(sorted(cuts), sorted(cuts)[1:]):
                counters = []
                for script in applicable:
                    govern = [r for f in script['coverage']['functions'] for r in f['ranges'] if r['startOffset'] <= start and end <= r['endOffset']]
                    if govern:
                        finest = min(govern, key=lambda r: r['endOffset']-r['startOffset'])
                        counters.append(dict(record=script['record'], **finest))
                count = max([r['count'] for r in counters] or [0])
                row = dict(source=name, line=line, startOffset=start, endOffset=end, maxCount=count, governingCounters=counters)
                if count == 0:
                    raw = text.encode('utf-16-le')[start*2:end*2].decode('utf-16-le')
                    w = waivers.get((name, start, end))
                    assert w and w['classification'] == 'unchanged-operand' and 'stencil' not in raw.lower(), row
                    old = subprocess.check_output(['git', 'show', BASE+':'+name], cwd=ROOT)
                    held = old.decode().encode('utf-16-le')[w['predecessorStartOffset']*2:w['predecessorEndOffset']*2].decode('utf-16-le')
                    assert raw == held == w['text'] and sha(raw.encode()) == w['sha256'] and sha(old) == w['predecessorSourceSha256']
                    row['waiver'] = w
                partitions.append(row)
    return dict(partitions=partitions, positive=sum(p['maxCount'] > 0 for p in partitions),
                exactUnchangedWaivers=sum(p['maxCount'] == 0 for p in partitions), zeroNewPartitions=0,
                sourceDigests={n: sha(b) for n, b in bodies.items()})


def ordered(directory):
    env = json.loads((directory/'report.json').read_text())
    assert env['status'] == 'passed' and env['browserErrors'] == dict(console=[], page=[], requests=[])
    e = env['browserResult']['result']
    blobs = {r['key']: r for r in e['blobs']}
    def body(ref):
        r = blobs[ref['key']]
        z = (directory/r['path']).read_bytes()
        raw = gzip.decompress(z)
        assert sha(z) == r['gzipSha256'] and len(raw) == r['bytes'] == ref['bytes'] and sha(raw) == r['sha256'] == ref['sha256']
        return raw
    points = [(0, 17, 71, 71), (197, 214, 130, 128), (198, 215, 141, 165), (238, 255, 85, 85), (239, 0, 84, 84)]
    rows = []
    for ref in e['runs']:
        raw = (directory/ref['path']).read_bytes()
        assert len(raw) == ref['bytes'] and sha(raw) == ref['sha256']
        run = json.loads(raw)
        fmt = run['format']
        plane = next(p for p in run['planes'] if p['level'] == 0)
        initial = body(plane['input'])
        before = body(run['frames'][0]['depths'][0]['native'])
        after = body(run['frames'][1]['depths'][0]['native'])
        prefix = plane['width']*plane['height']*16
        assert len(run['frames']) == 2 and len(run['draws']) == 4
        history_draws = [[op for op, _, _, _ in packets(h['hex'])].count(8) for h in run['history']]
        assert history_draws.count(2) == 2
        for index, original, first, final in points:
            actual = (initial[index*(8 if fmt == 126 else 4)+(4 if fmt == 126 else 0)], before[prefix+index*4], after[prefix+index*4])
            assert actual == (original, first, final), (run['name'], index, actual)
            rows.append(dict(run=run['name'], originalPixelIndex=index, inputS8=original,
                             afterTwoOriginalDraws=first, afterMaskedAndDisabledDraws=final,
                             nativeByteOffset=prefix+index*4, firstNativeDigest=sha(before), finalNativeDigest=sha(after)))
    assert len(e['runs']) == 4
    return dict(status='passed', points=rows, completeNativePlanesCheckedByOriginalInverse=True)


def switch(directory):
    env = json.loads((directory/'report.json').read_text())
    assert env['status'] == 'passed' and env['browserErrors'] == dict(console=[], page=[], requests=[])
    e = env['browserResult']['result']
    assert not e['guestExecution'] and not e['productionNegotiation']
    blobs = {r['key']: r for r in e['blobs']}
    assert len(blobs) == len(e['blobs'])
    for row in blobs.values():
        z = (directory/row['path']).read_bytes()
        raw = gzip.decompress(z)
        assert sha(z) == row['gzipSha256'] and len(raw) == row['bytes'] and sha(raw) == row['sha256']
    def body(ref):
        row = blobs[ref['key']]
        assert row['sha256'] == ref['sha256'] and row['bytes'] == ref['bytes']
        return gzip.decompress((directory/row['path']).read_bytes())
    sys.path.insert(0, str(ROOT/'tools/virgl-unorm-depth'))
    from lifetimes import audit_lifetimes
    out, native_pixels, public_bytes, consumed, blits = [], 0, 0, 0, 0
    for ref in e['runs']:
        raw = (directory/ref['path']).read_bytes()
        assert len(raw) == ref['bytes'] and sha(raw) == ref['sha256']
        run = json.loads(raw)
        fmt, old_fmt = run['replacementFormat'], run['format']
        assert fmt in [18, 21] and old_fmt in [20, 126]
        shader_sources, colors, bound_fragment, clear_s8, dsas, active, framebuffer, transfers = {}, [], None, [], {}, None, None, []
        for hi, history in enumerate(run['history']):
            assert history['result']['ok'] and history['result'].get('gpuComplete') is True
            for op, kind, w, packet_raw in packets(history['hex']):
                if op == 1 and kind == 4:
                    shader_sources[w[0]] = packet_raw[24:24+w[2]-1].decode()
                elif op == 31 and w[1] == 1:
                    bound_fragment = shader_sources[w[0]]
                elif op == 1 and kind == 3:
                    dsas[w[0]] = w
                elif op == 2 and kind == 3:
                    active = dsas[w[0]]
                elif op == 5:
                    framebuffer = w
                elif op == 7 and w[0] & 2:
                    clear_s8.append(w[7])
                elif op == 8:
                    assert active and framebuffer == [1, 80, 20]
                    assert active[1] & 1 == 0 and active[1] & 2 == 2
                    assert active[2] & 1 == active[3] & 1 == 1
                    assert (active[2] >> 1) & 7 == (active[3] >> 1) & 7 == 0
                    assert (active[2] >> 13) & 255 == 85 and (active[3] >> 13) & 255 == 15
                    assert (active[2] >> 21) & 255 == 170 and (active[3] >> 21) & 255 == 127
                    match = re.search(r'IMM\[0\] UINT32 \{([^}]+)\}', bound_fragment)
                    assert match and 'MOV OUT[0], IMM[0]' in bound_fragment
                    colors = list(map(int, match[1].split(',')))
                elif op == 43:
                    transfers.append((hi, w))
        assert clear_s8 == [149, 0xffffffff] and len(run['draws']) == 1
        assert run['before']['stencil'] is not None and run['after']['stencil'] is None
        assert run['before']['framebuffer'] == run['after']['framebuffer']
        assert run['after']['state']['enabled'] and [f['STENCIL_REF'] for f in run['after']['state']['faces']] == [13, 29]
        assert [f['STENCIL_FUNC'] for f in run['after']['state']['faces']] == [512, 512]
        count = run['width']*run['height']
        expected_color = struct.pack('<'+'I'*(count*4), *(colors*count))
        assert body(run['nativeColor']) == expected_color
        target = bytearray([0x2e]*run['targetBackingBytes'])
        color_transfer = next(w for hi, w in transfers if hi == run['publicColorHistoryIndex'])
        assert color_transfer[0] == 1 and color_transfer[12] == 2
        for y in range(run['height']):
            a = color_transfer[11]+y*color_transfer[3]
            target[a:a+run['width']*16] = expected_color[y*run['width']*16:(y+1)*run['width']*16]
        assert body(run['publicColor']) == target
        public_bytes += len(target)
        original = {p['level']: p for p in run['replacementPlanes']}
        for p in run['nativeDepth']:
            source = body(original[p['level']]['input'])
            actual = body(p['native'])
            pixels = p['width']*p['height']
            assert len(actual) == pixels*20
            native_pixels += pixels
            for i in range(pixels):
                if fmt == 18:
                    expected = source[i*4:i*4+4]
                    assert actual[i*16:i*16+4] == expected
                else:
                    n, = struct.unpack_from('<I', source, i*4)
                    z = (n & 0xffffff)/0xffffff
                    wanted, = struct.unpack('<I', struct.pack('<f', z))
                    got, = struct.unpack_from('<I', actual, i*16)
                    assert abs(got-wanted) <= 1 and got <= 0x3f800000
                assert actual[i*16+4:i*16+16] == struct.pack('<III', 0, 0, 1)
            assert actual[pixels*16:] == bytes(pixels*4)
        old = body(run['planes'][0]['input'])
        old_native = body(run['oldNative'])
        assert old_native[count*16:] == bytes([149, 0, 0, 0])*count
        for i in range(count):
            if old_fmt == 126:
                assert old_native[i*16:i*16+4] == old[i*8:i*8+4]
            else:
                n, = struct.unpack_from('<I', old, i*4)
                expected, = struct.unpack('<I', struct.pack('<f', (n >> 8)/0xffffff))
                observed, = struct.unpack_from('<I', old_native, i*16)
                assert abs(observed-expected) <= 1
        backing = body(run['replacementBacking'])
        assert body(run['replacementBeforePublic']) == backing
        expected = bytearray(backing)
        # Source input and every gap/padding byte are reconstructed independently.
        source_backing = bytearray([0xb3]*len(backing))
        for p in original.values():
            tight = body(p['input'])
            for y in range(p['height']):
                a = p['offset']+y*p['stride']
                source_backing[a:a+p['width']*4] = tight[y*p['width']*4:(y+1)*p['width']*4]
        assert backing == source_backing
        for read in run['publicDepth']:
            p = original[read['level']]
            w = next(w for hi, w in transfers if hi == read['historyIndex'])
            assert w[0] == 8 and w[1] == p['level'] and w[12] == 2
            tight = bytearray(body(p['input']))
            if fmt == 21:
                for i in range(3, len(tight), 4):
                    tight[i] = 0
            for y in range(p['height']):
                a = w[11]+y*w[3]
                expected[a:a+p['width']*4] = tight[y*p['width']*4:(y+1)*p['width']*4]
            assert body(read['backing']) == expected
            public_bytes += len(expected)
        draw = run['draws'][0]
        pairs = [r for r in run['requests'] if r['method'] == 'pair' and r['result']['ok'] and r['request']['fragmentText'] == bound_fragment]
        assert pairs
        for shader in draw['shaders']:
            want = pairs[-1]['result']['vertex' if shader['type'] == 35633 else 'fragment']['glsl']
            assert shader['glsl'] == want and any(v['name'] == 'shaderSource' and v['args'][1] == want and v['sequence'] < draw['sequence'] for v in run['events'])
        lifetime = audit_lifetimes(run)
        syncs = {s['id']: s for s in run['fenceObjects']}
        writer = 0
        for event in run['events']:
            if event['name'] in ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'blitFramebuffer', 'clear', 'clearBufferiv', 'clearBufferuiv', 'clearBufferfv', 'clearBufferfi', 'texSubImage2D', 'bufferSubData', 'copyBufferSubData']:
                writer = event['sequence']
                blits += int(event['name'] == 'blitFramebuffer')
            if event.get('cpu') and not event.get('synchronousReadback'):
                completion = event['completion']
                assert syncs[completion['sync']]['createdSequence'] > writer
                assert completion['delivered'] in [37146, 37148] and completion['actual'] in [37146, 37148] and completion['sequence'] < event['sequence']
        consumed += sum(any(p['delivered'] in [37146, 37148] and p['actual'] in [37146, 37148] for p in s['polls']) for s in run['fenceObjects'])
        out.append(dict(run=run['name'], bodySha256=sha(raw), originalFormat=old_fmt, depthOnlyFormat=fmt,
                        oldStencil=run['before']['stencil'], newStencil=run['after']['stencil'],
                        sameFramebuffer=run['after']['framebuffer'], nativeDrawSequence=draw['sequence'], lifetime=lifetime))
    assert len(out) == 4
    return dict(status='passed', originalFieldsOnly=True, oracleImportsProductCode=False, runs=out,
                nativeDepthPixels=native_pixels, publicBytes=public_bytes, consumedSyncs=consumed, blitWriters=blits)


def main(mode, directory):
    directory = Path(directory).resolve()
    if mode == 'worker':
        result = dict(status='passed', sourceFreeze=FREEZE, originalWire=audit_wire(directory), finestCoverage=coverage(directory))
        path = directory/'critic-original-wire-coverage.json'
    elif mode == 'ordered':
        result, path = ordered(directory), directory/'critic-handwritten-pixels.json'
    elif mode == 'switch':
        result, path = switch(directory), directory/'critic-live-switch.json'
    else:
        raise ValueError(mode)
    path.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(dict(status='passed', output=str(path), coverage=result.get('finestCoverage', {}).get('positive'))))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
