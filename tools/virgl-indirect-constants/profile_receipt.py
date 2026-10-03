"""Retain E7's independent 50-case profile oracle with four named diagnostics."""
import copy
from pathlib import Path

from compat_common import (ROOT, E7, HELD_HEAD, require, read, binding, held, source, unchanged, load, same, strict_v8_coverage)

BASELINE = E7 + '/profiles/report.json'
HELD_FILES = ['tools/virgl-structured-conditionals/profiles.mjs',
              'tools/virgl-structured-conditionals/profiles_receipt.py', BASELINE]
FILES = ['renderer/virgl-command/constant-domain.mjs', 'tools/virgl-indirect-constants/profiles.mjs', *HELD_FILES]
MIGRATIONS = ['vertex-v10-with-domain', 'vertex-v10-without-domain',
              'fragment-v10-with-domain', 'fragment-v10-without-domain']
BEFORE = 'Unknown shader profile.'
AFTER = 'Indirect shader profile requires a constant access contract.'


def expected_cases():
    for name in HELD_FILES:
        unchanged(name)
    prior = load('e8_held_profile_oracle', 'tools/virgl-structured-conditionals/profiles_receipt.py')
    baseline = held(BASELINE)
    require(baseline['schema'] == 'wasm-vm-structured-profiles-v1' and baseline['task'] == 'E6-T12e7'
            and baseline['status'] == 'passed' and same(baseline['cases'], prior.expected_cases()),
            'complete held E7 independent profile inputs and full results')
    expected = copy.deepcopy(prior.expected_cases())
    deltas = []
    for row in expected:
        if row['name'] not in MIGRATIONS:
            continue
        require(row['input']['profile'] == 'virgl-webgl2-raw-bits-v10' and 'constantAccesses' not in row['input']
                and same(row['expected'], {'ok': False, 'error': {'code': 'shader-domain-error', 'message': BEFORE}})
                and same(row['result'], row['expected']), 'exact formerly unknown v10 rejection recipe')
        for key in ('expected', 'result'):
            row[key]['error']['message'] = AFTER
        deltas.append({'name': row['name'], 'before': BEFORE, 'after': AFTER, 'outcome': 'shader-domain-error'})
    require([row['name'] for row in deltas] == MIGRATIONS, 'only four exact v10 diagnostics change')
    return expected, deltas


def verify(directory, head):
    require(isinstance(head, str) and len(head) == 40, 'exact frozen source head')
    return _verify(directory, head)


def verify_recording(directory):
    """Development-only source replay; no frozen-head acceptance claim."""
    return _verify(directory, None)


def _verify(directory, head):
    directory = Path(directory).resolve()
    report = read(directory / 'report.json')
    require(report['schema'] == 'wasm-vm-e8-retained-profiles-v1' and report['task'] == 'E6-T12e8'
            and report['status'] == 'passed' and report['heldHead'] == HELD_HEAD
            and report['predecessorFullGateClaimed'] is False, 'explicit successor profile replay identity')
    expected, deltas = expected_cases()
    require(same(report['cases'], expected) and same(report['diagnosticDeltas'], deltas),
            'all 50 complete typed public records and exactly four inventoried diagnostics')
    require(same(report['sources'], [binding(ROOT / name) for name in FILES]), 'current consumer and unchanged held source bytes')
    sources = report['sources'] + [binding(Path(__file__).resolve()), binding(ROOT / 'tools/virgl-indirect-constants/compat_common.py')]
    if head is not None:
        require(report['gitHead'] == head, 'profile recording frozen head')
        for item in sources:
            source(item, head)
    require(same(report['coverage'], binding(directory / 'coverage.json', directory)), 'actual helper coverage digest')
    coverage = read(directory / 'coverage.json')
    strict_v8_coverage(coverage)
    require(len(coverage) == 1 and coverage[0]['url'].endswith('/renderer/virgl-command/constant-domain.mjs'), 'actual helper coverage source')
    functions = [entry for entry in coverage[0]['functions'] if entry['functionName'] == 'parseConstantDomain']
    require(len(functions) == 1 and same(functions[0]['ranges'][0]['count'], 50), 'all 50 real public parser calls')
    return {'schema': 'wasm-vm-e8-retained-profiles-v1', 'status': 'passed', 'cases': 50,
            'heldHead': HELD_HEAD, 'predecessorFullGateClaimed': False, 'diagnosticDeltas': deltas,
            'mandatoryDomains': [7, 9], 'rejectedWithoutAccess': 10,
            'trueUnknownProfile': {'version': 12, 'proof': 'consumer-unit'},
            'sources': sources, 'records': [binding(directory / name, directory) for name in ('report.json', 'coverage.json')]}
