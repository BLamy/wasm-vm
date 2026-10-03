"""Replay all old unit outcomes; inherit E7's two explicit v8 diagnostics."""
import copy
import json
from pathlib import Path
import re

from compat_common import (ROOT, BASE, require, held, consumer_modules, consumer_source,
                           profile_delta, source, binding as source_binding)

prior = consumer_modules()['unit_receipt']
read, binding, SOURCES = prior.read, prior.binding, prior.SOURCES


def expected_records():
    original = prior.expected_records()
    baseline = held(BASE + '/unit/unit-report.json')
    for key, value in original.items():
        require(json.dumps(baseline[key], sort_keys=True, separators=(',', ':')) ==
                json.dumps(value, sort_keys=True, separators=(',', ':')),
                f'complete held independent unit oracle: {key}')
    result = copy.deepcopy(original)
    changed = []
    for record in result['schemas']:
        if record['name'] not in ('vertex-unknown-profile', 'fragment-unknown-profile'):
            continue
        require(record['input']['profile'] == 'virgl-webgl2-raw-bits-v8'
                and len(record['input']['constantDomains']) == 1
                and record['input']['constantDomains'][0]['stage'] == record['stage']
                and record['expected'] == {'ok': False}
                and record['result'] == {'ok': False, 'error': {'code': 'shader-domain-error',
                    'message': 'Unknown shader profile.'}}, 'exact two formerly unknown profile recipes')
        record['result']['error']['message'] = 'Unconditional shader profile carries a conditional contract.'
        changed.append(record['name'])
    require(changed == ['vertex-unknown-profile', 'fragment-unknown-profile'], 'only two authored profile diagnostics change')
    profile_delta()
    return result


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
    range_counts = [2, 2, 2, 8, 6, 1, 26, 1, 4, 7]
    require([function['functionName'] for function in functions] == names[:7] + [''] + names[7:],
            'complete old helper coverage plus unexecuted new indirect callback')
    require([len(function['ranges']) for function in functions] == range_counts, 'complete helper range coverage')
    zeros = []
    for function in functions:
        require(set(function) == {'functionName', 'ranges', 'isBlockCoverage'} and
                function['isBlockCoverage'] is bool(function['functionName']),
                'precise executed helper blocks; new unexecuted callback has function coverage')
        entry = function['ranges'][0]
        if function['functionName']:
            require(entry['count'] > 0 and source[entry['startOffset']:].startswith(f'function {function["functionName"]}('),
                    'executed old function source range')
        else:
            require(entry['count'] == 0 and source[entry['startOffset']:].startswith('(index, position) => Number.isInteger(index)'),
                    'indirect-only callback belongs to the separately recorded E8 consumer proof')
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
    indirect_start = source.index('    if (indirect) {') + len('    if (indirect) ')
    indirect_end = source.index(' else {', indirect_start)
    callback_start = source.index('(index, position) => Number.isInteger(index)')
    callback_end = source.index(')),', callback_start) + 1
    require(zeros == [('parseConstantDomain', '|| INDIRECT_PROFILES.has(value.profile)'),
                      ('parseConstantDomain', source[indirect_start:indirect_end]),
                      ('parseConstantDomain', '? { access }'), ('parseConstantDomain', '? { access }'),
                      ('parseConstantDomain', 'throw error;'), ('', source[callback_start:callback_end]),
                      ('checkFiniteBank', 'throw error;')],
            'old workload leaves only new indirect branches and unexpected rethrows unexecuted')
    return report


def verify(directory, head):
    directory = Path(directory)
    report = verify_content(directory)
    require(report['gitHead'] == head and re.fullmatch(r'[0-9a-f]{40}', head), 'exact unit evidence head')
    sources = list(report['sources'])
    for name in SOURCES:
        consumer_source(name)
    sources += [source_binding(ROOT / name) for name in (
        'tools/virgl-constant-domains/unit_receipt.py',
        'tools/virgl-indirect-constants/unit_compat.py',
        'tools/virgl-indirect-constants/compat_common.py',
        BASE + '/unit/unit-report.json')]
    for item in sources:
        source(item, head)
    return {'schema': 'wasm-vm-e8-retained-unit-compat-v1', **report['stats'],
            'coverageFunctions': 10, 'coverageRanges': 59, 'profileExtension': profile_delta(),
            'newProfileCoverage': 'tools/virgl-indirect-constants/consumer_receipt.py binds and verifies the separate complete E8 metadata and bank workload.',
            'diagnosticDeltas': [{'name': stage + '-unknown-profile',
                'before': 'Unknown shader profile.',
                'after': 'Unconditional shader profile carries a conditional contract.',
                'outcome': 'shader-domain-error'} for stage in ('vertex', 'fragment')],
            'waivedRanges': [{'function': name, 'source': 'throw error;',
                              'reason': 'Unexpected implementation defects propagate instead of being disguised as input errors.'}
                             for name in ('parseConstantDomain', 'checkFiniteBank')],
            'sources': sources, 'records': [binding(directory / name, directory)
                                            for name in ('unit-report.json', 'coverage.json')]}
