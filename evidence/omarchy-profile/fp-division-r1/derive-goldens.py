"""Independent exact-rational binary32 division goldens; no emulator backend."""
from fractions import Fraction
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
BOX = 0xffffffff00000000
def power(e):
    return Fraction(1 << e) if e >= 0 else Fraction(1, 1 << -e)
def finite(b):
    e, m = (b >> 23) & 255, b & 0x7fffff
    return (m | (0x800000 if e else 0)) * power(e - 150 if e else -149)
def rounded(x, step, mode, sign):
    y = x / step
    q, r = divmod(y.numerator, y.denominator)
    if not r:
        return q
    twice = r * 2
    up = ((mode == 0 and (twice > y.denominator or (twice == y.denominator and q & 1)))
          or (mode == 4 and twice >= y.denominator)
          or (mode == 2 and sign) or (mode == 3 and not sign))
    return q + bool(up)
def expected(a, b, mode):
    a = a & 0xffffffff if a >> 32 == 0xffffffff else 0x7fc00000
    b = b & 0xffffffff if b >> 32 == 0xffffffff else 0x7fc00000
    aa, bb = a & 0x7fffffff, b & 0x7fffffff
    sign = bool((a ^ b) >> 31)
    s = int(sign) << 31
    nan = lambda x: x > 0x7f800000
    snan = lambda x: nan(x) and not x & 0x400000
    if nan(aa) or nan(bb):
        return 0x7fc00000, 16 if snan(aa) or snan(bb) else 0
    if (aa == bb == 0x7f800000) or aa == bb == 0:
        return 0x7fc00000, 16
    if aa == 0x7f800000:
        return s | 0x7f800000, 0
    if bb == 0x7f800000 or aa == 0:
        return s, 0
    if bb == 0:
        return s | 0x7f800000, 8
    x = finite(aa) / finite(bb)
    e = x.numerator.bit_length() - x.denominator.bit_length()
    if x < power(e):
        e -= 1
    # Tininess uses precision-24 rounding with an unbounded exponent, before
    # independently rounding the final subnormal result (IEEE/RISC-V rule).
    unbounded = rounded(x, power(e - 23), mode, sign) * power(e - 23)
    if unbounded >= power(128):
        infinity = mode in (0, 4) or (mode == 2 and sign) or (mode == 3 and not sign)
        return s | (0x7f800000 if infinity else 0x7f7fffff), 5
    step = power(max(e - 23, -149))
    q = rounded(x, step, mode, sign)
    value = q * step
    flags = int(value != x)
    if flags and unbounded < power(-126):
        flags |= 2
    if value < power(-126):
        bits = int(value / power(-149))
    else:
        normal_e = e + int(q >= 0x1000000)
        # A tiny exact result can round to the smallest normal.
        normal_e = max(normal_e, -126)
        sig = int(value / power(normal_e - 23))
        bits = ((normal_e + 127) << 23) | (sig & 0x7fffff)
    return s | bits, flags

PAIRS = [
    (0x3f800000, 0x40400000), (0xbf800000, 0x40400000),
    (0x40400000, 0x40000000), (0x3f800000, 0xc0000000),
    (0, 0xbf800000), (0x80000000, 0xbf800000),
    (0x3f800000, 0), (0xbf800000, 0),
    (0x7f800000, 0), (0xff800000, 0x80000000),
    (0, 0), (0x80000000, 0), (0x7f800000, 0x7f800000),
    (0x3f800000, 0x7f800000), (0xbf800000, 0x7f800000),
    (0x7f800000, 0xbf800000), (0x7fc01234, 0x3f800000),
    (0xff800001, 0x3f800000), (0x3f800000, 0x7f800001),
    (0x00800000, 0x40000000), (1, 0x40000000),
    (0x80000001, 0x40000000), (3, 0x40000000),
    (0x00ffffff, 0x40000000), (0x80ffffff, 0x40000000),
    (0x00800000, 0x3f800001), (0x007fffff, 0x3f7fffff),
    (1, 0x34000001),
    (0x7f7fffff, 0x3f000000), (0xff7fffff, 0x3f000000),
    (0x7f7fffff, 0x3f7fffff), (0xff7fffff, 0x3f7fffff),
    (0x7f7ffffe, 0x3f7fffff), (0xff7ffffe, 0x3f7fffff),
    (1, 1), (0x00800000, 0x7f7fffff), (0x7f7fffff, 1),
]
pairs = [(BOX | a, BOX | b) for a, b in PAIRS]
pairs += [(0x123456787f800001, BOX | 0x3f800000),
          (BOX | 0x3f800000, 0xfffffffeff800001)]
rows = []
for a, b in pairs:
    modes = [expected(a, b, mode) for mode in range(5)]
    rows.append({'a':f'{a:016x}', 'b':f'{b:016x}',
                 'bits':[f'{v[0]:08x}' for v in modes], 'flags':[v[1] for v in modes]})
(ROOT / 'division-goldens.json').write_text(json.dumps(rows, indent=2) + '\n')
print('\n'.join('    (0x'+row['a']+', 0x'+row['b']+', ['+
      ', '.join('0x'+bits for bits in row['bits'])+'], '+str(row['flags'])+'),' for row in rows))
