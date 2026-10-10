#!/usr/bin/env python3
"""Critic audit: full custody, literal packet reconstruction and nested V8 regions."""
import argparse
import copy
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
BASE = '7a58efee480e38ebad14dedcc57bde0e747088ae'
FROZEN = 'cf6fee74b68682c189ffe27534fbc6abaf9c5ce4'
FLOATS = {**{91+i: (16, i+1) for i in range(4)}, **{28+i: (32, i+1) for i in range(4)}}
sha = lambda b: hashlib.sha256(b).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT)
load = lambda p: json.loads(Path(p).read_text())
shrink = lambda n, l: max(1, n//2**l)
f32 = lambda n: struct.unpack('<f', struct.pack('<f', n))[0]


def git_blobs(ref, names):
    names = list(names)
    if not names:
        return {}
    data = subprocess.check_output(
        ['git', 'cat-file', '--batch'], cwd=ROOT,
        input=''.join(ref+':'+n+'\n' for n in names).encode())
    result, offset = {}, 0
    for name in names:
        end = data.index(b'\n', offset)
        header = data[offset:end].split()
        assert header[1] == b'blob', (ref, name, header)
        length = int(header[2]); offset = end+1
        result[name] = data[offset:offset+length]; offset += length+1
    assert offset == len(data)
    return result


def authenticate_seal(folder, expected_head=None):
    manifest, index = load(folder/'manifest.json'), load(folder/'records.json')
    archive, raw_index = (folder/'recording.tar.gz').read_bytes(), (folder/'records.json').read_bytes()
    assert sha(archive) == manifest['archiveSha256'] and sha(raw_index) == manifest['recordIndexSha256']
    if expected_head:
        assert manifest['sourceHead'] == index['sourceHead'] == expected_head
    wanted = {r['path']: r for r in index['records']}
    assert len(wanted) == len(index['records'])
    seen, total = set(), 0
    with tarfile.open(folder/'recording.tar.gz', 'r:gz') as tar:
        for member in tar:
            assert member.isfile() and member.name in wanted and member.name not in seen
            row = wanted[member.name]; raw = tar.extractfile(member).read()
            assert len(raw) == row['bytes'] == member.size and sha(raw) == row['sha256'], member.name
            seen.add(member.name); total += len(raw)
    assert seen == set(wanted) and len(seen) == manifest['records']
    return dict(path=folder.relative_to(ROOT).as_posix(), records=len(seen), bytes=total,
                archiveSha256=sha(archive), recordIndexSha256=sha(raw_index))


def packets(hex_data):
    raw = bytes.fromhex(hex_data); offset = 0
    while offset < len(raw):
        assert len(raw)-offset >= 4
        header = struct.unpack_from('<I', raw, offset)[0]; length = header >> 16
        end = offset+4*(length+1); assert end <= len(raw)
        words = struct.unpack_from('<'+'I'*(length+1), raw, offset)
        yield header & 255, header >> 8 & 255, words, raw[offset:end], offset
        offset = end
    assert offset == len(raw)


def decode_original(run, blobs):
    contexts, snapshots, uploads = {}, {}, {}
    for index, h in enumerate(run['history']):
        ctx = contexts.setdefault(h['ctx'], dict(objects={}, shaders={}, views={}, samplers={}, blend=None, framebuffer=None))
        for opcode, kind, w, raw, offset in packets(h['hex']):
            if opcode == 1:
                if kind == 4:
                    assert w[2] in [0, 1] and w[5] == 0
                    text = raw[24:24+w[3]-1].decode('ascii')
                    assert raw[24+w[3]-1:] == bytes(len(raw)-(24+w[3]-1))
                    ctx['objects'][kind, w[1]] = text
                else:
                    ctx['objects'][kind, w[1]] = tuple(w[1:])
            elif opcode == 31:
                ctx['shaders'][w[2]] = ctx['objects'][4, w[1]]
            elif opcode in [10, 18]:
                target = ctx['views'] if opcode == 10 else ctx['samplers']
                for slot, handle in enumerate(w[3:], w[2]):
                    target[w[1], slot] = ctx['objects'].get((6 if opcode == 10 else 7, handle))
            elif opcode == 5:
                ctx['framebuffer'] = ctx['objects'].get((8, w[3])) if w[1] else None
            elif opcode == 2 and kind == 1:
                ctx['blend'] = ctx['objects'][1, w[1]]
            elif opcode == 43 and w[13] == 1 and w[1] == 6 and w[2] not in uploads:
                bits, count = FLOATS[run['source']['format']]; row_bytes = w[9]*count*bits//8
                assert w[6:9] == (0, 0, 0) and w[11] == 1
                assert (w[9], w[10]) == (shrink(run['source']['width'], w[2]), shrink(run['source']['height'], w[2]))
                backing = blobs[run['backing']['key']]; stride = w[4] or row_bytes
                raw_plane = b''.join(backing[w[12]+y*stride:w[12]+y*stride+row_bytes] for y in range(w[10]))
                assert len(raw_plane) == row_bytes*w[10]
                uploads[w[2]] = dict(width=w[9], height=w[10], raw=raw_plane, offset=w[12], stride=stride)
            if opcode in [7, 8]:
                snap = copy.deepcopy(ctx); snap.update(opcode=opcode, words=w, offset=offset)
                if opcode == 7:
                    snap['clear'] = list(struct.unpack('<4f', raw[8:24]))
                snapshots[index] = snap
    if 'source' not in run:
        return snapshots, uploads
    assert set(uploads) == set(range(run['source']['lastLevel']+1))
    for p in run['planes']:
        old = uploads[p['level']]
        assert old['raw'] == blobs[p['input']['key']] and old['width'] == p['width'] and old['height'] == p['height']
        assert old['offset'] == p['offset'] and old['stride'] == p['stride']
    return snapshots, uploads


def rgba(raw, fmt):
    bits, count = FLOATS[fmt]; words = struct.unpack('<'+('e' if bits == 16 else 'f')*(len(raw)//(bits//8)), raw)
    return [list(words[i:i+count])+([0.]*(3-count)+[1.] if count < 4 else []) for i in range(0, len(words), count)]


def store(color, fmt):
    bits, count = FLOATS[fmt]; code = 'e' if bits == 16 else 'f'
    return [struct.unpack('<'+code, struct.pack('<'+code, v))[0] if k < count else 1. if k == 3 else 0. for k, v in enumerate(color)]


def original_sample(run, snapshot, uploads, frame):
    stage = 0 if run['stage'] == 'vertex' else 1
    assert snapshot['shaders'][0] == run['vertex'] and snapshot['shaders'][1] == run['fragment']
    text = snapshot['shaders'][stage]
    imm = {int(i): [f32(float(n)) if kind == 'FLT32' else int(n) for n in body.split(',')]
           for i, kind, body in re.findall(r'^IMM\[(\d+)\] (FLT32|INT32|UINT32) \{([^}]+)\}$', text, re.M)}
    opcode, args = re.search(r'^\d+: (TEX|TXL|TXF|TXD|TXB|TXQ) (.*)$', text, re.M).groups()
    slot = int(re.search(r'SAMP\[(\d+)\], 2D$', args)[1]); assert opcode == run['opcode'] and slot == run['slot']
    view = snapshot['views'][stage, slot]; sampler = snapshot['samplers'][stage, slot]
    assert view[1] == 6 and view[2] >> 24 == 2 and view[2] & 0xffffff == run['source']['format'] and view[3] == 0
    first, last = view[4] & 255, view[4] >> 8
    swizzle = [view[5] >> (3*k) & 7 for k in range(4)]
    assert [first, last] == run['range'] and swizzle == run['swizzle']
    flags = sampler[1]; params = dict(s=flags & 7, t=flags >> 3 & 7, r=flags >> 6 & 7,
        min=flags >> 9 & 1, mip=flags >> 11 & 3, mag=flags >> 13 & 1,
        minLod=struct.unpack('<f', struct.pack('<I', sampler[3]))[0], maxLod=struct.unpack('<f', struct.pack('<I', sampler[4]))[0])
    assert params == run['parameters']
    planes = [(uploads[l]['width'], uploads[l]['height'], rgba(uploads[l]['raw'], run['source']['format'])) for l in range(first, last+1)]
    if frame.get('sourceClear'):
        change = frame['sourceClear']; local = change['level']-first
        pw, ph, _ = planes[local]; planes[local] = pw, ph, [store(change['values'], run['source']['format'])]*(pw*ph)
    if opcode == 'TXQ':
        assert 'TEMP[0].xyw, IMM[1]' in args and 'U2F TEMP[0], TEMP[0]' in text
        return [shrink(planes[0][0], imm[1][0]), shrink(planes[0][1], imm[1][0]), 0, last-first+1], params
    def texel(l, x, y):
        w, h, data = planes[l]; assert 0 <= x < w and 0 <= y < h
        return data[y*w+x]
    def sample(l, u, v, linear):
        w, h, _ = planes[l]; clamp = lambda i, n: max(0, min(n-1, i))
        assert params['s'] == params['t'] == 2
        if not linear:
            return texel(l, clamp(math.floor(u*w), w), clamp(math.floor(v*h), h))
        x, y = u*w-.5, v*h-.5; a, b = math.floor(x), math.floor(y); x -= a; y -= b
        colors = [texel(l, clamp(a+dx, w), clamp(b+dy, h)) for dx, dy in [(0,0),(1,0),(0,1),(1,1)]]
        return [(1-y)*((1-x)*colors[0][k]+x*colors[1][k])+y*((1-x)*colors[2][k]+x*colors[3][k]) for k in range(4)]
    if opcode == 'TXF':
        x, y, _, level = imm[1]; color = texel(level, x, y)
    else:
        u, v, _, lod = imm[0]
        if opcode in ['TEX', 'TXB']:
            lod = 0 # Complete recorded coordinates are spatially constant, so implicit derivatives are zero.
        elif opcode == 'TXD':
            w, h, _ = planes[0]; dx, dy = imm[2], imm[3]
            lod = math.log2(max(math.hypot(dx[0]*w, dx[1]*h), math.hypot(dy[0]*w, dy[1]*h)))
        lod = max(params['minLod'], min(params['maxLod'], lod)); linear = params['mag'] if lod <= 0 else params['min']
        if lod <= 0 or params['mip'] == 2:
            color = sample(0, u, v, linear)
        elif params['mip'] == 0:
            color = sample(max(0, min(last-first, math.floor(lod+.5))), u, v, linear)
        else:
            lod = max(0, min(last-first, lod)); a = math.floor(lod); b = min(last-first, a+1)
            A, B = sample(a, u, v, linear), sample(b, u, v, linear); fraction = lod-a
            color = [(1-fraction)*A[k]+fraction*B[k] for k in range(4)]
    return [0 if k == 4 else 1 if k == 5 else color[k] for k in swizzle], params


def blob_data(folder, result):
    result_blobs = {}
    for row in result['blobs']:
        packed = (folder/row['path']).read_bytes(); assert sha(packed) == row['gzipSha256']
        raw = gzip.decompress(packed); assert sha(raw) == row['sha256'] and len(raw) == row['bytes']
        assert row['key'] not in result_blobs; result_blobs[row['key']] = raw
    return result_blobs


def physical_audit(folder):
    record = load(folder/'report.json'); fault = bool(record.get('fault'))
    assert record['browserErrors'] == dict(console=[], page=[], requests=[])
    result = record.get('partial') or record['browserResult']['result']
    assert not record['browser']['headless'] and 'M4' in result['gpu'] and 'Metal' in result['gpu']
    assert not any(re.search(r'swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)', arg, re.I) for arg in record['browser']['commandLine'])
    blobs = blob_data(folder, result); decoded = {}; rows = []; totals = dict(components=0, nativeComponents=0, publicBytes=0, paddingBytes=0)
    previous = {}; lifetimes = []
    for index, run in enumerate(result['runs']):
        assert all(row['deleted'] == 1 for row in run['nativeObjects'])
        assert all(v == 0 for v in run['final']['resources']['budgets'].values()) and all(v == 0 for v in run['final']['renderer']['budgets'].values())
        if 'source' in run:
            decoded[index] = decode_original(run, blobs)
        if not fault:
            internal={91:33325,92:33327,93:34842,94:34842,28:33326,29:33328,30:34836,31:34836}
            allocations={a['texture']:a for a in run['allocations']if a.get('texture')and a['metadata']['format']in internal}
            for event in run['imageEvents']:
                if event['name']=='texStorage2D'and event.get('texture')in allocations:
                    metadata=allocations[event['texture']]['metadata']
                    assert event['args']==[3553,metadata['lastLevel']+1,internal[metadata['format']],metadata['width'],metadata['height']]
        if run.get('cache'):
            first,warm=run['cache'];assert first['temperature']=='first'and warm['temperature']=='warm'
            assert first['snapshot']['profile']==warm['snapshot']['profile']=='virgl-standard-float-image-async-jobs-v1'
            assert first['snapshot']['work']['programLinks']==warm['snapshot']['work']['programLinks']
        for action in run.get('actions',[]):
            if action.get('kind')=='unequal-source-ID-reuse':
                old,new=[r for r in run['created']if r['metadata']['id']==6]
                assert old['generation']==run['sourceGeneration']and new['generation']==action['newGeneration']>old['generation']
                assert (old['metadata']['width'],old['metadata']['height'],old['metadata']['lastLevel'])==(17,9,3)
                assert (new['metadata']['width'],new['metadata']['height'],new['metadata']['lastLevel'])==(11,7,2)
                assert {d['ctx']for d in run['history']if d['label'].endswith('after-reuse')}=={1,2}
                for d in run['draws']:
                    assert d['samplers'][0]['metadata']['width']==8 and d['samplers'][0]['metadata']['height']==4
                lifetimes.append(dict(run=index,name=run['name'],kind=action['kind'],oldGeneration=old['generation'],newGeneration=new['generation'],nativeViewTextures=sorted({d['samplers'][0]['texture']for d in run['draws']})))
            if action.get('kind')=='owned-final-fence-reuse':
                assert action['before']['budgets']['imageHolds']==2 and action['renderer']['jobs']['status']=='finishing'
                assert action['renderer']['jobs']['appliedCommands']==action['renderer']['jobs']['commandCount']==5
                assert action['newGeneration']>run['sourceGeneration']
                originals=[r for r in run['created']if r['metadata']['id']==1]; assert len(originals)==2 and originals[1]['generation']>originals[0]['generation']
                assert (originals[0]['metadata']['width'],originals[0]['metadata']['height'])==(7,5)and(originals[1]['metadata']['width'],originals[1]['metadata']['height'])==(9,3)
                target=next(a['texture']for a in run['allocations']if a['metadata']['id']==1 and a['metadata']['width']==7)
                assert run['draws'][0]['native']['attachment']==target
                terminal=next(h for h in run['history']if h['label'].startswith('queued-float-'))
                mode=run['name'].split('-',2)[2]
                assert terminal['result'].get('gpuComplete')if mode=='complete'else terminal['result']['error']['code']==('cancelled'if mode=='cancel'else'disposed')
                if mode in ['complete','cancel']:
                    assert terminal['result']['gpuComplete']and any(e['name']=='clientWaitSync'and e.get('label')==terminal['label']and e['delivered']in[37146,37148]for e in run['events'])
                else:
                    assert terminal['disposed']and not terminal['result'].get('gpuComplete',False)
                retired=next(p for p in run['retiredPlanes']if p['texture']==target)
                snapshots,uploads=decoded[index];color=original_sample(run,snapshots[run['history'].index(terminal)],uploads,dict())[0]
                expected=store(color,run['target']['format']);raw=blobs[retired['pixels']['key']];actual=struct.unpack('<140f',raw)
                assert all(abs(n-expected[i%4])<=2e-6*max(1,abs(expected[i%4]))for i,n in enumerate(actual))
                lifetimes.append(dict(run=index,name=run['name'],kind=action['kind'],oldGeneration=run['sourceGeneration'],newGeneration=action['newGeneration'],heldAtFinishing=2,terminalCode=terminal['result'].get('error',{}).get('code','completed'),gpuComplete=terminal['result'].get('gpuComplete',False),explicitDisposal=mode.endswith('dispose'),retiredNativeComponents=len(actual),retiredNativeSha256=sha(raw),completionAuthority='consumed physical fence'if mode in['complete','cancel']else'synchronous native readPixels before delete; disposed result claims no GPU completion'))
    for frame_index, frame in enumerate(result['frames']):
        run = result['runs'][frame['run']]; snapshots, uploads = decoded[frame['run']]
        snapshot = snapshots[frame['historyIndex']]; fmt = run['target']['format']; surface = snapshot['framebuffer']
        assert surface[1:3] == (1, fmt) and surface[4] == 0
        assert surface[3] == run.get('outputLevel', 0)
        assert (run['width'], run['height']) == (shrink(run['target']['width'], surface[3]), shrink(run['target']['height'], surface[3]))
        if frame['kind'] == 'clear':
            assert snapshot['opcode'] == 7 and snapshot['words'][1] & 4; color = snapshot['clear']
            assert color == run['clearColor']
        else:
            assert snapshot['opcode'] == 8 and snapshot['words'][1:] == (0,6,4,0,1,0,0,0,0,0,0xffffffff,0)
            color, params = original_sample(run, snapshot, uploads, frame)
            vertex_format=run.get('vertexFormat',31); assert snapshot['objects'][5,3]==(3,0,0,0,vertex_format)
            positions=struct.unpack('<24'+('i'if vertex_format==200 else'f'),blobs[run['positions']['key']])
            assert positions==(-1,-1,0,1,1,-1,0,1,1,1,0,1,-1,-1,0,1,1,1,0,1,-1,1,0,1)
            native=next(d for d in run['draws']if d['label']==frame['label']); assert native['name']=='drawArrays'and native['args']==[4,0,6]
            assert native['native']['level']==surface[3]and native['native']['viewport']==[0,0,run['width'],run['height']]
            assert native['attributes'][0]['stride']==16 and native['attributes'][0]['offset']==0
            assert blobs[native['attributes'][0]['bytes']['key']]==blobs[run['positions']['key']]
            if vertex_format==200:
                assert 'I2F OUT[0], IN[0]'in snapshot['shaders'][0]and any(r['request']['signedMask']==1 for r in run['requests'])
            if not fault:
                sampler=native['samplers'][0];p=sampler['parameters']; min_filter=9728+params['min']if params['mip']==2 else 9984+2*params['mip']+params['min']
                assert p['TEXTURE_WRAP_S']==p['TEXTURE_WRAP_T']==p['TEXTURE_WRAP_R']==33071
                assert p['TEXTURE_MIN_FILTER']==min_filter and p['TEXTURE_MAG_FILTER']==9728+params['mag']
                assert p['TEXTURE_MIN_LOD']==params['minLod']and p['TEXTURE_MAX_LOD']==params['maxLod']
                assert sampler['base']==0 and sampler['last']==run['range'][1]-run['range'][0]
                for q in native['queries']:assert q['type']==5124 and q['size']==1 and q['value']==sampler['last']+1
            blend = snapshot['blend']; mask = blend[3] >> 27 & 15 if blend else 15
            enabled = bool(blend and blend[3] & 1)
            assert mask == frame['mask'] and enabled == frame['blend']
            if enabled:
                assert blend[3] & ((1<<4)|(1<<9)|(1<<17)|(1<<22)) == ((1<<4)|(1<<9)|(1<<17)|(1<<22))
            old = previous.get(frame['run'], [0]*4)
            color = [n+(old[k] if enabled else 0) if mask & 1<<k else old[k] for k, n in enumerate(color)]
        expected = store(color, fmt); actual_raw = blobs[frame['pixels']['key']]
        actual = struct.unpack('<'+'f'*(len(actual_raw)//4), actual_raw)
        assert len(actual) == run['width']*run['height']*4
        mismatches = [dict(at=i, expected=expected[i%4], actual=n, budget=2e-6*max(1,abs(expected[i%4]))) for i,n in enumerate(actual) if not math.isfinite(n) or abs(n-expected[i%4]) > 2e-6*max(1,abs(expected[i%4]))]
        history = run['history'][frame['historyIndex']]; assert history['label'] == frame['label']
        assert history['result'].get('gpuComplete') or frame.get('retired') and history['result']['error']['code'] == 'cancelled'
        waits = [e for e in run['events'] if e['name'] == 'clientWaitSync' and e['label'] == frame['label'] and e['delivered'] in [37146,37148]]
        assert waits and all(e['actual'] in [37146,37148] for e in waits)
        if not fault:
            assert not mismatches, (folder.name, frame['label'], mismatches[:3])
        previous[frame['run']] = expected
        native_count = public_bytes = padding_bytes = 0
        for binding in frame['bindings']:
            assert binding['range'] == run['range'] and len(binding['planes']) == run['range'][1]-run['range'][0]+1
            for p in binding['planes']:
                assert p['original'] == p['local']+run['range'][0]
                original = rgba(uploads[p['original']]['raw'], run['source']['format'])
                native = struct.unpack('<'+'f'*(len(blobs[p['native']['key']])//4), blobs[p['native']['key']])
                assert list(native) == [n for color in original for n in color]; native_count += len(native)
        if not fault and not frame.get('boundary'):
            assert len(frame['outputs']) == run['target']['lastLevel']+1
            for p in frame['outputs']:
                raw = blobs[p['native']['key']]
                assert (p['width'],p['height']) == (shrink(run['target']['width'],p['level']),shrink(run['target']['height'],p['level']))
                if p['level'] == surface[3]:
                    assert raw == actual_raw
                else:
                    assert list(struct.unpack('<'+'f'*(len(raw)//4),raw)) == [0.,0.,0.,1. if FLOATS[fmt][1]<4 else 0.]*(p['width']*p['height'])
            h = run['history'][frame['publicHistory']]; wire = list(packets(h['hex'])); assert len(wire) == 1
            op, kind, w, _, _ = wire[0]; bits,count = FLOATS[fmt]; row_bytes = run['width']*count*bits//8; stride = row_bytes+3
            assert w == (43|13<<16,1,surface[3],0,stride,0,0,0,0,run['width'],run['height'],1,5,2)
            assert h['result']['gpuComplete']
            exchange = next(e for e in run['exchanges'] if e['label'] == h['label'] and e['direction'] == 'readback')
            public = blobs[exchange['blob']['key']]; code = 'e' if bits == 16 else 'f'
            assert public == b''.join(struct.pack('<'+code,actual[i*4+k]) for i in range(run['width']*run['height']) for k in range(count))
            backing = blobs[frame['outputBacking']['key']]; owned = set()
            for y in range(run['height']):
                a = 5+y*stride; assert backing[a:a+row_bytes] == public[y*row_bytes:(y+1)*row_bytes]; owned.update(range(a,a+row_bytes))
            assert all(n == 0x2e for i,n in enumerate(backing) if i not in owned)
            public_bytes,padding_bytes = len(public),len(backing)-len(owned)
        if frame.get('sourceClear'):
            assert blobs[run['backingAfter']['key']] == blobs[run['backing']['key']]
        row = dict(frame=frame_index, label=frame['label'], originalHexSha256=sha(bytes.fromhex(history['hex'])), physicalWaits=waits,
                   pixelsSha256=sha(actual_raw), expectedColor=expected, mismatchCount=len(mismatches), mismatches=mismatches[:8],
                   components=len(actual), nativeComponents=native_count, publicBytes=public_bytes, paddingBytes=padding_bytes)
        rows.append(row)
        for key in totals:
            totals[key] += row[key]
    if fault:
        assert any(row['mismatchCount'] for row in rows) and (result['sabotage'].get('fenceCompleted') or result['sabotage'].get('physicalFenceConsumed'))
    return dict(path=folder.relative_to(ROOT).as_posix(), fault=record.get('fault'), rows=rows, lifetimes=lifetimes, **totals)


def nested_coverage(directory, extra=None):
    added, name, line = {}, None, 0
    for row in git('diff','--unified=0',BASE,FROZEN,'--','renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs').decode().splitlines():
        if row.startswith('+++ b/'):
            name = row[6:]
        elif row.startswith('@@'):
            line = int(re.search(r'\+(\d+)',row)[1])
        elif row.startswith('+') and name:
            added.setdefault(name,[]).append(line); line += 1
    scripts = load(directory/'coverage-audit.json')['scripts']; rows = []
    if extra:
        for file in extra.glob('*/browser-coverage.json'):
            if '/fault-' in str(file):continue
            for s in load(file)['scripts']:
                if s['source'] in added:
                    scripts.append(dict(record=file.relative_to(ROOT).as_posix(),**s))
        for file in (extra/'node-coverage').glob('coverage-*.json'):
            for s in load(file)['result']:
                if s['url'].startswith(ROOT.as_uri()+'/'):
                    name=s['url'][len(ROOT.as_uri())+1:]
                    if name in added:
                        scripts.append(dict(record=file.relative_to(ROOT).as_posix(),source=name,sha256=sha((ROOT/name).read_bytes()),coverage=s))
    for name, lines in added.items():
        raw = git_blobs(FROZEN,[name])[name]; text = raw.decode(); chunks = text.splitlines(keepends=True)
        utf16 = lambda s: len(s.encode('utf-16-le'))//2
        data = text.encode('utf-16-le')
        observations = [s for s in scripts if s['source'] == name]
        assert all(s['sha256'] == sha(raw) for s in observations)
        for line in lines:
            start = utf16(''.join(chunks[:line-1])); end = start+utf16(chunks[line-1]); cuts = {start,end}
            for s in observations:
                for fn in s['coverage']['functions']:
                    for r in fn['ranges']:
                        if start < r['startOffset'] < end: cuts.add(r['startOffset'])
                        if start < r['endOffset'] < end: cuts.add(r['endOffset'])
            cuts = sorted(cuts)
            for a,b in zip(cuts,cuts[1:]):
                snippet = data[2*a:2*b].decode('utf-16-le')
                if not snippet.strip(): continue
                records = []
                for s in observations:
                    rs = [(fn,r) for fn in s['coverage']['functions'] for r in fn['ranges'] if r['startOffset'] <= a and r['endOffset'] >= b]
                    if rs:
                        size = min(r['endOffset']-r['startOffset'] for _,r in rs)
                        governing = [(fn,r) for fn,r in rs if r['endOffset']-r['startOffset'] == size]
                        records.append(dict(record=s['record'], ranges=[dict(function=fn['functionName'],**r)for fn,r in governing], minimumCount=min(r['count'] for _,r in governing)))
                rows.append(dict(source=name,line=line,startOffset=a,endOffset=b,snippet=snippet,records=records,
                                 held=any(r['minimumCount']>0 for r in records)))
    waived=[]
    for row in rows:
        if not row['held']and row['source']=='renderer/virgl-command/state.mjs'and row['line']==384 and row['snippet']==': []':
            expression='...(uniform ? [bufferZeroMask] : [])'
            old,new=git_blobs(BASE,[row['source']])[row['source']],git_blobs(FROZEN,[row['source']])[row['source']]
            assert old.count(expression.encode())==new.count(expression.encode())==1
            row['waiver']='Unchanged legacy cache-key configuration arm. The selected floating factory fixes uniform=true; this false arm is unavailable under this task, and its exact expression and historical factory selections are authenticated against verified D25. No legacy uniform=false compiler execution authority is claimed.'
            waived.append(row)
    return dict(fullNestedRegionsRemainAuthority=True,addedLines=sum(map(len,added.values())),segments=rows,waived=waived,
                gaps=[r for r in rows if not r['held']and'waiver'not in r])


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--native',type=Path)
    args = parser.parse_args(); output = args.output.resolve(); output.mkdir(parents=True,exist_ok=True)
    worker = ROOT/'evidence/virgl-standard-float-consumer/worker'; seals = [authenticate_seal(worker,FROZEN)]
    assert seals[0]['archiveSha256'] == 'b70916d9faee7567b16cd8c031fe04e9f3da31d84d9a6c1ab2de0096e3d4b049'
    assert seals[0]['recordIndexSha256'] == '3892679dc0855e5f04002414a4e9bf5b58bbbaef4836eebc8ae4519b1cd92cd1'
    sealed_members = {r['path']:r for r in load(worker/'records.json')['records']}
    for family in ['virgl-standard-float-images','virgl-standard-texture-operations']:
        for role in ['worker','verifier']:
            folder = ROOT/'evidence'/family/role; seals.append(authenticate_seal(folder))
            for name in ['manifest.json','records.json','recording.tar.gz']:
                assert (folder/name).read_bytes() == git_blobs(BASE,[(folder/name).relative_to(ROOT).as_posix()])[(folder/name).relative_to(ROOT).as_posix()]
    total_rows, total_sources, closure = [], 0, []
    for label,directory in [('hot',ROOT/'target/evidence/virgl-standard-float-consumer-final'),('cold',ROOT/'target/evidence/virgl-standard-float-consumer-cold-final/acceptance')]:
        receipt = load(directory/'receipt.json'); assert receipt['gitHead'] == FROZEN and receipt['status'] == 'passed'
        assert sha((directory/'receipt.json').read_bytes()) == sealed_members[label+'/receipt.json']['sha256']
        for name,digest in receipt['files'].items():
            raw = (directory/name).read_bytes()
            if name == 'acceptance.log' and sha(raw) != digest:
                suffix = b'Frozen original floating programs, native outputs and retained consumers authenticated.\n'
                assert raw.endswith(suffix) and sha(raw) == sealed_members[label+'/'+name+'.final']['sha256']
                raw = raw[:-len(suffix)]
            assert sha(raw) == digest == sealed_members[label+'/'+name]['sha256'] and len(raw) == sealed_members[label+'/'+name]['bytes']
        for name,digest in receipt['generated'].items():
            assert digest == sealed_members[label+'-generated/'+name]['sha256']
        originals = git_blobs(FROZEN,receipt['sources']); assert all(sha(originals[n]) == d for n,d in receipt['sources'].items())
        total_sources += len(originals)
        for path in sorted(directory.glob('hardware-*'))+sorted(directory.glob('fault-*')):
            record = load(path/'report.json'); source_map = {r['path']:r for r in record['sources']}
            assert record['gitHead'] == FROZEN and record['fixedMemory']['bytes'] == 16777216
            for served in record['servedFiles']:
                name = served['path'].removeprefix('/')
                if name == '':continue
                assert served['sha256'] == source_map[name]['sha256'] and served['bytes'] == source_map[name]['bytes']
                assert source_map[name]['sha256'] == (receipt['generated'] if '/build/' in name else receipt['sources'])[name]
            total_rows.append(dict(layer=label,**physical_audit(path)))
        coverage = nested_coverage(directory,args.native.resolve() if args.native else None); (output/(label+'-full-nested.json')).write_text(json.dumps(coverage,indent=2)+'\n')
        closure.append(dict(layer=label,sources=len(originals),receiptSha256=sha((directory/'receipt.json').read_bytes()),coverageGapCount=len(coverage['gaps'])))
    cold = load(ROOT/'target/evidence/virgl-standard-float-consumer-cold-final/report.json')
    assert cold['gitHead'] == cold['cloneHead'] == FROZEN and cold['statusBefore'] == cold['statusAfter'] == '' and cold['exitCode'] == 0
    report = dict(schema=1,task='E6-T11d26',status='passed-original-state-audit',baseline=BASE,sourceHead=FROZEN,
                  archiveCustody=seals,sourceClosure=closure,sourceRecords=total_sources,physicalRecords=total_rows,
                  totals={key:sum(r[key]for r in total_rows if not r['fault'])for key in ['components','nativeComponents','publicBytes','paddingBytes']})
    if args.native:
        native=args.native.resolve(); independent=physical_audit(native/'hardware-independent'); control=physical_audit(native/'fault-independent-filter')
        report['independentNative']=dict(positive=independent,control=control)
        normal=load(native/'hardware-independent/report.json')['browserResult']['result']; sabotage=load(native/'fault-independent-filter/report.json')['browserResult']['result']
        original=next(r for r in normal['runs']if r.get('source',{}).get('format')==31 and r.get('stage')=='fragment'); wrong=sabotage['runs'][0]
        assert all(original[k]==wrong[k]for k in ['vertex','fragment','source','range','parameters','swizzle'])
        normal_blobs=blob_data(native/'hardware-independent',normal); wrong_blobs=blob_data(native/'fault-independent-filter',sabotage)
        assert normal_blobs[original['backing']['key']]==wrong_blobs[wrong['backing']['key']]
        assert original['draws'][0]['shaders']==wrong['draws'][0]['shaders']
        combined=next(r for r in normal['runs']if r.get('kind')=='combined-float-depth-clear'); pseudo={**original,**combined,**dict(source=original['source'],backing=combined['originalSource']['backing'],target=combined['allocations'][0]['metadata'],width=3,height=2,outputLevel=0)}
        assert normal_blobs[pseudo['backing']['key']]==normal_blobs[original['backing']['key']]
        snapshots,uploads=decode_original(pseudo,normal_blobs); depth_rows=[]
        for capture in combined['captures']:
            history=next(h for h in combined['history']if h['label']==capture['original']['label']); commands=list(packets(history['hex'])); assert len(commands)==2 and commands[0][0]==7 and commands[1][0]==8
            _,_,w,raw,_=commands[0]; assert w[1]==5; depth=struct.unpack('<d',raw[24:32])[0]; color=list(struct.unpack('<4f',raw[8:24])); assert depth==capture['depth']
            index=combined['history'].index(history); snapshot=snapshots[index]; assert snapshot['objects'][3,41]==(41,5,0,0,0)
            expected=color if depth<.5 else original_sample(pseudo,snapshot,uploads,dict())[0]
            observed=struct.unpack('<24f',normal_blobs[capture['pixels']['key']]); assert all(abs(n-expected[i%4])<=2e-6*max(1,abs(expected[i%4]))for i,n in enumerate(observed))
            assert history['result']['gpuComplete']and any(e['name']=='clientWaitSync'and e['label']==history['label']and e['delivered']in[37146,37148]for e in combined['events'])
            depth_rows.append(dict(label=history['label'],depth=depth,expectedColor=expected,observedSha256=sha(normal_blobs[capture['pixels']['key']]),components=24))
        assert {r['depth']for r in depth_rows}=={.375,.75}
        assert len([e for e in combined['actualNativeCalls']if e['name']=='clear'and e['args']==[256]])==2
        report['independentNative']['combinedFloatDepth']=depth_rows
        native_custody=[]
        expected_generated=load(ROOT/'target/evidence/virgl-standard-float-consumer-final/receipt.json')['generated']
        for folder in [native/'wire',native/'hardware-independent',native/'fault-independent-filter']:
            r=load(folder/'report.json');source_map={s['path']:s for s in r['sources']}
            original_sources=git_blobs(r['gitHead'],[s['path']for s in r['sources']if '/build/'not in s['path']])
            for name,raw in original_sources.items():assert sha(raw)==source_map[name]['sha256']and len(raw)==source_map[name]['bytes']
            for name,digest in expected_generated.items():assert source_map[name]['sha256']==digest
            for s in r['servedFiles']:
                name=s['path'].removeprefix('/')
                if name:assert s['sha256']==source_map[name]['sha256']and s['bytes']==source_map[name]['bytes']
            if 'browserCoverage'in r:
                coverage_raw=(folder/r['browserCoverage']['path']).read_bytes();assert sha(coverage_raw)==r['browserCoverage']['sha256']
                for s in json.loads(coverage_raw)['scripts']:assert s['sha256']==source_map[s['source']]['sha256']
                assert sha((folder/r['screenshot']['path']).read_bytes())==r['screenshot']['sha256']
            native_custody.append(dict(path=folder.relative_to(ROOT).as_posix(),gitHead=r['gitHead'],sourceRecords=len(source_map),reportSha256=sha((folder/'report.json').read_bytes())))
        wire=load(native/'wire/report.json')['wire'];assert all(p['held']for p in wire['predictions'])
        for record in wire['records']:
            if record['kind']=='selected-range':
                fields=record['selected']['commands'][0]['fields'];assert record['selected']['profile']=='virgl-standard-float-image-commands-v1'
                assert fields==dict(handle=5,resourceHandle=6,format=record['format'],target=2,firstLayer=0,lastLayer=0,firstLevel=2,lastLevel=4,swizzle=[1,2,5,0])
            elif record['kind']=='historical-surface':assert record['selected']['ok']
            else:assert not record['selected']['ok']
        assert not load(output/'hot-full-nested.json')['gaps']and not load(output/'cold-full-nested.json')['gaps']
        report['independentNative']['custody']=native_custody
    (output/'original-audit.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(dict(status=report['status'],archiveMembers=sum(r['records']for r in seals),**report['totals'],closure=closure)))


if __name__ == '__main__':
    main()
