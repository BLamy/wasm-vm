"""Decode recorded queued request bytes independently of Rust protocol helpers."""
from pathlib import Path
import hashlib
import json
import re
import struct
import sys
import zlib

proof_dir = Path(sys.argv[1])
proof = json.loads((proof_dir / 'proof.json').read_text())
log_path = proof_dir / 'acceptance.log'
raw = log_path.read_bytes()
assert proof['passed'] is True
assert proof['head'] == '2e61bf3e971595741c627e8b68fcaee055c27945'
acceptance = [row for row in proof['commands'] if row['args'][:2] == ['make', 'verify-E5_5-T03at']]
assert len(acceptance) == 1 and acceptance[0]['code'] == 0
assert hashlib.sha256(raw).hexdigest() == acceptance[0]['logSha256']
rows = []
rectangles = [(0,0,7,5), (2,1,3,2), (1,0,5,3), (0,2,7,2), (4,3,3,2)]
offsets = [0,36,4,56,100]
crcs = [0x2d068e19, 0x80e3df97, 0xcafeb5cb, 0x74f3ca70, 0x4b09d24f]
for line_no, line in enumerate(raw.decode().splitlines(), 1):
    match = re.search(r'AT queued pattern=(\d+) requests=(.*?) trace=(.*?) shadow=\[(.*?)\] sink=(.*)', line)
    if not match:
        continue
    index = int(match[1])
    requests = [bytes(int(word.strip(), 16) for word in group.split(','))
                for group in re.findall(r'\[([0-9a-f, ]+)\]', match[2])]
    assert len(requests) == 5
    types = [struct.unpack_from('<I', request)[0] for request in requests]
    assert types == [257,262,259,261,260]
    assert struct.unpack_from('<IIII', requests[0], 24) == (1,1,7,5)
    x,y,w,h,offset,resource,padding = struct.unpack_from('<IIIIQII', requests[3], 24)
    assert (x,y,w,h) == rectangles[index]
    assert offset == offsets[index]
    assert resource == 1 and padding == 0
    assert offset + (h-1)*28 + w*4 <= 140
    assert struct.unpack_from('<IIIIII', requests[4], 24) == (x,y,w,h,1,0)
    nents = struct.unpack_from('<I', requests[1], 28)[0]
    assert len(requests[1]) == 32 + 16*nents
    backing = [struct.unpack_from('<QII', requests[1], 32 + entry*16) for entry in range(nents)]
    assert all(length > 0 and pad == 0 for _,length,pad in backing)
    assert sum(length for _,length,_ in backing) == 140
    traces = re.findall(r'CommandTraceRecord \{ ([^}]+) \}', match[3])
    assert len(traces) == 5
    for sequence,trace in enumerate(traces):
        number = lambda field: int(re.search(rf'\b{field}: (\d+)', trace)[1])
        assert number('sequence') == sequence
        assert number('command_type') == types[sequence]
        assert number('response_type') == 4352
        assert number('avail_idx') == number('used_idx') == sequence+1
        assert number('used_head') == sequence*2
        assert number('response_len') == 24
    assert 'scanout: Some(0)' in traces[-1]
    oracle = [int(word.strip(),16) for word in match[4].split(',')]
    assert len(oracle) == 35
    crc = zlib.crc32(struct.pack('<35I', *oracle))
    assert crc == crcs[index] == int(re.search(r'crc32: (\d+)', match[5])[1])
    for row in range(5):
        for column in range(7):
            if not (x <= column < x+w and y <= row < y+h):
                assert oracle[row*7+column] == 0
    rows.append({'line':line_no, 'pattern':index, 'rect':[x,y,w,h], 'offset':offset,
                 'backingEntries':nents, 'requestTypes':types, 'responses':5,
                 'sinkCrc32':f'{crc:08x}', 'shadowWords':len(oracle)})
assert [row['pattern'] for row in rows] == list(range(5))
text = raw.decode()
for marker in ['80 passed; 0 failed', '4 passed; 0 failed', '6 passed; 0 failed', 'ℹ tests 39', 'ℹ pass 39', 'ℹ fail 0']:
    assert marker in text, marker
print(json.dumps({'passed':True, 'head':proof['head'], 'logSha256':hashlib.sha256(raw).hexdigest(),
                  'note':'Recorded shadow field is a test oracle; the Rust test asserts actual resource words after recording. Sink CRC and queue responses are actual observations.',
                  'queuedPatterns':rows}, indent=2))
