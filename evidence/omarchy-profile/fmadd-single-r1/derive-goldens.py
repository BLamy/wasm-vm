"""Independent exact-rational FMADD.S oracle; no host float or emulator backend.

RISC-V F: fused operation, canonical NaNs, 0*infinity+qNaN raises NV.
Berkeley SoftFloat s_mulAddF32.c / s_roundPackToF32.c: single rounding,
unbounded-exponent precision-24 tininess before final subnormal rounding.
"""
from fractions import Fraction
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
BOX = 0xffffffff00000000
def power(e):
    return Fraction(1 << e) if e >= 0 else Fraction(1, 1 << -e)
def finite(b):
    e, m = (b >> 23) & 255, b & 0x7fffff
    magnitude = (m | (0x800000 if e else 0)) * power(e - 150 if e else -149)
    return -magnitude if b >> 31 else magnitude
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
def expected(a, b, c, mode):
    a, b, c = [v & 0xffffffff if v >> 32 == 0xffffffff else 0x7fc00000 for v in (a, b, c)]
    aa, bb, cc = [v & 0x7fffffff for v in (a, b, c)]
    nan = lambda x: x > 0x7f800000
    snan = lambda x: nan(x) and not x & 0x400000
    invalid_product = (aa == 0x7f800000 and bb == 0) or (bb == 0x7f800000 and aa == 0)
    if any(nan(v) for v in (aa, bb, cc)):
        return 0x7fc00000, 16 if invalid_product or any(snan(v) for v in (aa, bb, cc)) else 0
    if invalid_product:
        return 0x7fc00000, 16
    product_sign = (a ^ b) >> 31
    if aa == 0x7f800000 or bb == 0x7f800000:
        if cc == 0x7f800000 and product_sign != c >> 31:
            return 0x7fc00000, 16
        return (product_sign << 31) | 0x7f800000, 0
    if cc == 0x7f800000:
        return c, 0
    exact = finite(a) * finite(b) + finite(c)
    if exact == 0:
        same_zero = (aa == 0 or bb == 0) and cc == 0 and product_sign == c >> 31
        return ((product_sign if same_zero else int(mode == 2)) << 31), 0
    sign = exact < 0
    s, x = int(sign) << 31, abs(exact)
    e = x.numerator.bit_length() - x.denominator.bit_length()
    if x < power(e):
        e -= 1
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
        normal_e = max(e + int(q >= 0x1000000), -126)
        sig = int(value / power(normal_e - 23))
        bits = ((normal_e + 127) << 23) | (sig & 0x7fffff)
    return s | bits, flags

TRIPLES = [
    (0x3f800000, 0x40000000, 0x40400000),
    (0x3f800001, 0x3f7ffffe, 0xbf800000),
    (0xbf800001, 0x3f7ffffe, 0x3f800000),
    (0x3f800000, 0x3f800000, 0x33800000),
    (0xbf800000, 0x3f800000, 0xb3800000),
    (0x3f800001, 0x3f800000, 0x33800000),
    (0x3f800000, 0x3f800000, 0x33000000),
    (0x3f800000, 0x3f800000, 0xbf800000),
    (0x7f7fffff, 0x40000000, 0xff7fffff),
    (0x7f7fffff, 0x40000000, 0),
    (0xff7fffff, 0x40000000, 0),
    (0x5f800000, 0x5f800000, 1),
    (0x5f800000, 0x5f800000, 0x80000001),
    (0xdf800000, 0x5f800000, 1),
    (0xdf800000, 0x5f800000, 0x80000001),
    (0x00800000, 0x3f7fffff, 0),
    (0x80800000, 0x3f7fffff, 0),
    (1, 0x3f000000, 0), (0x80000001, 0x3f000000, 0),
    (3, 0x3f000000, 0), (0x80000003, 0x3f000000, 0),
    (1, 0x3e800000, 0x00800000),
    (0x80000001, 0x3e800000, 0x00800000),
    (0x80000001, 0x3e800001, 0x00800000),
    (0x80000001, 0x3e7fffff, 0x00800000),
    (0x80000001, 0x3f000000, 0x00800000),
    (0x80000001, 0x3effffff, 0x00800000),
    (0x80000001, 0x3f000001, 0x00800000),
    (1, 0x3e800000, 0x80800000),
    (1, 0x3e800001, 0x80800000),
    (1, 0x3e7fffff, 0x80800000),
    (0x00800000, 0x00800000, 0),
    (0x3f800000, 0x7f800000, 0x40000000),
    (0xbf800000, 0x7f800000, 0xff800000),
    (0x3f800000, 0x7f800000, 0xff800000),
    (0x3f800000, 0x40000000, 0xff800000),
    (0, 0x7f800000, 0x7fc12345),
    (0xff800000, 0x80000000, 0x7fc12345),
    (0, 0x7f800000, 0x3f800000),
]
for a in (0, 0x80000000):
    for b in (0x3f800000, 0xbf800000):
        for c in (0, 0x80000000):
            TRIPLES.append((a, b, c))
for pos in range(3):
    for bits in (0x7fc12345, 0xff800001):
        args = [0x3f800000, 0x40000000, 0x40400000]
        args[pos] = bits
        TRIPLES.append(tuple(args))
triples = [tuple(BOX | v for v in args) for args in TRIPLES]
for pos in range(3):
    args = [BOX | 0x3f800000, BOX | 0x40000000, BOX | 0x40400000]
    args[pos] = 0x123456787f800001
    triples.append(tuple(args))
rows = []
for a, b, c in triples:
    modes = [expected(a, b, c, mode) for mode in range(5)]
    rows.append({'a': f'{a:016x}', 'b': f'{b:016x}', 'c': f'{c:016x}',
                 'bits': [f'{v[0]:08x}' for v in modes], 'flags': [v[1] for v in modes]})
(ROOT / 'fmadd-goldens.json').write_text(json.dumps(rows, indent=2) + '\n')
rust = '\n'.join('    (0x' + r['a'] + ', 0x' + r['b'] + ', 0x' + r['c'] + ', [' +
                 ', '.join('0x' + v for v in r['bits']) + '], ' + str(r['flags']) + '),' for r in rows)
(REPO / 'tests/support/fmadd_goldens.rs').write_text(
    '// Exact Fraction-derived literals; see fmadd-single-r1/derive-goldens.py.\n'
    '#[allow(clippy::type_complexity)]\n'
    'pub const GOLDENS: &[(u64, u64, u64, [u32; 5], [u8; 5])] = &[\n' + rust + '\n];\n')
print(len(rows), 'independent triples,', len(rows) * 5, 'literal mode results')
