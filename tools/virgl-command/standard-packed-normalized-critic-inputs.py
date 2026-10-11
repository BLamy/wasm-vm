#!/usr/bin/env python3
"""Predict novel original alias/nonzero-mip/odd-box inputs before browser capture."""
import json
import sys
from pathlib import Path

primary = json.loads(Path(sys.argv[1]).read_text())
seed = 0xde37a921
cases = []
aliases = {5: 320, 320: 5, 122: 409, 409: 122, 6: 319, 319: 6, 135: 407, 407: 135,
           7: 321, 321: 7, 8: 131, 131: 8, 308: 8}
for fmt in primary['records']:
    size = fmt['guestPixelBytes']
    planes, offset, w, h = [], 3, 11, 7
    for level in range(4):
        words = [((seed + fmt['originalFormat'] * 97 + pixel * 0x9e3779b9) ^
                  ((pixel + 7) * 0x45d9f3b) ^ (level * 0xabcdef01)) & ((1 << (size * 8)) - 1)
                 for pixel in range(w * h)]
        stride = w * size + 5
        planes.append(dict(level=level, width=w, height=h, stride=stride, offset=offset,
                           inputHex=b''.join(word.to_bytes(size, 'little') for word in words).hex()))
        offset += (h - 1) * stride + w * size + 13
        w, h = max(1, w // 2), max(1, h // 2)
    backing = bytearray([0xcd] * (offset + 7))
    for plane in planes:
        raw = bytes.fromhex(plane['inputHex'])
        row = plane['width'] * size
        for y in range(plane['height']):
            at = plane['offset'] + y * plane['stride']
            backing[at:at + row] = raw[y * row:(y + 1) * row]
    patch = dict(level=1, x=2, y=1, width=2, height=2, stride=2 * size + 3, offset=1,
                 inputHex=b''.join(((seed ^ pixel * 0x1749a3bd ^ fmt['originalFormat']) & ((1 << (size * 8)) - 1)).to_bytes(size, 'little') for pixel in range(4)).hex())
    cases.append(dict(format=fmt['originalFormat'], alias=aliases[fmt['originalFormat']], planes=planes,
                      backingHex=backing.hex(), patch=patch,
                      box=dict(level=1, x=1, y=1, width=3, height=2, stride=3 * size + 3, offset=7)))
plan = dict(schema='d35-critic-novel-original-inputs-v1', seed=seed, originalArchiveSha256=primary['archiveSha256'],
            fields=primary['records'], cases=cases, expectedInitialPadding=205,
            assertionImportsProductConversion=False)
Path(sys.argv[2]).write_text('/* Critic input predictions derived from the full pinned Mesa table. */\nexport const plan = ' + json.dumps(plan, separators=(',', ':')) + ';\n')
print('Predicted13 novel packed alias/mip/partial-box cases at seed0xde37a921.')
