#!/usr/bin/env python3
"""Independent exact-rational FMADD.S oracle; no Rust/backend/host FP use.

All finite inputs are Fractions. First round the exact fused result at precision
24 with an unbounded exponent to classify tininess/overflow. Encode using the
binary32 exponent bounds only afterwards. The resulting constants are committed
in the verifier test, so tests never compute their expected values via the DUT.
"""
from fractions import Fraction as Q
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
BOX = 0xFFFFFFFF00000000
NAN = 0x7FC00000


def power(n):
    return Q(1 << n) if n >= 0 else Q(1, 1 << -n)


def value(bits):
    exp, fraction = (bits >> 23) & 255, bits & 0x7FFFFF
    magnitude = fraction * power(-149) if exp == 0 else (fraction + (1 << 23)) * power(exp - 150)
    return -magnitude if bits >> 31 else magnitude


def raw(wide):
    return wide & 0xFFFFFFFF if wide >> 32 == 0xFFFFFFFF else NAN


def is_nan(bits):
    return (bits & 0x7FFFFFFF) > 0x7F800000


def is_snan(bits):
    return is_nan(bits) and not bits & 0x400000


def infinity(bits):
    return (bits & 0x7FFFFFFF) == 0x7F800000


def zero(bits):
    return (bits & 0x7FFFFFFF) == 0


def round_integer(q, mode, negative):
    floor, remainder = divmod(q.numerator, q.denominator)
    if not remainder:
        return floor
    twice = remainder * 2
    increment = (
        (mode == 0 and (twice > q.denominator or (twice == q.denominator and floor & 1)))
        or (mode == 2 and negative)
        or (mode == 3 and not negative)
        or (mode == 4 and twice >= q.denominator)
    )
    return floor + int(increment)


def floor_log2(q):
    exponent = q.numerator.bit_length() - q.denominator.bit_length()
    return exponent if q >= power(exponent) else exponent - 1


def fused(a, b, c, mode):
    a, b, c = map(raw, (a, b, c))
    invalid_product = (zero(a) and infinity(b)) or (infinity(a) and zero(b))
    if invalid_product or any(is_snan(x) for x in (a, b, c)):
        return NAN, 16
    if any(is_nan(x) for x in (a, b, c)):
        return NAN, 0
    product_sign = (a ^ b) >> 31
    if infinity(a) or infinity(b):
        if infinity(c) and product_sign != c >> 31:
            return NAN, 16
        return (product_sign << 31) | 0x7F800000, 0
    if infinity(c):
        return c, 0
    exact = value(a) * value(b) + value(c)
    if not exact:
        if (zero(a) or zero(b)) and zero(c) and product_sign == c >> 31:
            return product_sign << 31, 0
        return int(mode == 2) << 31, 0
    negative = exact < 0
    magnitude = abs(exact)
    exponent = floor_log2(magnitude)
    spacing = power(exponent - 23)
    unbounded = round_integer(magnitude / spacing, mode, negative) * spacing
    if unbounded >= power(128):
        away = mode in (0, 4) or (mode == 2 and negative) or (mode == 3 and not negative)
        return (int(negative) << 31) | (0x7F800000 if away else 0x7F7FFFFF), 5
    tiny = unbounded < power(-126)
    spacing = power(max(exponent - 23, -149))
    encoded_value = round_integer(magnitude / spacing, mode, negative) * spacing
    inexact = encoded_value != magnitude
    if encoded_value < power(-126):
        payload = int(encoded_value / power(-149))
    else:
        out_exp = floor_log2(encoded_value)
        mantissa = int(encoded_value / power(out_exp - 23))
        payload = ((out_exp + 127) << 23) | (mantissa - (1 << 23))
    return (int(negative) << 31) | payload, int(inexact) | (2 if tiny and inexact else 0)


