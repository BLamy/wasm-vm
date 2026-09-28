#!/usr/bin/env python3
"""Decode the actual PNG independently; do not alter its bytes or pixels."""
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import zlib


def audit(filename, foot=None):
    png = filename.read_bytes()
    assert png[:8] == b'\x89PNG\r\n\x1a\n'
    offset, compressed, header, ended = 8, bytearray(), None, False
    while offset < len(png):
        length = struct.unpack_from('>I', png, offset)[0]
        kind, data = png[offset+4:offset+8], png[offset+8:offset+8+length]
        crc = struct.unpack_from('>I', png, offset+8+length)[0]
        assert zlib.crc32(kind + data) & 0xffffffff == crc
        if kind == b'IHDR': header = struct.unpack('>IIBBBBB', data)
        if kind == b'IDAT': compressed.extend(data)
        offset += 12 + length
        if kind == b'IEND':
            ended = True
            break
    assert ended and offset == len(png)
    width, height, depth, color, compression, filtering, interlace = header
    assert (width, height, depth, compression, filtering, interlace) == (1280, 800, 8, 0, 0, 0)
    assert color in (2, 6)
    bpp = 3 if color == 2 else 4
    stride, raw = width*bpp, zlib.decompress(compressed)
    assert len(raw) == height*(stride+1)
    previous, decoded = bytearray(stride), bytearray()
    maximum, alpha_minimum, bright, all_colors, roi_colors = 0, 255, 0, set(), set()
    roi = None
    if foot:
        x, y = foot['at']; w, h = foot['size']
        assert foot['class'] == 'foot' and foot['mapped'] and not foot['hidden']
        assert x >= 0 and y >= 26 and w >= 200 and h >= 100 and x+w <= width and y+h <= height
        roi = [math.ceil(x+12), math.ceil(y+10), math.floor(x+min(w-12, 300)), math.floor(y+55)]
    for y in range(height):
        filtering = raw[y*(stride+1)]
        row = bytearray(raw[y*(stride+1)+1:(y+1)*(stride+1)])
        assert filtering <= 4
        for x in range(stride):
            left = row[x-bpp] if x >= bpp else 0
            above, upper_left = previous[x], previous[x-bpp] if x >= bpp else 0
            if filtering == 1: predictor = left
            elif filtering == 2: predictor = above
            elif filtering == 3: predictor = (left+above)//2
            elif filtering == 4:
                p = left + above - upper_left
                a, b, c = abs(p-left), abs(p-above), abs(p-upper_left)
                predictor = left if a <= b and a <= c else above if b <= c else upper_left
            else: predictor = 0
            row[x] = (row[x]+predictor) & 255
        for x in range(width):
            i = x*bpp
            rgb = bytes(row[i:i+3]); maximum = max(maximum, *rgb); all_colors.add(rgb)
            alpha = row[i+3] if bpp == 4 else 255
            alpha_minimum = min(alpha_minimum, alpha)
            if roi and roi[0] <= x < roi[2] and roi[1] <= y < roi[3] and alpha and max(rgb) > 140:
                bright += 1; roi_colors.add(rgb)
        decoded.extend(row); previous = row
    return dict(path=str(filename), size=len(png), sha256=hashlib.sha256(png).hexdigest(), width=width, height=height,
        pixels=width*height, maximumRGBChannel=maximum, minimumAlpha=alpha_minimum, colors=len(all_colors),
        entirelyBlack=maximum == 0, rawPixelSha256=hashlib.sha256(decoded).hexdigest(),
        terminalRoi=roi, brightPixels=bright if roi else None, brightColors=len(roi_colors) if roi else None,
        nonblank=bright >= 80 and len(roi_colors) >= 8 if roi else None)


if __name__ == '__main__':
    report = json.loads(Path(sys.argv[2]).read_text()) if len(sys.argv) > 2 else {}
    foot = report.get('modePreparation', {}).get('foot')
    print(json.dumps(audit(Path(sys.argv[1]), foot), indent=2))
