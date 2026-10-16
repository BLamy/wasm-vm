#!/usr/bin/env python3
"""Promote the fresh critic's proof forgeries, with clean full-auditor controls."""
import argparse
import copy
import json
from pathlib import Path
import tempfile
import native_receipt
import receipt
from shared import binding, read, require, same, sha


def fork_recording(original, target):
    """Keep every unaltered byte; copy only ancestors of changed JSON records."""
    target.mkdir()
    for path in original.iterdir():
        if path.name in ('native', 'wasm', 'consumer', 'v8') and path.is_dir():
            fork_recording(path, target / path.name)
        else:
            (target / path.name).symlink_to(path)


def replace(path, value):
    path.unlink()
    path.write_text(json.dumps(value, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    evidence = args.evidence.resolve()
    original = read(evidence / 'receipt.json')
    head = original['gitHead']
    require(same(receipt.verify(evidence, head), original),
            'untouched full receipt must regenerate before any negative assertion')
    native = read(evidence / 'native/native-report.json')
    require(same(native_receipt.verify(evidence / 'native', head), native),
            'untouched native control must pass')
    results = []

    def attack(name, mutate, full=False):
        with tempfile.TemporaryDirectory(prefix='raw-equality-proof-attack-') as temporary:
            folder = Path(temporary) / 'recording'
            fork_recording(evidence, folder)
            mutate(folder)
            try:
                (receipt.verify(folder, head) if full else
                 native_receipt.verify(folder / 'native', head))
            except (ValueError, KeyError, TypeError) as error:
                results.append(dict(name=name, rejected=True, error=str(error),
                                    auditor='full' if full else 'native'))
            else:
                raise ValueError('promoted proof forgery escaped: ' + name)

    def native_forgery(mutate, propagate=False):
        def change(folder):
            candidate = copy.deepcopy(native)
            mutate(candidate)
            replace(folder / 'native/native-report.json', candidate)
            if propagate:
                candidate_wasm = read(folder / 'wasm/report.json')
                raw = (folder / 'native/native-report.json').read_bytes()
                candidate_wasm['nativeReport'].update(bytes=len(raw), sha256=sha(raw))
                replace(folder / 'wasm/report.json', candidate_wasm)
        return change

    mutations = []
    for field in ('singleResultBytes', 'pairResultBytes', 'stageGlslBytes'):
        for kind, value in [('bool', True), ('float', float(native['recordedMaxima'][field])),
                            ('incorrect-integer', 1)]:
            mutations.append(('recordedMaxima-' + field + '-' + kind,
                              lambda r, f=field, v=value: r['recordedMaxima'].__setitem__(f, v)))
    mutations += [
        ('missing-maxima-field', lambda r: r['recordedMaxima'].pop('stageGlslBytes')),
        ('omitted-native-sources', lambda r: r.__setitem__('sources', [])),
        ('omitted-coverage-sources', lambda r: r['coverage'].__setitem__('sources', [])),
        ('wrong-coverage-digest', lambda r: r['coverage']['sources'][0].__setitem__('sha256', '0' * 64)),
        ('wrong-coverage-bytes', lambda r: r['coverage']['sources'][0].__setitem__('bytes', 1)),
        ('invented-coverage-path', lambda r: r['coverage']['sources'][0].__setitem__('path', 'invented/coverage.c')),
        ('wrong-coverage-summary', lambda r: r['coverage']['sources'][0]['summary']['lines'].__setitem__('covered', 0)),
        ('boolean-coverage-counter', lambda r: r['coverage']['sources'][0]['summary']['lines'].__setitem__('covered', False)),
        ('float-layout-bound', lambda r: r['layout'].__setitem__('rawIrBytes', 26352.0)),
        ('float-call-statistic', lambda r: r['stats'].__setitem__('calls', 602100.0)),
    ]
    for name, mutate in mutations:
        attack(name, native_forgery(mutate))
    # Propagate the honest byte length/digest into the counterpart so rejection
    # cannot be attributed to an incidental stale cross-link.
    full_names = {'recordedMaxima-stageGlslBytes-bool',
                  'recordedMaxima-stageGlslBytes-float',
                  'recordedMaxima-stageGlslBytes-incorrect-integer',
                  'omitted-native-sources', 'omitted-coverage-sources',
                  'wrong-coverage-summary', 'wrong-coverage-digest'}
    for name, mutate in mutations:
        if name in full_names:
            attack('propagated-' + name, native_forgery(mutate, True), True)

    def consumer_forgery(mutate):
        def change(folder):
            candidate = read(folder / 'consumer/report.json')
            mutate(candidate)
            replace(folder / 'consumer/report.json', candidate)
        return change

    for name, mutate in [
        ('consumer-float-getters', lambda r: r.__setitem__('getters', 0.0)),
        ('consumer-boolean-getters', lambda r: r.__setitem__('getters', False)),
        ('consumer-missing-checks', lambda r: r.__setitem__('checks', [])),
        ('consumer-missing-negative-checks', lambda r: r.__setitem__('checks', [e for e in r['checks']
            if not e['name'].startswith(('forbidden13-', 'unknown14'))])),
        ('consumer-missing-sources', lambda r: r.__setitem__('sources', [])),
        ('consumer-extra-schema-field', lambda r: r.__setitem__('extra', 1)),
        ('consumer-wrong-schema', lambda r: r.__setitem__('schema', 'unknown')),
        ('consumer-boolean-result-as-integer', lambda r: r['checks'][0]['result'].__setitem__('ok', 1)),
        ('consumer-reordered-checks', lambda r: r['checks'].reverse()),
    ]:
        attack(name, consumer_forgery(mutate), True)

    coverage_path = next((evidence / 'consumer/v8').glob('*.json'))

    def getter_forgery(value):
        def change(folder):
            path = folder / coverage_path.relative_to(evidence)
            candidate = read(path)
            functions = [f for script in candidate['result']
                         if script['url'].endswith('/tools/virgl-raw-equality/consumer.mjs')
                         for f in script['functions'] if f['functionName'] == 'get']
            require(len(functions) == 1, 'unique actual getter negative control')
            functions[0]['ranges'][0]['count'] = value
            replace(path, candidate)
        return change

    for name, value in [('boolean', False), ('float', 0.0), ('invoked', 1)]:
        attack('consumer-V8-getter-' + name, getter_forgery(value), True)
    require(same(receipt.verify(evidence, head), original),
            'positive full control must remain unchanged after all forgeries')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dict(schema='raw-equality-negative-receipts-v1',
        status='passed', gitHead=head, cleanControls='passed',
        nativeReport=binding(evidence / 'native/native-report.json', evidence),
        originalReceiptSha256=sha((evidence / 'receipt.json').read_bytes()),
        checks=results), indent=2) + '\n')
    print(f'All {len(results)} promoted native/full proof forgeries rejected; clean controls pass.')


if __name__ == '__main__':
    main()
