"""Independent v12 count oracle composed with unchanged E8 bank/schema rules."""
import copy
from pathlib import Path
import struct

from compat_common import (ROOT, require, binding, source, unchanged, load, same, strict_v8_coverage)

OLD_ORACLE = 'tools/virgl-indirect-constants/consumer_receipt.py'
unchanged(OLD_ORACLE)
old = load('e9_held_indirect_consumer_oracle', OLD_ORACLE)
read, encoded = old.read, old.encoded
FILES = ['renderer/virgl-command/constant-domain.mjs', 'renderer/virgl-command/decoder.mjs',
         'tools/virgl-bounded-loops/consumer-unit.mjs']
DOMAIN = ('kind', 'stage', 'slot', 'name', 'count')
CONSTRAINT = (*DOMAIN, 'register', 'component', 'maximum')


def metadata(stage='vertex', version=12, count=46):
    value = old.metadata(stage, 11 if version == 12 else version, count, list(range(10, 46)))
    if version == 12:
        value['profile'] = 'virgl-webgl2-raw-bits-v12'
        name = 'vsconst0' if stage == 'vertex' else 'fsconst0'
        value['constantConstraints'] = [{'kind': 'constant-bank-counted-table-i32-v1', 'stage': stage,
                                        'slot': 0, 'name': name, 'count': count, 'register': 9,
                                        'component': 0, 'maximum': 18}]
    return value


def failure(code, message):
    return {'ok': False, 'error': {'code': code, 'message': message}}


def schema_result(value, stage):
    """Reuse the held independent rules only for their unchanged prior boundary."""
    bad = lambda message: failure('shader-domain-error', message)
    if value['profile'] != 'virgl-webgl2-raw-bits-v12':
        if 'constantConstraints' in value:
            if value['profile'] == 'virgl-webgl2-raw-bits-v13':
                return bad('Unknown shader profile.')
            return bad('Shader profile forbids a constant count constraint.')
        return old.schema_result(value, stage)
    prior_input = copy.deepcopy(value)
    prior_input.pop('constantConstraints', None)
    prior_input['profile'] = 'virgl-webgl2-raw-bits-v11'
    prior_result = old.schema_result(prior_input, stage)
    if not prior_result['ok']:
        return prior_result
    if 'constantConstraints' not in value:
        return bad('Loop shader profile requires a constant count constraint.')
    constraints = value['constantConstraints']
    if type(constraints) is not list:
        return bad('Expected an own data array.')
    if len(constraints) > 1:
        return bad('Array extent exceeds the bounded contract.')
    if not constraints:
        return bad('Loop shader requires one constant count constraint.')
    constraint = constraints[0]
    if type(constraint) is not dict:
        return bad('Expected an own data record.')
    if set(constraint) - set(CONSTRAINT):
        return bad('Unknown or accessor property.')
    for key in CONSTRAINT:
        if key not in constraint:
            return bad(f'Missing {key}.')
    expected = metadata(stage)['constantConstraints'][0]
    if any(not same(constraint[key], expected[key]) for key in CONSTRAINT if key != 'count'):
        return bad('Unknown or inconsistent constant count constraint.')
    if not any(same(constraint['count'], count) for count in (46, 47)) or \
            not same(constraint['count'], prior_result['domain']['count']) or \
            not same(constraint['count'], prior_result['access']['count']):
        return bad('Constant count constraint does not match the complete declared bank extent.')
    if not set(range(10, 46)).issubset(prior_result['access']['indices']):
        return bad('Loop constant access must cover every certified index from 10 through 45.')
    return {**prior_result, 'constraint': copy.deepcopy(constraint)}


