"""Independently reconstruct the indirect-bank consumer inputs and typed results."""
import copy
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess
from compat_common import strict_v8_coverage

ROOT = Path(__file__).resolve().parents[2]
FILES = ('renderer/virgl-command/constant-domain.mjs', 'renderer/virgl-command/decoder.mjs',
         'tools/virgl-indirect-constants/consumer-unit.mjs')
META = ('profile', 'stage', 'inputs', 'outputs', 'attributes', 'uniforms', 'samplers', 'uniformBlocks')
DOMAIN = ('kind', 'stage', 'slot', 'name', 'count')
UNIFORM = ('name', 'type', 'count', 'encoding')
FULL = ([0, 0x80000000, 1, 0x80000001, 0x007fffff, 0x807fffff,
         0x00800000, 0x80800000, 0x3f800000, 0xbf800000, 0x7f7fffff, 0xff7fffff] * 16)[:184]


def require(value, message):
    if not value:
        raise ValueError(message)


def same(left, right):
    return json.dumps(left, sort_keys=True, separators=(',', ':'), allow_nan=False) == \
        json.dumps(right, sort_keys=True, separators=(',', ':'), allow_nan=False)


def read(path):
    def unique(pairs):
        out = {}
        for key, value in pairs:
            require(key not in out, f'duplicate JSON key {key}')
            out[key] = value
        return out
    return json.loads(path.read_bytes(), object_pairs_hook=unique,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))


