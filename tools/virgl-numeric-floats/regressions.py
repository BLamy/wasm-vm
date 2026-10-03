#!/usr/bin/env python3
"""Recheck the complete unchanged ordered-float gate's recorded data.

The nested gate includes all retained raw/integer, bank, constant and asynchronous
oracles. This successor adds no historical migration and never substitutes a
printed receipt status for re-executing its independent recorded-data checks.
"""
from __future__ import annotations
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HELD_HEAD = '59f1b924286af70096d9fb19fbdb35b9ec2ed7a1'
HELPERS = ['tools/virgl-constants/receipt.py', 'tools/virgl-float-masks/receipt.py',
           'tools/virgl-float-masks/native_receipt.py', 'tools/virgl-float-masks/regressions.py']


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


base = load('numeric_regression_base', HELPERS[0])
ordered = load('numeric_regression_ordered', HELPERS[1])
native_gate = load('numeric_regression_native', HELPERS[2])
prior_gate = load('numeric_regression_prior', HELPERS[3])
require, sha, read, binding = base.require, base.sha, base.read, base.binding


def verify(output, head, contract):
    output = Path(output)
    directory = output / 'float-regression'
    receipt = read(directory / 'receipt.json')
    require(receipt['task'] == 'E6-T12e4c1' and receipt['status'] == 'passed' and receipt['gitHead'] == head
            and receipt['production'] == contract['production']
            and receipt['shaderOutcomes'] == {'translated': 12, 'unsupported-feature': 7},
            'complete current-head ordered-float regression receipt')
    base.verify_records(directory, receipt)
    for source in receipt['sources']:
        base.verify_source(source, head)
    native, fixtures, hardware, cases, pairs, originals = native_gate.verify_native(directory, head)
    modes = ['unordered-guard', 'signed-zero', 'negative-order']
    reports = [base.verify_browser(directory / 'hardware', head, contract, task='E6-T12e4c1')]
    reports += [base.verify_browser(directory / ('sabotage-' + mode), head, contract,
                                   passed=False, task='E6-T12e4c1') for mode in modes]
    for report in reports:
        ordered.translations(report['acceptance'], fixtures, hardware, cases, pairs, originals)
        require(report['acceptance']['operationDefinitions'] == hardware['operationDefinitions'],
                'unchanged authored ordered operations')
        ordered.verify_finite(report['acceptance'], hardware, cases)
    pixels = ordered.verify_gpu(reports[0]['acceptance'], hardware, cases, pairs)
    for mode, report in zip(modes, reports[1:]):
        ordered.verify_sabotage(report['acceptance'], cases, hardware, mode)
    prior = prior_gate.verify(directory, head, contract)
    require(receipt['orderedWords'] == 768 and receipt['finiteSelections'] == 24
            and receipt['interpolationPixels'] == pixels == 37696
            and receipt['profiles'] == [ordered.LEGACY, ordered.RAW, ordered.INTEGER, ordered.ORDERED]
            and receipt['regressions'] == {key: value for key, value in prior.items() if key != 'sources'},
            'nested receipt derived counts and prior proof agree with independent recheck')
    wasm_path = ROOT / 'renderer/virgl-shader/build/wasm/virgl-shader.wasm'
    require(receipt['compilerSha256'] == {'nativeSanitizer': native['binarySha256'], 'wasm': sha(wasm_path.read_bytes())},
            'all nested proof uses the current compiler binaries')
    unchanged = HELPERS + ['tools/virgl-float-masks/native.py', 'tools/verify-virgl-float-masks.sh',
                            'tools/verify-virgl-float-masks.mjs', 'renderer/virgl-shader/tests/float-masks.mjs',
                            'renderer/virgl-shader/native_tests/float_masks.c',
                            'renderer/virgl-shader/tests/float-mask-cases.json',
                            'renderer/virgl-shader/tests/float-mask-hardware.json']
    for path in unchanged:
        require(base.git('show', f'{HELD_HEAD}:{path}') == (ROOT / path).read_bytes(),
                'prior gate implementation and fixtures unchanged')
    names = {source['path'] for source in receipt['sources'] + prior['sources']}
    names.update(unchanged + ['tools/virgl-numeric-floats/regressions.py'])
    sources = []
    for path in sorted(names):
        if '/build/' not in path:
            item = binding(ROOT / path)
            base.verify_source(item, head)
            sources.append(item)
    return {'heldOrderedHead': HELD_HEAD, 'recordedHead': head,
            'boundary': 'Complete unchanged ordered-float gate, including its prior raw/integer and legacy gates, rechecked from recorded data.',
            'orderedCases': len(cases), 'orderedPairs': len(pairs), 'orderedWords': 768,
            'orderedFiniteSelections': 24, 'orderedInterpolationPixels': pixels,
            'receipt': binding(directory / 'receipt.json', output),
            'reports': [binding(directory / name / 'report.json', output) for name in
                        ('hardware', *['sabotage-' + mode for mode in modes])],
            'prior': {key: value for key, value in prior.items() if key != 'sources'}, 'sources': sources}
