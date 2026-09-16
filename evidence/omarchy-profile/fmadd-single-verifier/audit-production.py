#!/usr/bin/env python3
"""Audit recorded real browser execution; do not create a second emulator run."""
import hashlib
import json
from pathlib import Path
import struct
import sys

repo = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
worker = repo / 'evidence/omarchy-profile/fmadd-single-r1'
record = Path(sys.argv[1]) if len(sys.argv) > 1 else worker / 'browser'
name = sys.argv[2] if len(sys.argv) > 2 else 'production-inspection.json'
report = json.loads((record / 'report.json').read_text())
frozen = json.loads((worker / 'frozen.json').read_text())
sha = lambda b: hashlib.sha256(b).hexdigest()
elf = (record / 'fmadd.elf').read_bytes()
assert sha(elf) == report['elfSha256']
assert elf[:7] == b'\x7fELF\x02\x01\x01'
assert struct.unpack_from('<H', elf, 18)[0] == 243
assert struct.unpack_from('<Q', elf, 24)[0] == 0x80000000
words = list(struct.unpack_from('<' + 'I' * len(report['words']), elf, 0x1000))
assert words == report['words']
fmas = [(i, (w >> 7) & 31, (w >> 15) & 31, (w >> 20) & 31,
         (w >> 27) & 31, (w >> 12) & 7, (w >> 25) & 3)
        for i, w in enumerate(words) if w & 127 == 0x43]
assert fmas == [(15,6,0,1,2,7,0), (16,7,3,4,31,1,0),
                (17,8,5,30,31,0,0), (22,12,6,31,6,0,0)]
assert list(struct.unpack_from('<8I', elf, 0x3000)) == [
    0x3f800001,0x3f7ffffe,0xbf800000,0x7f7fffff,
    0x40000000,0x00800000,0x3f7fffff,0]
expected = {10:2, 13:0xffffffffa8800000, 14:0xffffffff7f7fffff,
            15:0xffffffff00800000, 16:0xffffffff40000000,
            17:0xffffffff40800000, 18:0xffffffff3f800000,
            19:0xffffffffa8800000, 20:7, 21:2}
oracle, jit = report['runs']
assert report['passed'] and report['errors'] == []
assert report['wasmSha256'] == frozen['wasmSha256']
expected_head = (json.loads((worker/'cold/report.json').read_text())['head']
                 if record == worker/'cold/browser' else frozen['head'])
assert report['head'] == expected_head
assert report['suite'] == {'metric-pass':'127','metric-fail':'0','metric-done':'127'}
assert oracle['registers'] == jit['registers'] and oracle['stats'] == jit['stats']
assert not oracle['jit'] and jit['jit']
for run in [oracle, jit]:
    assert run['stats']['retired'] == 5000
    assert all(s['kind'] == 'max' for s in run['statuses'])
    for register, value in expected.items():
        assert int(run['registers'][register + 1], 16) == value, register
    assert int(run['registers'][23], 16) & 0x8000000000006000 == 0x8000000000006000
assert not jit['jitStats']['admissionProbe']
assert int(jit['jitStats']['retiredViaJit']) >= 3500
assert jit['memoryGrowth']['after'] - jit['memoryGrowth']['before'] == 65536
assert jit['memoryGrowth']['afterRetired'] == 256

# Reconstruct RAM independently from guest ELF and the predicted seven FPR
# stores. stateDigest is explicitly a RAM digest, not a register-state digest.
ram = bytearray(8 * 1024 * 1024)
offset, address, _, size = struct.unpack_from('<4Q', elf, 72)
assert offset == 0x1000 and address == 0x80000000 and size == 0x2060
ram[:size] = elf[offset:offset + size]
for index, register in enumerate(range(13,20)):
    struct.pack_into('<Q', ram, 0x2020 + 8 * index, expected[register])
digest = sha(ram)
assert oracle['digest'] == jit['digest'] == digest
for filename, expected_sha in [
    ('suite.png', report['suiteScreenshotSha256']),
    ('capability-inspection.png', report['capabilityInspection']['sha256']),
    ('built-page.png', report['screenshotSha256']),
]:
    assert sha((record / filename).read_bytes()) == expected_sha
receipt = dict(head=report['head'], reportSha256=sha((record/'report.json').read_bytes()),
               elfSha256=sha(elf), literalRegistersChecked={str(k):f'{v:x}' for k,v in expected.items()},
               fmaParcels=fmas, independentlyReconstructedRamDigest=digest,
               retiredViaJit=jit['jitStats']['retiredViaJit'], retiredTotal=5000,
               suite=report['suite'], memoryGrowth=jit['memoryGrowth'], screenshotsRehashed=True)
(out/name).write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2))