def binding(path, base=ROOT):
    raw = path.read_bytes()
    return {'path': str(path.relative_to(base)), 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def integer(value):
    return number(value) and value == int(value)


def metadata(stage='vertex', version=11, count=46, indices=None):
    name = 'vsconst0' if stage == 'vertex' else 'fsconst0'
    value = {'profile': f'virgl-webgl2-raw-bits-v{version}' if type(version) is int else version,
             'stage': stage, 'inputs': [], 'outputs': [], 'attributes': [],
             'uniforms': [{'name': name, 'type': 'uvec4[]', 'count': count, 'encoding': 'float32-bits'}],
             'samplers': [], 'uniformBlocks': []}
    if version in (7, 9, 11):
        value['constantDomains'] = [{'kind': 'constant-bank-finite-f32-v1', 'stage': stage,
                                     'slot': 0, 'name': name, 'count': count}]
    if version in (10, 11):
        value['constantAccesses'] = [{'kind': 'constant-bank-static-indirect-v1', 'stage': stage,
                                     'slot': 0, 'name': name, 'count': count,
                                     'indices': [0, 23, 45] if indices is None else indices}]
    return value


def failure(code, message):
    return {'ok': False, 'error': {'code': code, 'message': message}}


def schema_result(value, stage):
    """Data-only schema oracle; descriptor attacks are separately authored recipes."""
    class Invalid(Exception):
        pass

    def check(ok, message):
        if not ok:
            raise Invalid(message)

    def record(obj, keys, required=None):
        check(type(obj) is dict, 'Expected an own data record.')
        check(not set(obj) - set(keys), 'Unknown or accessor property.')
        for key in keys if required is None else required:
            check(key in obj, f'Missing {key}.')

    def array(obj, maximum):
        check(type(obj) is list, 'Expected an own data array.')
        check(len(obj) <= maximum, 'Array extent exceeds the bounded contract.')

    def bank_matches(obj, uniform):
        return integer(obj['count']) and 1 <= obj['count'] <= 47 and uniform == {
            'name': name, 'type': 'uvec4[]', 'count': obj['count'], 'encoding': 'float32-bits'}

    try:
        check(stage in ('vertex', 'fragment'), 'Unknown shader stage.')
        record(value, (*META, 'constantDomains', 'constantAccesses'), META)
        check(value['stage'] == stage, 'Constant domain stage disagrees with the shader stage.')
        name = 'vsconst0' if stage == 'vertex' else 'fsconst0'
        profiles = {f'virgl-webgl2-raw-bits-v{i}' for i in range(1, 12)} | {'virgl-webgl2-straight-line-v5'}
        check(value['profile'] in profiles, 'Unknown shader profile.')
        indirect = value['profile'] in ('virgl-webgl2-raw-bits-v10', 'virgl-webgl2-raw-bits-v11')
        conditional = value['profile'] in tuple(f'virgl-webgl2-raw-bits-v{i}' for i in (7, 9, 11))
        access = None
        if indirect:
            check('constantAccesses' in value, 'Indirect shader profile requires a constant access contract.')
            array(value['constantAccesses'], 1)
            array(value['uniforms'], 1)
            check(len(value['constantAccesses']) == len(value['uniforms']) == 1,
                  'Indirect shader requires one access contract and one constant bank.')
            access, uniform = value['constantAccesses'][0], value['uniforms'][0]
            record(access, (*DOMAIN, 'indices'))
            record(uniform, UNIFORM)
            check(access['kind'] == 'constant-bank-static-indirect-v1' and access['stage'] == stage
                  and type(access['slot']) is int and access['slot'] == 0 and access['name'] == name,
                  'Unknown or inconsistent constant-bank access.')
            check(bank_matches(access, uniform), 'Constant access does not match the declared bank extent and encoding.')
            array(access['indices'], 46)
            indices = access['indices']
            check(len(indices) > 0 and all(integer(i) and 0 <= i <= 45 and i < access['count'] for i in indices)
                  and all(a < b for a, b in zip(indices, indices[1:])),
                  'Constant access indices must be nonempty, sorted, unique and guest-addressable.')
        else:
            check('constantAccesses' not in value, 'Shader profile forbids a constant access contract.')
        if not conditional:
            check('constantDomains' not in value, 'Unconditional shader profile carries a conditional contract.')
            return {'ok': True, 'domain': None, **({'access': copy.deepcopy(access)} if indirect else {})}
        check('constantDomains' in value, 'Conditional shader profile requires a constant domain.')
        array(value['constantDomains'], 1)
        array(value['uniforms'], 1)
        check(len(value['constantDomains']) == len(value['uniforms']) == 1,
              'Conditional shader requires one domain and one constant bank.')
        domain, uniform = value['constantDomains'][0], value['uniforms'][0]
        record(domain, DOMAIN)
        record(uniform, UNIFORM)
        check(domain['kind'] == 'constant-bank-finite-f32-v1' and domain['stage'] == stage
              and type(domain['slot']) is int and domain['slot'] == 0 and domain['name'] == name,
              'Unknown or inconsistent constant-bank domain.')
        check(bank_matches(domain, uniform), 'Constant domain does not match the declared bank extent and encoding.')
        return {'ok': True, 'domain': copy.deepcopy(domain), **({'access': copy.deepcopy(access)} if indirect else {})}
    except Invalid as error:
        return failure('shader-domain-error', str(error))


def expected_schemas():
    rows = []

    def add(name, stage, value, recipe=None, message=None):
        rows.append({'name': name, 'stage': stage, **({'recipe': recipe} if recipe else {'input': value}),
                     'result': failure('shader-domain-error', message) if message else schema_result(value, stage),
                     'frozen': True})

    for stage in ('vertex', 'fragment'):
        for version in (10, 11):
            for count in (1, 8, 46, 47):
                add(f'{stage}-v{version}-extent{count}', stage, metadata(stage, version, count, list(range(min(count, 46)))))
            for index in (0, 23, 45):
                add(f'{stage}-v{version}-singleton{index}', stage, metadata(stage, version, 46, [index]))
        for version in ('virgl-webgl2-straight-line-v5', *range(1, 10)):
            value = metadata(stage, version)
            add(f'{stage}-old-{version}', stage, copy.deepcopy(value))
            value['constantAccesses'] = metadata(stage)['constantAccesses']
            add(f'{stage}-old-{version}-forbids-access', stage, value)
        cases = ['unknown-profile', 'missing-access', 'empty-access', 'duplicate-access', 'access-not-array',
                 'access-record-array', 'access-kind', 'access-stage', 'access-slot', 'access-name',
                 'access-count-0', 'access-count-48', 'access-count-1.5', 'access-count-46', 'access-count-null',
                 'extent-mismatch', 'no-uniform', 'duplicate-uniform', 'uniform-name', 'uniform-type', 'uniform-encoding',
                 'uniform-extra', 'empty-indices', 'indices-not-array', 'indices-too-many',
                 *(f'indices-invalid-{i}' for i in range(9)), 'index-outside-extent', 'extent47-index46',
                 'extra-access-key', *(f'missing-access-{key}' for key in (*DOMAIN, 'indices')),
                 'v11-missing-domain', 'v11-domain-count-mismatch', 'v11-domain-stage-mismatch', 'v10-forbids-domain']
        for case in cases:
            value = metadata(stage)
            access, uniform = value['constantAccesses'][0], value['uniforms'][0]
            if case == 'unknown-profile': value['profile'] = 'virgl-webgl2-raw-bits-v12'
            elif case == 'missing-access': del value['constantAccesses']
            elif case == 'empty-access': value['constantAccesses'] = []
            elif case == 'duplicate-access': value['constantAccesses'].append(copy.deepcopy(access))
            elif case == 'access-not-array': value['constantAccesses'] = {}
            elif case == 'access-record-array': value['constantAccesses'][0] = []
            elif case == 'access-kind': access['kind'] = 'observed-index-v1'
            elif case == 'access-stage': access['stage'] = 'fragment' if stage == 'vertex' else 'vertex'
            elif case == 'access-slot': access['slot'] = 1
            elif case == 'access-name': access['name'] += '[0]'
            elif case.startswith('access-count-'):
                access['count'] = {'0': 0, '48': 48, '1.5': 1.5, '46': '46', 'null': None}[case.removeprefix('access-count-')]
            elif case == 'extent-mismatch': uniform['count'] = 45
            elif case == 'no-uniform': value['uniforms'] = []
            elif case == 'duplicate-uniform': value['uniforms'].append(copy.deepcopy(uniform))
            elif case == 'uniform-name': uniform['name'] = 'otherconst0'
            elif case == 'uniform-type': uniform['type'] = 'vec4[]'
            elif case == 'uniform-encoding': uniform['encoding'] = 'numeric'
            elif case == 'uniform-extra': uniform['extra'] = 1
            elif case == 'empty-indices': access['indices'] = []
            elif case == 'indices-not-array': access['indices'] = {}
            elif case == 'indices-too-many': access['indices'] = list(range(47))
            elif case.startswith('indices-invalid-'):
                access['indices'] = [[-1], [46], [0xffffffff], [0x80000000], [1.5], ['1'], [None], [0, 0], [23, 0]][int(case.rsplit('-', 1)[1])]
            elif case == 'index-outside-extent': access['count'] = uniform['count'] = 23
            elif case == 'extent47-index46': access['count'] = uniform['count'] = 47; access['indices'] = [46]
            elif case == 'extra-access-key': access['extra'] = 1
            elif case.startswith('missing-access-'): del access[case.removeprefix('missing-access-')]
            elif case == 'v11-missing-domain': del value['constantDomains']
            elif case == 'v11-domain-count-mismatch': value['constantDomains'][0]['count'] = 45
            elif case == 'v11-domain-stage-mismatch': value['constantDomains'][0]['stage'] = 'fragment' if stage == 'vertex' else 'vertex'
            elif case == 'v10-forbids-domain': value['profile'] = 'virgl-webgl2-raw-bits-v10'
            else: raise ValueError(case)
            add(f'{stage}-{case}', stage, value)
        for version in (10, 11):
            for location in ('metadata', 'accesses', 'access', 'indices', 'uniform'):
                message = ('Array entries must be own data properties.' if location in ('accesses', 'indices')
                           else 'Unknown or accessor property.')
                add(f'{stage}-v{version}-{location}-accessor', stage, None, f'{location}-accessor', message)
        for location in ('accesses', 'indices'):
            for mutation in ('sparse', 'extra', 'symbol', 'inherited'):
                add(f'{stage}-{location}-{mutation}', stage, None, f'{location}-{mutation}',
                    'Array must be dense and contain no extra properties.')
        for mutation, message in [('revoked', 'Unusable array identity.'), ('throwing-descriptors', 'Unusable own data properties.'),
                                  ('symbol', 'Unknown or accessor property.'), ('inherited', 'Missing indices.')]:
            add(f'{stage}-access-{mutation}', stage, None, f'access-{mutation}', message)
    return rows


def encoded(value):
    if type(value) is bool:
        return {'type': 'boolean', 'value': value}
    if type(value) in (int, float):
        return {'type': 'number', 'value': value}
    return {'type': 'string' if type(value) is str else 'object', 'value': value}


def bank_result(words, count, finite, recipe=None):
    finite_policy = finite == encoded(True)
    code = 'constant-domain-error' if finite_policy else 'constant-access-error'
    count_value = count.get('value')
    if count['type'] != 'number' or not integer(count_value) or not 1 <= count_value <= 47 or finite['type'] != 'boolean':
        return failure(code, 'Invalid indirect constant-bank contract.')
    if recipe:
        return failure(code, {'typed-array': 'Expected an own data array.', 'null': 'Expected an own data array.',
                              'sparse': 'Array must be dense and contain no extra properties.',
                              'accessor': 'Array entries must be own data properties.',
                              'extra': 'Array must be dense and contain no extra properties.',
                              'symbol': 'Array must be dense and contain no extra properties.',
                              'revoked': 'Unusable array identity.', 'throwing-descriptors': 'Unusable own data properties.'}[recipe])
    if len(words) > 184: return failure(code, 'Array extent exceeds the bounded contract.')
    if len(words) % 4: return failure(code, 'Constant bank must contain complete vec4 registers.')
    count_value = min(count_value, 46) * 4
    if len(words) < count_value: return failure('incomplete-draw', 'Drawing requires every declared indirect constant word.')
    prefix = words[:count_value]
    if not all(word['type'] == 'number' and integer(word.get('value')) and 0 <= word['value'] < 2**32 for word in prefix):
        return failure(code, 'Indirect constant word is not an exact u32.')
    # Binary32 exponent by unsigned division, independent of the JS bitwise predicate.
    if finite_policy and any((word['value'] // 2**23) % 256 == 255 for word in prefix):
        return failure(code, 'Indirect constant word is outside the finite-binary32 domain.')
    return {'ok': True, 'words': [word['value'] for word in prefix]}


def expected_banks():
    rows = []

    def add(name, words, count, finite, recipe=None, typed=False):
        words = words if typed or words is None else list(map(encoded, words))
        count = count if type(count) is dict else encoded(count)
        finite = finite if type(finite) is dict else encoded(finite)
        rows.append({'name': name, **({'recipe': recipe} if recipe else {'words': words}),
                     'count': count, 'finite': finite, 'result': bank_result(words, count, finite, recipe), 'frozen': True})

    for finite in (False, True):
        policy = 'finite' if finite else 'raw'
        for count in (1, 8, 45, 46, 47):
            add(f'{policy}-extent{count}', FULL, count, finite)
            add(f'{policy}-short-extent{count}', FULL[:(min(count, 46) - 1) * 4], count, finite)
        for label, count in [('0', 0), ('48', 48), ('-1', -1), ('1.5', 1.5), ('46', '46'), ('null', None),
                             ('NaN', {'type': 'number', 'value': 'NaN'}), ('Infinity', {'type': 'number', 'value': 'Infinity'})]:
            add(f'{policy}-invalid-count-{label}', FULL, count, finite)
        for word in (0x7f800000, 0xff800000, 0x7f800001, 0xff800001, 0x7fc00000, 0xffc00000, 0x7fffffff, 0xffffffff):
            add(f'{policy}-word-{word:x}', [word, 0, 0, 0], 1, finite)
        bad_words = [('number', '-1', encoded(-1)), ('number', '4294967296', encoded(2**32)), ('number', '0.5', encoded(.5)),
                     *[('number', value, {'type': 'number', 'value': value}) for value in ('NaN', 'Infinity', '-Infinity')],
                     ('string', '0', encoded('0')), ('object', 'null', encoded(None)), ('undefined', 'undefined', {'type': 'undefined'}),
                     ('boolean', 'true', encoded(True)), ('bigint', '0', {'type': 'bigint', 'value': '0'}),
                     ('symbol', 'Symbol(word)', {'type': 'symbol', 'value': 'Symbol(word)'}), ('object', '[object Object]', encoded({}))]
        for kind, label, word in bad_words:
            add(f'{policy}-invalid-word-{kind}-{label}', [word, encoded(0), encoded(0), encoded(0)], 1, finite, typed=True)
        add(f'{policy}-bank188', FULL + [0] * 4, 47, finite)
        add(f'{policy}-bank183', FULL[:183], 45, finite)
        add(f'{policy}-short-nonfinite', [0x7f800000, 0, 0, 0], 46, finite)
        suffix = list(FULL); suffix[183] = 0xffffffff
        add(f'{policy}-outside-declared-prefix', suffix, 45, finite)
        for mutation in ('typed-array', 'null', 'sparse', 'accessor', 'extra', 'symbol', 'revoked', 'throwing-descriptors'):
            add(f'{policy}-bank-{mutation}', None, 1, finite, mutation)
    for label, finite in [('undefined', {'type': 'undefined'}), ('0', encoded(0)), ('true', encoded('true')), ('null', encoded(None))]:
        add(f'invalid-policy-{label}', FULL, 46, finite)
    for lane in range(184):
        words = list(FULL); words[lane] = 0x7fc00000
        add(f'finite-poison-lane{lane}', words, 47, True)
    return rows


def expected_ownership():
    rows = [{'name': 'metadata-copy', 'retained': schema_result(metadata(), 'vertex'),
             'originalIndicesAfter': [44, 44, 44], 'frozenMutationRejected': True}]
    for stage in (0, 1):
        packet = struct.pack('<187I', 0x00ba000c, stage, 0, *FULL)
        changed = list(FULL); changed[92] = 2
        rows.append({'name': f'decoder-stage{stage}-replacement', 'requestHex': packet.hex(),
                     'packetAfterHex': (b'\xff' * len(packet)).hex(), 'original': FULL,
                     'first': {'ok': True, 'words': FULL},
                     'short': failure('incomplete-draw', 'Drawing requires every declared indirect constant word.'),
                     'second': {'ok': True, 'words': changed}, 'distinctReferences': True, 'frozenMutationRejected': True})
    return rows


def verify(directory, head):
    require(isinstance(head, str) and len(head) == 40, 'exact frozen source head')
    return _verify(directory, head)


def verify_recording(directory):
    """Development-only replay, never a frozen-head acceptance claim."""
    return _verify(directory, None)


def _verify(directory, head):
    directory = Path(directory).resolve()
    report = read(directory / 'report.json')
    require(report['schema'] == 'wasm-vm-indirect-consumer-unit-v1' and report['task'] == 'E6-T12e8'
            and report['status'] == 'passed', 'consumer proof identity')
    require(same(report['schemas'], expected_schemas()), 'all 206 independently authored metadata inputs and full results')
    require(same(report['banks'], expected_banks()), 'all 290 independently authored raw/finite bank inputs and full results')
    require(same(report['ownership'], expected_ownership()), 'actual decoder ownership and replacement outcomes')
    require(same(report['stats'], {'schemas': 206, 'banks': 290, 'ownership': 3})
            and type(report['getterCalls']) is int and report['getterCalls'] == 0,
            'complete inventory and zero accessor executions')
    require(same(report['sources'], [binding(ROOT / name) for name in FILES]), 'consumer and recording source bytes')
    sources = report['sources'] + [binding(Path(__file__).resolve()), binding(ROOT / 'tools/virgl-indirect-constants/compat_common.py')]
    if head is not None:
        require(report['gitHead'] == head, 'consumer proof frozen head')
        for item in sources:
            require(subprocess.check_output(['git', 'show', f'{head}:{item["path"]}'], cwd=ROOT)
                    == (ROOT / item['path']).read_bytes(), 'consumer source equals frozen head')
    require(same(report['coverage'], binding(directory / 'coverage.json', directory)), 'actual coverage bytes')
    coverage = read(directory / 'coverage.json')
    strict_v8_coverage(coverage)
    require(len(coverage) == 2, 'consumer and decoder coverage')
    consumer = [entry for entry in coverage if entry['url'].endswith('/renderer/virgl-command/constant-domain.mjs')]
    require(len(consumer) == 1, 'actual consumer source coverage')
    for name, count in [('parseConstantDomain', 207), ('checkIndirectBank', 296)]:
        functions = [entry for entry in consumer[0]['functions'] if entry['functionName'] == name]
        require(len(functions) == 1 and same(functions[0]['ranges'][0]['count'], count), f'all {name} calls recorded')
    return {'status': 'passed', 'schemas': 206, 'banks': 290, 'ownership': 3, 'getterCalls': 0,
            'sources': sources, 'records': [binding(directory / name, directory) for name in ('report.json', 'coverage.json')]}
