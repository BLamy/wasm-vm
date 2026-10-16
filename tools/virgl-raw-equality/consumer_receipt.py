"""Reconstruct the consumer ledger without executing the parser under test."""
import copy
from pathlib import Path
from shared import ROOT, binding, read, require, same, source

SOURCES = ['renderer/virgl-command/constant-domain.mjs',
           'tools/virgl-raw-equality/consumer.mjs']
GETTER = "get(){getters++;throw new Error('invoked');}"
GROUPS = ['raw', 'integer', 'float', 'numeric', 'component', 'dot',
          'constant', 'structured', 'indirect', 'loop']
MESSAGES = {
    'constantDomains': 'Unconditional shader profile carries a conditional contract.',
    'constantAccesses': 'Shader profile forbids a constant access contract.',
    'constantConstraints': 'Shader profile forbids a constant count constraint.',
}


def expected_checks(native):
    checks = []

    def observe(name, metadata, stage, result):
        checks.append(dict(name=name, metadata=copy.deepcopy(metadata), stage=stage,
                           result=copy.deepcopy(result)))

    for entry in [e for group in GROUPS for e in native[group + 'Cases']] + native['cases']:
        if not entry['result']['ok']:
            continue
        metadata = entry['result']['metadata']
        profile = metadata['profile']
        result = {'ok': True, 'domain': metadata['constantDomains'][0]
                  if profile.endswith(('-v7', '-v9', '-v11', '-v12')) else None}
        if profile.endswith(('-v10', '-v11', '-v12')):
            result['access'] = metadata['constantAccesses'][0]
        if profile.endswith('-v12'):
            result['constraint'] = metadata['constantConstraints'][0]
        observe(entry['name'], metadata, entry['stage'], result)

    def failure(message):
        return {'ok': False, 'error': {'code': 'shader-domain-error', 'message': message}}

    singles = [e for e in native['cases'] if e['name'] in ('eq-vertex', 'eq-fragment')]
    require([e['stage'] for e in singles] == ['vertex', 'fragment'], 'both profile13 consumer stages')
    for entry in singles:
        original, stage = entry['result']['metadata'], entry['stage']
        observe('valid13-' + stage, original, stage, {'ok': True, 'domain': None})
        for key, message in MESSAGES.items():
            for value in ([], None, {}, 0, False):
                metadata = dict(original, **{key: value})
                observe('forbidden13-' + key, metadata, stage, failure(message))
        observe('unknown14', dict(original, profile='virgl-webgl2-raw-bits-v14'), stage,
                failure('Unknown shader profile.'))
        observe('owned13', original, stage, {'ok': True, 'domain': None})
    return checks


def verify(directory, head, native):
    directory = Path(directory)
    report = read(directory / 'report.json')
    require(type(report) is dict and set(report) ==
            {'schema', 'status', 'checks', 'getters', 'sources'}, 'closed consumer report')
    require(report['schema'] == 'raw-equality-consumer-v1' and report['status'] == 'passed',
            'completed current consumer recording')
    require(type(report['getters']) is int and report['getters'] == 0,
            'actual typed zero invoked getters')
    require(same(report['checks'], expected_checks(native)),
            'complete ordered source-bound consumer metadata/results and literal negative cases')
    require(same(report['sources'], [binding(ROOT / path) for path in SOURCES]),
            'complete exact consumer runtime/harness source inventory')
    for item in report['sources']:
        source(item, head)
    verify_coverage(directory, native, len(report['checks']))
    return report


def verify_coverage(directory, native, count):
    files = list((Path(directory) / 'v8').glob('*.json'))
    require(files, 'actual consumer V8 counters')
    scripts = [script for path in files for script in read(path)['result']
               if script['url'] in [(ROOT / name).as_uri() for name in SOURCES]]
    require(len(scripts) == 2 and len({script['url'] for script in scripts}) == 2,
            'exact recorded consumer runtime and harness modules')
    selected = {}
    for script in scripts:
        require(set(script) == {'scriptId', 'url', 'functions'}, 'closed consumer V8 script')
        name = next(name for name in SOURCES if (ROOT / name).as_uri() == script['url'])
        text = (ROOT / name).read_text()
        units = len(text.encode('utf-16-le')) // 2
        require(type(script['functions']) is list and script['functions'],
                'actual consumer function coverage')
        for function in script['functions']:
            require(set(function) == {'functionName', 'ranges', 'isBlockCoverage'} and
                    type(function['functionName']) is str and
                    type(function['isBlockCoverage']) is bool and
                    type(function['ranges']) is list and function['ranges'],
                    'closed consumer V8 function')
            for region in function['ranges']:
                require(set(region) == {'startOffset', 'endOffset', 'count'} and
                        all(type(region[key]) is int and region[key] >= 0
                            for key in ('startOffset', 'endOffset', 'count')) and
                        region['startOffset'] <= region['endOffset'] <= units,
                        'typed bounded consumer V8 counters')
        selected[name] = script
    runtime = selected[SOURCES[0]]['functions']
    parses = [f['ranges'][0]['count'] for f in runtime
              if f['functionName'] == 'parseConstantDomain']
    # The ledger includes one of two unknown14 calls; accessor tests and loop
    # bank checks are executed but not serialized as JSON metadata checks.
    loops = sum(e['name'].startswith('loop-equality') for e in native['cases'])
    require(parses == [count + 6 + 2 + loops], 'complete exact consumer parse call schedule')
    harness = selected[SOURCES[1]]['functions']
    text = (ROOT / SOURCES[1]).read_text()
    require(text.count(GETTER) == 1, 'unique actual throwing getter source')
    start = len(text[:text.index(GETTER)].encode('utf-16-le')) // 2
    end = start + len(GETTER.encode('utf-16-le')) // 2
    getters = [f for f in harness if f['functionName'] == 'get']
    require(len(getters) == 1 and same(getters[0]['ranges'],
            [{'startOffset': start, 'endOffset': end, 'count': 0}]),
            'actual source-bound getter counter remains exactly zero')
