"""Exact-rational numeric references; fixture error bounds never gate admission."""
from fractions import Fraction
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location('component_prior_oracle', ROOT / 'tools/virgl-numeric-floats/oracle.py')
_prior = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_prior)
word, power, require = _prior.word, _prior.power, _prior.require


def rational(value):
    value = Fraction(value)
    return {'numerator': str(value.numerator), 'denominator': str(value.denominator)}


def decode(bits):
    """Decode finite binary32 bytes using integers, including subnormal encodings."""
    require(type(bits) is int and 0 <= bits < 2 ** 32, 'one unsigned binary32 word')
    sign, exponent, fraction = bits >> 31, (bits >> 23) & 255, bits & 0x7fffff
    require(exponent != 255, 'finite binary32 value for rational comparison')
    magnitude = Fraction(fraction) * power(-149) if exponent == 0 else Fraction((1 << 23) + fraction) * power(exponent - 150)
    return -magnitude if sign else magnitude


def classify(bits):
    require(type(bits) is int and 0 <= bits < 2 ** 32, 'one unsigned binary32 word')
    magnitude, exponent = bits & 0x7fffffff, (bits >> 23) & 255
    if exponent == 255:
        return 'infinity' if magnitude == 0x7f800000 else 'nan'
    if magnitude == 0:
        return 'zero'
    return 'subnormal' if exponent == 0 else 'normal'


def exponent(value):
    value = abs(Fraction(value))
    require(value != 0, 'nonzero binary exponent')
    result = value.numerator.bit_length() - value.denominator.bit_length()
    return result - 1 if value < power(result) else result


def division_bounds(numerator, denominator):
    """Conservative symmetric 2.5-ULP enclosure for the authored normal witnesses.

    At an exact power of two the larger, upper-binade spacing bounds both sides.
    Other witnesses stay in one binade even after the error radius. These checks
    limit this quantitative oracle, never the shaders accepted by the compiler.
    """
    a, b = Fraction(numerator), Fraction(denominator)
    require(power(-126) <= b <= power(126), 'authored positive denominator inside the specified accuracy range')
    q = a / b
    e = exponent(q)
    require(-126 <= e <= 126, 'normal quantitative quotient with overflow margin')
    ulp = power(e - 23)
    radius = Fraction(5, 2) * ulp
    boundary = abs(q) == power(e)
    require(abs(q) - radius >= power(-126) and abs(q) + radius < power(e + 1),
            'authored enclosure avoids subnormal and next-binade ambiguity')
    require(boundary or abs(q) - radius >= power(e), 'interior witness or exact binade boundary')
    return {'numerator': rational(a), 'denominator': rational(b), 'quotient': rational(q),
            'exponent': e, 'ulpQuantum': rational(ulp), 'lower': rational(q - radius),
            'upper': rational(q + radius), 'boundary': boundary}


def exact_words(value):
    """Possible ordinary result encodings for an exact normal dyadic or zero."""
    value = Fraction(value)
    return [0, 0x80000000] if value == 0 else [word(value)]


def fraction_part(value):
    value = Fraction(value)
    return value - value.numerator // value.denominator


def numeric(operation, vector):
    a, b, c = [[Fraction(value) for value in vector[field]] for field in ('a', 'b', 'c')]
    quarter, eighth = Fraction(1, 4), Fraction(1, 8)
    blend = lambda weight, yes, no: weight * yes + (1 - weight) * no
    if operation == 'max':
        return [max(x, y) for x, y in zip(a, b)]
    if operation == 'frc':
        return [fraction_part(value) for value in a]
    if operation in ('lrp', 'maximal'):
        return [blend(weight, yes, no) for weight, yes, no in zip(a, b, c)]
    if operation == 'lrp-alias':
        original = [value + quarter for value in b]
        return [blend(a[1], original[3], c[2]), blend(a[0], original[2], c[3]), *original[2:]]
    if operation == 'max-alias':
        original = [value + quarter for value in a]
        return [max(b[3], -original[2]), max(b[0], -original[1]), max(b[1], -original[0]), original[3]]
    if operation == 'frc-alias':
        original = [value + quarter for value in a]
        after_partial = [fraction_part(-original[1]), fraction_part(-original[0]), *original[2:]]
        return [value + eighth for value in reversed(after_partial)]
    if operation == 'negate-add':
        return [-a[index_a] + b[index_b] for index_a, index_b in zip((2, 1, 0, 3), (3, 0, 1, 2))]
    if operation == 'negate-mad':
        return [a[index_a] * b[index_b] - c[index_c]
                for index_a, index_b, index_c in zip((3, 2, 1, 0), (1, 0, 3, 2), (2, 3, 0, 1))]
    if operation == 'safe-negate':
        decoded = [Fraction((1 << 23) + (raw & 0x7fffff), 1 << 24) for raw in vector['raw']]
        return [max(value, -raw_value) for value, raw_value in zip(b, decoded)]
    raise ValueError(f'unknown independent componentwise oracle: {operation}')


def division_inputs(operation, vector):
    a, b = [[Fraction(value) for value in vector[field]] for field in ('a', 'b')]
    if operation == 'div':
        return [{'kind': 'division', 'a': x, 'b': y} for x, y in zip(a, b)]
    if operation == 'div-alias':
        original = [value + Fraction(1, 4) for value in a]
        return [{'kind': 'division', 'a': original[1], 'b': b[2]},
                {'kind': 'division', 'a': original[0], 'b': b[3]},
                {'kind': 'division', 'a': -original[3], 'b': b[0]},
                {'kind': 'exact', 'value': original[3]}]
    raise ValueError(f'unknown independent division oracle: {operation}')


def texture_values(operation, sampled):
    half, quarter = Fraction(1, 2), Fraction(1, 4)
    require(all(value in (0, 1) for value in sampled), 'authored endpoint texture values')
    if operation == 'tex-frc-lrp':
        # Explicit half scale preserves the texture distinction through fract.
        return [fraction_part(quarter - half * value) for value in sampled]
    if operation == 'tex-negate':
        values = [half * value + quarter for value in sampled]
        return [max(value, -value) for value in values]
    raise ValueError(f'unknown independent component texture oracle: {operation}')


def outward_word(value, upper):
    """Nearest binary32 endpoint rounded outward using an exact integer grid."""
    value = Fraction(value)
    if value == 0:
        return 0
    e = exponent(value)
    require(-126 <= e <= 126, 'normal endpoint with overflow margin')
    step = power(e - 23)
    scaled = abs(value) / step
    whole = scaled.numerator // scaled.denominator
    magnitude_up = upper if value > 0 else not upper
    if magnitude_up and scaled.denominator != 1:
        whole += 1
    result = whole * step * (1 if value > 0 else -1)
    require((result >= value) if upper else (result <= value), 'directed rational endpoint')
    return word(result)
