from pathlib import Path
import hashlib, json, gzip, struct, re

ROOT = Path(__file__).resolve().parents[3]
EV = ROOT / 'target/evidence/omarchy-color-checkpoint-frozen01/hardware'
OWN = Path(__file__).resolve().parent
sha = lambda b: hashlib.sha256(b).hexdigest()

def decode(raw):
    at = 0
    def take(n):
        nonlocal at
        b = raw[at:at+n]
        assert len(b) == n
        at += n
        return b
    def count(): return struct.unpack('<I', take(4))[0]
    def value():
        t = take(1)[0]
        if t == 0: return None
        if t == 1: return False
        if t == 2: return True
        if t == 3: return struct.unpack('<d', take(8))[0]
        if t == 4: return take(count()).decode('utf8')
        if t == 5: return take(count())
        if t == 6: return [value() for _ in range(count())]
        assert t == 7, t
        return {value(): value() for _ in range(count())}
    result = value()
    assert at == len(raw)
    return result

def dma(data):
    if isinstance(data, bytes): return data
    assert data['encoding'] == 'u32-runs-v1'
    b = data['bytes']; at = 0; result = bytearray()
    while at < len(b):
        header = struct.unpack_from('<I', b, at)[0]; at += 4
        count = header & 0x7fffffff
        assert count > 0
        if header & 0x80000000:
            result += b[at:at+4] * count; at += 4
        else:
            result += b[at:at+4*count]; at += 4*count
    assert at == len(b) and len(result) == data['length']
    return result

rows = []
for i in range(3):
    run = json.loads(gzip.decompress((EV / f'run-{i:04}.json.gz').read_bytes()))
    if i < 2:
        w = h = run['metadata']['width']; prefix = f'production-R8-{w}'
        outputname = prefix+'-restored.bin'; natives = [prefix+'-native-0.bin', prefix+'-native-1.bin']
    else:
        w, h = 1024, 2048; prefix = 'historical-R8-eight-MiB'
        outputname = prefix+'-read.bin'; natives = [prefix+'-native.bin']
    literal = (EV / 'bytes' / f'{prefix}-literal.bin').read_bytes()
    result = (EV / 'bytes' / outputname).read_bytes()
    expected = bytearray(w*h); xors = [(x*17) ^ (x//16) ^ (42*13) for x in range(w)]
    for y in range(h): expected[y*w:(y+1)*w] = bytes(1 + ((x ^ (y*29)) % 251) for x in xors)
    assert literal == expected and result == expected
    nativechecks = []
    for name in natives:
        b = (EV / 'bytes' / name).read_bytes()
        assert len(b) == w*h*4
        assert b[0::4] == literal and b[1::4] == bytes(w*h) and b[2::4] == bytes(w*h) and b[3::4] == bytes([255])*(w*h)
        nativechecks.append({'path':'hardware/bytes/'+name, 'bytes':len(b), 'sha256':sha(b), 'every_native_lane_matches':True})
    row = {'run':i, 'name':prefix, 'logical_bytes':len(literal), 'every_literal_and_output_byte_matches_independent_expected':True,
           'logical_sha256':sha(literal), 'native':nativechecks, 'objects_remaining':run['remainingNativeObjects']}
    if i < 2:
        assert run['layout']['ramBytes'] == 4194304 and run['status'] == 'passed'
        assert run['beforeCheckpoint']['store']['limits']['scratchBytes'] == 67108864
        assert len(run['nativeReads']) == 2
        assert run['poison']['sha256'] == sha(bytes([0x6d])*1048576)
        checkpoint = (EV / 'bytes' / f'{prefix}.wvgjrn').read_bytes()
        assert checkpoint[:8] == b'WVGJRN01'
        version, length = struct.unpack_from('<II', checkpoint, 8)
        assert version == 1 and length == len(checkpoint)-48
        assert hashlib.sha256(checkpoint[:-32]).digest() == checkpoint[-32:]
        payload = decode(checkpoint[16:-32])
        assert payload['schema'] == 'production-gpu-journal-v1'
        assert payload['contents'] == run['checkpoint']['contents']
        frames = [decode(v) for v in payload['frames']]
        gathers = [f for f in frames if f.get('op') == 'gatherInput']
        uploads = b''.join(dma(f['data']) for f in gathers)
        assert uploads == literal
        assert all(f.get('op') not in ['scatterOutput','scatterLayeredOutput'] for f in frames)
        assert run['checkpoint']['sha256'] == sha(checkpoint) == run['restore']['sha256']
        row['journal'] = {'bytes':len(checkpoint), 'sha256':sha(checkpoint), 'framing_and_trailing_digest_valid':True, 'frame_count':len(frames),
                          'gatherInput_frames':len(gathers), 'full_original_guest_upload_bytes_match_literal':True, 'contents_identity_matches':True, 'restored_identity_matches':True}
        row['hardware'] = [{'context':j, 'full_reads':[{'stage':e['stage'], 'args':e['args']} for e in n if e['name']=='readPixels' and isinstance(e['args'][6],dict)],
                            'band_reads':sum(e['name']=='getBufferSubData' for e in n), 'uploads':sum(e['name']=='texSubImage2D' for e in n)} for j,n in enumerate(run['native'])]
    if 'overLimit' in run:
        over = run['overLimit']
        assert over['before'] == over['after'] and over['readsBefore'] == over['readsAfter']
        if i < 2: assert over['machineBefore'] == over['machineAfter']
        meta = over['metadata']
        row['refusal'] = {'native_bytes':meta['width']*meta['height']*4, 'logical_bytes':meta['width']*meta['height'], 'read_count_unchanged':over['readsBefore'],
                          'owner_quotas_identical':True, 'machine_identical':over.get('machineBefore') == over.get('machineAfter'), 'error':over.get('error',over.get('result'))}
    rows.append(row)
report = json.loads((EV / 'report.json').read_bytes()); gpu = report['browser']['gpu']
assert 'Apple M4 Max' in gpu['devices'][0]['deviceString'] and gpu['featureStatus']['webgl'] == 'enabled'
assert not any(re.search('swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)',x,re.I) for x in report['browser']['commandLine'])
assert report['browserErrors'] == {'console':[], 'page':[], 'requests':[]}
result = {'schema':'critic-independent-buffer-and-journal-audit-v1', 'original_custody_sha256':'cb47154101a11b111f61fa98d80e9095ef8181956cf19ba44e9c76e82d745f57',
          'hardware':gpu['devices'][0], 'hardware_enabled':True, 'browser_errors':report['browserErrors'], 'rows':rows}
p = OWN / 'worker-byte-and-journal-audit.json'
p.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'audit':str(p), 'sha256':sha(p.read_bytes()), 'logical_total':sum(r['logical_bytes'] for r in rows),
                  'native_total':sum(n['bytes'] for r in rows for n in r['native']), 'row_summaries':[{k:r[k] for k in ['name','logical_bytes','logical_sha256','objects_remaining']} for r in rows]},indent=2))
