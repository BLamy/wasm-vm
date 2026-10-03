"""Replay verified E8 GPU and consumer leaves with explicit v12 diagnostic deltas."""
import copy
from pathlib import Path

from compat_common import (ROOT, E8, HELD_HEAD, require, read, binding, held, source,
                           unchanged, consumer_source, profile_delta, load, same, strict_v8_coverage)

PREFIX = 'tools/virgl-indirect-constants/'
FIXTURE = 'renderer/virgl-command/tests/indirect-constants-shaders.json'
HELPERS = [PREFIX + name for name in ('browser_receipt.py', 'oracle.py', 'faults.py', 'fault_wasm.mjs',
                                    'consumer_receipt.py', 'consumer-unit.mjs')]
DEPENDENCIES = [
    'tools/virgl-constant-compiler/browser_receipt.py', 'tools/virgl-constant-compiler/lifecycle_receipt.py',
    'tools/virgl-constant-compiler/oracle.py', 'tools/virgl-dot-reciprocals/oracle.py',
    'tools/virgl-component-floats/oracle.py', 'tools/virgl-numeric-floats/oracle.py',
]
CONSUMER_BASE = E8 + '/consumer-unit/report.json'
MIGRATIONS = ['vertex-unknown-profile', 'fragment-unknown-profile']
BEFORE = 'Unknown shader profile.'
AFTER = 'Loop shader profile requires a constant count constraint.'


def native_view(native):
    baseline = held(E8 + '/native/native-report.json')
    for current, prior in [('indirectCases', 'cases'), ('indirectPairs', 'pairs'), ('indirectFixtures', 'fixtures')]:
        require(same(native[current], baseline[prior]), f'all full retained E8 native records: {current}')
    require(same(native['originals'], baseline['originals']), 'all full original E8 outcomes')
    for item in native['indirectFixtures']:
        unchanged(item['path'])
        require(same(item, binding(ROOT / item['path'])), 'literal E8 fixtures remain exact')
    return {'cases': native['indirectCases'], 'pairs': native['indirectPairs'],
            'fixtures': native['indirectFixtures'], 'originals': native['originals']}


def verify_consumer(directory, head=None):
    """Replay the old recorder and its independent oracle; name the only two changes."""
    directory = Path(directory).resolve()
    for name in (PREFIX + 'consumer-unit.mjs', PREFIX + 'consumer_receipt.py'):
        unchanged(name)
    prior = load('e9_held_indirect_consumer', PREFIX + 'consumer_receipt.py')
    baseline = held(CONSUMER_BASE)
    expected = {'schemas': prior.expected_schemas(), 'banks': prior.expected_banks(),
                'ownership': prior.expected_ownership()}
    for key, value in expected.items():
        require(same(baseline[key], value), f'all independent held E8 {key}')
    expected = copy.deepcopy(expected)
    deltas = []
    for row in expected['schemas']:
        if row['name'] not in MIGRATIONS:
            continue
        require(row['input']['profile'] == 'virgl-webgl2-raw-bits-v12'
                and 'constantConstraints' not in row['input']
                and row['input']['constantDomains'] and row['input']['constantAccesses']
                and same(row['result'], {'ok': False, 'error': {'code': 'shader-domain-error', 'message': BEFORE}}),
                'exact old unknown-v12 recipe already carries domain and access')
        row['result']['error']['message'] = AFTER
        deltas.append({'name': row['name'], 'before': BEFORE, 'after': AFTER, 'outcome': 'shader-domain-error'})
    require([row['name'] for row in deltas] == MIGRATIONS, 'exactly two v12 missing-constraint diagnostics')
    report = prior.read(directory / 'report.json')
    require(report['schema'] == 'wasm-vm-indirect-consumer-unit-v1' and report['task'] == 'E6-T12e8'
            and report['status'] == 'passed', 'actual unchanged E8 leaf recorder identity')
    for key, value in expected.items():
        require(same(report[key], value), f'complete typed successor replay of E8 {key}')
    require(same(report['stats'], {'schemas': 206, 'banks': 290, 'ownership': 3})
            and type(report['getterCalls']) is int and report['getterCalls'] == 0,
            'all typed E8 consumer counters and no accessor executions')
    require(same(report['sources'], [binding(ROOT / name) for name in prior.FILES]),
            'current consumer and held recorder identities')
    for name in prior.FILES:
        consumer_source(name)
    sources = report['sources'] + [binding(ROOT / name) for name in (
        PREFIX + 'consumer_receipt.py', CONSUMER_BASE, 'tools/virgl-bounded-loops/indirect_compat.py',
        'tools/virgl-bounded-loops/compat_common.py')]
    if head is not None:
        require(type(head) is str and len(head) == 40 and report['gitHead'] == head, 'consumer leaf frozen head')
        for item in sources:
            source(item, head)
    require(same(report['coverage'], binding(directory / 'coverage.json', directory)), 'actual retained consumer coverage bytes')
    coverage = prior.read(directory / 'coverage.json'); strict_v8_coverage(coverage)
    require(len(coverage) == 2, 'actual consumer and decoder coverage')
    for filename in ('constant-domain.mjs', 'decoder.mjs'):
        require(len([entry for entry in coverage if entry['url'].endswith('/renderer/virgl-command/' + filename)]) == 1,
                'unique actual consumer/decoder coverage sources')
    consumer = next(entry for entry in coverage if entry['url'].endswith('/constant-domain.mjs'))
    for name, count in [('parseConstantDomain', 207), ('checkIndirectBank', 296)]:
        functions = [entry for entry in consumer['functions'] if entry['functionName'] == name]
        require(len(functions) == 1 and same(functions[0]['ranges'][0]['count'], count), f'all retained {name} calls')
    return {'status': 'passed', 'schemas': 206, 'banks': 290, 'ownership': 3, 'getterCalls': 0,
            'diagnosticDeltas': deltas, 'trueUnknownProfile': {'version': 13, 'proof': 'consumer-unit'},
            'sources': sources, 'records': [binding(directory / name, directory) for name in ('report.json', 'coverage.json')]}