def generate():
    cases = []

    def add(label, a, b, c, *, wide=False):
        operands = (a, b, c) if wide else tuple(BOX | x for x in (a, b, c))
        results = [fused(*operands, mode) for mode in range(5)]
        cases.append(dict(label=label, operands=list(operands), result=[x[0] for x in results], flags=[x[1] for x in results]))

    add("fused_cancellation", 0x3F800001, 0x3F7FFFFE, 0xBF800000)
    add("intermediate_overflow_cancelled", 0x7F7FFFFF, 0x40000000, 0xFF7FFFFF)
    add("large_cancel_to_small", 0x7F000000, 0x40000000, 0xFF7FFFFF)
    for negative in (0, 0x80000000):
        for multiplier in (0x3E800000, 0x3EFFFFFF, 0x3F000000, 0x3F000001, 0x3F200000, 0x3F3FFFFF, 0x3F400000, 0x3F400001, 0x3F800000):
            add(f"tiny_boundary_{negative:x}_{multiplier:x}", 1 | negative, multiplier, 0x007FFFFF | negative)
        add(f"half_min_sub_{negative:x}", 1 | negative, 0x3F000000, negative)
        add(f"exact_min_sub_{negative:x}", 1 | negative, 0x3F800000, negative)
        add(f"tiny_half_normal_{negative:x}", 0x00800000 | negative, 0x3F7FFFFF, negative)
        add(f"normal_inexact_above_{negative:x}", 1 | negative, 0x3F000000, 0x00800000 | negative)
        add(f"large_overflow_{negative:x}", 0x7F7FFFFF | negative, 0x40000000, negative)
        # The exact product is 2^128; an opposite tiny addend moves it just
        # below the overflow boundary despite a 277-bit exponent gap.
        for addend in (1, 0x80000001, 0x007FFFFF, 0x807FFFFF):
            add(f"overflow_wide_gap_{negative:x}_{addend:x}", 0x7F000000 | negative, 0x40000000, addend ^ negative)
        for multiplier in (0x3E7FFFFF, 0x3E800000, 0x3E800001, 0x3EFFFFFF, 0x3F000000, 0x3F000001):
            add(f"tininess_threshold_{negative:x}_{multiplier:x}", 1 | (negative ^ 0x80000000), multiplier, 0x00800000 | negative)
        for addend in (1, 0x72800000, 0x72FFFFFF, 0x73000000, 0x73000001, 0x73800000):
            add(f"overflow_boundary_{negative:x}_{addend:x}", 0x7F7FFFFF | negative, 0x3F800000, addend | negative)
        add(f"unit_tie_{negative:x}", 0x3F800000 | negative, 0x3F800000, 0x33800000 | negative)
        add(f"unit_odd_tie_{negative:x}", 0x3F800001 | negative, 0x3F800000, 0x33800000 | negative)
    for sa in (0, 0x80000000):
        for sb in (0, 0x80000000):
            for sc in (0, 0x80000000):
                add(f"zero_signs_{sa:x}_{sb:x}_{sc:x}", sa, 0x3F800000 | sb, sc)
    for c in (0x3F800000, 0x7FC01234, 0x7F800001, 0xFF800000):
        add(f"zero_inf_{c:x}", 0, 0x7F800000, c)
        add(f"inf_zero_{c:x}", 0xFF800000, 0x80000000, c)
    add("inf_opposite", 0x7F800000, 0x3F800000, 0xFF800000)
    add("inf_same", 0xFF800000, 0x3F800000, 0xFF800000)
    add("inf_addend", 0x7F7FFFFF, 0x7F7FFFFF, 0xFF800000)
    for position in range(3):
        for special in (0xFFFFFFFF7FC01234, 0xFFFFFFFF7F800001, 0xFFFFFFFE7F800001, 0x000000007F800001, 0x800000003F800000):
            values = [BOX | 0x3F800000] * 3
            values[position] = special
            add(f"special_operand_{position}_{special:x}", *values, wide=True)
    add("malformed_addend_invalid_product", BOX, BOX | 0x7F800000, 0xFFFFFFFE3F800000, wide=True)
    add("malformed_product_suppresses_false_invalid", 0xFFFFFFFE00000000, BOX | 0x7F800000, BOX, wide=True)
    for seed in (0xC3A85D176901B2EF, 0x01FAB8423D97EC65, 0x7E934B1AC652D08F):
        random = seed
        def next_value():
            nonlocal random
            random ^= (random << 13) & ((1 << 64) - 1)
            random ^= random >> 7
            random ^= (random << 17) & ((1 << 64) - 1)
            return random
        for i in range(24):
            operands = []
            for _ in range(3):
                v = next_value()
                operands.append((BOX if v % 11 else 0xFFFFFFFE00000000) | (v & 0xFFFFFFFF))
            add(f"seed_{seed:x}_{i}", *operands, wide=True)
    assert cases[0]["result"] == [0xA8800000] * 5 and cases[0]["flags"] == [0] * 5
    assert cases[1]["result"] == [0x7F7FFFFF] * 5 and cases[1]["flags"] == [0] * 5
    return cases


if __name__ == "__main__":
    cases = generate()
    report = dict(schema=1, derivation="Python Fraction exact fused operation and independent unbounded-exponent rounding", cases=cases)
    (HERE / "goldens.json").write_text(json.dumps(report, indent=2) + "\n")
    lines = ["pub const GOLDENS: &[Golden] = &["]
    for g in cases:
        args = ", ".join(f"0x{x:016x}" for x in g["operands"])
        results = ", ".join(f"0x{x:08x}" for x in g["result"])
        flags = ", ".join(str(x) for x in g["flags"])
        lines.append(f'    Golden {{ name: "{g["label"]}", operands: [{args}], result: [{results}], flags: [{flags}] }},')
    lines.append("];")
    (HERE / "goldens.rs").write_text("\n".join(lines) + "\n")
    print(json.dumps({"cases":len(cases), "mode_results":len(cases)*5, "json_sha256":hashlib.sha256((HERE/"goldens.json").read_bytes()).hexdigest(), "source_sha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}))
