#!/usr/bin/env python3
"""Fresh incremental critic: reproduce F1–F3 and attack the repaired predicates."""
import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def exact(left, right):
    return json.dumps(left, sort_keys=True, separators=(',', ':'), allow_nan=False) == \
        json.dumps(right, sort_keys=True, separators=(',', ':'), allow_nan=False)


def read(path):
    return json.loads(path.read_bytes())


def bind(path, root):
    raw = path.read_bytes()
    return dict(path=str(path.relative_to(root)), bytes=len(raw), sha256=sha(raw))


def overlay(source, target):
    target.mkdir()
    for path in source.iterdir():
        if path.name in ('native', 'wasm', 'consumer', 'v8') and path.is_dir():
            overlay(path, target / path.name)
        else:
            (target / path.name).symlink_to(path)


def replace(path, value):
    path.unlink()
    path.write_text(json.dumps(value, indent=2) + '\n')


def independent_checks(native):
    """Literal task obligations; do not call the parser or worker reconstruction."""
    checks = []
    entries = [entry for group in ('raw', 'integer', 'float', 'numeric', 'component',
               'dot', 'constant', 'structured', 'indirect', 'loop')
               for entry in native[group + 'Cases']] + native['cases']
    for entry in entries:
        if entry['result']['ok']:
            md = copy.deepcopy(entry['result']['metadata'])
            number = int(md['profile'].rsplit('-v', 1)[1])
            result = {'ok': True, 'domain': md['constantDomains'][0]
                      if number in (7, 9, 11, 12) else None}
            if number in (10, 11, 12):
                result['access'] = md['constantAccesses'][0]
            if number == 12:
                result['constraint'] = md['constantConstraints'][0]
            checks.append(dict(name=entry['name'], stage=entry['stage'], metadata=md, result=result))
    messages = (
        ('constantDomains', 'Unconditional shader profile carries a conditional contract.'),
        ('constantAccesses', 'Shader profile forbids a constant access contract.'),
        ('constantConstraints', 'Shader profile forbids a constant count constraint.'),
    )
    for stage in ('vertex', 'fragment'):
        md = copy.deepcopy(next(entry['result']['metadata'] for entry in native['cases']
                                if entry['name'] == 'eq-' + stage))

        def append(name, metadata, result):
            checks.append(dict(name=name, stage=stage, metadata=copy.deepcopy(metadata),
                               result=copy.deepcopy(result)))

        append('valid13-' + stage, md, {'ok': True, 'domain': None})
        for key, message in messages:
            for value in ([], None, {}, 0, False):
                append('forbidden13-' + key, dict(md, **{key: value}),
                       {'ok': False, 'error': {'code': 'shader-domain-error', 'message': message}})
        append('unknown14', dict(md, profile='virgl-webgl2-raw-bits-v14'),
               {'ok': False, 'error': {'code': 'shader-domain-error',
                                      'message': 'Unknown shader profile.'}})
        append('owned13', md, {'ok': True, 'domain': None})
    return checks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--evidence', required=True, type=Path)
    parser.add_argument('--head', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    root, evidence = args.root.resolve(), args.evidence.resolve()
    local_modules, lines = set(), {}
    watched = {str(root / 'tools/virgl-raw-equality' / name) for name in
               ('native_receipt.py', 'consumer_receipt.py', 'receipt.py')}
    original_spec = importlib.util.spec_from_file_location

    def imported(name, path, *extra, **kwargs):
        path = Path(path).resolve()
        if path.is_relative_to(root):
            local_modules.add(str(path.relative_to(root)))
        return original_spec(name, path, *extra, **kwargs)

    def trace(frame, event, arg):
        if frame.f_code.co_filename not in watched:
            return None
        if event == 'line':
            path = str(Path(frame.f_code.co_filename).relative_to(root))
            key = path + ':' + str(frame.f_lineno)
            lines[key] = lines.get(key, 0) + 1
        return trace

    importlib.util.spec_from_file_location = imported
    sys.settrace(trace)
    sys.path.insert(0, str(root / 'tools/virgl-raw-equality'))
    import native_receipt
    import consumer_receipt
    import receipt
    original = read(evidence / 'receipt.json')
    assert original['gitHead'] == args.head
    actual = receipt.verify(evidence, args.head)
    assert exact(actual, original), 'clean exact full control'
    native = read(evidence / 'native/native-report.json')
    assert exact(native_receipt.verify(evidence / 'native', args.head), native)
    consumer = read(evidence / 'consumer/report.json')
    expected_checks = independent_checks(native)
    assert len(expected_checks) == 2535 and exact(expected_checks, consumer['checks'])
    stages = [entry for key in ['originals', 'cases'] + [g[0] + 'Cases' for g in native_receipt.producer.GROUPS]
              for entry in native[key]]
    pairs = [entry for key in ['pairs'] + [g[0] + 'Pairs' for g in native_receipt.producer.GROUPS]
             for entry in native[key]]
    maxima = dict(singleResultBytes=max(entry['resultBytes'] for entry in stages),
                  pairResultBytes=max(entry['resultBytes'] for entry in pairs),
                  stageGlslBytes=max(len(stage['glsl'].encode()) for entry in stages + pairs
                    if entry['result']['ok'] for stage in
                    ([entry['result']['vertex'], entry['result']['fragment']]
                     if 'vertex' in entry['result'] else [entry['result']])))
    assert exact(maxima, native['recordedMaxima'])
    exported = read(evidence / 'native/coverage.json')
    summaries = [dict(bind(Path(entry['filename']).resolve(), root), summary=entry['summary'])
                 for entry in exported['data'][0]['files']]
    assert exact(summaries, native['coverage']['sources'])
    binary = root / 'renderer/virgl-shader/build/raw-equality-sanitize/raw-equality-test'
    assert sha(binary.read_bytes()) == native['binarySha256']
    cov = subprocess.check_output(['xcrun', '--find', 'llvm-cov']).decode().strip()
    command = [cov, 'export', str(binary), '-instr-profile=' + str(evidence / 'native/native.profdata'),
               str(root / 'renderer/virgl-shader/bridge.c'), str(root / 'renderer/virgl-shader/raw_bits.c')]
    assert subprocess.check_output(command) == (evidence / 'native/coverage.json').read_bytes()
    results, sensitivity = [], []

    def attack(name, mutation, auditor='native', sabotaged=None):
        with tempfile.TemporaryDirectory(prefix='raw-equality-fresh-response-') as temporary:
            candidate = Path(temporary) / 'evidence'
            overlay(evidence, candidate)
            mutation(candidate)
            outcome = dict(name=name, auditor=auditor)
            try:
                (receipt.verify(candidate, args.head) if auditor == 'full' else
                 native_receipt.verify(candidate / 'native', args.head))
            except (ValueError, KeyError, TypeError) as error:
                outcome.update(rejected=True, error=str(error), exception=type(error).__name__)
            else:
                outcome['rejected'] = False
            (sensitivity if sabotaged else results).append(outcome)
            assert outcome['rejected'] is (not bool(sabotaged)), outcome

    def native_change(mutation, propagate=False):
        def change(folder):
            value = copy.deepcopy(native)
            mutation(value)
            replace(folder / 'native/native-report.json', value)
            if propagate:
                wasm = read(folder / 'wasm/report.json')
                raw = (folder / 'native/native-report.json').read_bytes()
                wasm['nativeReport'].update(bytes=len(raw), sha256=sha(raw))
                replace(folder / 'wasm/report.json', wasm)
        return change

    native_mutations = []
    for field in maxima:
        for kind, value in [('bool', True), ('float', float(maxima[field])),
                            ('smaller', 1), ('larger', maxima[field] + 1)]:
            native_mutations.append((field + '-' + kind,
                lambda r, f=field, v=value: r['recordedMaxima'].__setitem__(f, v)))
    native_mutations += [
        ('missing-maximum', lambda r: r['recordedMaxima'].pop('stageGlslBytes')),
        ('extra-maximum', lambda r: r['recordedMaxima'].__setitem__('invented', 1)),
        ('empty-native-sources', lambda r: r.__setitem__('sources', [])),
        ('duplicate-native-source', lambda r: r['sources'].append(copy.deepcopy(r['sources'][0]))),
        ('reverse-native-sources', lambda r: r['sources'].reverse()),
        ('empty-coverage-sources', lambda r: r['coverage'].__setitem__('sources', [])),
        ('duplicate-coverage-source', lambda r: r['coverage']['sources'].append(copy.deepcopy(r['coverage']['sources'][0]))),
        ('reverse-coverage-sources', lambda r: r['coverage']['sources'].reverse()),
        ('invented-coverage-path', lambda r: r['coverage']['sources'][0].__setitem__('path', 'invented/source.c')),
        ('wrong-coverage-digest', lambda r: r['coverage']['sources'][0].__setitem__('sha256', '0' * 64)),
        ('wrong-coverage-bytes', lambda r: r['coverage']['sources'][0].__setitem__('bytes', 1)),
        ('wrong-coverage-summary', lambda r: r['coverage']['sources'][0]['summary']['lines'].__setitem__('covered', 0)),
        ('bool-coverage-summary', lambda r: r['coverage']['sources'][0]['summary']['lines'].__setitem__('covered', False)),
        ('float-coverage-summary', lambda r: r['coverage']['sources'][0]['summary']['lines'].__setitem__('covered', 0.0)),
    ]
    for name, mutate in native_mutations:
        attack(name, native_change(mutate))
    for name, mutate in native_mutations:
        if name in ('stageGlslBytes-bool', 'stageGlslBytes-float', 'stageGlslBytes-smaller',
                    'stageGlslBytes-larger', 'empty-native-sources', 'empty-coverage-sources',
                    'wrong-coverage-summary', 'wrong-coverage-digest'):
            attack('propagated-' + name, native_change(mutate, True), 'full')

    def consumer_change(mutation):
        def change(folder):
            value = read(folder / 'consumer/report.json')
            mutation(value)
            replace(folder / 'consumer/report.json', value)
        return change

    consumer_mutations = [
        ('empty-consumer-checks', lambda r: r.__setitem__('checks', [])),
        ('omitted-negative-consumer-checks', lambda r: r.__setitem__('checks', [e for e in r['checks']
            if not e['name'].startswith(('forbidden13-', 'unknown14'))])),
        ('duplicate-consumer-check', lambda r: r['checks'].__setitem__(0, copy.deepcopy(r['checks'][1]))),
        ('reverse-consumer-checks', lambda r: r['checks'].reverse()),
        ('wrong-consumer-name', lambda r: r['checks'][0].__setitem__('name', 'forged')),
        ('wrong-consumer-stage', lambda r: r['checks'][0].__setitem__('stage', 'forged')),
        ('wrong-consumer-metadata', lambda r: r['checks'][0]['metadata'].__setitem__('profile', 'virgl-webgl2-raw-bits-v14')),
        ('wrong-consumer-result', lambda r: r['checks'][0]['result'].__setitem__('domain', {})),
        ('consumer-numeric-boolean', lambda r: r['checks'][0]['result'].__setitem__('ok', 1)),
        ('empty-consumer-sources', lambda r: r.__setitem__('sources', [])),
        ('duplicate-consumer-source', lambda r: r['sources'].append(copy.deepcopy(r['sources'][0]))),
        ('reverse-consumer-sources', lambda r: r['sources'].reverse()),
        ('consumer-extra-field', lambda r: r.__setitem__('invented', 0)),
        ('consumer-wrong-schema', lambda r: r.__setitem__('schema', 'unknown')),
        ('consumer-getters-bool', lambda r: r.__setitem__('getters', False)),
        ('consumer-getters-float', lambda r: r.__setitem__('getters', 0.0)),
        ('consumer-getters-invoked', lambda r: r.__setitem__('getters', 1)),
    ]
    for name, mutate in consumer_mutations:
        attack(name, consumer_change(mutate), 'full')
    v8paths = sorted((evidence / 'consumer/v8').glob('*.json'))
    assert len(v8paths) == 1, 'one actual consumer Node V8 capture'
    v8relative = v8paths[0].relative_to(evidence)
    captured = read(v8paths[0])
    harness_url = (root / 'tools/virgl-raw-equality/consumer.mjs').as_uri()
    runtime_url = (root / 'renderer/virgl-command/constant-domain.mjs').as_uri()

    def function(value, url, name):
        return next(f for script in value['result'] if script['url'] == url
                    for f in script['functions'] if f['functionName'] == name)

    def v8_change(mutation):
        def change(folder):
            value = copy.deepcopy(captured)
            mutation(value)
            replace(folder / v8relative, value)
        return change

    parse_count = function(captured, runtime_url, 'parseConstantDomain')['ranges'][0]['count']
    expected_parse_count = len(expected_checks) + 8 + sum(e['name'].startswith('loop-equality') for e in native['cases'])
    assert type(parse_count) is int and parse_count == expected_parse_count == 2545
    getter = function(captured, harness_url, 'get')
    text = (root / 'tools/virgl-raw-equality/consumer.mjs').read_text()
    literal = "get(){getters++;throw new Error('invoked');}"
    start = len(text[:text.index(literal)].encode('utf-16-le')) // 2
    assert exact(getter['ranges'], [dict(startOffset=start, endOffset=start + len(literal), count=0)])
    coverage_mutations = [
        ('omitted-runtime-V8', lambda r: r.__setitem__('result', [s for s in r['result'] if s['url'] != runtime_url])),
        ('omitted-harness-V8', lambda r: r.__setitem__('result', [s for s in r['result'] if s['url'] != harness_url])),
        ('duplicated-runtime-V8', lambda r: r['result'].append(copy.deepcopy(next(s for s in r['result'] if s['url'] == runtime_url)))),
        ('missing-parse-function', lambda r: next(s for s in r['result'] if s['url'] == runtime_url).__setitem__('functions',
            [f for f in next(s for s in r['result'] if s['url'] == runtime_url)['functions'] if f['functionName'] != 'parseConstantDomain'])),
        ('wrong-parse-schedule', lambda r: function(r, runtime_url, 'parseConstantDomain')['ranges'][0].__setitem__('count', parse_count - 1)),
        ('float-parse-counter', lambda r: function(r, runtime_url, 'parseConstantDomain')['ranges'][0].__setitem__('count', float(parse_count))),
        ('bool-getter-counter', lambda r: function(r, harness_url, 'get')['ranges'][0].__setitem__('count', False)),
        ('float-getter-counter', lambda r: function(r, harness_url, 'get')['ranges'][0].__setitem__('count', 0.0)),
        ('invoked-getter-counter', lambda r: function(r, harness_url, 'get')['ranges'][0].__setitem__('count', 1)),
        ('wrong-getter-offset', lambda r: function(r, harness_url, 'get')['ranges'][0].__setitem__('startOffset', start + 1)),
        ('float-getter-offset', lambda r: function(r, harness_url, 'get')['ranges'][0].__setitem__('startOffset', float(start))),
        ('unbounded-getter-offset', lambda r: function(r, harness_url, 'get')['ranges'][0].__setitem__('endOffset', len(text.encode('utf-16-le')) // 2 + 1)),
    ]
    for name, mutate in coverage_mutations:
        attack(name, v8_change(mutate), 'full')

    def coordinated_omission(folder):
        ledger = read(folder / 'consumer/report.json')
        victim = next(i for i, entry in enumerate(ledger['checks'])
                      if entry['name'].startswith('forbidden13-'))
        del ledger['checks'][victim]
        replace(folder / 'consumer/report.json', ledger)
        counters = copy.deepcopy(captured)
        function(counters, runtime_url, 'parseConstantDomain')['ranges'][0]['count'] -= 1
        replace(folder / v8relative, counters)

    attack('coordinated-consumer-omission-and-V8-schedule', coordinated_omission, 'full')

    # Isolate the new predicates in memory; tracked worker sources stay exact.
    for predicate, label in [('verify_maxima', 'stageGlslBytes-bool'),
                             ('verify_sources', 'empty-native-sources'),
                             ('verify_coverage_sources', 'empty-coverage-sources')]:
        saved = getattr(native_receipt, predicate)
        try:
            setattr(native_receipt, predicate, lambda *_: None)
            mutate = next(m for n, m in native_mutations if n == label)
            attack('disabled-' + predicate, native_change(mutate, True), 'full', sabotaged=True)
        finally:
            setattr(native_receipt, predicate, saved)
    saved = consumer_receipt.expected_checks
    try:
        forged_checks = copy.deepcopy(consumer['checks'])
        forged_checks[0]['name'] = 'forged'
        consumer_receipt.expected_checks = lambda _: forged_checks
        mutate = next(m for n, m in consumer_mutations if n == 'wrong-consumer-name')
        attack('disabled-exact-consumer-ledger', consumer_change(mutate), 'full', sabotaged=True)
    finally:
        consumer_receipt.expected_checks = saved
    for message, label, kind in [
        ('actual typed zero invoked getters', 'consumer-getters-bool', 'consumer'),
        ('complete exact consumer parse call schedule', 'wrong-parse-schedule', 'v8'),
        ('actual source-bound getter counter remains exactly zero', 'invoked-getter-counter', 'v8'),
    ]:
        saved = consumer_receipt.require
        try:
            consumer_receipt.require = lambda okay, text, skip=message: saved(okay, text) if text != skip else None
            candidates = consumer_mutations if kind == 'consumer' else coverage_mutations
            mutate = next(m for n, m in candidates if n == label)
            change = consumer_change(mutate) if kind == 'consumer' else v8_change(mutate)
            attack('disabled-' + label, change, 'full', sabotaged=True)
        finally:
            consumer_receipt.require = saved
    assert exact(receipt.verify(evidence, args.head), original), 'restored final clean full control'
    sys.settrace(None)
    for module in list(sys.modules.values()):
        if getattr(module, '__name__', None) != '__main__' and getattr(module, '__file__', None):
            path = Path(module.__file__).resolve()
            if path.is_file() and path.is_relative_to(root):
                local_modules.add(str(path.relative_to(root)))
    assert local_modules <= {item['path'] for item in original['sources']}, 'actual imported proof source closure'
    for item in original['sources']:
        assert exact(bind(root / item['path'], root), item)
        assert (root / item['path']).read_bytes() == subprocess.check_output(
            ['git', 'show', args.head + ':' + item['path']], cwd=root)
    for item in original['records']:
        assert exact(bind(evidence / item['path'], evidence), item)
    current_records = {str(path.relative_to(evidence)) for path in evidence.rglob('*')
                       if path.is_file() and path.name not in ('receipt.json', 'acceptance.log')}
    assert current_records == {item['path'] for item in original['records']}
    negative = read(evidence / 'negative-receipts.json')
    positive = read(evidence / 'positive-receipt.json')
    assert negative['gitHead'] == positive['gitHead'] == args.head
    assert negative['originalReceiptSha256'] == sha((evidence / 'positive-receipt.json').read_bytes())
    assert len(negative['checks']) == 38 and all(e['rejected'] is True for e in negative['checks'])
    # The saved positive receipt precedes sealing the two new negative/control records.
    stripped = copy.deepcopy(original)
    stripped['records'] = [e for e in stripped['records'] if e['path'] not in
                           ('negative-receipts.json', 'positive-receipt.json')]
    assert exact(stripped, positive)
    output = dict(schema='fresh-raw-equality-response-audit-v1', status='passed', head=args.head,
                  evidence=str(evidence), receipt=bind(evidence / 'receipt.json', evidence),
                  cleanControls='passed', maxima=maxima, consumerChecks=len(expected_checks),
                  parseCalls=parse_count, getterRange=getter['ranges'],
                  llvmReexport=dict(command=command, sha256=sha((evidence / 'native/coverage.json').read_bytes()), exact=True),
                  loadedModules=sorted(local_modules), sourceBindings=len(original['sources']),
                  recordBindings=len(original['records']), promotedChecks=len(negative['checks']),
                  attacks=results, sensitivity=sensitivity, tracedLines=lines)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps({k: v for k, v in output.items() if k not in ('attacks', 'tracedLines')}, indent=2))


if __name__ == '__main__':
    main()
