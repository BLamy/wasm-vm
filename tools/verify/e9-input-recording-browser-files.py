#!/usr/bin/env python3
"""Authenticate original browser input-prefix objects without importing the product codec."""
import argparse
import gzip
import hashlib
import json
import struct
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--directory', type=Path, required=True)
a = p.parse_args()
directory = a.directory.resolve()
sha = lambda b: hashlib.sha256(b).hexdigest()
keys = ('transition', 'phase', 'ordinal', 'sequence', 'retired')
position = lambda r: {k: r[k] for k in keys}
results = {}
for label in ('probe-prefix', 'probe-prefix-after-reload', 'bulk-prefix', 'worker-ui-prefix',
              'file-prefix-before-quota', 'file-prefix-final', 'file-prefix-fresh-tab'):
    value = json.loads((directory / (label + '.json')).read_bytes())
    manifest = json.loads((directory / (label + '.manifest.json')).read_bytes())
    assert manifest == value['manifest'] and manifest['policy']['mode'] == 'capture-prefix'
    objects = {}

    def read(ref):
        digest = ref['sha256']
        if digest not in objects:
            raw = gzip.decompress((directory / (label + '-objects') / (digest + '.gz')).read_bytes())
            assert sha(raw) == digest and str(len(raw)) == ref['length'], (label, digest)
            objects[digest] = raw
        return objects[digest]

    previous = manifest['begin']
    records = []
    for index in manifest['events']:
        raw = read(index['content'])
        assert len(raw) <= 4194304
        group = json.loads(raw)
        assert len(group) == index['count'] and position(group[0]) == index['first']
        assert position(group[-1]) == index['last']
        for event in group:
            assert event['required'] and event['phase'] == 'before'
            assert int(event['sequence']) == int(previous['sequence']) + 1
            assert int(event['transition']) >= int(previous['transition'])
            assert int(previous['retired']) <= int(event['retired']) <= int(event['transition'])
            assert event['ordinal'] == (previous['ordinal'] + 1 if event['transition'] == previous['transition'] else 1)
            intent = json.loads(bytes(event['intent']))
            assert intent['version'] == 1 and set(intent) == {'version', 'channel', 'outcome'}
            payload = event['payload']
            data = bytes(payload['bytes']) if payload['storage'] == 'inline' else read(payload['content'])
            receipt = {**position(event), 'channel': intent['channel'], 'outcome': intent['outcome'], 'bytes': list(data)}
            assert receipt == value['receipts'][len(records)], (label, event['sequence'])
            records.append(receipt)
            previous = position(event)
    assert previous == manifest['end'] and len(records) == len(value['receipts'])
    witness = read(manifest['checkpoints'][0]['machine'])
    assert witness[:8] == b'WVINPUT1'
    version, native_len, pending_len, output_len = struct.unpack_from('<IQII', witness, 8)
    assert version == 1 and len(witness) == 28 + native_len + pending_len + output_len
    assert witness[28:40] == b'WVMRESU1\1\0\0\0'
    pending = witness[28 + native_len:28 + native_len + pending_len]
    if label == 'worker-ui-prefix':
        assert pending.endswith(b'e9_initial=queued-before-recording\n')
        delivered = b''.join(bytes(r['bytes']) for r in records if r['channel'] == 2)
        assert delivered[:len(pending)] == pending
    results[label] = {'events': len(records), 'objects': len(objects), 'end': previous,
                      'witness_sha256': sha(witness), 'initial_pending_bytes': pending_len,
                      'payload_sha256': [sha(bytes(r['bytes'])) for r in records]}

assert json.loads((directory / 'probe-prefix.json').read_bytes()) == json.loads((directory / 'probe-prefix-after-reload.json').read_bytes())
assert json.loads((directory / 'file-prefix-final.json').read_bytes()) == json.loads((directory / 'file-prefix-fresh-tab.json').read_bytes())
bulk = json.loads((directory / 'bulk-prefix.json').read_bytes())
assert len(bulk['manifest']['events']) > 1 and len(bulk['receipts']) == 64
for i, r in enumerate(bulk['receipts']):
    assert bytes(r['bytes']) == bytes([i]) * 65536 and r['outcome'][0] == ('0' if i < 16 else '1')

word = lambda t, c, v: struct.pack('<HHi', t, c, v)
keyboard = b''.join(word(1, c, v) + bytes(8) for c, v in ((42, 1), (30, 1), (30, 0), (42, 0)))
tablet = (word(3, 0, 125) + bytes(8)) * 2
mouse = word(2, 0, -7) + word(2, 1, 3) + bytes(8)
expected = b'Rclip:\xce\xbb\r\10' + keyboard + b'\4' + tablet + b'\3' + mouse + b'D'
assert (directory / 'probe-guest.bin').read_bytes() == expected
file_bytes = bytes((i * 37 + 71) & 255 for i in range(131129))
assert (directory / 'linux-guest-file.bin').read_bytes() == file_bytes
for name in ('linux-guest-partial.bin', 'linux-cancelled-private.bin'):
    assert (directory / name).read_bytes() == file_bytes[:65528]
file_records = json.loads((directory / 'file-prefix-final.json').read_bytes())['receipts']
assert any(r['channel'] == 13 and r['outcome'][0] == '0' and bytes(r['bytes'][5:]) == file_bytes for r in file_records)
assert any(r['channel'] == 14 and r['outcome'][0] == '0' for r in file_records)
assert any(r['channel'] == 13 and r['outcome'][0] == '1' and r['outcome'][3] == '12' for r in file_records)
report = {'status': 'passed', 'scope': 'Independent object hashes, wire positions, initial UART queue, exact guest UART/DMA/file/retained-partial bytes.', 'prefixes': results}
(directory / 'input-prefix-oracle.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': 'passed', 'prefixes': len(results), 'guest_bytes': len(expected), 'file_bytes': len(file_bytes)}))
