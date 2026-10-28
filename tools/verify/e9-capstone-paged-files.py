#!/usr/bin/env python3
"""Independent CAS, RAM-chain and raw-witness oracle for the bounded paged GPU fixture."""
import sys
if sys.flags.optimize:
    raise RuntimeError("paged oracle requires Python assertions")
import argparse
import hashlib
import json
from pathlib import Path
import struct

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--directory', required=True, type=Path)
a = parser.parse_args()
root = a.directory.resolve()
sha = lambda b: hashlib.sha256(b).hexdigest()
u16 = lambda b, at: struct.unpack_from('<H', b, at)[0]
u32 = lambda b, at: struct.unpack_from('<I', b, at)[0]
u64 = lambda b, at: struct.unpack_from('<Q', b, at)[0]
r = json.loads((root / 'report.json').read_text())
assert r['status'] == 'passed' and not any(r[k] for k in ['errors', 'external', 'blocked', 'sockets'])
assert r['workerFactories'] == ['0']
saved = root / 'saved'
archive = json.loads((saved / 'storage.json').read_text())
objects = {row['key']: row['value'] for row in archive['stores']['objects']}

def read(ref):
    obj = objects[ref['sha256']]
    assert obj['sha256'] == ref['sha256'] and obj['length'] == ref['length']
    parts = []
    for part in obj['parts']:
        b = (saved / 'chunks' / (part['sha256'] + '.bin')).read_bytes()
        assert len(b) == int(part['length']) and sha(b) == part['sha256']
        parts.append(b)
    b = b''.join(parts)
    assert len(b) == int(ref['length']) and sha(b) == ref['sha256']
    return b

for key, obj in objects.items():
    assert key == obj['sha256']
    read(obj)
manifest = json.loads(bytes(next(row['value']['manifest'] for row in archive['stores']['sessions']
                                if row['key'] == r['recording']['id'])))
assert manifest['machine']['ram_bytes'] == '1073741824'
assert manifest['policy']['mode'] == 'exact-replay'
assert manifest['policy']['clock'] == dict(mode='icount', divider=64, timebase_hz='10000000', interactive=None)
commitment = json.loads(bytes(next(x['bytes'] for x in manifest['extensions']
                                  if x['kind'] == 'e9-exact-witness-pages-v2')))
assert commitment['finished'] is True
cursor, remaining, pages, witnesses = commitment['tail'], commitment['count'], 0, {}
keyof = lambda p: tuple(p[k] for k in ['transition', 'retired', 'sequence', 'phase', 'ordinal'])
while cursor:
    page = json.loads(read(cursor))
    assert page['before'] + len(page['rows']) == remaining
    for row in page['rows']:
        key = keyof(row)
        assert key not in witnesses
        witnesses[key] = bytes(row['digest']).hex()
    remaining, cursor = page['before'], page['previous']
    pages += 1
    assert pages <= 4096
assert remaining == 0 and len(witnesses) == commitment['count'] and pages == commitment['pages']

def raw_state(row):
    ref = row['state']
    assert ref['file'].startswith(('source-', 'replay-')) and Path(ref['file']).name == ref['file']
    b = (root / ref['file']).read_bytes()
    assert len(b) == ref['bytes'] and sha(b) == ref['sha256']
    return b

def witness(row):
    b = raw_state(row)
    return sha(b'wasm-vm-gpu-guest-state-v1\0' + struct.pack('<Q', len(b)) + b + bytes.fromhex(row['ramDigest']))

