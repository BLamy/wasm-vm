#!/usr/bin/env python3
"""Fresh independent original-field audit; no product or worker oracle imports."""
import argparse
import gzip
import hashlib
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NORMAL = [0x3eaaab55, 0x3f000001, 0x3effffff, 0x3f7fffff, 0x35800000, 0x3c012345,
          0x3f000000, 0x3e800000, 0, 0x3f800000, 0xbf800000, 0x40000000, 0x00800000, 0x00900001]
EXCEPTIONAL = [0x80000000, 1, 0x007fffff, 0x80000001, 0x7f800000, 0xff800000,
               0x7fc01234, 0x7f812345, 0xffc56789]
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def require(value, message):
    if not value:
        raise ValueError(message)


def allowed_depth(bits):
    exponent = bits >> 23 & 255
    if exponent == 255:
        return None
    if bits >> 31 or bits & 0x7fffffff == 0:
        return (0, 0x80000000)
    if exponent == 0:
        return (bits, 0, 0x80000000)
    number = struct.unpack('<f', struct.pack('<I', bits))[0]
    return (struct.unpack('<I', struct.pack('<f', min(1.0, max(0.0, number))))[0],)


def original(format_id, width, height, last, seed, exceptional=False):
    size = 8 if format_id == 126 else 4
    state = seed & 0xffffffff
    initial = seed
    planes, offset = [], 5

    def next_word():
        nonlocal state
        state ^= state << 13 & 0xffffffff
        state ^= state >> 17
        state ^= state << 5 & 0xffffffff
        state &= 0xffffffff
        return state

    for level in range(last + 1):
        raw = bytearray()
        for pixel in range(width * height):
            bits = EXCEPTIONAL[(pixel + level) % len(EXCEPTIONAL)] if exceptional else NORMAL[(pixel + level + (next_word() if pixel else 0)) % len(NORMAL)]
            raw.extend(struct.pack('<I', bits))
            if size == 8:
                raw.extend(struct.pack('<I', (next_word() & 0xffffff00) | ((pixel * 73 + level * 29 + initial) & 255)))
        stride = width * size + 7
        planes.append(dict(level=level, width=width, height=height, stride=stride, offset=offset, raw=bytes(raw)))
        offset += (height - 1) * stride + width * size + 11
        width, height = max(1, width // 2), max(1, height // 2)
    backing = bytearray([0xa7] * (offset + 9))
    for plane in planes:
        n = plane['width'] * size
        for y in range(plane['height']):
            at = plane['offset'] + y * plane['stride']
            backing[at:at+n] = plane['raw'][y*n:(y+1)*n]
    return planes, bytes(backing)


def predictions(format_id, raw):
    size = 8 if format_id == 126 else 4
    return [dict(depthAllowed=allowed_depth(struct.unpack_from('<I', raw, at)[0]),
                 stencil=raw[at+4] if size == 8 else 0) for at in range(0, len(raw), size)]


def fields(format_id, expected, raw, public=False):
    size, n = (8 if format_id == 126 else 4), len(expected)
    require(len(raw) == n * (size if public else 20), 'full original/native/public byte count')
    misses = []
    for pixel, wanted in enumerate(expected):
        word = struct.unpack_from('<I', raw, pixel * (size if public else 16))[0]
        if wanted['depthAllowed'] is not None and word not in wanted['depthAllowed']:
            misses.append(dict(pixel=pixel, field='depth', expected=wanted['depthAllowed'], observed=word))
        if public:
            if size == 8 and raw[pixel*8+4:pixel*8+8] != bytes([wanted['stencil'], 0, 0, 0]):
                misses.append(dict(pixel=pixel, field='stencil/X24', expected=[wanted['stencil'], 0, 0, 0], observed=list(raw[pixel*8+4:pixel*8+8])))
        else:
            require(struct.unpack_from('<3I', raw, pixel*16+4) == (0, 0, 1), 'all independent integer diagnostic lanes')
            value = raw[n*16+pixel*4:n*16+pixel*4+4]
            if value != bytes([wanted['stencil'], 0, 0, 0]):
                misses.append(dict(pixel=pixel, field='native-stencil', expected=[wanted['stencil'], 0, 0, 0], observed=list(value)))
    return misses


class Recording:
    def __init__(self, path):
        self.path = path
        raw = path.read_bytes()
        self.digest = sha(raw)
        self.envelope = json.loads(raw)
        self.data = self.envelope.get('partial') or self.envelope['browserResult']['result']
        self.blobs = {row['key']: row for row in self.data['blobs']}
        require(len(self.blobs) == len(self.data['blobs']), 'unique blob key custody')
        self.decoded = {}
        self.native_pixels, self.public_bytes, self.fences = 0, 0, 0
        self.critical = []
        for row in self.blobs.values():
            packed = (path.parent / row['path']).read_bytes()
            require(sha(packed) == row['gzipSha256'], 'compressed blob custody')
            value = gzip.decompress(packed)
            require(len(value) == row['bytes'] and sha(value) == row['sha256'], 'complete decompressed blob custody')
            self.decoded[row['key']] = value
        require(self.envelope['browserErrors'] == dict(console=[], page=[], requests=[]), 'recorded error-free browser')
        require(not self.envelope['browser']['headless'] and 'M4' in self.data['gpu'] and 'Metal' in self.data['gpu'], 'actual headed physical Metal device')
        require(not any(any(name in argument.lower() for name in ('swiftshader', 'llvmpipe', 'softpipe', 'lavapipe')) or argument.startswith('--disable-gpu') for argument in self.envelope['browser']['commandLine']), 'software flags forbidden')
        require(not self.data['guestExecution'] and not self.data['productionNegotiation'] and not self.data['productionDrawAuthority'], 'selected storage authority only')
        for name in ('browserCoverage', 'screenshot'):
            record = self.envelope[name]
            require(sha((path.parent / record['path']).read_bytes()) == record['sha256'], 'recorded ' + name)
        served = {row['path']: row for row in self.envelope['servedFiles']}
        for row in self.envelope['sources']:
            value = (path.parent / 'source' / row['path']).read_bytes()
            require(len(value) == row['bytes'] and sha(value) == row['sha256'], 'full source body ' + row['path'])
            if '/' + row['path'] in served:
                require(served['/' + row['path']]['sha256'] == row['sha256'], 'immutable actual serving ' + row['path'])
        coverage = json.loads((path.parent / self.envelope['browserCoverage']['path']).read_text())
        for row in coverage['scripts']:
            require(sha(row['sourceBody'].encode()) == row['sha256'] == served['/' + row['source']]['sha256'], 'original full detailed V8 source identity')
        for run in self.data['runs']:
            require(all(value == 0 for value in run['final']['budgets'].values()), 'all terminal owned charges zero')
            require(all(row['deleted'] == 1 for row in run['nativeObjects']), 'every owned native object retires once')
            for event in run['events']:
                if event['name'] == 'fenceSync':
                    require(sum(row['name'] == 'deleteSync' and row['sync'] == event['sync'] for row in run['events']) == 1, 'native physical sync retires once')
                if event['name'] == 'clientWaitSync':
                    require(event['actual'] in (37146, 37147, 37148) and event['delivered'] in (37146, 37147, 37148), 'legal actual and delivered native fence status')
                    if event['delivered'] in (37146, 37148):
                        require(event['actual'] in (37146, 37148), 'delivered completion must be actual completion')

    def blob(self, point):
        row = self.blobs[point['key']]
        require(all(point[key] == row[key] for key in ('bytes', 'sha256', 'gzipSha256')), 'referenced complete blob identity')
        return self.decoded[point['key']]

    def fence(self, point, run):
        require(point['name'] == 'clientWaitSync' and point['actual'] in (37146, 37148) and point['delivered'] in (37146, 37148), 'consumed real physical completion')
        require(point in run['events'], 'consumed fence belongs to its actual recorded run')
        issued = [event for event in run['events'] if event['name'] == 'fenceSync' and event['sync'] == point['sync']]
        require(len(issued) == 1 and issued[0]['turn'] <= point['turn'], 'actual issue precedes consumed completion')
        self.fences += 1

    def plane(self, format_id, expected, point, label):
        self.native_pixels += len(expected)
        miss = fields(format_id, expected, self.blob(point))
        require(not miss, label + ': ' + str(miss[:4]))

    def public(self, format_id, expected, point, label):
        self.public_bytes += len(self.blob(point))
        miss = fields(format_id, expected, self.blob(point), True)
        require(not miss, label + ': ' + str(miss[:4]))


def packet(raw, plane, format_id, opcode, direction=1):
    data = bytes.fromhex(raw)
    require(len(data) % 4 == 0, 'original packet aligned words')
    words = struct.unpack('<' + 'I' * (len(data)//4), data)
    common = (6, plane['level'], 0, plane['stride'], 0, plane.get('x', 0), plane.get('y', 0), 0, plane['width'], plane['height'], 1)
    require(words[0] & 0xffff == opcode and words[0] >> 16 == len(words)-1 and words[1:12] == common, 'every original packet header/identity/geometry/stride field')
    if opcode == 43:
        require(words[12:] == (plane['offset'], direction), 'original data offset and direction')
    elif opcode == 45:
        require(words[12:] == (8, plane['offset'], direction), 'original staging identity/offset/flags')
    else:
        n = plane['width'] * (8 if format_id == 126 else 4)
        span = (plane['height']-1)*plane['stride']+n
        payload = bytearray([0x6d] * ((span+3)//4*4))
        for y in range(plane['height']):
            payload[y*plane['stride']:y*plane['stride']+n] = plane['raw'][y*n:(y+1)*n]
        require(data[48:] == payload, 'complete original inline payload including all padding')


def matrix(record, preinspection):
    require(len(record.data['runs']) == 32, 'complete original matrix')
    stencil_values, padding_count = set(), 0
    for index, (run, prior) in enumerate(zip(record.data['runs'], preinspection['rows'])):
        meta, format_id = run['metadata'], run['metadata']['format']
        size, owned = (8, 16) if format_id == 126 else (4, 4)
        require((format_id, run['seed'], run['exceptional'], meta['bind']) == (prior['format'], prior['seed'], prior['exceptional'], prior['bind']), 'preinspection original case identity')
        planes, backing = original(format_id, meta['width'], meta['height'], meta['lastLevel'], run['seed'], run['exceptional'])
        require(record.blob(run['backing']).hex() == prior['backingHex'] and record.blob(run['backing']) == backing, 'complete preinspection original segmented backing')
        expected = [predictions(format_id, plane['raw']) for plane in planes]
        require(len(planes) == len(run['planes']) == len(run['operations']), 'full original plane/packet count')
        for plane, saved, predicted, operation in zip(planes, run['planes'], prior['planes'], run['operations']):
            require(all(saved[key] == plane[key] == predicted[key] for key in ('level', 'width', 'height', 'offset', 'stride')), 'preinspection original plane dimensions/geometry')
            require(record.blob(saved['input']) == plane['raw'] == bytes.fromhex(predicted['inputHex']), 'preinspection every original word')
            packet(operation['wire'], plane, format_id, 9 if plane['level'] % 3 == 0 else 43)
            record.plane(format_id, expected[plane['level']], saved['observed']['native'], 'complete original native fields')
            if format_id == 126:
                stencil_values.update(plane['raw'][4::8])
        record.fence(run['uploadFence'], run)
        for patch in run['patches']:
            level, width, height = patch['level'], patch['width'], patch['height']
            patch_planes, _ = original(format_id, width, height, 0, run['seed'] ^ (0x987612 if level == 0 else 0x651832))
            require(record.blob(patch['input']) == patch_planes[0]['raw'], 'all independently generated nonzero partial mip fields')
            packet(patch['wire'], dict(patch, raw=patch_planes[0]['raw']), format_id, 9)
            patch_expected = predictions(format_id, patch_planes[0]['raw'])
            for y in range(height):
                start = (patch['y'] + y) * planes[level]['width'] + patch['x']
                expected[level][start:start+width] = patch_expected[y*width:(y+1)*width]
            record.fence(patch['fence'], run)
            record.plane(format_id, expected[level], patch.get('native', run.get('afterPatchNative')), 'partial mip and all untouched native fields')
        clear_index = 0
        for view in run['views']:
            first, last = view['firstLevel'], view['lastLevel']
            require(view['generation'] == run['generation'] and view['metadata']['lastLevel'] == last-first, 'original range generation and level remapping')
            require((view['texture'] == run['allocations'][0]['texture']) == (first == 0 and last == meta['lastLevel']), 'full native range alias versus private range ownership')
            require(view['callerState']['before'] == view['callerState']['after'], 'copy caller FBO/scissor restoration')
            record.fence(view['fence'], run)
            for plane in view['planes']:
                require(plane['original'] == first+plane['local'], 'every local native range level identity')
                record.plane(format_id, expected[plane['original']], plane['native'], 'every retained original native range field')
            if 'refresh' in view:
                clear = run['clears'][clear_index]
                clear_index += 1
                require(clear['values'] == [0.6875, 173] and record.blob(clear['backingBefore']) == backing, 'literal native-only mutation and complete unchanged backing')
                expected[clear['level']] = [dict(depthAllowed=(0x3f300000,), stencil=173 if format_id == 126 else 0)] * len(expected[clear['level']])
                record.fence(clear['fence'], run)
                record.fence(view['refresh']['fence'], run)
                for plane in view['refresh']['planes']:
                    record.plane(format_id, expected[plane['original']], plane['native'], 'GPU-only refreshed level and every adjacent field')
        require(not any(row['label'] == 'original-floating-depth-range-copy' for row in run['readbacks'] + run['uploads']), 'range refresh never stages a CPU texture mirror')
        for allocation in run['allocations']:
            item = allocation['metadata']
            if item['target'] != 2:
                continue
            pixels = sum(max(1, item['width']//2**level) * max(1, item['height']//2**level) for level in range(item['lastLevel']+1))
            require(item['byteLength'] == pixels*size and item['gpuByteLength'] == pixels*owned, 'complete logical and physical native ownership')
            storage = next(event for event in run['nativeEvents'] if event['name'] == 'texStorage2D' and event['texture'] == allocation['texture'])
            require(storage['args'][1:] == [item['lastLevel']+1, 36013 if format_id == 126 else 36012, item['width'], item['height']], 'actual qualified native internal storage')
            require(storage['budgets']['gpuBytes'] >= item['gpuByteLength'], 'native texture/PBO charge precedes allocation')
            if format_id == 126:
                buffer = next(event for event in run['nativeEvents'] if event['name'] == 'bufferData' and event['buffer'] == allocation['uploadBuffer'])
                require(buffer['args'][1] == item['byteLength'] and buffer['budgets']['gpuBytes'] >= item['gpuByteLength'], 'actual persistent packed upload PBO precharge')
            else:
                require(allocation['uploadBuffer'] is None, 'float-only native texture owns no PBO')
        for plane in planes:
            uploads = [upload for upload in run['uploads'] if upload['label'] == 'original-floating-depth-upload-'+str(plane['level'])]
            native = next(upload for upload in uploads if upload.get('name') != 'bufferSubData')
            require(native['args'][1] == plane['level'] and native['args'][6:8] == ([34041, 36269] if format_id == 126 else [6402, 5126]), 'actual original native upload level format and type')
            data = next(upload for upload in uploads if upload.get('name') == 'bufferSubData') if format_id == 126 else native
            require(record.blob(data['bytes']) == plane['raw'], 'complete actual native uploaded original fields')
            if format_id == 126:
                require(native['type'] == 'PBO' and native['unpackBuffer'] == data['unpackBuffer'] == run['allocations'][0]['uploadBuffer'], 'actual numeric-offset persistent PBO route')
        covered = set()
        for plane, transfer in zip(planes, run['transfers']):
            packet(transfer['wire'], plane, format_id, 43, 2)
            record.public(format_id, expected[plane['level']], transfer['sync'], 'complete public original synchronous fields')
            for read in transfer['reads']:
                packet(read['wire'], plane, format_id, read['opcode'], 2 if read['opcode'] == 43 else 3)
                record.fence(read['fence'], run)
                record.public(format_id, expected[plane['level']], read['nativeBytes'], 'complete PBO original public fields')
                scratch = plane['width']*plane['height']*(16 if format_id == 126 else 4)
                staging = plane['width']*plane['height']*(24 if format_id == 126 else 8)
                physical = sum(p['width']*p['height']*owned for p in planes)
                for point in ('beforeRead', 'afterPrepare', 'afterIssue', 'afterReady', 'afterRelease'):
                    budget = read[point]
                    cpu = scratch if point in ('afterPrepare', 'afterIssue', 'afterReady') else 0
                    gpu = staging if point in ('afterIssue', 'afterReady') else 0
                    require((budget['gpuBytes'], budget['scratchBytes'], budget['cpuBytes'], budget['backingBytes']) == (physical+gpu, cpu, 2*len(backing)+cpu, 2*len(backing)), 'exact logical physical scratch conversion staging reservation at '+point)
            for y in range(plane['height']):
                covered.update(range(plane['offset']+y*plane['stride'], plane['offset']+y*plane['stride']+plane['width']*size))
        for key, initial in (('finalBacking', backing), ('finalStagingBacking', bytes([0x2e])*len(backing))):
            raw = record.blob(run[key])
            require(len(raw) == len(initial) and all(raw[i] == value for i, value in enumerate(initial) if i not in covered), 'every untouched segmented and row padding byte')
            for plane in planes:
                n = plane['width']*size
                tight = b''.join(raw[plane['offset']+y*plane['stride']:plane['offset']+y*plane['stride']+n] for y in range(plane['height']))
                require(not fields(format_id, expected[plane['level']], tight, True), 'all final segmented public words')
            padding_count += len(backing)-len(covered)
        require(all(state['before'] == state['after'] for state in run['packStates']), 'all recorded caller program VAO FBO viewport indexed blend masks depth and stencil state')
        if index in (0, 15, 30, 31):
            record.critical.append(dict(run=index, point='planes/0/observed/native', blob=run['planes'][0]['observed']['native']))
    require(stencil_values == set(range(256)), 'all 256 original stencil fields represented')
    return dict(stencilValues=len(stencil_values), paddingBytes=padding_count)


def boundary(record):
    require(len(record.data['runs']) == 47, 'full 47-case physical schedule attack matrix')
    kinds = []
    for run in record.data['runs']:
        kind, meta = run['kind'], run['metadata']
        kinds.append(kind)
        fmt = meta['format']
        if kind == 'generation-context-held-range':
            planes, backing = original(fmt, 13, 7, 3, record.data['seed'] ^ fmt)
            require(record.blob(run['backing']) == backing, 'original complete old generation segmented backing')
            require(run['sourceGeneration'] == run['privateGeneration'] != run['replacementGeneration'] and len({run['sourceTexture'], run['privateTexture'], run['replacementTexture']}) == 3, 'old original private and opposite-format unequal native identities')
            _, replacement = original(126 if fmt == 18 else 18, 13, 7, 3, record.data['seed'] ^ 0xabcdef)
            require(record.blob(run['replacementBacking']) == replacement, 'complete opposite-format replacement originals')
            for key in ('uploadFence', 'copyFence'):
                record.fence(run[key], run)
            record.fence(run['discarded']['fence'], run)
            for plane in run['heldPlanes']:
                require(plane['original'] == plane['local']+1, 'old truncated level remapping')
                record.plane(fmt, predictions(fmt, planes[plane['original']]['raw']), plane['native'], 'old retained range after source ID and context reuse')
        elif kind == 'queued-complete':
            record.fence(run['fence'], run)
            record.public(fmt, predictions(fmt, record.blob(run['input'])), run['output'], 'old physically queued storage fields after generation reuse')
        elif kind.startswith('native-budget-'):
            budget, short = kind.removeprefix('native-budget-').rsplit('-', 1)
            require(run['before']['budgets'] == run['after']['budgets'], 'budget refusal or exact-bound release restores charges')
            if int(short):
                result = run['issued'] if budget == 'gpuBytes' else run['prepared']
                require(not result['ok'] and result['error']['code'] == 'limit-exceeded', 'one-byte-short original read refusal')
            else:
                record.fence(run['fence'], run)
                record.public(fmt, predictions(fmt, record.blob(run['input'])), run['output'], 'exact bounded original native read fields')
        elif kind.startswith('private-range-budget-'):
            require(run['before']['budgets'] == run['after']['budgets'], 'private range owned byte charge restores')
            if kind.endswith('-1'):
                require(not run['capture']['ok'] and run['capture']['error']['code'] == 'limit-exceeded', 'private range one-byte-short refusal')
            else:
                require(run['allocated']['budgets']['gpuBytes'] == run['sourceBytes']+run['viewBytes'], 'complete private texture and persistent PBO precharge')
                record.fence(run['copyFence'], run)
                for plane in run['planes']:
                    record.plane(fmt, predictions(fmt, record.blob(run['inputPlanes'][plane['original']]['input'])), plane['native'], 'bounded private range native original fields')
        elif kind.startswith('native-error-') or kind.startswith('private-allocation-error-'):
            require(not run['result']['ok'] and run['result']['error']['code'] == 'backend-error' and run['faultEvents'], 'actual native failure and explicit refusal')
            if kind.startswith('private-allocation-error-'):
                require(run['before']['budgets'] == run['after']['budgets'], 'private allocation failure precharge rollback')
        elif kind == 'deliberately-masked-indexed-extension':
            require(run['before'] == run['after'] and any(event.get('deliberatelyMasked') and event['actualAvailable'] for event in run['nativeEvents']), 'physically available extension masked and global caller state restored')
            record.fence(run['uploadFence'], run)
            expected = predictions(fmt, record.blob(run['input']))
            record.public(fmt, expected, run['output'], 'actual no-indexed public field read')
            record.plane(fmt, expected, run['native'], 'actual no-indexed native field read')
        elif kind == 'actual-context-loss':
            require(run['actualLost'] and not run['result']['ok'] and run['result']['error']['code'] == 'backend-error', 'actual native context loss refuses')
        elif kind == 'current-helper-program-disposal':
            require(run['currentBefore'] is not None and run['currentAfter'] is None, 'own current native helper program unbound before retirement')
            record.public(fmt, predictions(fmt, record.blob(run['input'])), run['output'], 'helper lifecycle native public fields')
        elif kind == 'private-helper-ownership-guards':
            require(len(run['refusals']) == 5 and all(row['error'] for row in run['refusals']) and len(set(run['ownedScratch'].values())) == 3, 'foreign invalid disposed native helper guards')
            record.fence(run['scratchFence'], run)
        elif kind == 'raw-buffer-read':
            wanted = bytes((i*73+record.data['seed']) & 255 for i in range(37))
            require(record.blob(run['input']) == record.blob(run['sync']) == record.blob(run['async']) == wanted, 'unchanged complete raw buffer byte semantics')
            record.fence(run['uploadFence'], run)
            record.fence(run['fence'], run)
        else:
            require(kind in ('queued-cancel-before-begin', 'queued-cancel-after-begin', 'queued-dispose-owner', 'queued-dispose-backend'), 'every bounded physical terminal path classified')
    return dict(kinds=kinds, scheduleSeed=record.data['seed'])


def controls(record):
    fault = record.data['fault']
    run = record.data['runs'][0]
    format_id = run['metadata']['format']
    record.fence(run['uploadFence'], run)
    if fault == 'stencil-selection':
        point = run['control']
        record.fence(point['fence'], run)
        miss = fields(format_id, predictions(format_id, record.blob(point['input'])), record.blob(point['public']), True)
        blob = point['public']
    else:
        record.fence(run['sabotageFence'], run)
        require(run['sabotageFence']['sync'] != run['uploadFence']['sync'], 'completed native wrong precision/field mutation has distinct second physical fence')
        point = run['planes'][0]
        miss = fields(format_id, predictions(format_id, record.blob(point['input'])), record.blob(point['observed']['native']))
        blob = point['observed']['native']
    require(miss and record.envelope['status'] == 'failed' and record.data['sabotage']['fenceCompleted'] and not record.data['sabotage']['held'], 'unchanged independent inverse refutes physically completed native control')
    return dict(fault=fault, status='refuted', misses=miss[:8], blob=blob, reportSha256=record.digest)


def novel(record, originals):
    fault = record.data.get('fault')
    require(len(record.data['runs']) == (1 if fault else 4), 'full independently seeded bounded original-range cases')
    results = []
    for run in record.data['runs']:
        fmt = run['metadata']['format']
        source = next(row for row in originals['rows'] if row['format'] == fmt and row['seed'] == run['seed'])
        require(record.blob(run['backing']).hex() == source['backingHex'] and all(record.blob(run[key]).hex() == source['backingHex'] for key in ('backingBeforeMutation', 'backingAfterMutation')), 'complete independently prepared segmented backing unchanged by GPU-only refresh')
        require(run['privateMetadata']['lastLevel'] == 1 and run['privateMetadata']['width'] == 7 and run['privateMetadata']['height'] == 4 and run['privateMetadata']['gpuByteLength'] == source['privateOwnedBytes'], 'original private truncated native range and persistent PBO footprint')
        require(run['afterCapture']['budgets']['gpuBytes'] == source['originalOwnedBytes']+source['privateOwnedBytes'], 'exact independently predicted complete source/private ownership')
        for plane in source['planes']:
            require(record.blob(run['planes'][plane['level']]['input']).hex() == plane['inputHex'], 'all independent original words')
            record.plane(fmt, plane['predictions'], run['planes'][plane['level']]['native'], 'independent arbitrary original finite native fields')
        for key in ('uploadFence', 'initialCopyFence', 'refreshFence'):
            record.fence(run[key], run)
        record.fence(run['patch']['fence'], run)
        record.fence(run['clear']['fence'], run)
        for plane in run['initialPrivate']:
            require(plane['original'] == plane['local']+1, 'original private range local remapping')
            record.plane(fmt, source['planes'][plane['original']]['predictions'], plane['native'], 'initial independent private native fields')
        for plane in run['refreshedPrivate']:
            expected = source['afterMutationPredictions'][plane['original']]
            if fault and plane['local'] == 1:
                record.fence(run['secondFence'], run)
                require(run['secondFence']['sync'] != run['refreshFence']['sync'], 'distinct actual second native mutation fence')
                miss = fields(fmt, expected, record.blob(plane['native']))
                require(record.envelope['status'] == 'failed' and miss and not record.data['sabotage']['held'] and record.data['sabotage']['fenceCompleted'], 'unchanged independent native inverse refutes actual completed private field mutation')
                require(any(row['pixel'] == 4 and row['field'] == 'native-stencil' and row['observed'][0] == 220 for row in miss), 'actual targeted private native stencil 219-to-220 corruption')
                results.append(dict(seed=run['seed'], format=fmt, status='refuted', misses=miss, originalFence=run['refreshFence'], secondFence=run['secondFence'], point=plane['native']))
            else:
                record.plane(fmt, expected, plane['native'], 'nonzero mip patch GPU-only refresh and every adjacent field')
        if fault:
            continue
        for transfer in run['publicTransfers']:
            record.public(fmt, source['afterMutationPredictions'][transfer['level']], transfer['public'], 'independent complete original public depth stencil and X24')
        require(run['sourceGeneration'] == run['privateGeneration'] != run['replacement']['generation'] and len({run['sourceTexture'], run['privateTexture'], run['replacement']['texture']}) == 3, 'unequal original/private/opposite-format replacement generations')
        require(run['replacement']['format'] != fmt and record.blob(run['replacement']['backing']) == record.blob(run['replacementAfter']), 'old native completion preserves every opposite-format replacement backing byte')
        record.fence(run['discarded']['fence'], run)
        for plane in run['heldPrivate']:
            record.plane(fmt, source['afterMutationPredictions'][plane['original']], plane['native'], 'old private native fields after opposite-format and context reuse')
        replacement = next(row for row in originals['rows'] if row['seed'] == run['seed'] and row['format'] != fmt)
        require(run['afterHoldRelease']['budgets']['gpuBytes'] == replacement['originalOwnedBytes'], 'final old hold releases all old native texture and PBO charges')
        results.append(dict(seed=run['seed'], format=fmt, status='held'))
    return results


def caller_states(record, originals):
    """Check native identities and exact helper state beyond inherited transfer setup."""
    require(record.data['status'] == 'passed' and len(record.data['runs']) == 2, 'both physical caller-state cases complete')
    results = []
    for run in record.data['runs']:
        fmt = run['metadata']['format']
        source = next(row for row in originals['rows'] if row['seed'] == 0x6b49172d and row['format'] == fmt)
        require(run['seed'] == source['seed'] and fmt in (18, 126), 'independent caller original identity')
        caller = [row for row in run['nativeObjects'] if row['label'] == 'state-independent-caller-objects']
        identities = {kind: [row['id'] for row in caller if row['name'] == 'create'+kind]
                      for kind in ('Program', 'Shader', 'VertexArray', 'Buffer', 'Texture', 'Framebuffer', 'Sampler')}
        require([len(identities[kind]) for kind in identities] == [1, 2, 1, 2, 1, 2, 1], 'concrete distinct owned native caller objects')
        program, vao, color, sampler = (identities[kind][0] for kind in ('Program', 'VertexArray', 'Texture', 'Sampler'))
        other, elements = identities['Buffer']
        read, draw = identities['Framebuffer']
        require(other != elements and read != draw, 'native element/other-data classes and unequal caller FBOs')
        texture = run['allocations'][0]['texture']
        before = dict(program=program, vao=vao, read=read, draw=draw, readAttachment=color,
                      drawAttachment=color, readBuffer=36064, active=33987, viewport=[2, 3, 5, 7],
                      scissor=[3, 2, 4, 5], depthMask=True, caps=[False, True, True, True, False, True, False, False, False],
                      stencil=[[513, 37, 115, 183, 7682, 7683, 5386], [516, 91, 157, 105, 7681, 0, 34055]],
                      buffers=[other]*5+[elements], pixelStore=[8, 17, 2, 3, 8, 19, 1, 2, 23, 1],
                      units=[dict(unit=0, texture=color, sampler=sampler),
                             dict(unit=1, texture=texture, sampler=None, sourceParameters=[1, 2, 34894, 515, 9729, 9729]),
                             dict(unit=3, texture=color, sampler=sampler)],
                      indexed=[dict(mask=[i % 2 == 0, True, i % 3 == 0, False], blend=[32778, 32779, 770, 771, 1, 0]) for i in range(8)])
        require(run['before'] == before, 'all pre-run predicted nondefault native caller fields')
        require(run['copyState']['before'] == before == run['copyState']['after'], 'actual private copy preserves every native caller identity')
        normalized = dict(before, buffers=[None, None, *before['buffers'][2:]], pixelStore=[1, 0, 0, 0, 1, 0, 0, 0, 0, 0])
        backend_fbo = next(row['id'] for row in run['nativeObjects'] if row['name'] == 'createFramebuffer' and row['label'] == '')
        issued = dict(normalized, read=backend_fbo, readAttachment=None)
        staging = [event for event in run['nativeEvents'] if event['name'] == 'bufferData' and event['args'][0] == 35051]
        require(len(staging) == 1 and staging[0]['args'][1] == 135*(8 if fmt == 126 else 4), 'actual original-field native staging byte count')
        collected = dict(issued, buffers=[None, None, staging[0]['buffer'], *before['buffers'][3:]])
        for name, expected in [('syncState', normalized), ('issueState', issued), ('collectState', collected)]:
            require(run[name]['before'] == before and run[name]['expected'] == expected == run[name]['after'],
                    'new helper preserves all concrete state beyond literal inherited setup: '+name)
        require(len(run['source']) == len(source['planes']) == 4, 'all full original caller mip inputs')
        for saved, plane in zip(run['source'], source['planes']):
            raw = bytes.fromhex(plane['inputHex'])
            require(saved['level'] == plane['level'] and record.blob(saved['input']) == raw, 'every pre-run original caller field')
            upload = next(row for row in run['uploads'] if row.get('texture') == texture and row['args'][1] == plane['level'])
            require(upload['args'] == [3553, plane['level'], 0, 0, plane['width'], plane['height'], 34041 if fmt == 126 else 6402, 36269 if fmt == 126 else 5126],
                    'every actual original native caller upload dimension/format/type')
            data = next(row for row in run['uploads'] if row.get('name') == 'bufferSubData' and row['bytes']['sha256'] == saved['input']['sha256']) if fmt == 126 else upload
            require(record.blob(data['bytes']) == raw, 'complete actual native caller input bytes')
            require((upload['type'] == 'PBO') == (fmt == 126), 'qualified native original upload overload')
        base = source['planes'][0]['predictions']
        record.public(fmt, base, run['sync'], 'all nondefault caller original synchronous fields')
        record.public(fmt, base, run['async'], 'all nondefault caller original staged fields')
        require(len(run['private']) == 2, 'complete private caller range')
        for plane in run['private']:
            require(plane['original'] == plane['local']+1, 'original caller private mip remapping')
            record.plane(fmt, source['planes'][plane['original']]['predictions'], plane['native'], 'complete caller private native field planes')
        seen = set()
        for event in run['events']:
            if event['name'] == 'clientWaitSync' and event['delivered'] in (37146, 37148) and event['sync'] not in seen:
                record.fence(event, run)
                seen.add(event['sync'])
        require(len(seen) == (7 if fmt == 126 else 5), 'all upload/copy/PBO and independent diagnostic completions')
        results.append(dict(format=fmt, seed=source['seed'], status='held', copy=run['copyState'], synchronous=run['syncState'],
                            issue=run['issueState'], collection=run['collectState']))
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worker', type=Path)
    parser.add_argument('--predictions', type=Path)
    parser.add_argument('--boundaries', type=Path)
    parser.add_argument('--novel', type=Path)
    parser.add_argument('--states', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    results, native_pixels, public_bytes, fences = [], 0, 0, 0
    if args.worker:
        require(args.predictions, 'preinspection predictions are required')
        prior = json.loads(args.predictions.read_text())
        for phase in ('hot', 'cold'):
            for path in sorted((args.worker / phase).glob('hardware-*/report.json')) + sorted((args.worker / phase).glob('fault-*/report.json')):
                record = Recording(path)
                require(record.envelope['gitHead'] == '2ef416185b8b4ddd85e39efd0913c8eb8eeb71e3', 'exact frozen worker source head')
                detail = controls(record) if path.parent.name.startswith('fault-') else matrix(record, prior) if path.parent.name == 'hardware-matrix' else boundary(record)
                results.append(dict(path=path.relative_to(args.worker).as_posix(), reportSha256=record.digest, detail=detail, critical=record.critical))
                native_pixels += record.native_pixels
                public_bytes += record.public_bytes
                fences += record.fences
    if args.boundaries:
        for path in sorted(args.boundaries.glob('hardware-boundaries-*/report.json')):
            record = Recording(path)
            results.append(dict(path=str(path), reportSha256=record.digest, detail=boundary(record)))
            native_pixels += record.native_pixels
            public_bytes += record.public_bytes
            fences += record.fences
    if args.novel:
        originals = json.loads((ROOT / 'renderer/virgl-command/tests/standard-floating-depth-critic-originals.json').read_text())
        for name in ('novel', 'fault-completed-private-stencil'):
            record = Recording(args.novel / name / 'report.json')
            results.append(dict(path=name+'/report.json', reportSha256=record.digest, detail=novel(record, originals)))
            native_pixels += record.native_pixels
            public_bytes += record.public_bytes
            fences += record.fences
    if args.states:
        originals = json.loads((ROOT / 'renderer/virgl-command/tests/standard-floating-depth-critic-originals.json').read_text())
        record = Recording(args.states / 'states' / 'report.json')
        results.append(dict(path='states/report.json', reportSha256=record.digest, detail=caller_states(record, originals)))
        native_pixels += record.native_pixels
        public_bytes += record.public_bytes
        fences += record.fences
    require(results, 'full actual recordings required')
    result = dict(schema='fresh-d39-independent-full-fields-v1', status='passed', oracleImportsProductCode=False,
                  nativePixels=native_pixels, publicBytes=public_bytes, consumedPhysicalFences=fences, records=results)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({key: value for key, value in result.items() if key != 'records'}))


if __name__ == '__main__':
    main()
