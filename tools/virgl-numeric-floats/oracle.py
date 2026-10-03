"""Independent exact-rational oracles for the authored ordinary numeric probes."""
from fractions import Fraction


def require(condition, message):
    if not condition:
        raise ValueError(message)


def power(exponent):
    return Fraction(2 ** exponent) if exponent >= 0 else Fraction(1, 2 ** -exponent)


def word(value):
    """Encode an exactly representable normal dyadic, without a host float cast."""
    value = Fraction(value)
    if value == 0:
        return 0
    sign = (1 << 31) if value < 0 else 0
    value = abs(value)
    exponent = value.numerator.bit_length() - value.denominator.bit_length()
    if value < power(exponent):
        exponent -= 1
    significand = value / power(exponent - 23)
    require(-126 <= exponent <= 127 and significand.denominator == 1
            and (1 << 23) <= significand < (1 << 24), 'exact normal binary32 oracle domain')
    return sign + ((exponent + 127) << 23) + int(significand) - (1 << 23)


def numeric(operation, vector):
    a, b = [[Fraction(v) for v in vector[key]] for key in ('a', 'b')]
    condition = vector['condition']
    quarter, half, eighth = Fraction(1, 4), Fraction(1, 2), Fraction(1, 8)
    choose = lambda selector, yes, no: yes if selector != 0 else no
    if operation in ('chain', 'maximal'):
        result = [((v + quarter) * half) * 2 + eighth for v in a]
    elif operation == 'mov-snapshot':
        result = [v + quarter + eighth for v in reversed(a)]
    elif operation == 'mov-alias':
        z = (a[3] + quarter) * half
        result = [a[1] + quarter, a[0] + quarter, z, z + eighth]
    elif operation == 'ucmp-before':
        result = [choose(c, x, y) + eighth for c, x, y in zip(condition, a, b)]
    elif operation in ('ucmp-alias-true', 'ucmp-alias-false'):
        original, other = [v + quarter for v in a], [v * half for v in b]
        yes, no = (original, other) if operation == 'ucmp-alias-true' else (other, original)
        if operation == 'ucmp-alias-true':
            first = choose(condition[1], yes[1], no[3])
            second = choose(condition[0], yes[0], no[2])
        else:
            first = choose(condition[1], yes[3], no[1])
            second = choose(condition[0], yes[2], no[0])
        result = [first + eighth, second + eighth, original[2] + eighth, original[3] + eighth]
    elif operation == 'safe-raw':
        # The bitwise producer sets exponent126 and keeps exactly23 mantissa bits.
        result = [Fraction((1 << 23) + (v % (1 << 23)), 1 << 23) for v in vector['raw']]
    elif operation == 'invalidation':
        result = [Fraction(7, 8)] * 4
    else:
        raise ValueError(f'unknown numeric oracle operation: {operation}')
    require(all(value > 0 for value in result), 'authored raw captures avoid computed zero-sign ambiguity')
    return result


def numeric_words(operation, vector):
    return [word(value) for value in numeric(operation, vector)]


def texel(texture, coordinate):
    width, height = texture['width'], texture['height']
    x, y = (Fraction(v) for v in coordinate[:2])
    require(0 < x < 1 and 0 < y < 1, 'interior normalized texture coordinates')
    ix, iy = int(x * width), int(y * height)
    values = texture['bytes'][(iy * width + ix) * 4:(iy * width + ix + 1) * 4]
    require(len(values) == 4 and set(values) <= {0, 255}, 'literal endpoint texture oracle')
    return [Fraction(value, 255) for value in values]


def texture_values(operation, primary, alternate, condition):
    if operation == 'tex-chain':
        selected = primary
    elif operation == 'tex-select':
        selected = [yes if selector != 0 else no for selector, yes, no in zip(condition, primary, alternate)]
    else:
        raise ValueError(f'unknown texture oracle operation: {operation}')
    return [value / 2 + Fraction(1, 4) for value in selected]