ram, previous, results = bytearray(1 << 30), None, []
view = memoryview(ram)
states = {row['id']: row for row in r['recording']['states']}
for point in manifest['checkpoints']:
    data = read(point['machine'])
    delta = None
    if data[:8] == b'WVKEYF01':
        delta = json.loads(data[8:])
        assert delta['parent'] == previous and delta['ramBytes'] == str(len(ram))
        count, last = 0, -1
        for ref in delta['chunks']:
            b = read(ref)
            assert b[:8] == b'WVRAMD01' and u32(b, 8) == 1 and u64(b, 12) == len(ram)
            at = 24
            for _ in range(u32(b, 20)):
                page, length = u32(b, at), u16(b, at + 4)
                at += 6
                assert last < page < len(ram) // 4096 and length == 4096 and at + length <= len(b)
                view[page * 4096:page * 4096 + length] = b[at:at + length]
                at += length
                last, count = page, count + 1
            assert at == len(b)
        assert count == delta['dirtyPages'] and sha(view) == delta['ramSha256']
        data = read(delta['frame'])
    assert data[:8] == (b'WVGPUD01' if delta else b'WVGPUB01') and u32(data, 8) == 1
    header, size, pending, output = u32(data, 12), u64(data, 16), u32(data, 24), u32(data, 28)
    assert 32 + header + size + pending + output == len(data)
    meta = json.loads(data[32:32 + header])
    native = data[32 + header:32 + header + size]
    assert meta['position'] == point['position'] and meta['rendererSha256'] == point['gpu']['sha256']
    assert sha(read(point['gpu'])) == meta['rendererSha256']
    assert native[:8] == b'WVMRESU1' and native[-84:-76] == b'WVGRESU1'
    assert u32(native, len(native) - 76) == 1 and u64(native, len(native) - 72) == len(native) - 84
    assert native[-64:-32].hex() == meta['rendererSha256'] and sha(native[:-32]) == native[-32:].hex()
    sections, at = {}, 84
    while at < len(native) - 84:
        tag, length = u32(native, at), u32(native, at + 4)
        at += 8
        assert tag not in sections and at + length <= len(native) - 84
        sections[tag] = native[at:at + length]
        at += length
    assert at == len(native) - 84 and {1, 4, 6, 12, 18, 19, 20, 21, 22} <= sections.keys()
    assert (2 in sections) == (delta is None)
    if not delta:
        encoded, at, offset = sections[2], 0, 0
        while at < len(encoded):
            kind, length = encoded[at], u32(encoded, at + 1)
            at += 5
            assert kind in (0, 1) and 0 < length <= len(ram) - offset
            if kind:
                assert at + length <= len(encoded)
                view[offset:offset + length] = encoded[at:at + length]
                at += length
            offset += length
        assert at == len(encoded) and offset == len(ram)
    assert sha(view) == meta['ramSha256']
    row = states[point['id']]
    assert meta['ramSha256'] == row['ramDigest'] and witness(row) == row['digest'] == meta['stateSha256'] == witnesses[keyof(point['position'])]
    clock = sections[18]
    assert tuple(u64(clock, at) for at in [12, 20, 28, 36]) == tuple(int(point['position'][k]) for k in ['transition', 'retired', 'ordinal', 'sequence'])
    results.append(dict(id=point['id'], incremental=delta is not None, ramSha256=meta['ramSha256'], digest=meta['stateSha256']))
    previous = point['machine']
assert len(results) >= 3
for window in r['replay']['windows']:
    source = states[window['to']]
    assert raw_state(window) == raw_state(source) and window['digest'] == source['digest']
    assert window['replay']['paged'] and window['replay']['eventCursor'] == int(window['position']['sequence'])
assert len(r['replay']['windows']) == 2 and any(x['incrementalStart'] for x in r['replay']['windows'])
end = r['recording']['end']
assert witness(end) == end['digest'] == witnesses[keyof(manifest['end'])] == r['replay']['digest']
if r['replay']['tail']:
    assert raw_state(r['replay']['tail']) == raw_state(end)
    assert r['replay']['tail']['replay']['eventCursor'] == int(end['sequence'])
assert r['recording']['pixel'] == r['replay']['pixel'] == [0, 255, 0, 255]
green = bytes([0, 255, 0, 255]) * 4096
assert any(obj['length'] == str(len(green)) and read(obj) == green for obj in objects.values()), 'literal owned GPU readback missing'
result = dict(status='passed', scope='bounded paged fixture only', objects=len(objects), witnessPages=pages, checkpoints=results,
              windows=2, finalDigest=end['digest'], literalReadbackSha256=sha(green))
(root / 'independent-paged-files.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