def expected_schemas():
    rows = []

    def add(name, stage, value, recipe=None, message=None):
        rows.append({'name': name, 'stage': stage, **({'recipe': recipe} if recipe else {'input': value}),
                     'result': failure('shader-domain-error', message) if message else schema_result(value, stage), 'frozen': True})

    for stage in ('vertex', 'fragment'):
        for count in (46, 47):
            for extra in (False, True):
                value = metadata(stage, 12, count)
                if extra: value['constantAccesses'][0]['indices'] = list(range(46))
                add(f'{stage}-extent{count}-extra{str(extra).lower()}', stage, value)
        for version in ('virgl-webgl2-straight-line-v5', *range(1, 12)):
            value = metadata(stage, version)
            add(f'{stage}-old-{version}', stage, copy.deepcopy(value))
            value['constantConstraints'] = metadata(stage)['constantConstraints']
            add(f'{stage}-old-{version}-forbids-constraint', stage, value)
        fields = [('register', 8), ('component', 1), ('maximum', 19), ('maximum', 17), ('maximum', '18'),
                  ('maximum', 18.5), ('count', 45), ('count', 48), ('count', '46'), ('count', True),
                  ('register', True), ('component', False), ('slot', False)]
        cases = ['unknown-profile', 'missing-constraint', 'empty-constraint', 'duplicate-constraint',
                 'constraint-not-array', 'constraint-not-record', 'constraint-kind', 'constraint-stage',
                 'constraint-slot', 'constraint-name', *(f'constraint-field-{i}' for i in range(len(fields))),
                 'count-mismatch', 'entire-extent45', 'constraint-extra', *(f'missing-{key}' for key in CONSTRAINT),
                 'missing-domain', 'missing-access', 'domain-mismatch', 'access-mismatch', 'unordered-access', 'index46']
        for case in cases:
            value = metadata(stage)
            constraint = value['constantConstraints'][0]
            if case == 'unknown-profile': value['profile'] = 'virgl-webgl2-raw-bits-v13'
            elif case == 'missing-constraint': del value['constantConstraints']
            elif case == 'empty-constraint': value['constantConstraints'] = []
            elif case == 'duplicate-constraint': value['constantConstraints'].append(copy.deepcopy(constraint))
            elif case == 'constraint-not-array': value['constantConstraints'] = {}
            elif case == 'constraint-not-record': value['constantConstraints'][0] = []
            elif case == 'constraint-kind': constraint['kind'] = 'observed-loop-count-v1'
            elif case == 'constraint-stage': constraint['stage'] = 'fragment' if stage == 'vertex' else 'vertex'
            elif case == 'constraint-slot': constraint['slot'] = 1
            elif case == 'constraint-name': constraint['name'] += '[0]'
            elif case.startswith('constraint-field-'):
                key, field = fields[int(case.rsplit('-', 1)[1])]; constraint[key] = field
            elif case == 'count-mismatch': constraint['count'] = 47
            elif case == 'entire-extent45':
                constraint['count'] = value['constantDomains'][0]['count'] = value['constantAccesses'][0]['count'] = value['uniforms'][0]['count'] = 45
                value['constantAccesses'][0]['indices'].pop()
            elif case == 'constraint-extra': constraint['extra'] = 1
            elif case == 'missing-domain': del value['constantDomains']
            elif case == 'missing-access': del value['constantAccesses']
            elif case.startswith('missing-'): del constraint[case.removeprefix('missing-')]
            elif case == 'domain-mismatch': value['constantDomains'][0]['count'] = 47
            elif case == 'access-mismatch': value['constantAccesses'][0]['count'] = 47
            elif case == 'unordered-access': value['constantAccesses'][0]['indices'].reverse()
            elif case == 'index46': value['constantAccesses'][0]['indices'].append(46)
            else: raise ValueError(case)
            add(f'{stage}-{case}', stage, value)
        for missing in range(10, 46):
            value = metadata(stage)
            value['constantAccesses'][0]['indices'].remove(missing)
            add(f'{stage}-missing-index{missing}', stage, value)
        for location in ('metadata', 'array', 'record'):
            add(f'{stage}-{location}-accessor', stage, None, f'{location}-accessor',
                'Array entries must be own data properties.' if location == 'array' else 'Unknown or accessor property.')
        for mutation in ('sparse', 'extra', 'symbol', 'inherited', 'revoked', 'throwing-descriptors'):
            add(f'{stage}-array-{mutation}', stage, None, f'array-{mutation}',
                {'revoked': 'Unusable array identity.', 'throwing-descriptors': 'Unusable own data properties.'}.get(
                    mutation, 'Array must be dense and contain no extra properties.'))
        for mutation, message in [('symbol', 'Unknown or accessor property.'), ('inherited', 'Missing maximum.'),
                                  ('revoked', 'Unusable array identity.'), ('throwing-descriptors', 'Unusable own data properties.')]:
            add(f'{stage}-record-{mutation}', stage, None, f'record-{mutation}', message)
    return rows


