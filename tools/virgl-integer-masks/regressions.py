#!/usr/bin/env python3
"""Re-interrogate the complete E4a gate under the current integer-mask compiler.

Historical receipts remain unchanged. The three authored negative slots whose
opcode is now implemented are replaced only with adjacent unsupported UMUL;
the exact old inputs are retained as explicit E4b acceptance/parse-error cases.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HELD_HEAD = '98314e2ddb082cf372a46ab90871b7cfdb77d587'
HELD_NATIVE = 'evidence/virgl-raw-bits/worker/native/native-report.json'
HELD_SHA256 = 'cb39748e8786140e0fd5b0439c1407a302d9df353e5e0ecb9dec48dbd8ca2b7d'
HELPERS = ['tools/virgl-raw-bits/receipt.py', 'tools/virgl-raw-bits/regressions.py',
           'tools/virgl-integer-masks/regressions.py']


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


raw = load('integer_raw_regression', HELPERS[0])
legacy = load('integer_legacy_regression', HELPERS[1])
require, sha, read, binding, git = raw.require, raw.sha, raw.read, raw.binding, raw.git
verify_source, verify_records = raw.verify_source, raw.verify_records


def verify_migrations():
    """Only three named author-written fixtures may change across this boundary."""
    new_cases = read(ROOT / 'renderer/virgl-shader/tests/integer-mask-cases.json')
    migrations = []
    specifications = {
        'renderer/virgl-shader/tests/captured-invalid.json': {'integer-opcode-remains-rejected'},
        'renderer/virgl-shader/tests/bank-cases.json': {'vertex-unsupported-UADD', 'fragment-unsupported-UADD'},
    }
    for name, targets in specifications.items():
        old = json.loads(git('show', f'{HELD_HEAD}:{name}'))
        current = read(ROOT / name)
        require(len(old) == len(current), 'historical negative fixture count preserved')
        expected = []
        for entry in old:
            replacement = dict(entry)
            if entry['name'] in targets:
                require(entry['text'].count('UADD ') == 1, 'one exact migrated opcode')
                replacement['text'] = entry['text'].replace('UADD ', 'UMUL ')
                replacement['name'] = entry['name'].replace('-unsupported-UADD', '-unsupported-UMUL')
                promoted = [case for case in new_cases if case['stage'] == entry['stage'] and case['text'] == entry['text']]
                require(len(promoted) == 1, 'exact historical shader body retained in successor cases')
                case = promoted[0]
                captured = name.endswith('captured-invalid.json')
                require(case['ok'] is captured and case['expected'] == (
                        {'profile': 'virgl-webgl2-raw-bits-v2'} if captured else {'errorCode': 'parse-error'}),
                        'new explicit acceptance versus arity diagnostic')
                migrations.append({'source': name, 'oldName': entry['name'], 'replacementName': replacement['name'],
                                   'oldInputSha256': sha(entry['text'].encode('ascii')),
                                   'replacementInputSha256': sha(replacement['text'].encode('ascii')),
                                   'promotedCase': case['name'], 'expected': case['expected']})
            expected.append(replacement)
        require(current == expected, 'only exact three adjacent-opcode replacements authorized')
    require(len(migrations) == 3, 'complete named migration set')
    for name in ('renderer/virgl-shader/tests/component-cases.json', 'renderer/virgl-shader/tests/raw-bit-cases.json',
                 'renderer/virgl-shader/tests/raw-bit-hardware.json'):
        require((ROOT / name).read_bytes() == git('show', f'{HELD_HEAD}:{name}'), 'unchanged old unsafe-output and raw-profile inputs')
    return migrations


def verify(output, head, contract):
    output = Path(output)
    directory = output / 'raw-regression'
    receipt = read(directory / 'receipt.json')
    require(receipt['schema'] == 1 and receipt['task'] == 'E6-T12e4a' and receipt['status'] == 'passed' and
            receipt['gitHead'] == head and receipt['production'] == contract['production'] and
            receipt['profiles'] == ['virgl-webgl2-straight-line-v5', 'virgl-webgl2-raw-bits-v1'] and
            receipt['shaderOutcomes'] == {'translated': 12, 'unsupported-feature': 7}, 'complete current-head E4a regression')
    verify_records(directory, receipt)
    for source in receipt['sources']:
        verify_source(source, head)
    require(git('show', f'{HELD_HEAD}:{HELD_NATIVE}') == (ROOT / HELD_NATIVE).read_bytes() and
            sha((ROOT / HELD_NATIVE).read_bytes()) == HELD_SHA256, 'held E4a exact native baseline identity')
    held = read(ROOT / HELD_NATIVE)
    native, fixtures, hardware, cases, pairs, originals = raw.verify_native(directory, head)
    for key in ('cases', 'pairs', 'originals'):
        require(native[key] == held[key], 'every retained E4a native full result and input binding remains exact')
    require(receipt['compilerSha256'] == {
        'nativeSanitizer': native['binarySha256'],
        'wasm': sha((ROOT / 'renderer/virgl-shader/build/wasm/virgl-shader.wasm').read_bytes())},
        'regression consumed actual current compiler artifacts')
    browser = raw.base.verify_browser(directory / 'hardware', head, contract, task='E6-T12e4a')
    sabotage = raw.base.verify_browser(directory / 'sabotage', head, contract, passed=False, task='E6-T12e4a')
    for report in (browser, sabotage):
        raw.translations(report['acceptance'], fixtures, hardware, cases, pairs, originals)
    pixels = raw.verify_gpu(browser['acceptance'], hardware, cases, pairs)
    raw.verify_sabotage(sabotage['acceptance'], cases, hardware)
    nested = legacy.verify(directory, head, contract)
    require(receipt['rawWords'] == 480 and receipt['interpolationPixels'] == pixels == 14880 and
            receipt['regressions'] == {k: v for k, v in nested.items() if k != 'sources'}, 'recomputed raw and nested regression acceptance')
    successor = read(output / 'native/native-report.json')
    require(successor['schema'] == 'wasm-vm-integer-masks-native-v1' and successor['rawBaseline'] == binding(ROOT / HELD_NATIVE),
            'new sanitizer independently binds held raw baseline')
    for group, successor_group in (('cases', 'rawCases'), ('pairs', 'rawPairs')):
        require(len(native[group]) == len(successor[successor_group]), 'both native harnesses cover entire retained workload')
        for current, previous in zip(successor[successor_group], native[group]):
            require(all(current[field] == value for field, value in previous.items()), 'both current native harnesses record byte-identical old results')
    migrations = verify_migrations()
    sources = {item['path']: item for item in receipt['sources']}
    for name in [*HELPERS, HELD_NATIVE, 'tools/virgl-integer-masks/native_receipt.py',
                 'renderer/virgl-shader/tests/integer-mask-cases.json']:
        source = binding(ROOT / name)
        verify_source(source, head)
        sources[name] = source
    return {'heldRawHead': HELD_HEAD, 'recordedHead': head,
            'boundary': 'Current E4a gate rechecked from recorded native/Wasm/actual GPU data, preserving all 279 standalone and 22 pair results plus all 19 originals.',
            'rawCases': len(cases), 'rawPairs': len(pairs), 'rawWords': 480, 'interpolationPixels': pixels,
            'migrations': migrations, 'rawReceipt': binding(directory / 'receipt.json', output),
            'heldNative': binding(ROOT / HELD_NATIVE), 'sources': [sources[name] for name in sorted(sources)]}
