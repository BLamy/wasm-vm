#!/usr/bin/env python3
"""Reconstruct authored consumer tests without loading the JavaScript consumer."""
import copy
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[2]
PROFILE = 'virgl-webgl2-raw-bits-v7'
KIND = 'constant-bank-finite-f32-v1'
SOURCES = ['renderer/virgl-command/constant-domain.mjs', 'renderer/virgl-command/decoder.mjs',
           'tools/virgl-constant-domains/unit.mjs']
METADATA_KEYS = {'profile', 'stage', 'inputs', 'outputs', 'attributes', 'uniforms', 'samplers', 'uniformBlocks'}
DOMAIN_KEYS = {'kind', 'stage', 'slot', 'name', 'count'}
OLD_PROFILES = ['virgl-webgl2-straight-line-v5'] + [f'virgl-webgl2-raw-bits-v{i}' for i in range(1, 7)]


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f'duplicate JSON key: {key}')
            result[key] = value
        return result
    return json.loads(path.read_bytes(), object_pairs_hook=unique,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f'non-JSON number: {value}')))


def binding(path, base):
    raw = path.read_bytes()
    return {'path': str(path.relative_to(base)), 'bytes': len(raw), 'sha256': sha(raw)}


def integer(value):
    return type(value) is int or (type(value) is float and math.isfinite(value) and value.is_integer())