def verify(output, head, native):
    output = Path(output).resolve() / 'indirect-regression'
    baseline = held(E8 + '/receipt.json')
    require(baseline['task'] == 'E6-T12e8' and baseline['status'] == 'passed', 'verified E8 baseline remains source bound')
    for name in HELPERS + DEPENDENCIES + [FIXTURE, 'tools/verify-virgl-indirect-constants.mjs',
            'renderer/virgl-command/tests/indirect-constants.mjs',
            'renderer/virgl-command/tests/indirect-constants-oracle.mjs', 'tools/lib/virgl-browser-runner.mjs']:
        unchanged(name)
    browser = load('e9_held_indirect_gpu', PREFIX + 'browser_receipt.py')
    faults = load('e9_held_indirect_faults', PREFIX + 'faults.py')
    for name in browser.RUNTIME:
        consumer_source(name)
    view = native_view(native)
    clean_by_sha = {}
    for entry in view['cases']:
        digest = entry['inputSha256']
        require(digest not in clean_by_sha or same(clean_by_sha[digest], entry['result']),
                'identical E8 literal bodies retain identical complete results')
        clean_by_sha[digest] = entry['result']
    fault_directory = output / 'fault-artifacts'
    fault_summary = faults.verify(fault_directory, head, clean_by_sha)
    manifest = read(fault_directory / 'manifest.json')
    proof = browser.verify(output, head, view, manifest)
    require(proof['preview'] is False and proof['status'] == 'passed', 'complete exact-head E8 GPU leaf replay')
    consumer = verify_consumer(output / 'consumer-unit', head)
    names = {item['path'] for item in proof['sources'] + manifest['sources'] + consumer['sources']}
    names.update(HELPERS + DEPENDENCIES + [E8 + '/receipt.json', E8 + '/native/native-report.json',
                 'tools/virgl-bounded-loops/indirect_compat.py', 'tools/virgl-bounded-loops/compat_common.py'])
    sources = []
    for name in sorted(names):
        if '/build/' not in name:
            item = binding(ROOT / name); source(item, head); sources.append(item)
    return {'schema': 'wasm-vm-e9-indirect-constant-compat-v1', 'status': 'passed',
            'recordedHead': head, 'heldHead': HELD_HEAD, 'predecessorFullGateClaimed': False,
            'boundary': 'Unchanged E8 literal indirect GPU and source-fault leaves use exact retained native results. All E8 consumer inputs and full outcomes remain, except two named unknown-v12 diagnostics now require its missing loop constraint.',
            'profileExtension': profile_delta(), 'baseline': binding(ROOT / E8 / 'receipt.json'),
            'cases': len(view['cases']), 'pairs': len(view['pairs']), 'modes': proof['modes'], 'compilerFaults': fault_summary,
            'consumer': {key: value for key, value in consumer.items() if key not in ('sources', 'records')},
            'records': [*proof['records'], *[binding(output / 'consumer-unit' / name, output) for name in ('report.json', 'coverage.json')], binding(fault_directory / 'manifest.json', output)],
            'sources': sources}