def full_bank(count=18):
    words = ([0, 0x80000000, 1, 0x80000001, 0x3f800000, 0xbf800000, 0x7f7fffff, 0xff7fffff] * 23)
    words[36] = count
    return words


def bank_result(words, extent, recipe=None):
    if not any(same(extent, encoded(value)) for value in (46, 47)):
        return failure('constant-constraint-error', 'Invalid counted-table bank extent.')
    prior = old.bank_result(words, extent, encoded(True), recipe)
    if not prior['ok']:
        return prior
    word = prior['words'][36]
    require(type(word) is int and 0 <= word < 2**32, 'independent raw count is an integer u32')
    signed = word - 2**32 if word >= 2**31 else word
    if signed > 18:
        return failure('constant-constraint-error', 'Raw signed constant count exceeds the proved maximum of 18.')
    return prior


def expected_banks():
    rows = []

    def add(name, words, extent, recipe=None, typed=False):
        words = words if typed or words is None else list(map(encoded, words))
        extent = extent if type(extent) is dict else encoded(extent)
        rows.append({'name': name, **({'recipe': recipe} if recipe else {'words': words}), 'extent': extent,
                     'result': bank_result(words, extent, recipe), 'frozen': True})

    for extent in (46, 47):
        for count in range(33):
            add(f'extent{extent}-count{count}', full_bank(count), extent)
        for word in (0x80000000, 0x80000001, 0xff7fffff, 0x80800000, 0x3f800000, 0x7f000000,
                     0x7f7fffff, 0x7f800000, 0xff800000, 0xffffffff, 0x7fffffff):
            add(f'extent{extent}-word{word:x}', full_bank(word), extent)
        bad = [('number', '-1', encoded(-1)), ('number', '4294967296', encoded(2**32)), ('number', '0.5', encoded(.5)),
               *[('number', x, {'type': 'number', 'value': x}) for x in ('NaN', 'Infinity', '-Infinity')],
               ('string', '18', encoded('18')), ('object', 'null', encoded(None)), ('undefined', 'undefined', {'type': 'undefined'}),
               ('boolean', 'true', encoded(True)), ('boolean', 'false', encoded(False)), ('bigint', '18', {'type': 'bigint', 'value': '18'}),
               ('symbol', 'Symbol(count)', {'type': 'symbol', 'value': 'Symbol(count)'}), ('object', '[object Object]', encoded({}))]
        for kind, label, word in bad:
            words = list(map(encoded, full_bank())); words[36] = word
            add(f'extent{extent}-invalid-{kind}-{label}', words, extent, typed=True)
        for lane in (0, 35, 36, 37, 180, 183):
            words = full_bank(); words[lane] = 0x7fc00000
            add(f'extent{extent}-poison{lane}', words, extent)
        add(f'extent{extent}-short', full_bank()[:180], extent)
        add(f'extent{extent}-short-invalid-count', full_bank(19)[:180], extent)
        add(f'extent{extent}-partial-register', full_bank()[:183], extent)
        add(f'extent{extent}-extra-register', full_bank() + [0, 0, 0, 0], extent)
        words = full_bank(19); words[183] = 0x7fc00000
        add(f'extent{extent}-finite-before-count', words, extent)
    bad_extents = [('number', str(x), encoded(x)) for x in (0, 45, 48, -1, 46.5)] + [
        ('string', '46', encoded('46')), ('boolean', 'true', encoded(True)), ('object', 'null', encoded(None)),
        ('undefined', 'undefined', {'type': 'undefined'}),
        *[('number', x, {'type': 'number', 'value': x}) for x in ('NaN', 'Infinity')]]
    for kind, label, extent in bad_extents:
        add(f'invalid-extent-{kind}-{label}', full_bank(), extent)
    for mutation in ('typed-array', 'null', 'sparse', 'accessor', 'extra', 'symbol', 'revoked', 'throwing-descriptors'):
        add(f'bank-{mutation}', None, 46, mutation)
    return rows


