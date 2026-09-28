#!/usr/bin/env python3
"""Audit an already-recorded production guest without starting an emulator."""
import hashlib
import json
from pathlib import Path
import struct
import sys

repo = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
record = Path(sys.argv[1]) if len(sys.argv) > 1 else repo / 'evidence/omarchy-profile/fp-division-r1/browser'
name = sys.argv[2] if len(sys.argv) > 2 else 'production-inspection.json'
report = json.loads((record / 'report.json').read_text())
frozen = json.loads((repo / 'evidence/omarchy-profile/fp-division-r1/frozen.json').read_text())
sha = lambda b: hashlib.sha256(b).hexdigest()
elf = (record / 'fp-division.elf').read_bytes()
assert sha(elf) == report['elfSha256']
assert elf[:7] == b'\x7fELF\x02\x01\x01'
assert struct.unpack_from('<H', elf, 18)[0] == 243
assert struct.unpack_from('<Q', elf, 24)[0] == 0x80000000
words = list(struct.unpack_from('<' + 'I' * len(report['words']), elf, 0x1000))
assert words == report['words']
divisions = [(i, (w >> 7) & 31, (w >> 15) & 31, (w >> 20) & 31, (w >> 12) & 7)
             for i, w in enumerate(words) if w & 0x7f == 0x53 and w >> 25 == 12]
assert divisions == [(14,6,0,1,7), (15,7,2,3,1), (16,8,4,5,0), (20,11,0,30,0), (21,12,30,30,0)]
assert list(struct.unpack_from('<7I', elf, 0x3000)) == [0x3f800000,0x40400000,0x7f7fffff,0x3f000000,0x00ffffff,0x40000000,0]
expected = {10:1, 13:0xffffffff3eaaaaaa, 14:0xffffffff7f7fffff,
            15:0xffffffff00800000, 16:0xffffffff3f800000,
            17:0xffffffff40000000, 18:0xffffffff7f800000,
            19:0xffffffff7fc00000, 20:31, 21:2}
oracle, jit = report['runs']
assert report['passed'] and report['errors'] == []
assert report['wasmSha256'] == frozen['wasmSha256']
assert report['suite'] == {'metric-pass':'127','metric-fail':'0','metric-done':'127'}
assert oracle['registers'] == jit['registers'] and oracle['stats'] == jit['stats']
assert not oracle['jit'] and jit['jit']
for run in [oracle, jit]:
    assert run['stats']['retired'] == 5000
    assert all(s['kind'] == 'max' for s in run['statuses'])
    for register, value in expected.items():
        assert int(run['registers'][register + 1], 16) == value, register
    assert int(run['registers'][23], 16) & 0x8000000000006000 == 0x8000000000006000
assert jit['jitStats']['retiredViaJit'] == 4601
assert not jit['jitStats']['admissionProbe']

# stateDigest is explicitly RAM-only. Recreate it from the ELF and the seven
# independently predicted guest FPR stores, not from a runtime-produced golden.
ram = bytearray(8 * 1024 * 1024)
offset, address, _, size = struct.unpack_from('<4Q', elf, 72)
assert offset == 0x1000 and address == 0x80000000 and size == 0x2060
ram[:size] = elf[offset:offset + size]
for index, register in enumerate(range(13, 20)):
    struct.pack_into('<Q', ram, 0x2020 + 8 * index, expected[register])
digest = sha(ram)
assert oracle['digest'] == jit['digest'] == digest
for filename, expected_sha in [
    ('suite.png', report['suiteScreenshotSha256']),
    ('capability-inspection.png', report['capabilityInspection']['sha256']),
    ('built-page.png', report['screenshotSha256']),
]:
    assert sha((record / filename).read_bytes()) == expected_sha
receipt = dict(head=report['head'], reportSha256=sha((record / 'report.json').read_bytes()),
               elfSha256=sha(elf), elfWordsMatchReport=True, divisionInstructions=divisions,
               literalRegistersChecked={str(k):f'{v:x}' for k,v in expected.items()},
               independentlyReconstructedRamDigest=digest,
               retiredViaJit=4601, retiredTotal=5000, suite=report['suite'],
               screenshotsRehashed=True)
(out / name).write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))
