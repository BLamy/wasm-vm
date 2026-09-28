#!/usr/bin/env python3
"""Independent FDIV binary32 literals, exact fractions and integer rounding only.

This does not import or run any project code. Tininess is decided by rounding
at full precision with an unbounded exponent before subnormal quantization.
"""
from fractions import Fraction
import json
from pathlib import Path

BOX = 0xffffffff00000000


def two(e):
    return Fraction(1 << e) if e >= 0 else Fraction(1, 1 << -e)


def finite(bits):
    e, f = (bits >> 23) & 255, bits & 0x7fffff
    return Fraction(f if not e else f | 0x800000) * two(-149 if not e else e - 150)


def rounded(q, negative, mode):
    n, rem = divmod(q.numerator, q.denominator)
    if not rem:
        return n
    if mode == 0:
        up = rem * 2 > q.denominator or (rem * 2 == q.denominator and n & 1)
    elif mode == 1:
        up = False
    elif mode == 2:
        up = negative
    elif mode == 3:
        up = not negative
    else:
        up = rem * 2 >= q.denominator
    return n + int(up)


def divide(a, b, mode):
    a = a & 0xffffffff if a >> 32 == 0xffffffff else 0x7fc00000
    b = b & 0xffffffff if b >> 32 == 0xffffffff else 0x7fc00000
    sign = (a ^ b) & 0x80000000
    ma, mb = a & 0x7fffffff, b & 0x7fffffff
    if ma > 0x7f800000 or mb > 0x7f800000:
        snan = any((v & 0x7fffffff) > 0x7f800000 and not (v & 0x400000) for v in (a, b))
        return 0x7fc00000, 16 if snan else 0
    if (ma == mb == 0) or (ma == mb == 0x7f800000):
        return 0x7fc00000, 16
    if ma == 0x7f800000:
        return sign | 0x7f800000, 0
    if mb == 0x7f800000 or ma == 0:
        return sign, 0
    if mb == 0:
        return sign | 0x7f800000, 8
    q = finite(a) / finite(b)
    exponent = q.numerator.bit_length() - q.denominator.bit_length()
    if q < two(exponent):
        exponent -= 1
    unbounded = rounded(q / two(exponent - 23), bool(sign), mode) * two(exponent - 23)
    tiny = unbounded < two(-126)
    if unbounded >= two(128):
        infinity = mode in (0, 4) or (mode == 2 and sign) or (mode == 3 and not sign)
        return sign | (0x7f800000 if infinity else 0x7f7fffff), 5
    quantum = two(max(exponent - 23, -149))
    quantized = rounded(q / quantum, bool(sign), mode) * quantum
    inexact = q != quantized
    if quantized < two(-126):
        bits = int(quantized / two(-149))
    else:
        e = quantized.numerator.bit_length() - quantized.denominator.bit_length()
        if quantized < two(e):
            e -= 1
        bits = ((e + 127) << 23) | (int(quantized / two(e - 23)) & 0x7fffff)
    return sign | bits, int(inexact) | (2 if tiny and inexact else 0)


PAIRS = [
    (0x3f800000, 0x40400000), (0xbf800000, 0x40400000),
    (0x40000000, 0x40400000), (0x3f800000, 0x41200000),
    (0x40400000, 0x40000000), (0xc1100000, 0xc0400000),
    (0x00000000, 0x3f800000), (0x80000000, 0x3f800000),
    (0x00000000, 0xbf800000), (0x80000000, 0xbf800000),
    (0x3f800000, 0x00000000), (0x3f800000, 0x80000000),
    (0xbf800000, 0x80000000), (0x00000000, 0x00000000),
    (0x80000000, 0x00000000), (0x7f800000, 0x00000000),
    (0xff800000, 0x80000000), (0x7f800000, 0x7f800000),
    (0xff800000, 0x7f800000), (0x3f800000, 0xff800000),
    (0xbf800000, 0xff800000), (0xff800000, 0xbf800000),
    (0x7fc04321, 0x00000000), (0x00000000, 0xffc00042),
    (0x7f800001, 0x3f800000), (0x7fc00042, 0xff800042),
    (0x00000001, 0x40000000), (0x80000001, 0x40000000),
    (0x00000003, 0x40000000), (0x80000003, 0x40000000),
    (0x00800000, 0x40000000), (0x007fffff, 0x3f000000),
    (0x00ffffff, 0x40000000), (0x80ffffff, 0x40000000),
    (0x00800000, 0x3f800001), (0x80800000, 0x3f800001),
    (0x00ffffff, 0x3fffffff), (0x80ffffff, 0x3fffffff),
    (0x00800001, 0x3f800001), (0x00000001, 0x00000001),
    (0x3f800000, 0x00000001), (0x00000001, 0x7f7fffff),
    (0x7f7fffff, 0x3f000000), (0xff7fffff, 0x3f000000),
    (0x7f7fffff, 0x3f7fffff), (0xff7fffff, 0x3f7fffff),
    (0x7f7ffffe, 0x3f7fffff), (0xff7ffffe, 0x3f7fffff),
    (0x3f800001, 0x3f800000), (0x3f800000, 0x3f800001),
    (0x00000001, 0x34000001), (0x80000001, 0x34000001),
    (0x00800000, 0x3f7fffff), (0x80800000, 0x3f7fffff),
]
RAW = [
    (0xfffffffe7f800001, BOX | 0),
    (BOX | 0x3f800000, 0xfffffffe00000000),
    (0x000000007f800001, BOX | 0xff800001),
    (BOX | 0x7f800001, 0x00000000ff800001),
    (0x000000003f800000, 0x800000003f800000),
]

if __name__ == '__main__':
    rows = []
    for a, b in [(BOX | a, BOX | b) for a, b in PAIRS] + RAW:
        values = [divide(a, b, rm) for rm in range(5)]
        rows.append(dict(a=f'{a:016x}', b=f'{b:016x}',
                         results=[f'{x:08x}' for x, _ in values],
                         flags=[f for _, f in values]))
    assert rows[0]['results'] == ['3eaaaaab','3eaaaaaa','3eaaaaaa','3eaaaaab','3eaaaaab']
    assert rows[32]['flags'] == [3] * 5
    assert rows[36]['flags'] == [0] * 5
    assert rows[44]['flags'] == [5] * 5
    output = Path(__file__).with_name('goldens.json')
    output.write_text(json.dumps(rows, indent=2) + '\n')
    print(f'{len(rows)} independent literal pairs -> {output}')