def expected_ownership():
    rows = [{'name': 'metadata-copy', 'retained': schema_result(metadata(), 'vertex'),
             'changedMaximum': 19, 'changedRegister': 8, 'frozenMutationRejected': True}]
    for stage in (0, 1):
        packet = struct.pack('<187I', 0x00ba000c, stage, 0, *full_bank())
        rows.append({'name': f'decoder-stage{stage}-replacement', 'requestHex': packet.hex(),
                     'packetAfterHex': (b'\xff' * len(packet)).hex(), 'approved': {'ok': True, 'words': full_bank()},
                     'failed': failure('constant-constraint-error', 'Raw signed constant count exceeds the proved maximum of 18.'),
                     'negative': {'ok': True, 'words': full_bank(0x80000000)}, 'restored': {'ok': True, 'words': full_bank()},
                     'distinctReferences': True, 'frozenMutationRejected': True})
    return rows


def verify(directory, head):
    require(isinstance(head, str) and len(head) == 40, 'exact frozen source head')
    return _verify(directory, head)


def verify_recording(directory):
    """Development-only source audit, not a frozen-head claim."""
    return _verify(directory, None)


def _verify(directory, head):
    directory = Path(directory).resolve()
    report = read(directory / 'report.json')
    require(report['schema'] == 'wasm-vm-bounded-loop-consumer-unit-v1' and report['task'] == 'E6-T12e9'
            and report['status'] == 'passed', 'consumer recording identity')
    require(same(report['schemas'], expected_schemas()), 'all 234 exact independently authored metadata records')
    require(same(report['banks'], expected_banks()), 'all 157 independent raw signed count and finite bank records')
    require(same(report['ownership'], expected_ownership()), 'all three metadata/decoder snapshot ownership sequences')
    require(same(report['stats'], {'schemas': 234, 'banks': 157, 'ownership': 3})
            and type(report['getterCalls']) is int and report['getterCalls'] == 0, 'complete typed counts and zero accessor calls')
    require(same(report['sources'], [binding(ROOT / name) for name in FILES]), 'actual source identities')
    sources = report['sources'] + [binding(Path(__file__).resolve()), binding(ROOT / OLD_ORACLE),
                                  binding(ROOT / 'tools/virgl-bounded-loops/compat_common.py')]
    unchanged(OLD_ORACLE)
    if head is not None:
        require(report['gitHead'] == head, 'recording frozen head')
        for item in sources:
            source(item, head)
    require(same(report['coverage'], binding(directory / 'coverage.json', directory)), 'actual precise coverage bytes')
    coverage = read(directory / 'coverage.json'); strict_v8_coverage(coverage)
    require(len(coverage) == 2, 'both actual consumer and decoder covered')
    consumer = [item for item in coverage if item['url'].endswith('/renderer/virgl-command/constant-domain.mjs')]
    decoder = [item for item in coverage if item['url'].endswith('/renderer/virgl-command/decoder.mjs')]
    require(len(consumer) == len(decoder) == 1, 'distinct real consumer and decoder coverage sources')
    for name, count in [('parseConstantDomain', 235), ('checkLoopBank', 165)]:
        functions = [item for item in consumer[0]['functions'] if item['functionName'] == name]
        require(len(functions) == 1 and same(functions[0]['ranges'][0]['count'], count), f'all actual {name} calls counted')
    return {'status': 'passed', 'schemas': 234, 'banks': 157, 'ownership': 3, 'getterCalls': 0,
            'sources': sources, 'records': [binding(directory / name, directory) for name in ('report.json', 'coverage.json')]}
