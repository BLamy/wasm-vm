"""Exact-rational scalar references; quantitative domains never gate admission."""
from fractions import Fraction
import importlib.util
from math import isqrt
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location('scalar_component_oracle', ROOT / 'tools/virgl-component-floats/oracle.py')
_prior = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_prior)
word, power, require = _prior.word, _prior.power, _prior.require
rational, decode, classify = _prior.rational, _prior.decode, _prior.classify
exponent, exact_words, outward_word = _prior.exponent, _prior.exact_words, _prior.outward_word


def rcp_bounds(value):
    """Use the preceding independently checked positive-divisor theorem."""
    value = Fraction(value)
    require(value == decode(word(value)), 'authored reciprocal source is actual binary32')
    return _prior.division_bounds(1, value)


def rsq_bounds(value):
    """Bracket 1/sqrt(value) with integers, then allow the specified two ULPs.

    For s = 1/value and Q = 2**192, m = floor(sqrt(floor(s*Q*Q)))
    is also floor(sqrt(s)*Q). Cross multiplication proves either an exact root
    or adjacent rational endpoints. The exponent follows from s's binary
    exponent by floor division by two. No host square root is an oracle.
    """
    value = Fraction(value)
    require(value > 0 and value == decode(word(value)) and classify(word(value)) == 'normal',
            'authored inverse-root source is exact positive normal binary32')
    squared = 1 / value
    scale_bits = 192
    scale = 1 << scale_bits
    scaled_numerator = squared.numerator * scale * scale
    m = isqrt(scaled_numerator // squared.denominator)
    exact = m * m * squared.denominator == scaled_numerator
    root_lower = Fraction(m, scale)
    root_upper = root_lower if exact else Fraction(m + 1, scale)
    require(root_lower * root_lower <= squared <= root_upper * root_upper
            and (exact or root_upper * root_upper > squared), 'independent squared root bracket')
    e = exponent(squared) // 2
    require(-126 <= e <= 126 and power(2 * e) <= squared < power(2 * e + 2),
            'normal inverse-root binade with overflow margin')
    quantum = power(e - 23)
    radius = 2 * quantum
    lower, upper = root_lower - radius, root_upper + radius
    boundary = squared == power(2 * e)
    require(lower >= power(-126) and upper < power(e + 1)
            and (boundary or lower >= power(e)), 'authored root enclosure avoids binade/subnormal ambiguity')
    return {'kind': 'rsq', 'input': rational(value), 'squaredReciprocal': rational(squared),
            'rootLower': rational(root_lower), 'rootUpper': rational(root_upper),
            'exactRoot': exact, 'scaleBits': scale_bits, 'exponent': e,
            'ulpQuantum': rational(quantum), 'lower': rational(lower),
            'upper': rational(upper), 'boundary': boundary}


def safe_values(words):
    """The authored bit mask retains only mantissa bit22 under exponent126."""
    return [Fraction(1, 2) + Fraction((bits >> 22) & 1, 4) for bits in words]


def exact_dot(a, b):
    """Validate exactness under every ordinary association of authored controls."""
    from itertools import permutations
    require(len(a) == len(b) == 3, 'exactly three consumed dot lanes')
    terms = [x * y for x, y in zip(a, b)]
    for term in terms:
        require(decode(word(term)) == term, 'authored dot product is exactly representable')
    for first, second, third in permutations(terms):
        require(decode(word(first + second)) == first + second
                and decode(word(first + second + third)) == first + second + third,
                'authored dot remains exact under every addition association')
    return sum(terms, Fraction(0))


def numeric(operation, vector):
    a, b, c = [[Fraction(value) for value in vector[field]] for field in ('a', 'b', 'c')]
    if operation == 'dp3-swizzle':
        result = exact_dot([a[i] for i in (2, 0, 1)], [-b[i] for i in (1, 2, 0)])
    elif operation == 'dp3-safe':
        result = exact_dot(safe_values(vector['raw'])[:3], b[:3])
    elif operation == 'dp3-alias-xy':
        before = [value + Fraction(1, 4) for value in a]
        result = exact_dot([before[i] for i in (1, 2, 0)], [b[i] for i in (2, 0, 1)])
        return [result, result, *before[2:]]
    else:
        require(operation in ('dp3', 'dp3-shadow', 'maximal') or
                operation in [f'dp3-partial-{mask}' for mask in ('x', 'y', 'z', 'w', 'xyz')],
                'authored independent exact dot operation')
        result = exact_dot(a[:3], b[:3])
    if operation.startswith('dp3-partial-'):
        mask = operation.removeprefix('dp3-partial-')
        return [result if lane in mask else value for lane, value in zip('xyzw', c)]
    return [result] * 4


def reciprocal_inputs(operation, vector):
    a, b = [[Fraction(value) for value in vector[field]] for field in ('a', 'b')]
    if operation == 'rcp':
        return [{'kind': 'rcp', 'value': a[1]}] * 4
    if operation == 'rcp-negate-shadow':
        return [{'kind': 'rcp', 'value': -b[3]}] * 4
    if operation == 'rsq':
        return [{'kind': 'rsq', 'value': a[2]}] * 4
    if operation == 'rsq-safe':
        return [{'kind': 'rsq', 'value': safe_values(vector['raw'])[1]}] * 4
    before = [value + Fraction(1, 4) for value in a]
    if operation == 'rcp-alias-w':
        return [{'kind': 'exact', 'value': value} for value in before[:3]] + [{'kind': 'rcp', 'value': before[2]}]
    if operation == 'rsq-alias-xy':
        return [{'kind': 'rsq', 'value': before[3]}] * 2 + [{'kind': 'exact', 'value': value} for value in before[2:]]
    raise ValueError(f'unknown independent scalar reciprocal oracle: {operation}')


def texture_inputs(operation, sampled):
    sampled = [Fraction(value) for value in sampled]
    require(len(sampled) == 4 and all(value in (0, 1) for value in sampled), 'authored four endpoint texels')
    if operation == 'tex-dp3':
        result = exact_dot(sampled[:3], [Fraction(1, 4), Fraction(1, 4), Fraction(1, 2)]) + Fraction(1, 4)
        return [{'kind': 'exact', 'value': result}] * 4
    if operation == 'tex-rcp':
        return [{'kind': 'rcp', 'value': sampled[0] + 1}] * 4
    if operation == 'tex-rsq':
        return [{'kind': 'rsq', 'value': sampled[1] + 1}] * 4
    raise ValueError(f'unknown independent scalar sampled oracle: {operation}')