def finite_word(value):
    # Independent unsigned division, not the implementation's bitwise predicate.
    return integer(value) and 0 <= value < 2**32 and (int(value) // 2**23) % 256 != 255


def encode(value):
    if type(value) in (int, float):
        return {'type': 'number', 'value': value}
    if value is None:
        return {'type': 'object', 'value': None}
    if type(value) is str:
        return {'type': 'string', 'value': value}
    raise ValueError('unsupported authored input encoding')


def failure(code, message):
    return {'ok': False, 'error': {'code': code, 'message': message}}


def metadata(stage='vertex', count=46, profile=PROFILE):
    name = 'vsconst0' if stage == 'vertex' else 'fsconst0'
    result = {'profile': profile, 'stage': stage, 'inputs': [], 'outputs': [], 'attributes': [],
              'uniforms': [{'name': name, 'type': 'uvec4[]', 'count': count, 'encoding': 'float32-bits'}],
              'samplers': [], 'uniformBlocks': []}
    if profile == PROFILE:
        result['constantDomains'] = [{'kind': KIND, 'stage': stage, 'slot': 0, 'name': name, 'count': count}]
    return result


def schema_result(value, stage):
    """Independent data-only schema rules; exotic descriptor cases use explicit recipes."""
    def bad(message):
        return failure('shader-domain-error', message)
    if stage not in ('vertex', 'fragment'):
        return bad('Unknown shader stage.')
    if type(value) is not dict:
        return bad('Expected an own data record.')
    if set(value) - METADATA_KEYS - {'constantDomains'}:
        return bad('Unknown or accessor property.')
    for key in ('profile', 'stage', 'inputs', 'outputs', 'attributes', 'uniforms', 'samplers', 'uniformBlocks'):
        if key not in value:
            return bad(f'Missing {key}.')
    if value['stage'] != stage:
        return bad('Constant domain stage disagrees with the shader stage.')
    if value['profile'] not in [PROFILE, *OLD_PROFILES]:
        return bad('Unknown shader profile.')
    if value['profile'] != PROFILE:
        if 'constantDomains' in value:
            return bad('Unconditional shader profile carries a conditional contract.')
        return {'ok': True, 'domain': None}
    if 'constantDomains' not in value:
        return bad('Conditional shader profile requires a constant domain.')
    for entries in (value['constantDomains'], value['uniforms']):
        if type(entries) is not list:
            return bad('Expected an own data array.')
        if len(entries) > 1:
            return bad('Array extent exceeds the bounded contract.')
    if len(value['constantDomains']) != 1 or len(value['uniforms']) != 1:
        return bad('Conditional shader requires one domain and one constant bank.')
    domain, uniform = value['constantDomains'][0], value['uniforms'][0]
    for obj, fields in ((domain, ('kind', 'stage', 'slot', 'name', 'count')),
                        (uniform, ('name', 'type', 'count', 'encoding'))):
        if type(obj) is not dict:
            return bad('Expected an own data record.')
        if set(obj) - set(fields):
            return bad('Unknown or accessor property.')
        for field in fields:
            if field not in obj:
                return bad(f'Missing {field}.')
    name = 'vsconst0' if stage == 'vertex' else 'fsconst0'
    if (domain['kind'] != KIND or domain['stage'] != stage or type(domain['slot']) is not int
            or domain['slot'] != 0 or domain['name'] != name):
        return bad('Unknown or inconsistent constant-bank domain.')
    if (not integer(domain['count']) or not 1 <= domain['count'] <= 47 or uniform['name'] != name
            or uniform['type'] != 'uvec4[]' or uniform['encoding'] != 'float32-bits'
            or uniform['count'] != domain['count']):
        return bad('Constant domain does not match the declared bank extent and encoding.')
    return {'ok': True, 'domain': copy.deepcopy(domain)}


def bank_result(words, count):
    if not integer(count) or not 0 <= count <= 46:
        return failure('constant-domain-error', 'Invalid reflected constant upload extent.')
    if len(words) > 184:
        return failure('constant-domain-error', 'Array extent exceeds the bounded contract.')
    if len(words) % 4:
        return failure('constant-domain-error', 'Constant bank must contain complete vec4 registers.')
    if len(words) < count * 4:
        return failure('incomplete-draw', 'Drawing requires every active constant word.')
    prefix = words[:count * 4]
    if not all(finite_word(word) for word in prefix):
        return failure('constant-domain-error', 'Active constant word is outside the finite-binary32 domain.')
    return {'ok': True, 'words': prefix}


def expected_records():
    predicates, schemas, banks, ownership = [], [], [], []
    for sign in (0, 1):
        for exponent in range(256):
            for mantissa in (0, 1, 0x7fffff):
                word = sign * 2**31 + exponent * 2**23 + mantissa
                expected = exponent != 255
                require(finite_word(word) == expected, 'independent exponent construction')
                predicates.append({'input': encode(word), 'sign': sign, 'exponent': exponent,
                                   'mantissa': mantissa, 'expected': expected, 'result': expected})
    for value in [encode(-1), encode(2**32), encode(.5),
                  *({'type': 'number', 'value': v} for v in ('NaN', 'Infinity', '-Infinity')),
                  encode('0'), encode(None), {'type': 'undefined'}, {'type': 'boolean', 'value': True},
                  {'type': 'bigint', 'value': '0'}, {'type': 'symbol', 'value': 'word'}, {'type': 'object', 'value': {}}]:
        predicates.append({'input': value, 'expected': False, 'result': False})

    def schema(name, stage, value, ok):
        result = schema_result(value, stage)
        require(result['ok'] is ok, f'authored independent schema expectation: {name}')
        expected = {'ok': ok, 'domain': copy.deepcopy(result['domain'])} if ok else {'ok': False}
        schemas.append({'name': name, 'stage': stage, 'input': value, 'expected': expected, 'result': result})

    for stage in ('vertex', 'fragment'):
        for count in (1, 8, 46, 47):
            schema(f'{stage}-extent{count}', stage, metadata(stage, count), True)
        for profile in OLD_PROFILES:
            schema(f'{stage}-{profile}', stage, metadata(stage, profile=profile), True)
        mutations = ['unknown-profile', 'missing-contract', 'old-profile-with-contract', 'wrong-metadata-stage',
                     'empty-contract', 'duplicate-contract', 'unknown-kind', 'wrong-stage', 'slot-one', 'wrong-name',
                     'name-has-array-suffix', 'zero-extent', 'extent48', 'fraction-extent', 'extent-disagreement',
                     'uniform-name', 'uniform-type', 'uniform-encoding', 'no-uniform', 'duplicate-uniform',
                     'unknown-metadata-key', 'unknown-domain-key', 'unknown-uniform-key',
                     *[f'missing-domain-{key}' for key in ('kind', 'stage', 'slot', 'name', 'count')]]
        for mutation in mutations:
            value = metadata(stage)
            domain, uniform = value['constantDomains'][0], value['uniforms'][0]
            if mutation == 'unknown-profile': value['profile'] = 'virgl-webgl2-raw-bits-v8'
            elif mutation == 'missing-contract': del value['constantDomains']
            elif mutation == 'old-profile-with-contract': value['profile'] = 'virgl-webgl2-raw-bits-v6'
            elif mutation == 'wrong-metadata-stage': value['stage'] = 'fragment' if stage == 'vertex' else 'vertex'
            elif mutation == 'empty-contract': value['constantDomains'] = []
            elif mutation == 'duplicate-contract': value['constantDomains'].append(copy.deepcopy(domain))
            elif mutation == 'unknown-kind': domain['kind'] = 'finite-normal-only-v1'
            elif mutation == 'wrong-stage': domain['stage'] = 'fragment' if stage == 'vertex' else 'vertex'
            elif mutation == 'slot-one': domain['slot'] = 1
            elif mutation == 'wrong-name': domain['name'] = 'otherconst0'
            elif mutation == 'name-has-array-suffix': domain['name'] += '[0]'
            elif mutation in ('zero-extent', 'extent48', 'fraction-extent'):
                domain['count'] = uniform['count'] = {'zero-extent': 0, 'extent48': 48, 'fraction-extent': 1.5}[mutation]
            elif mutation == 'extent-disagreement': domain['count'] -= 1
            elif mutation == 'uniform-name': uniform['name'] = 'otherconst0'
            elif mutation == 'uniform-type': uniform['type'] = 'vec4[]'
            elif mutation == 'uniform-encoding': uniform['encoding'] = 'numeric'
            elif mutation == 'no-uniform': value['uniforms'] = []
            elif mutation == 'duplicate-uniform': value['uniforms'].append(copy.deepcopy(uniform))
            elif mutation == 'unknown-metadata-key': value['unknown'] = True
            elif mutation == 'unknown-domain-key': domain['unknown'] = True
            elif mutation == 'unknown-uniform-key': uniform['unknown'] = True
            elif mutation.startswith('missing-domain-'): del domain[mutation.removeprefix('missing-domain-')]
            else: raise ValueError('unrecognized independent mutation')
            schema(f'{stage}-{mutation}', stage, value, False)
        schema(f'{stage}-legacy-after-both-markers-removed', stage, metadata(stage, profile='virgl-webgl2-raw-bits-v6'), True)
    exotic_schemas = [
        ('null-record', 'Expected an own data record.'), ('array-record', 'Expected an own data record.'),
        ('primitive-record', 'Expected an own data record.'), ('revoked-record', 'Unusable array identity.'),
        ('throwing-descriptors', 'Unusable own data properties.'), ('inherited-profile', 'Missing profile.'),
        ('metadata-accessor', 'Unknown or accessor property.'), ('domain-accessor', 'Unknown or accessor property.'),
        ('array-accessor', 'Array entries must be own data properties.'),
        ('sparse-array', 'Array must be dense and contain no extra properties.'),
        ('array-extra-key', 'Array must be dense and contain no extra properties.'),
        ('array-symbol', 'Array must be dense and contain no extra properties.'),
        ('record-symbol', 'Unknown or accessor property.'), ('contract-not-array', 'Expected an own data array.'),
    ]
    for name, message in exotic_schemas:
        schemas.append({'name': name, 'stage': 'vertex', 'recipe': {'base': 'vertex-extent46', 'mutation': name},
                        'expected': {'ok': False}, 'result': failure('shader-domain-error', message)})
    schema('unknown-requested-stage', 'geometry', metadata(), False)

    finite = [0, 0x80000000, 1, 0x80000001, 0x007fffff, 0x807fffff, 0x00800000, 0x80800000,
              0x3f800000, 0xbf800000, 0x7f7fffff, 0xff7fffff]
    full = [finite[i % len(finite)] for i in range(184)]

    def bank(name, words, count):
        result = bank_result(words, count)
        banks.append({'name': name, 'words': words, 'uploadCount': encode(count),
                      'expectedCode': result.get('error', {}).get('code'), 'result': result})
    for count in (0, 1, 8, 45, 46): bank(f'full-prefix{count}', full, count)
    bank('empty-inactive', [], 0)
    bank('empty-active', [], 1)
    bank('short180-active46', full[:180], 46)
    bank('short180-active45', full[:180], 45)
    for word in (0x7f800000, 0xff800000, 0x7f800001, 0xff800001, 0x7fc00000, 0xffc00000, 0x7fffffff, 0xffffffff):
        for index in (0, 3, 180, 183):
            words = full.copy(); words[index] = word
            bank(f'nonfinite-{word:x}-lane{index}', words, 46)
            if index >= 180: bank(f'pruned-{word:x}-lane{index}', words, 45)
            bank(f'inactive-{word:x}-lane{index}', words, 0)
    bank('short-nonfinite-remains-incomplete', [0x7f800000, 0, 0, 0], 46)
    bank('bank188-not-guest-addressable', full + [0, 0, 0, 0], 46)
    bank('bank183-not-vec4', full[:183], 45)
    for count in (-1, .5, 47, '1'): bank(f'bad-count-{count}', full, count)
    for count in ('NaN', 'Infinity'):
        banks.append({'name': f'bad-count-{count}', 'words': full, 'uploadCount': {'type': 'number', 'value': count},
                      'expectedCode': 'constant-domain-error',
                      'result': failure('constant-domain-error', 'Invalid reflected constant upload extent.')})
    for name, message in [('not-array', 'Expected an own data array.'), ('null', 'Expected an own data array.'),
                          ('revoked', 'Unusable array identity.'), ('sparse', 'Array must be dense and contain no extra properties.'),
                          ('accessor', 'Array entries must be own data properties.'),
                          ('extra-key', 'Array must be dense and contain no extra properties.')]:
        banks.append({'name': f'bank-{name}', 'recipe': {'mutation': name}, 'uploadCount': encode(1),
                      'expectedCode': 'constant-domain-error', 'result': failure('constant-domain-error', message)})
    for word in (-1, 2**32, .5, '0', None):
        bank(f'invalid-word-{"null" if word is None else word}', [word, 0, 0, 0], 1)
    ownership.append({'name': 'contract-copy', 'sourceCountAfter': 1,
                      'retained': schema_result(metadata(), 'vertex'), 'frozenMutationRejected': True})
    ownership.append({'name': 'bank-copy', 'sourceAfter': [0x7f800000] * 184,
                      'retained': bank_result(full, 46), 'frozenMutationRejected': True})
    for stage in (0, 1):
        request = struct.pack('<187I', 0x00ba000c, stage, 0, *full)
        ownership.append({'name': f'decoder-stage{stage}-replace', 'requestHex': request.hex(),
                          'inputAfterHex': (b'\xff' * len(request)).hex(), 'decodedWords': full,
                          'snapshot': bank_result(full, 46), 'replacement': full[:180],
                          'rejected': bank_result(full[:180], 46), 'distinctReferences': True,
                          'frozenMutationRejected': True})
    return {'schema': 'wasm-vm-constant-domains-unit-v1', 'status': 'passed', 'profile': PROFILE, 'kind': KIND,
            'predicates': predicates, 'schemas': schemas, 'banks': banks, 'ownership': ownership,
            'stats': {key: len(value) for key, value in [('predicates', predicates), ('schemas', schemas),
                                                       ('banks', banks), ('ownership', ownership)]}}


def verify_content(directory):
    directory = Path(directory)
    report = read(directory / 'unit-report.json')
    expected = expected_records()
    require(set(report) == set(expected) | {'gitHead', 'sources', 'coverage'}, 'complete unit report shape')
    for key, value in expected.items():
        # Canonical JSON comparison also distinguishes booleans from integers.
        require(json.dumps(report[key], sort_keys=True, separators=(',', ':')) ==
                json.dumps(value, sort_keys=True, separators=(',', ':')), f'independent complete unit {key}')
    require(report['sources'] == [binding(ROOT / name, ROOT) for name in SOURCES], 'unit source identities')
    require(report['coverage'] == binding(directory / 'coverage.json', directory), 'unit coverage digest')
    coverage = read(directory / 'coverage.json')
    require(set(coverage) == {'result'} and len(coverage['result']) == 1, 'one complete helper coverage script')
    script = coverage['result'][0]
    source_path = ROOT / SOURCES[0]
    source = source_path.read_text()
    require(script['url'] == source_path.as_uri() and re.fullmatch(r'[0-9]+', script['scriptId']), 'covered helper identity')
    functions = script['functions']
    names = ['require', 'descriptors', 'isArray', 'record', 'array', 'failure',
             'parseConstantDomain', 'finiteBinary32Word', 'checkFiniteBank']
    range_counts = [2, 2, 2, 8, 6, 1, 19, 4, 7]
    require([function['functionName'] for function in functions] == names, 'complete helper function coverage')
    require([len(function['ranges']) for function in functions] == range_counts, 'complete helper range coverage')
    zeros = []
    for function in functions:
        require(set(function) == {'functionName', 'ranges', 'isBlockCoverage'} and function['isBlockCoverage'] is True,
                'precise helper block coverage')
        entry = function['ranges'][0]
        require(entry['count'] > 0 and source[entry['startOffset']:].startswith(f'function {function["functionName"]}('),
                'executed function source range')
        seen = set()
        for item in function['ranges']:
            require(set(item) == {'startOffset', 'endOffset', 'count'} and
                    all(type(item[k]) is int for k in item) and item['count'] >= 0 and
                    entry['startOffset'] <= item['startOffset'] < item['endOffset'] <= entry['endOffset'] <= len(source),
                    'bounded precise coverage range')
            pair = item['startOffset'], item['endOffset']
            require(pair not in seen, 'unique coverage range'); seen.add(pair)
            if item['count'] == 0:
                zeros.append((function['functionName'], source[item['startOffset']:item['endOffset']]))
    require(zeros == [('parseConstantDomain', 'throw error;'), ('checkFiniteBank', 'throw error;')],
            'only unexpected implementation-defect rethrows remain unexecuted')
    return report


def verify(directory, head):
    report = verify_content(directory)
    require(report['gitHead'] == head and re.fullmatch(r'[0-9a-f]{40}', head), 'exact unit evidence head')
    for name in SOURCES:
        require(subprocess.check_output(['git', 'show', f'{head}:{name}'], cwd=ROOT) == (ROOT / name).read_bytes(),
                f'frozen unit source: {name}')
    return {'schema': report['schema'], **report['stats'], 'coverageFunctions': 9, 'coverageRanges': 51,
            'waivedRanges': [{'function': name, 'source': 'throw error;',
                              'reason': 'Unexpected implementation defects propagate instead of being disguised as input errors.'}
                             for name in ('parseConstantDomain', 'checkFiniteBank')],
            'sources': report['sources'], 'records': [binding(Path(directory) / name, Path(directory))
                                                    for name in ('unit-report.json', 'coverage.json')]}
