#!/usr/bin/env python3
"""Independent c580 text binding and high-precision coordinate samples."""
from decimal import Decimal, localcontext
from pathlib import Path
import hashlib
import json
import re
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
PATTERN = re.compile(
    r'^\s*P\((\w+),\s*(\d+),\s*"([xyzw]+)",\s*'
    r'S\((\w+),\s*(\d+),\s*"([xyzw]{4})"\),\s*'
    r'S\((\w+),\s*(\d+),\s*"([xyzw]{4})"\)\);')


def require(condition, reason):
    if not condition:
        raise AssertionError(reason)


def f32(word):
    return Decimal(str(struct.unpack('<f', struct.pack('<I', word))[0]))


def main():
    bank_file, native_path, wasm_path, report_path = map(Path, sys.argv[1:5])
    provenance = json.loads(bank_file.with_suffix('.json').read_text())
    source = (ROOT / 'renderer/virgl-shader/native_tests/coordinate_prefix.c').read_text()
    actual = []
    for line in source.splitlines():
        match = PATTERN.match(line)
        if not match:
            continue
        op, dst, mask, af, ai, ac, bf, bi, bc = match.groups()
        operands = [f'{af}[{ai}].{ac}']
        if op not in ('MOV', 'RCP'):
            operands.append(f'{bf}[{bi}].{bc}')
        actual.append(f'{len(actual)}: {op} TEMP[{dst}].{mask}, ' + ', '.join(operands))
    require(actual == provenance['prefix'], 'every replayed pc0..27 operand matches authenticated source')
    native = native_path.read_text()
    wasm = wasm_path.read_text()
    require(native == wasm and native.endswith('STATUS passed\n'), 'identical native/Wasm certificates')
    lines = re.findall(r'^BANK (\d+) source\.x<=2\^(\d+) source\.y<=2\^(\d+) '
                       r'pc25\.x<=2\^(\d+) pc25\.y<=2\^(\d+) pc27\.x<=2\^(\d+)$', native, re.M)
    require(len(lines) == 3 and [int(line[0]) for line in lines] == [0, 1, 2],
            'three ordered native/Wasm bank results')
    data = bank_file.read_bytes()
    require(hashlib.sha256(data).hexdigest() == provenance['binarySha256'],
            'bank binary matches authenticated packet provenance')
    require(struct.unpack_from('<II', data) == (0x50435231, 3) and len(data) == 8 + 3 * 136 * 4,
            'authenticated complete bank format')
    samples = []
    with localcontext() as context:
        context.prec = 80
        for index, (_, source_x, source_y, xb, yb, selected) in enumerate(lines):
            words = struct.unpack_from('<136I', data, 8 + index * 136 * 4)
            width, height = f32(words[32 * 4]), f32(words[32 * 4 + 1])
            ox, oy = f32(words[31 * 4]), f32(words[31 * 4 + 1])
            require(width >= 1 and height >= 1 and f32(words[29 * 4]) == 0,
                    'finite positive denominators and zero cap')
            require(words[29 * 4] == 0 and words[33 * 4 + 2] == 0xbf800000,
                    'captured positive zero and negative unit coefficient')
            signed_zero = f32(words[29 * 4]) * f32(words[33 * 4 + 2])
            require(signed_zero.is_zero() and signed_zero.is_signed(),
                    'pc15 signed-zero multiplication stays inside the finite envelope')
            # GLint viewport origins range through -2^31..2^31-1, and a
            # nonnegative GLsizei viewport width/height can approach 2^31.
            # Test centers at both signed-origin and summed positive edges.
            far = Decimal(2) ** 32 - Decimal('2.5')
            near = -(Decimal(2) ** 31) + Decimal('0.5')
            for x, y in [(Decimal('0.5'), Decimal('0.5')),
                         (width - Decimal('0.5'), height - Decimal('0.5')),
                         (Decimal(2) ** 31 - Decimal('0.5'), Decimal('0.5')),
                         (Decimal('0.5'), Decimal(2) ** 31 - Decimal('0.5')),
                         (far, Decimal('0.5')), (Decimal('0.5'), far),
                         (near, Decimal('0.5')), (Decimal('0.5'), near)]:
                # Algebraically independent reduction of the signed-mask
                # pc0..27 sequence; each physical operation has ample margin
                # inside the deliberately coarse binary exponent certificate.
                px = abs(x - ox - width / 2) - width / 2 + 1 / width
                py = abs(Decimal(768) - y - oy - height / 2) - height / 2 + 1 / height
                low = min(px, py)
                require(abs(x) < Decimal(2) ** int(source_x) and
                        abs(y) < Decimal(2) ** int(source_y) and
                        abs(px) < Decimal(2) ** int(xb) and
                        abs(py) < Decimal(2) ** int(yb) and
                        abs(low) < Decimal(2) ** int(selected),
                        'high-precision source equation enclosed by checked bounds')
                samples.append({'bank': index, 'x': str(x), 'y': str(y),
                                'pc25x': str(px), 'pc25y': str(py), 'pc27x': str(low)})
    report = {'schema': 'virgl-coordinate-prefix-independent-v1',
              'sourceInstructionsChecked': len(actual), 'banks': len(lines),
              'signedZeroPc15Banks': len(lines),
              'sampleCount': len(samples), 'samples': samples}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(f'{len(actual)} original instructions and {len(samples)} independent samples enclosed')


if __name__ == '__main__':
    main()
