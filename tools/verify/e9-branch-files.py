#!/usr/bin/env python3
"""Independent native snapshot, COW filesystem and GPU readback oracles; no runtime codecs."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--directory', type=Path, required=True)
p.add_argument('--kind', choices=['software', 'gpu'], required=True)
a = p.parse_args()
out = a.directory.resolve()
repo = Path(__file__).resolve().parents[2]
sha = lambda b: hashlib.sha256(b).hexdigest()
u32 = lambda b, at: struct.unpack_from('<I', b, at)[0]
u64 = lambda b, at: struct.unpack_from('<Q', b, at)[0]
browser = json.loads((out / 'report.json').read_text())
assert browser['status'] == 'passed'
report = dict(status='running', kind=a.kind, browserSha256=sha((out / 'report.json').read_bytes()), points={})


def snapshot(file):
    raw = file.read_bytes()
    assert raw[:12] == b'WVMRESU1\1\0\0\0'
    body = raw
    if raw[-84:-76] == b'WVGRESU1':
        assert u32(raw, len(raw)-76) == 1 and u64(raw, len(raw)-72) == len(raw)-84
        assert sha(raw[:-32]) == raw[-32:].hex()
        body = raw[:-84]
    sections = {}
    at = 84
    while at < len(body):
        tag, length = struct.unpack_from('<II', body, at)
        at += 8
        assert tag not in sections and length <= len(body)-at
        sections[tag] = body[at:at+length]
        at += length
    assert at == len(body)
    return raw, sections


def overlay(device, identity, image_bytes):
    assert u32(device, 0) <= len(device)-4
    hub = device[4:4+u32(device, 0)]
    assert hub[:8] == b'WVDEVST1'
    size = u32(hub, 8)
    config = hub[12:12+size]
    assert config[2] == 1 and config[3:35] == identity
    assert u64(config, 35)*512 == image_bytes
    at = 12+size+32
    pending = u32(hub, at)
    at += 4
    assert pending == 0, 'proof point must have settled original block work'
    count = u32(hub, at)
    at += 4
    for _ in range(count):
        at += 12
        length = u32(hub, at)
        at += 4+length
        assert at <= len(hub)
    failed = u32(hub, at)
    at += 4+failed*5
    reads = u32(hub, at)
    at += 4
    for _ in range(reads):
        at += 12
        count = u32(hub, at)
        at += 4+count*4
    count = u32(hub, at)
    at += 4
    blocks = {}
    for _ in range(count):
        sector = u64(hub, at)
        at += 8
        assert sector < image_bytes//512 and sector not in blocks
        blocks[sector] = hub[at:at+512]
        assert len(blocks[sector]) == 512
        at += 512
    assert at+9 == len(hub) and u64(hub, at) == 0 and hub[at+8] == 0
    return blocks


def ram_sample(encoded, start, length, total):
    result = bytearray(length)
    digest = hashlib.sha256()
    at = cursor = 0
    while at < len(encoded):
        kind, size = encoded[at], u32(encoded, at+1)
        at += 5
        assert kind in (0, 1) and size > 0 and cursor+size <= total
        if kind:
            part = encoded[at:at+size]
            assert len(part) == size
            digest.update(part)
            lo, hi = max(cursor, start), min(cursor+size, start+length)
            if lo < hi:
                result[lo-start:hi-start] = part[lo-cursor:hi-cursor]
            at += size
        else:
            remaining = size
            while remaining:
                amount = min(remaining, 1 << 20)
                digest.update(bytes(amount))
                remaining -= amount
        cursor += size
    assert cursor == total and at == len(encoded)
    return bytes(result), digest.hexdigest()


if a.kind == 'software':
    image_dir = repo / 'web/assets/session-branch-linux'
    manifest = json.loads((image_dir/'image.json').read_text())
    base = bytearray()
    for digest in manifest['chunks']:
        chunk = (image_dir/(digest+'.bin')).read_bytes()
        assert sha(chunk) == digest and len(chunk) == manifest['chunk_size']
        base.extend(chunk)
    assert len(base) == manifest['image_len'] == 8 << 20
    assert sha(base) == '06cdb8c321a35eb6fd703d4994a4f8950d10a0b1608770fc3184f37a2fce8154'
    builder = 'sha256:0d1ead8c1106a838e478676dff113f21cdd91eb9456232ff9f6c24679a87d0eb'
    report['builder'] = builder
    for label, expected in [('past', b'past\n'), ('P', b'P\n'), ('A', b'A\n'), ('B', b'B\n')]:
        raw, sections = snapshot(out/(label+'.resume'))
        blocks = overlay(sections[20], raw[44:76], len(base))
        image = base.copy()
        for sector, block in blocks.items():
            image[sector*512:(sector+1)*512] = block
        file = out/(label+'.ext2')
        file.write_bytes(image)
        command = ['docker', 'run', '--rm', '--network', 'none', '-v', str(out)+':/proof:ro',
                   '--entrypoint', '/usr/sbin/debugfs', builder, '-R', 'cat /state', '/proof/'+file.name]
        result = subprocess.run(command, capture_output=True, check=True)
        (out/(label+'.debugfs.log')).write_bytes(result.stderr)
        (out/(label+'.file')).write_bytes(result.stdout)
        assert result.stdout == expected, (label, result.stdout)
        clock = sections[18]
        report['points'][label] = dict(nativeSha256=sha(raw), fileSha256=sha(result.stdout), overlaySectors=len(blocks),
                                      transition=str(u64(clock, 12)), sequence=str(u64(clock, 36)),
                                      sections={str(tag): sha(data) for tag, data in sections.items()}, command=command)
    assert (out/'source-P.resume').read_bytes() == (out/'P.resume').read_bytes(), 'original and replayed parent native states must be byte-identical'
else:
    symbols = browser['fixture']['symbols']
    for label, color, marker in [('past', [0, 255, 0, 255], 0x4d), ('P', [255, 0, 0, 255], ord('P')),
                                 ('A', [0, 0, 255, 255], ord('A')), ('B', [0, 255, 0, 255], ord('B'))]:
        raw, sections = snapshot(out/(label+'.resume'))
        blocks = overlay(sections[20], raw[44:76], 262144)
        assert blocks == {8: bytes([marker])*512}, 'private actual disk sectors'
        symbol = symbols['pixels']
        pixels, ram_digest = ram_sample(sections[2], int(symbol['address'], 16)-0x80000000, symbol['bytes'], 1 << 30)
        assert pixels == bytes(color)*4096, 'actual guest DMA readback differs from the literal expected color'
        disk_symbol = symbols['diskBytes']
        disk_bytes, second_digest = ram_sample(sections[2], int(disk_symbol['address'], 16)-0x80000000, disk_symbol['bytes'], 1 << 30)
        assert disk_bytes == bytes([marker])*512 and second_digest == ram_digest
        report['points'][label] = dict(nativeSha256=sha(raw), ramSha256=ram_digest, readbackSha256=sha(pixels),
                                      diskSha256=sha(disk_bytes), sections={str(tag): sha(data) for tag, data in sections.items() if tag != 2})
    assert browser['counter']['opens'] == 1 and browser['counter']['replayCalls'] == 0
    assert [value['letter'] for value in browser['counter']['frames']] == ['S', 'P']
    for index, value in enumerate(browser['counter']['frames']):
        frame = (out/f'counter-{index}.bin').read_bytes()
        assert sha(frame) == value['sha256'] and frame[14:32] == b'E9_BRANCH_COUNTER_' and chr(frame[32]) == value['letter']
report['status'] = 'passed'
(out/'independent-files.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(dict(status=report['status'], kind=a.kind, points=list(report['points']))))
