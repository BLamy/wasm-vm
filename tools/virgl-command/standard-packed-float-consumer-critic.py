#!/usr/bin/env python3
"""Fresh original-input critic; no worker scalar/pixel tables or expected blobs."""
import bisect, functools, gzip, hashlib, json, math, re, struct, subprocess, sys, tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = 'ed846a71801b74986e903f4f029b225df9545134'
FREEZE = '8d3e5ff481d2ecdf9930c44c3d1894bdcdb3e180'
RUNTIME = ['renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/state.mjs']
sha = lambda raw: hashlib.sha256(raw).hexdigest()
f32 = lambda n: struct.unpack('<f', struct.pack('<f', n))[0]
shrink = lambda n, level: max(1, n // 2**level)

@functools.lru_cache(maxsize=None)
def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def field(n, bits):
    exponent, fraction = divmod(n, 1 << bits)
    assert exponent < 31, 'this consumer claim is finite only'
    return math.ldexp(fraction, -14-bits) if exponent == 0 else math.ldexp((1 << bits)+fraction, exponent-15-bits)

TABLE = {bits: [field(n, bits) for n in range(31 << bits)] for bits in (5, 6)}
def nearest(value, bits):
    assert math.isfinite(value)
    if value <= 0:
        return 0
    table = TABLE[bits]; right = bisect.bisect_left(table, value)
    if right == len(table):
        return len(table)-1
    if right == 0:
        return 0
    lower, upper = right-1, right
    dl, du = value-table[lower], table[upper]-value
    return lower if dl < du else upper if du < dl else lower if lower % 2 == 0 else upper

def packed(raw):
    return [(field(n & 2047, 6), field(n >> 11 & 2047, 6), field(n >> 22, 5), 1.) for n, in struct.iter_unpack('<I', raw)]

def inverse(raw):
    return b''.join(struct.pack('<I', nearest(r, 6) | nearest(g, 6) << 11 | nearest(b, 5) << 22) for r, g, b, a in struct.iter_unpack('<ffff', raw))

FORMATS = {**{91+i: (16, i+1) for i in range(4)}, **{28+i: (32, i+1) for i in range(4)}}
def target_store(color, fmt):
    if fmt == 124:
        result = []
        for i, value in enumerate(color[:3]):
            value = max(0., f32(value)); bits = 6 if i < 2 else 5
            toward_zero = bisect.bisect_right(TABLE[bits], value)-1
            rounded = nearest(value, bits)
            assert toward_zero == rounded, ('undeclared packed rounding', color, i)
            result.append(field(rounded, bits))
        return result+[1.]
    bits, count = FORMATS[fmt]; fmtcode = 'e' if bits == 16 else 'f'
    return [struct.unpack('<'+fmtcode, struct.pack('<'+fmtcode, color[k]))[0] if k < count else 1. if k == 3 else 0. for k in range(4)]

def packets(hexadecimal):
    raw = bytes.fromhex(hexadecimal); offset = 0; result = []
    while offset < len(raw):
        header, = struct.unpack_from('<I', raw, offset); count = header >> 16
        assert offset+4+4*count <= len(raw)
        result.append(dict(offset=offset, opcode=header & 255, object=header >> 8 & 255,
                           words=list(struct.unpack_from('<'+'I'*count, raw, offset+4)),
                           raw=raw[offset+4:offset+4+4*count]))
        offset += 4+4*count
    assert offset == len(raw)
    return result

def original_program(run):
    text = run[run['stage']]; immediates = {}
    for index, kind, body in re.findall(r'^IMM\[(\d+)\] (FLT32|INT32|UINT32) \{([^}]+)\}$', text, re.M):
        immediates[int(index)] = [f32(float(n)) if kind == 'FLT32' else int(n) for n in body.split(',')]
    opcode, operands = re.search(r'^\d+: (TEX|TXL|TXF|TXD|TXB|TXQ) (.*)$', text, re.M).groups()
    assert opcode == run['opcode'] and int(re.search(r'SAMP\[(\d+)\], 2D$', operands)[1]) == run['slot']
    return opcode, immediates, operands

class Critic:
    def __init__(self, output):
        self.output = Path(output); self.output.mkdir(parents=True, exist_ok=True)
        self.citations = []; self.authentications = []
        self.totals = {k: 0 for k in ['archiveMembers', 'sources', 'served', 'blobs', 'outputComponents', 'sourceComponents', 'publicBytes', 'paddingBytes', 'nativeRuns', 'fences', 'originalPackets', 'nativeUploads', 'retainedDraws', 'faults']}

    def held(self, prediction, member, point, digest, detail):
        self.citations.append(dict(prediction=prediction, status='HELD', member=member, point=point, sha256=digest, detail=detail))

    def seal(self, folder):
        folder = Path(folder); manifest = json.loads((folder/'manifest.json').read_text())
        index = (folder/'records.json').read_bytes(); rows = json.loads(index)['records']
        assert sha((folder/'recording.tar.gz').read_bytes()) == manifest['archiveSha256']
        assert sha(index) == manifest['recordIndexSha256']
        expected = {r['path']: r for r in rows}; assert len(expected) == len(rows) == manifest['records']
        members = {}
        with tarfile.open(folder/'recording.tar.gz') as archive:
            for member in archive:
                assert member.isfile() and member.name in expected and member.name not in members
                raw = archive.extractfile(member).read(); row = expected[member.name]
                assert len(raw) == row['bytes'] and sha(raw) == row['sha256'], member.name
                members[member.name] = raw
        assert members.keys() == expected.keys()
        self.totals['archiveMembers'] += len(members)
        self.authentications.append(dict(folder=str(folder.relative_to(ROOT)), manifest=manifest, indexSha256=sha(index), members=len(members)))
        self.held('P01', str(folder.relative_to(ROOT))+'/recording.tar.gz', '/all-indexed-members', manifest['archiveSha256'], f'Independently rehashed all {len(members)} indexed members, with unique complete index.')
        return manifest, members

    def blob(self, members, directory, row):
        path = directory+'/'+row.get('path', row['key']+'.bin.gz')
        compressed = members[path]; assert sha(compressed) == row['gzipSha256']
        raw = gzip.decompress(compressed); assert len(raw) == row['bytes'] and sha(raw) == row['sha256'], path
        self.totals['blobs'] += 1
        return raw

    def sources(self, members, member, report):
        directory = member.rsplit('/', 1)[0]; source_rows = {r['path']: r for r in report['sources']}
        for name, row in source_rows.items():
            if row.get('archivePath'):
                raw = members[directory+'/'+row['archivePath']]
            elif '/build/' in name:
                raw = members[member.split('/')[0]+'-generated/'+name]
            else:
                raw = git('show', FREEZE+':'+name)
            assert len(raw) == row['bytes'] and sha(raw) == row['sha256'], (member, name)
            if '/build/' not in name:
                assert raw == git('show', report['gitHead']+':'+name), (member, name)
            self.totals['sources'] += 1
        for row in report.get('servedFiles', []):
            if row['path'] == '/':
                continue
            if row['path'] == '/fixtures.json':
                assert row['sha256'] == report['fixtureTransport']['sha256'] and row['bytes'] == report['fixtureTransport']['bytes']
                for original in report['inputs']:
                    data = git('show', report['gitHead']+':'+original['path'])
                    assert len(data) == original['bytes'] and sha(data) == original['sha256']
                    if 'decodedSha256' in original:
                        decoded = gzip.decompress(data)
                        assert len(decoded) == original['decodedBytes'] and sha(decoded) == original['decodedSha256']
                continue
            source = source_rows[row['path'][1:]]
            assert row['bytes'] == source['bytes'] and row['sha256'] == source['sha256']
            self.totals['served'] += 1
        if 'browserCoverage' in report:
            raw = members[directory+'/'+report['browserCoverage']['path']]
            assert sha(raw) == report['browserCoverage']['sha256']
            for script in json.loads(raw)['scripts']:
                assert script['sha256'] == source_rows[script['source']]['sha256']
        if 'screenshot' in report:
            assert sha(members[directory+'/'+report['screenshot']['path']]) == report['screenshot']['sha256']
        self.held('P01', member, '/sources,/servedFiles,/browserCoverage', sha(members[member]), 'Full originals and actually served/generated/V8 source identities match exact frozen code.')

    def physical_fence(self, run, label):
        signals = [e for e in run['events'] if e['name'] == 'clientWaitSync' and e['label'] == label and e['delivered'] in (37146, 37148)]
        assert signals, ('physical signal missing', label)
        for event in signals:
            assert event['actual'] in (37146, 37148)
            sync = event['sync']; creates = [e for e in run['events'] if e['name'] == 'fenceSync' and e['sync'] == sync]
            assert len(creates) == 1 and creates[0]['turn'] < event['turn']
            assert sum(e['name'] == 'deleteSync' and e['sync'] == sync for e in run['events']) == 1
        self.totals['fences'] += len(signals)
        return signals[-1]

    def run_inputs(self, run, blobs, member, point, digest):
        self.totals['nativeRuns'] += 1
        assert all(n == 0 for n in run['final']['renderer']['budgets'].values())
        assert all(n == 0 for n in run['final']['resources']['budgets'].values())
        assert all(row['deleted'] == 1 for row in run['nativeObjects'])
        self.held('P18', member, point+'/nativeObjects,/final', digest, 'Owned native objects deleted exactly once; all terminal budgets are zero.')
        if 'source' not in run:
            return
        assert run['source']['format'] == 124
        backing = blobs[run['backing']['key']]
        planes = run['planes']
        assert len(planes) == run['source']['lastLevel']+1
        for plane in planes:
            width, height = shrink(run['source']['width'], plane['level']), shrink(run['source']['height'], plane['level'])
            raw = blobs[plane['input']['key']]; assert len(raw) == width*height*4 and width == plane['width'] and height == plane['height']
            for y in range(height):
                assert backing[plane['offset']+y*plane['stride']:plane['offset']+y*plane['stride']+4*width] == raw[y*4*width:(y+1)*4*width]
        shader_texts = {}
        original_views = []; original_surfaces = []; original_transfers = []
        for record in run['history']:
            parsed = packets(record['hex']); self.totals['originalPackets'] += len(parsed)
            if record.get('dump'):
                assert record['dump']['submissions'][0]['hex'] == record['hex']
            for packet in parsed:
                words = packet['words']
                if packet['opcode'] == 1 and packet['object'] == 4:
                    assert words[2] > 0
                    original_text = packet['raw'][20:20+words[2]].rstrip(b'\0')
                    assert original_text.endswith(b'\n')
                    shader_texts[words[1]] = original_text.decode()
                if packet['opcode'] == 1 and packet['object'] == 6:
                    assert len(words) == 6 and words[2] & 0xffffff == 124 and words[2] >> 24 == 2
                    assert words[3] == 0
                    first, last = words[4] & 255, words[4] >> 8
                    swizzle = [(words[5] >> (3*k)) & 7 for k in range(4)]
                    assert [first, last] == run['range'] and swizzle == run['swizzle']
                    original_views.append(words)
                if packet['opcode'] == 1 and packet['object'] == 8:
                    original_surfaces.append(words)
                if packet['opcode'] == 43:
                    original_transfers.append(words)
        assert shader_texts == {0: run['vertex'], 1: run['fragment']}, (member, point, 'original shader text')
        assert (original_views or not run['draws']) and any(w[1] == 1 and w[2] == run['target']['format'] and w[3] == run['outputLevel'] for w in original_surfaces)
        for plane in planes:
            transfer = next(w for w in original_transfers if w[0] == 6 and w[1] == plane['level'] and w[-1] == 1)
            assert len(transfer) == 13 and transfer[3] == plane['stride'] and transfer[11] == plane['offset']
            assert transfer[8:11] == [plane['width'], plane['height'], 1]
            exchange = next(e for e in run['exchanges'] if e['direction'] == 'upload' and e['resource']['id'] == 6 and e['layout']['level'] == plane['level'])
            assert blobs[exchange['blob']['key']] == blobs[plane['input']['key']]
            layout = exchange['layout']; assert layout['offset'] == plane['offset'] and layout['rowStride'] == plane['stride'] and layout['rowBytes'] == 4*plane['width'] and layout['tightBytes'] == 4*plane['width']*plane['height']
            upload = next(e for e in run['uploads'] if e['args'][1] == plane['level'])
            assert upload['type'] == 'Uint32Array' and upload['args'][4:8] == [plane['width'], plane['height'], 6407, 35899]
            assert blobs[upload['bytes']['key']] == blobs[plane['input']['key']]
            self.totals['nativeUploads'] += 1
        assert struct.unpack('<24f', blobs[run['positions']['key']]) == (-1.,-1.,0.,1.,1.,-1.,0.,1.,1.,1.,0.,1.,-1.,-1.,0.,1.,1.,1.,0.,1.,-1.,1.,0.,1.)
        for request in run['requests']:
            assert request['request']['vertexText'] == run['vertex'] and request['request']['fragmentText'] == run['fragment']
        for draw in run['draws']:
            assert draw['name'] == 'drawArrays' and draw['args'] == [4, 0, 6]
            for attribute in draw['attributes']:
                assert blobs[attribute['bytes']['key']] == blobs[run['positions']['key']]
            for sampler in draw['samplers']:
                assert sampler['metadata']['format'] == 124 and sampler['base'] == 0 and sampler['last'] == run['range'][1]-run['range'][0]
                assert sampler['metadata']['width'] == shrink(run['source']['width'], run['range'][0])
                assert sampler['metadata']['height'] == shrink(run['source']['height'], run['range'][0])
                assert sampler['unit'] == run['slot']+(16 if run['stage'] == 'vertex' else 0)
                assert any(e['name'] == 'texStorage2D' and e['texture'] == sampler['texture'] and e['args'][2] == 35898 for e in run['imageEvents'])
            for query in draw['queries']:
                assert query['type'] == 5124 and query['value'] == run['range'][1]-run['range'][0]+1
            self.totals['retainedDraws'] += 1
        if run.get('cache'):
            assert run['cache'][0]['temperature'] == 'first' and run['cache'][1]['temperature'] == 'warm'
            assert run['cache'][0]['snapshot']['work']['programLinks'] == run['cache'][1]['snapshot']['work']['programLinks']
        self.held('P05', member, point+'/planes,/history,/exchanges,/uploads', digest, 'Original tight packed planes, offset/stride backing, original transfers and actual UInt32 RGB uploads agree.')
        self.held('P07', member, point+'/draws,/imageEvents', digest, 'Actual retained native local mip ranges, formats, uniforms and attributes match original view/program input.')
        self.held('P09', member, point+'/requests,/cache', digest, 'Original bridge texts/attributes and first/warm native program reuse agree.')

    def color(self, run, frame, blobs):
        op, imm, operands = original_program(run); first, last = run['range']; levels = last-first+1
        planes = []
        for plane in run['planes'][first:last+1]:
            planes.append([plane['width'], plane['height'], packed(blobs[plane['input']['key']])])
        if frame.get('sourceClear'):
            clear = frame['sourceClear']; i = clear['level']-first
            planes[i][2] = [target_store(clear['values'], 124)]*(planes[i][0]*planes[i][1])
        if op == 'TXQ':
            assert re.match(r'TEMP\[0\]\.xyw, IMM\[1\]', operands) and 'U2F TEMP[0], TEMP[0]' in run[run['stage']]
            lod = imm[1][0]
            return [shrink(planes[0][0], lod), shrink(planes[0][1], lod), 0., float(levels)]
        def texel(level, x, y):
            width, height, data = planes[level]; assert 0 <= x < width and 0 <= y < height
            return data[y*width+x]
        def sample(level, u, v, linear):
            width, height, data = planes[level]; clamp = lambda n, maximum: max(0, min(maximum-1, n))
            if not linear:
                return texel(level, clamp(math.floor(u*width), width), clamp(math.floor(v*height), height))
            x, y = u*width-.5, v*height-.5; i, j = math.floor(x), math.floor(y); a, b = x-i, y-j
            colors = [texel(level, clamp(i+dx, width), clamp(j+dy, height)) for dx, dy in [(0,0),(1,0),(0,1),(1,1)]]
            weights = [(1-a)*(1-b), a*(1-b), (1-a)*b, a*b]
            return [sum(color[k]*weight for color, weight in zip(colors, weights)) for k in range(4)]
        if op == 'TXF':
            x, y, z, lod = imm[1]; color = texel(lod, x, y)
        else:
            u, v, z, lod = imm[0]
            if op in ('TEX', 'TXB'):
                lod = 0.
            if op == 'TXD':
                width, height, data = planes[0]; dx, dy = imm[2], imm[3]
                lod = math.log2(max(math.hypot(dx[0]*width, dx[1]*height), math.hypot(dy[0]*width, dy[1]*height)))
            parameters = run['parameters']; lod = max(parameters['minLod'], min(parameters['maxLod'], lod))
            linear = parameters['mag'] if lod <= 0 else parameters['min']
            if lod <= 0 or parameters['mip'] == 2:
                color = sample(0, u, v, linear)
            elif parameters['mip'] == 0:
                color = sample(max(0, min(levels-1, math.floor(lod+.5))), u, v, linear)
            else:
                lod = max(0, min(levels-1, lod)); lo = math.floor(lod); hi = min(levels-1, lo+1); weight = lod-lo
                a, b = sample(lo, u, v, linear), sample(hi, u, v, linear)
                color = [a[k]*(1-weight)+b[k]*weight for k in range(4)]
        return [0. if k == 4 else 1. if k == 5 else color[k] for k in run['swizzle']]

    def frame(self, run, frame, blobs, member, point, digest, previous, fault, precision=False):
        fmt = run['target']['format']; width, height = run['width'], run['height']
        if frame['kind'] == 'clear':
            record = run['history'][frame['historyIndex']]
            clear = [p for p in packets(record['hex']) if p['opcode'] == 7][-1]
            color = list(struct.unpack_from('<4f', clear['raw'], 4))
            assert color == list(map(f32, run['clearColor']))
        else:
            color = self.color(run, frame, blobs)
            if not frame.get('boundary'):
                if frame['blend']:
                    assert previous is not None
                    flags = [p for p in packets(run['history'][frame['historyIndex']]['hex']) if p['opcode'] == 1 and p['object'] == 1][-1]['words'][3]
                    assert (flags >> 27 & 15) == frame['mask'] and flags & 1 and flags >> 4 & 31 == 1 and flags >> 9 & 31 == 1
                color = [color[k]+(previous[k] if frame['blend'] else 0.) if frame['mask'] & (1 << k) else previous[k] for k in range(4)]
        expected = target_store(color, fmt); raw = blobs[frame['pixels']['key']]
        actual = list(struct.unpack('<'+'f'*(len(raw)//4), raw)); assert len(actual) == width*height*4
        misses = []
        for i, value in enumerate(actual):
            wanted = expected[i % 4]
            # Quantization authority is exact for packed targets; finite native shader math has its existing narrow budget.
            budget = 0. if fmt == 124 else 2e-6*max(1., abs(wanted))
            if not math.isfinite(value) or abs(value-wanted) > budget:
                if len(misses) < 8:
                    misses.append(dict(component=i, wanted=wanted, observed=value, budget=budget))
        record = run['history'][frame['historyIndex']]; assert record['label'] == frame['label']
        assert record['result'].get('gpuComplete') or frame.get('retired') and record['result']['error']['code'] == 'cancelled'
        event = self.physical_fence(run, frame['label'])
        self.held('P08', member, point+'/historyIndex,/events', digest, dict(actual=event['actual'], delivered=event['delivered'], turn=event['turn'], sync=event['sync']))
        if fault:
            if misses:
                self.totals['faults'] += 1
                self.held('P17', member, point+'/pixels,/faultEvents', digest, dict(predicted=expected, observed=actual[:4], mismatches=misses, physicalFence=event))
            return expected, bool(misses)
        if precision:
            self.citations.append(dict(prediction='P20-original-arbitrary-weight', status='FAILED' if misses else 'HELD', member=member, point=point+'/pixels', sha256=sha(raw), detail=dict(originalPrediction=expected, observed=actual[:4], unchangedBudget='2e-6*max(1,abs(original))', mismatches=misses, classification='critic filtering-accuracy assumption; no exact arbitrary-weight native precision guarantee in the task')))
        else:
            assert not misses, (member, point, run['name'], misses)
        self.totals['outputComponents'] += len(actual)
        if not precision:
            self.held('P04' if frame['kind'] == 'clear' and fmt == 124 else 'P11' if fmt == 124 else 'P06', member, point+'/pixels', sha(raw), dict(originalPrediction=expected, allComponents=len(actual), originalProgram=run['opcode']))
        if frame.get('boundary'):
            if frame.get('sourceClear'):
                assert blobs[run['backingAfter']['key']] == blobs[run['backing']['key']]
                assert frame['sourceClear']['values'] == [.125,1.25,4,1]
                self.held('P15', member, point+'/sourceClear,/backingAfter', digest, 'GPU-only native source clear changes output; every original backing byte is unchanged.')
            return expected, False
        for plane in frame['outputs']:
            assert plane['width'] == shrink(run['target']['width'], plane['level']) and plane['height'] == shrink(run['target']['height'], plane['level'])
            data = blobs[plane['native']['key']]
            if plane['level'] == run['outputLevel']:
                assert data == raw
            else:
                assert struct.unpack('<'+'f'*(len(data)//4), data) == tuple([0.,0.,0.,1. if fmt == 124 or FORMATS[fmt][1] < 4 else 0.]*(plane['width']*plane['height']))
        assert len(frame['outputs']) == run['target']['lastLevel']+1
        self.held('P12', member, point+'/outputs', digest, 'Complete selected and unselected native target mip planes independently agree.')
        for binding in frame['bindings']:
            assert binding['range'] == run['range'] and len(binding['planes']) == run['range'][1]-run['range'][0]+1
            for plane in binding['planes']:
                original = run['planes'][plane['original']]
                wanted = [n for pixel in packed(blobs[original['input']['key']]) for n in pixel]
                native = blobs[plane['native']['key']]
                assert list(struct.unpack('<'+'f'*(len(native)//4), native)) == wanted
                self.totals['sourceComponents'] += len(wanted)
        read = run['history'][frame['publicHistory']]; assert read['result']['ok'] and read['result']['gpuComplete']
        self.physical_fence(run, read['label'])
        readpacket, = packets(read['hex']); words = readpacket['words']; bits, count = (32,1) if fmt == 124 else FORMATS[fmt]
        row_bytes = width*count*bits//8; stride = row_bytes+3
        assert readpacket['opcode'] == 43 and words == [1,run['outputLevel'],0,stride,0,0,0,0,width,height,1,5,2]
        exchange = next(e for e in run['exchanges'] if e['label'] == read['label'] and e['direction'] == 'readback')
        public = blobs[exchange['blob']['key']]
        original_public = inverse(raw) if fmt == 124 else b''.join(struct.pack('<'+('e' if bits == 16 else 'f'), actual[i*4+k]) for i in range(width*height) for k in range(count))
        assert public == original_public
        backing = blobs[frame['outputBacking']['key']]; touched = set()
        for y in range(height):
            start = 5+y*stride; assert backing[start:start+row_bytes] == public[y*row_bytes:(y+1)*row_bytes]; touched.update(range(start,start+row_bytes))
        assert all(value == 0x2e for i, value in enumerate(backing) if i not in touched)
        self.totals['publicBytes'] += len(public); self.totals['paddingBytes'] += len(backing)-len(touched)
        self.held('P10', member, point+'/publicHistory,/outputBacking', sha(public), dict(originalPublicBytes=len(public), unchangedPaddingBytes=len(backing)-len(touched)))
        return expected, bool(misses)

    def historical(self, result, blobs, member, digest):
        names = ['createVirglStateRenderer','createVirglDrawRenderer','createVirglAsyncRenderer','createVirglStandardAsyncRenderer','createVirglStandardUniformAsyncRenderer','createVirglStandardBufferAsyncRenderer','createVirglStandardImageAsyncRenderer','createVirglStandardColorAsyncRenderer','createVirglStandardTextureAsyncRenderer','createVirglStandardFloatImageAsyncRenderer']
        assert [r['name'] for r in result['nativeControls']] == names and len(result['wireControls']) == 32
        for i, run in enumerate(result['nativeControls']):
            point = '/browserResult/result/nativeControls/'+str(i)
            assert all(n == 0 for owner in run['final'].values() for n in owner['budgets'].values())
            assert all(row['deleted'] == 1 for row in run['nativeObjects'])
            assert len(run['history']) == (1 if i < 3 else 2)
            color = None
            for record in run['history']:
                assert record['result']['ok'] and record['dump']['complete'] and record['dump']['submissions'][0]['hex'] == record['hex']
                original = packets(record['hex']); self.totals['originalPackets'] += len(original)
                for p in original:
                    if p['opcode'] == 7:
                        color = list(struct.unpack_from('<4f', p['raw'], 4)); assert color == ([0.,0.,0.,0.] if i>=3 else [.25,.5,.75,1.])
                    if p['opcode'] == 1 and p['object'] == 4 and p['words'][1] == 1:
                        text = p['raw'][20:20+p['words'][2]].rstrip(b'\0').decode()
                        assert '0: MOV OUT[0], IMM[0]' in text
                        color = [float(n) for n in re.search(r'IMM\[0\] FLT32 \{([^}]+)\}', text)[1].split(',')]
                if i >= 2:
                    assert record['result']['gpuComplete']; self.physical_fence(run, record['label'])
            # Decode the original normalized color independently; exact assertions allow only nearest rounding here.
            wanted = bytes(math.floor(max(0.,min(1.,n))*255+.5) for n in color)*4
            assert blobs[run['pixels']['key']] == wanted
            if i >= 3:
                assert any(call['name'] == 'drawArrays' and call['args'] == [4,0,6] for call in run['calls'])
                program, = run['history'][1]['dump']['programs']
                parsed = packets(run['history'][1]['hex']); vertex = next(p for p in parsed if p['opcode'] == 1 and p['object'] == 4 and p['words'][1] == 0)
                vertex_text = vertex['raw'][20:20+vertex['words'][2]].rstrip(b'\0').decode()
                assert program['vertexTGSI'] == vertex_text
                if i == 3:
                    assert '0: I2F OUT[0], IN[0]' in vertex_text
                    element = next(p for p in parsed if p['opcode'] == 1 and p['object'] == 5)
                    assert element['words'][-1] == 200 and 'integer-input-v1:1:0' in program['key']
                    assert any(call['name'] == 'vertexAttribIPointer' and call['args'][1:3] == [4,5124] for call in run['calls'])
                else:
                    assert '0: MOV OUT[0], IN[0]' in vertex_text
            self.totals['nativeRuns'] += 1
            self.held('P19', member, point+'/history,/pixels,/events,/calls,/nativeObjects,/final', digest, dict(factory=run['name'], originalColor=color, allNativeBytes=len(wanted), typedIntegerOriginal=i==3))
        for row in result['wireControls']:
            original = packets(row['hex'])
            fmt = original[0]['words'][2] if original else None
            admitted = fmt in (None,16) or row['name'] in ['decodeStandardColorSubmission','decodeStandardFloatImageSubmission','decodeStandardPackedFloatImageSubmission']
            assert row['result']['ok'] == admitted
            if admitted and original:
                assert row['result']['commands'][0]['fields']['format'] == fmt
            elif not admitted:
                assert row['result']['error']['code'] == 'unsupported-feature'
        self.held('P19', member, '/browserResult/result/wireControls', digest, '32 independently decoded bounded original historical profile/surface controls.')

    def novel(self, result, blobs, member, digest):
        precision = result['mode'] == 'precision'
        assert len(result['runs']) == 2 and [r['range'] for r in result['runs']] == [[1,3],[0,3]]
        for i, run in enumerate(result['runs']):
            assert run['source']['width'] == 13 and run['source']['height'] == 7 and run['source']['lastLevel'] == 3
            assert run['swizzle'] == [2,0,5,4] and len(run['draws']) == 4
            action, = run['actions']; assert action['kind'] == 'fresh-unequal-ID-reuse'
            assert action['oldGeneration'] == run['sourceGeneration'] and action['newGeneration'] > action['oldGeneration']
            assert action['replacement']['width'] == 9 and action['replacement']['height'] == 5 and action['replacement']['lastLevel'] == 2
            histories = [h for h in run['history'] if re.search('critic-retained-context-[12]-',h['label']) and not h['label'].endswith('/public')]
            assert {h['ctx'] for h in histories} == {1,2} and all(h['result']['ok'] and h['result']['gpuComplete'] for h in histories)
            original = self.color(run, {}, blobs); assert original == run['originalPrediction']
            if not precision:
                assert run['inputDomain'] == 'exact-e15-eighths-weighted-v1'
                for plane in run['planes']:
                    for n, in struct.iter_unpack('<I',blobs[plane['input']['key']]):
                        assert all(code>>bits == 15 and (code % (1<<bits)) % ((1<<bits)//8) == 0 for code,bits in [(n&2047,6),(n>>11&2047,6),(n>>22,5)])
                assert all(struct.unpack('<e',struct.pack('<e',n))[0] == n for n in original)
            self.held('P21', member, '/browserResult/result/runs/'+str(i)+'/actions,/history,/draws', digest, dict(range=run['range'], originalPrediction=original, oldGeneration=action['oldGeneration'], newGeneration=action['newGeneration'], retainedContexts=[1,2], exactlyRepresentableWeights=not precision))
        if precision:
            assert len(result['precisionDiagnostics']) == 2
            for i, diagnostic in enumerate(result['precisionDiagnostics']):
                assert diagnostic['run'] == i and diagnostic['physicalFence']
                assert diagnostic['internalFormat'] == 34836 and diagnostic['sourceInternalFormat'] == 35898
                assert diagnostic['originalPrediction'] == result['runs'][i]['originalPrediction'] and diagnostic['originalOracleMismatches']
                assert blobs[diagnostic['directPixels']['key']] == blobs[diagnostic['originalPixels']['key']]
                assert any(e.get('actual') in (37146,37148) and e['turn'] >= 1 for e in diagnostic['events'])
                assert sum(e['name']=='deleteSync' for e in diagnostic['events']) == 1
                assert len(diagnostic['ownedObjects']) == 6 and all(e['deleted'] == 1 for e in diagnostic['ownedObjects'])
                assert 'textureLod(source,vec2(.375,.625),.5)' in diagnostic['fragment'] and 'v.b,v.r,1.,0.' in diagnostic['fragment']
                self.held('P20-native-isolation', member, '/browserResult/result/precisionDiagnostics/'+str(i), digest, 'Independent direct native highp textureLod reproduces every original consumer byte after its own consumed physical fence. Original failed accuracy prediction is preserved; no wider worker tolerance or pixel-derived oracle is used.')

    def boundaries(self, result, member, digest):
        runs = result['runs']
        for i, run in enumerate(runs):
            point = '/browserResult/result/runs/'+str(i)
            if run.get('name', '').startswith('retained-'):
                action = run['actions'][0]; assert action['kind'] == 'unequal-source-ID-reuse'
                assert action['newGeneration'] > run['sourceGeneration'] and action['replacement']['width'] == 11 and action['replacement']['height'] == 7
                assert {draw['label'] for draw in run['draws']} >= {'original-float-before-reuse', 'original-float-after-reuse', 'second-retained-float-after-reuse', 'restored-original-float-after-reuse'}
                assert all(sampler['metadata']['width'] == shrink(run['source']['width'], run['range'][0]) for draw in run['draws'] for sampler in draw['samplers'])
                self.held('P13', member, point+'/actions,/draws', digest, 'Two contexts and restored state keep the old original source despite unequal public-ID reuse.')
            if run.get('name', '').startswith('queued-'):
                action = run['actions'][0]; assert action['kind'] == 'owned-final-fence-reuse' and action['before']['budgets']['imageHolds'] == 2
                assert action['newGeneration'] > run['sourceGeneration'] and action['renderer']['jobs']['status'] == 'finishing'
                mode = run['name'].split('queued-124-')[1]; record = run['actions'][-1]
                if mode == 'complete':
                    assert record['result']['ok'] and record['result']['gpuComplete']
                else:
                    assert record['result']['error']['code'] == ('cancelled' if mode == 'cancel' else 'disposed')
                    if mode == 'cancel':
                        assert record['result']['gpuComplete']
                    else:
                        assert not record['result'].get('gpuComplete', False)
                if mode in ('complete', 'cancel'):
                    plane = run['retiredPlanes'][0]; assert plane['fencePoint']['actual'] in (37146,37148) and plane['fencePoint']['delivered'] in (37146,37148)
                self.held('P14', member, point+'/actions,/retiredPlanes', digest, dict(mode=mode, oldPhysicalHolds=2, newGeneration=action['newGeneration'], completionAuthority=mode in ('complete','cancel')))
            if run.get('kind') == 'native-float-clear-failure':
                assert run['actions'][0]['result']['error']['code'] == 'backend-error' and not run['draws']
                assert len(run['faultEvents']) == 1 and run['faultEvents'][0]['name'] == 'clearBufferfv'
                self.held('P16', member, point+'/faultEvents,/actions', digest, 'Actual invalid native clear refuses before a draw.')
            if run.get('kind') == 'strict-packed-consumer-config':
                assert len(run['actions']) == 4 and all(a['result']['error']['code'] == 'invalid-input' for a in run['actions'])
                assert run['getterReads'] == 0 and not run['history']
                counter = next(p for p in result['predictions'] if p['prediction'] == 'invalid packed consumer fields allocate no native objects')
                assert counter['observed'] == counter['expected'] == 0
                self.held('P16', member, point+'/actions,/getterReads; /predictions/invalid-packed-consumer-fields', digest, 'Hostile own-data configurations refuse without invoking getters or creating objects; finish overwrites the allocations field with prior rig allocations, so use its preserved native-call counter and independent replay.')
            if run.get('name', '').startswith('gpu-refresh-'):
                assert run['actions'][-1]['result']['error']['code'] == 'framebuffer-feedback'
        assert len(result['hostRefusals']) == 3
        for row in result['hostRefusals']:
            assert row['result']['error']['code'] == 'unsupported-host' and row['allocations'] == 0
        self.held('P16', member, '/browserResult/result/hostRefusals', digest, 'All three required native extensions refuse before consumer allocations.')

    def report(self, members, member, fresh=False):
        report = json.loads(members[member]); directory = member.rsplit('/', 1)[0]; digest = sha(members[member])
        fault = report.get('fault') is not None
        assert report['task'] == 'E6-T11d28' and report['status'] == ('failed' if fault else 'passed')
        assert report['browserErrors'] == dict(console=[], page=[], requests=[])
        assert not report['browser']['headless'] and not any(re.search(r'swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu', s, re.I) for s in report['browser']['commandLine'])
        result = report['partial'] if fault else report['browserResult']['result']
        assert 'M4' in result['gpu'] and 'Metal' in result['gpu'] and not result['guestExecution'] and not result['productionNegotiation']
        self.sources(members, member, report)
        blobs = {row['key']: self.blob(members, directory, row) for row in result['blobs']}
        assert len(blobs) == len(result['blobs'])
        if fresh and result['mode'] in ('novel','precision'):
            name = 'precision-recheck-preobservations.json' if result['mode'] == 'precision' else 'exact-weight-independent-preobservations.json'
            declaration = json.loads(members[directory+'/sources/evidence/virgl-standard-packed-float-consumer/verifier/'+name])
            assert declaration['status'] == 'PREDICTED-BEFORE-NATIVE-EXECUTION' and declaration['seed'] == 0xc01dcafe
            for run, declared in zip(result['runs'], declaration['rows']):
                assert run['range'] == declared['range'] and run['swizzle'] == declared['swizzle']
                assert run['vertex'] == declared['vertex'] and run['fragment'] == declared['fragment'] and run['originalPrediction'] == declared['originalPrediction']
                for plane, original in zip(run['planes'],declared['planes']):
                    assert blobs[plane['input']['key']] == b''.join(struct.pack('<I',n) for n in original['words'])
                    assert all(plane[k] == original[k] for k in ('level','width','height','offset','stride'))
            self.held('P21-before-native' if result['mode']=='novel' else 'P20-before-native', member, '/sources/preobservations,/browserResult/result/runs', digest, 'Every original word/program/range and independent rational prediction matches the complete predeclared frozen input, before native observations.')
        for i, run in enumerate(result['runs']):
            self.run_inputs(run, blobs, member, '/browserResult/result/runs/'+str(i), digest)
        previous = {}; failures = 0
        for i, frame in enumerate(result['frames']):
            run = result['runs'][frame['run']]; expected, failed = self.frame(run, frame, blobs, member, '/browserResult/result/frames/'+str(i), digest, previous.get(frame['run']), fault, result['mode']=='precision')
            previous[frame['run']] = expected; failures += failed
        if fault:
            assert failures and result['sabotage']['fenceCompleted'] and any(run['faultEvents'] for run in result['runs'])
        elif result['mode'] == 'boundaries':
            self.boundaries(result, member, digest)
        elif result['mode'] == 'historical':
            self.historical(result, blobs, member, digest)
        elif result['mode'] in ('novel','precision'):
            self.novel(result, blobs, member, digest)
        if not fresh and not fault:
            assert len(result['runs']) == (49 if result['mode'] == 'matrix' else 11)
        return result

    def main(self, extras):
        worker_folder = ROOT/'evidence/virgl-standard-packed-float-consumer/worker'
        manifest, members = self.seal(worker_folder)
        assert manifest['sourceHead'] == FREEZE and manifest['archiveSha256'] == '681c54f8ca1e027a048f370e55f33c980745e41024a7524f7a71852e671c99aa'
        for prefix in ['hot','cold']:
            receipt = json.loads(members[prefix+'/receipt.json']); assert receipt['gitHead'] == FREEZE and receipt['status'] == 'passed'
            for name, digest in receipt['files'].items():
                assert sha(members[prefix+'/'+name]) == digest
            for name, digest in receipt['sources'].items():
                assert sha(git('show', FREEZE+':'+name)) == digest
            for name, digest in receipt['generated'].items():
                assert sha(members[('hot' if prefix=='hot' else 'cold')+'-generated/'+name]) == digest
            wire_member = prefix+'/wire/report.json'; wire = json.loads(members[wire_member]); self.sources(members, wire_member, wire)
            rows = wire['wire']['records']; assert len(rows) == 23
            for row in rows:
                packet, = packets(row['hex']); words = packet['words']; selected = row['selected']
                if selected['ok']:
                    assert row['format'] == 124 and selected['profile'] == 'virgl-standard-r11g11b10-image-commands-v1'
                    if packet['object'] == 6:
                        assert words == [9,6,124 | 2 << 24,0,1 | 3 << 8,2 | 4 << 3 | 0 << 6 | 5 << 9]
                    else:
                        assert packet['object'] == 8 and words == [10,6,124,2,0]
                else:
                    assert selected['error']['code'] in ('unsupported-feature','invalid-value','invalid-enum')
            assert all(p['held'] for p in wire['wire']['predictions']) and len(wire['wire']['predictions']) == 35
            self.held('P02', wire_member, '/wire/records', sha(members[wire_member]), 'All 23 literal original selected/refused/range cases agree with independently parsed fields; historical refusals recorded.')
            for name in ['hardware-matrix','hardware-boundaries-0xa5471e03','hardware-boundaries-0x13579bdf','hardware-boundaries-0x9e3779b9','fault-output-storage','fault-linear-filter']:
                result = self.report(members, prefix+'/'+name+'/report.json')
                if name == 'hardware-matrix':
                    assert {(r['stage'],r['opcode']) for r in result['runs']} == {('vertex',op) for op in ['TEX','TXL','TXF','TXD','TXQ']} | {('fragment',op) for op in ['TEX','TXL','TXF','TXD','TXB','TXQ']}
            for name, task in [('retained-async-jobs','E6-T11b1'),('retained-float-consumer','E6-T11d26'),('retained-packed-storage','E6-T11d27')]:
                member = prefix+'/'+name+'/report.json'; report = json.loads(members[member]); assert report['gitHead'] == FREEZE and report['task'] == task and report['status'] == 'passed'
                self.sources(members, member, report)
        cold = json.loads(members['cold/report.json']); assert cold['gitHead'] == cold['cloneHead'] == FREEZE and cold['statusBefore'] == cold['statusAfter'] == '' and cold['exitCode'] == 0
        assert sha(members['cold/cold.log']) == cold['logSha256'] and sha(members['cold/receipt.json']) == cold['receiptSha256']
        self.held('P01', 'cold/report.json', '/cloneHead,/statusBefore,/statusAfter,/removedEnvironmentNames', sha(members['cold/report.json']), 'The single unchanged pristine scrubbed exact-head proof is authenticated and carried.')
        inverse_boundary = json.loads((ROOT/'tools/virgl-command/standard-packed-float-consumer-boundary.json').read_text())
        assert inverse_boundary['predecessor'] == BASE and set(inverse_boundary['changes']) == set(RUNTIME)
        for name, rows in inverse_boundary['changes'].items():
            current = (ROOT/name).read_text(); assert current.encode() == git('show', FREEZE+':'+name)
            for row in reversed(rows):
                assert current.count(row['after']) == 1; current = current.replace(row['after'], row['before'], 1)
            assert current.encode() == git('show', BASE+':'+name)
        for name in ['resources','packed-float-images','float-images','color-images','constant-domain','cache']:
            path = 'renderer/virgl-command/'+name+'.mjs'; assert git('show', BASE+':'+path) == git('show', FREEZE+':'+path)
        assert not git('diff','--name-only',BASE,FREEZE,'--','renderer/virgl-shader','crates','web','tools/guest')
        scoped = git('diff',BASE,FREEZE,'--','renderer','tools').decode()
        assert not re.search(r'^\+.*(?:#\[ignore\]|debug_assertions\s*=\s*false|skip\s*:\s*true)', scoped, re.M)
        self.held('P03', 'tools/virgl-command/standard-packed-float-consumer-boundary.json', '/changes', sha((ROOT/'tools/virgl-command/standard-packed-float-consumer-boundary.json').read_bytes()), 'Exact inverse reconstructs original decoder/state and all dependency/runtime/production boundaries are unchanged; no ignored tests or disabled assertions introduced.')
        for prefix in ['evidence/virgl-standard-float-consumer','evidence/virgl-standard-packed-float-images']:
            for suffix in ['worker','verifier']:
                folder = ROOT/prefix/suffix
                for name in ['manifest.json','records.json','recording.tar.gz']:
                    relative = prefix+'/'+suffix+'/'+name; assert (ROOT/relative).read_bytes() == git('show',BASE+':'+relative)
                self.seal(folder)
        for extra in extras:
            base = Path(extra); fresh_members = {str(p.relative_to(base)):p.read_bytes() for p in base.rglob('*') if p.is_file()}
            for member in sorted(fresh_members):
                if member.endswith('/report.json') and member.split('/')[0] in ('novel','sabotage','boundaries','historical','precision'):
                    self.report(fresh_members, member, fresh=True)
        report = dict(schema='d28-fresh-original-input-audit-v1',status='passed',taskCorrectness='HELD',failedCriticPrecisionAssumptions=sum(c['status']=='FAILED' for c in self.citations),runtimeHead=FREEZE,predecessor=BASE,workerManifest=manifest,authentications=self.authentications,totals=self.totals,citations=self.citations,oracleAuthority='original-packets-TGSI-IEEE-bits-native-planes; no expected blobs or emitted ESSL',precisionDiagnosticAuthority='Original failed arbitrary-weight accuracy predictions remain FAILED; task native semantics isolated independently; exactly representable input domain repairs critic proof without widening the worker budget.')
        (self.output/'audit.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(dict(status=report['status'],**self.totals,citations=len(self.citations))))

if __name__ == '__main__':
    Critic(sys.argv[1]).main(sys.argv[2:])
