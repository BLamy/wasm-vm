#!/usr/bin/env python3
"""Fresh critic: independent, redigested receipt type/observation attacks."""
import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile

HEAD = 'a7be954c1f3bea9dd1e96522e890fa012197c6fe'


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--clone', required=True, type=Path)
    parser.add_argument('--evidence', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--expect-rejected', action='store_true')
    args = parser.parse_args()
    sys.path.insert(0, str(args.clone / 'tools/virgl-raw-equality'))
    import native_receipt
    import wasm_receipt
    import receipt

    native_folder = args.evidence / 'native'
    report_path = native_folder / 'native-report.json'
    native = json.loads(report_path.read_bytes())
    base = native_receipt.verify(native_folder, HEAD)
    assert base == native
    attacks = []

    def run(label, mutate):
        candidate = copy.deepcopy(native)
        with tempfile.TemporaryDirectory(prefix='equality-critic-receipt-') as temporary:
            folder = Path(temporary)
            for path in native_folder.iterdir():
                if path.name != 'native-report.json':
                    (folder / path.name).symlink_to(path)
            mutate(candidate)
            (folder / 'native-report.json').write_text(json.dumps(candidate, indent=2) + '\n')
            try:
                accepted = native_receipt.verify(folder, HEAD)
            except Exception as error:
                attacks.append({'attack': label, 'rejected': True,
                                'error': str(error), 'exception': type(error).__name__})
            else:
                attacks.append({'attack': label, 'rejected': False,
                                'forgedMaxima': accepted['recordedMaxima'],
                                'forgedCoverageSources': accepted['coverage']['sources']})

    for field in ('singleResultBytes', 'pairResultBytes', 'stageGlslBytes'):
        for kind, value in [('bool', True), ('float', float(native['recordedMaxima'][field])),
                            ('incorrect-integer', 1)]:
            run('recordedMaxima-' + field + '-' + kind,
                lambda candidate, f=field, v=value: candidate['recordedMaxima'].__setitem__(f, v))
    run('omitted-native-source-inventory', lambda candidate: candidate.__setitem__('sources', []))
    run('omitted-coverage-source-inventory', lambda candidate: candidate['coverage'].__setitem__('sources', []))
    run('incorrect-coverage-source-digest', lambda candidate: candidate['coverage']['sources'][0].__setitem__('sha256', '0' * 64))
    run('incorrect-coverage-source-byte-length', lambda candidate: candidate['coverage']['sources'][0].__setitem__('bytes', 1))
    run('invented-coverage-source-name', lambda candidate: candidate['coverage']['sources'][0].__setitem__('path', 'invented/coverage.c'))
    run('incorrect-coverage-source-summary', lambda candidate: candidate['coverage']['sources'][0]['summary']['lines'].__setitem__('covered', 0))
    run('boolean-source-summary-counter', lambda candidate: candidate['coverage']['sources'][0]['summary']['lines'].__setitem__('covered', False))
    run('float-layout-bound', lambda candidate: candidate['layout'].__setitem__('rawIrBytes', 26352.0))
    run('float-native-statistic', lambda candidate: candidate['stats'].__setitem__('calls', 602100.0))
    stage_keys = ['originals', 'cases'] + [g[0] + 'Cases' for g in native_receipt.producer.GROUPS]
    pair_keys = ['pairs'] + [g[0] + 'Pairs' for g in native_receipt.producer.GROUPS]
    actual_maxima = {'singleResultBytes': max(e['resultBytes'] for key in stage_keys for e in native[key]),
                     'pairResultBytes': max(e['resultBytes'] for key in pair_keys for e in native[key]),
                     'stageGlslBytes': max(len(stage['glsl'].encode())
                     for key in stage_keys + pair_keys
                     for e in native[key] if e['result']['ok']
                     for stage in ([e['result']['vertex'], e['result']['fragment']]
                     if 'vertex' in e['result'] else [e['result']]))}
    assert actual_maxima == native['recordedMaxima']
    output = {'schema': 'fresh-raw-equality-receipt-attacks-v1', 'head': HEAD,
              'cleanControl': 'passed', 'inputSha256': digest(report_path.read_bytes()),
              'reconstructedActualMaxima': actual_maxima,
              'attacks': attacks,
              'rejected': sum(a['rejected'] for a in attacks),
              'acceptedForgeries': [a['attack'] for a in attacks if not a['rejected']]}
    full = receipt.verify(args.evidence, HEAD)
    assert full == json.loads((args.evidence / 'receipt.json').read_bytes())
    output['fullCleanControl'] = 'passed'
    full_attacks = []
    for label, target, mutate in [
        ('maxima-bool-full-submission', 'native/native-report.json',
         lambda r: r['recordedMaxima'].__setitem__('stageGlslBytes', True)),
        ('consumer-float-getter-count', 'consumer/report.json', lambda r: r.__setitem__('getters', 0.0)),
        ('consumer-boolean-getter-count', 'consumer/report.json', lambda r: r.__setitem__('getters', False)),
        ('consumer-missing-checks', 'consumer/report.json', lambda r: r.__setitem__('checks', [])),
        ('consumer-omitted-runtime-sources', 'consumer/report.json', lambda r: r.__setitem__('sources', [])),
        ('consumer-omitted-forbidden-and-v14', 'consumer/report.json',
         lambda r: r.__setitem__('checks', [e for e in r['checks']
           if not e['name'].startswith(('forbidden13-', 'unknown14'))])),
    ]:
        with tempfile.TemporaryDirectory(prefix='equality-critic-full-receipt-') as temporary:
            folder = Path(temporary)
            for child in args.evidence.iterdir():
                if child.is_dir() and target.startswith(child.name + '/'):
                    (folder / child.name).mkdir()
                    for path in child.iterdir():
                        if path.name != Path(target).name:
                            (folder / child.name / path.name).symlink_to(path)
                else:
                    (folder / child.name).symlink_to(child)
            value = json.loads((args.evidence / target).read_bytes())
            mutate(value)
            (folder / target).write_text(json.dumps(value, indent=2) + '\n')
            try:
                forged = receipt.verify(folder, HEAD)
            except Exception as error:
                full_attacks.append({'attack': label, 'rejected': True, 'error': str(error)})
            else:
                full_attacks.append({'attack': label, 'rejected': False,
                                    'nativeMaxima': forged['native']['recordedMaxima'],
                                    'consumer': forged['consumer']})
    output['fullSubmissionAttacks'] = full_attacks
    args.output.write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps({k:v for k,v in output.items() if k != 'attacks'}, indent=2))
    if args.expect_rejected:
        assert all(item['rejected'] for item in attacks + full_attacks), 'receipt accepted a promoted proof forgery'


if __name__ == '__main__':
    main()
