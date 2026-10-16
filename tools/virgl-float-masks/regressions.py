#!/usr/bin/env python3
"""Preserve prior browser proof with explicit migration-aware native evidence.

The historical E4a/E4b native receipts intentionally pin old inputs. This
successor replaces only that loader: the new native harness records all retained
inputs against verified prior full outputs and explicitly binds six promotions.
All prior browser translation, hardware, pressure and sabotage oracles run here
unchanged, together with the complete bank gate and constant/async regressions.
"""
from __future__ import annotations
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HELD_HEAD = '7be4e09748bc4acfcdf167bd66cd6f3d890132d5'
HELPERS = ['tools/virgl-constants/receipt.py', 'tools/virgl-banks/receipt.py',
           'tools/virgl-raw-bits/regressions.py', 'tools/virgl-raw-bits/receipt.py',
           'tools/virgl-integer-masks/receipt.py', 'tools/virgl-float-masks/native_receipt.py',
           'tools/virgl-float-masks/regressions.py']


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


constants = load('float_regression_constants', HELPERS[0])
banks = load('float_regression_banks', HELPERS[1])
legacy_gate = load('float_regression_legacy', HELPERS[2])
raw = load('float_regression_raw', HELPERS[3])
integer = load('float_regression_integer', HELPERS[4])
native_gate = load('float_regression_native', HELPERS[5])
require, sha, read, binding = constants.require, constants.sha, constants.read, constants.binding
verify_source = constants.verify_source


def current_head(report, head):
    require(report['gitHead'] == head, 'every regression recorded at exact current head')
    return head


def verify_legacy(output, head, contract):
    """Return source bindings and compact fresh-regression proof for root receipt."""
    output = Path(output)
    legacy = legacy_gate.held_json(legacy_gate.HELD_NATIVE)
    require(sha((ROOT / legacy_gate.HELD_NATIVE).read_bytes()) == legacy_gate.HELD_NATIVE_SHA256, 'exact verified E3b native baseline')
    require(legacy['status'] == 'passed' and legacy['schema'] == 'wasm-vm-constants-native-v1', 'held native schema')
    verify_source(legacy['fixture'], head)
    require(legacy['fixture']['path'] == legacy_gate.CONSTANT_FIXTURE, 'held constant fixture identity')
    fixtures = read(ROOT / legacy_gate.CONSTANT_FIXTURE)
    require(len(fixtures) == len(legacy['cases']) == 8, 'eight old authored constant shaders')
    cases = {}
    for fixture, case in zip(fixtures, legacy['cases']):
        require(case['name'] == fixture['name'] and case['stage'] == fixture['stage'] and case['expected'] == fixture['expected'] and
                case['inputSha256'] == sha(fixture['text'].encode('ascii')), 'held exact authored shader binding')
        cases[case['name']] = case
    originals = {entry['sha256']: entry['result'] for entry in legacy['originals']}
    current_native = read(output / 'native/native-report.json')
    require(current_native['schema'] == 'wasm-vm-float-masks-native-v1' and current_native['status'] == 'passed' and
            {entry['sha256']: entry['result'] for entry in current_native['originals']} == originals,
            'current native originals equal held full translations')
    constant_output = output / 'constant-regression'
    decoder = constants.verify_decoder(constant_output)
    constant_head = current_head(read(constant_output / 'hardware/report.json'), head)
    hardware = constants.verify_browser(constant_output / 'hardware', constant_head, contract)
    constants.verify_translations(hardware['acceptance'], fixtures, cases, originals, decoder)
    constants.verify_hardware(hardware['acceptance'], cases)
    for item in hardware['sources']:
        if item['path'].startswith(('renderer/virgl-command/', 'tools/virgl-constants/')) or item['path'] == 'tools/verify-virgl-constants.mjs':
            require(constants.git('show', f'{legacy_gate.HELD_HEAD}:{item["path"]}') == (ROOT / item['path']).read_bytes(),
                    'held finite-command decoder/reflection/pixel oracle unchanged')
    current_head(read(output / 'async-regression/report.json'), head)
    async_report = legacy_gate.verify_async(output / 'async-regression', head, originals, hardware)
    regression_output = output / 'regression'
    regression = read(regression_output / 'receipt.json')
    bank_head = current_head(regression, head)
    require(regression['task'] == 'E6-T12e3' and regression['status'] == 'passed' and
            regression['production'] == contract['production'] and
            regression['shaderOutcomes'] == {'translated': 12, 'unsupported-feature': 7}, 'complete current bank regression receipt')
    constants.verify_records(regression_output, regression)
    for item in regression['sources']:
        verify_source(item, head)
    for path, digest in regression['compilerSha256'].items():
        require(sha((ROOT / path).read_bytes()) == digest, 'bank regression uses same current compiler')
    # Re-run the narrow recorded-data oracles instead of accepting only the
    # receipt's printed status; the bank gate already ran the costly programs.
    corpus = read(regression_output / 'regression/components/regression/contract/receipt.json')['capturedShaderResults']
    bank_fixtures = read(ROOT / 'renderer/virgl-shader/tests/bank-cases.json')
    native = read(regression_output / 'native/native-report.json')
    banks.verify_native(native, bank_fixtures, corpus, regression_output)
    reports = {name: banks.verify_browser_sources(regression_output, name, bank_head, contract) for name in ('hardware', 'sabotage')}
    banks.verify_execution(reports, native, bank_fixtures, corpus)
    names = {item['path'] for report in (hardware, async_report, regression) for item in report['sources']}
    names.update(item['path'] for item in async_report['inputs'])
    names.update(HELPERS + [legacy_gate.CONSTANT_FIXTURE, 'tools/virgl-constants/decoder.mjs', legacy_gate.HELD_NATIVE, legacy_gate.HELD_ASYNC])
    sources = []
    for name in sorted(names):
        if '/build/' not in name:
            item = binding(ROOT / name)
            verify_source(item, head)
            sources.append(item)
    return {'heldLegacyHead': legacy_gate.HELD_HEAD,
            'recordedHeads': {'banks': bank_head, 'constants': constant_head, 'async': async_report['gitHead']},
            'boundary': 'Current browser legacy outputs equal verified native E3b results; current native originals and full bank regression remain exact. Historical unchanged-compiler receipt is retained, not reinterpreted.',
            'constantCases': 23, 'constantPixels': 45056, 'actualConstantRigs': 10, 'validationConstantRigs': 25,
            'asyncPackets': 210, 'asyncInteriorPixels': 768, 'asyncAttacks': len(async_report['browserResult']['result']['attacks']),
            'bankCases': len(bank_fixtures), 'bankReceipt': binding(regression_output / 'receipt.json', output),
            'constantReport': binding(constant_output / 'hardware/report.json', output),
            'constantDecoder': binding(constant_output / 'decoder/decoder-report.json', output),
            'asyncReport': binding(output / 'async-regression/report.json', output),
            'legacyNative': binding(ROOT / legacy_gate.HELD_NATIVE), 'sources': sources}


def verify(output, head, contract):
    output = Path(output)
    native, _, _, _, _, originals = native_gate.verify_native(output, head)
    raw_cases = {entry['name']: entry for entry in native['rawCases']}
    raw_pairs = {entry['name']: entry for entry in native['rawPairs']}
    integer_cases = {entry['name']: entry for entry in native['integerCases']}
    integer_pairs = {entry['name']: entry for entry in native['integerPairs']}
    raw_fixtures, raw_hardware = [read(ROOT / entry['path']) for entry in native['rawFixtures']]
    integer_fixtures, integer_hardware = [read(ROOT / entry['path']) for entry in native['integerFixtures']]
    raw_directory = output / 'raw-regression'
    raw_reports = [constants.verify_browser(raw_directory / 'hardware', head, contract, task='E6-T12e4a'),
                   constants.verify_browser(raw_directory / 'sabotage', head, contract, passed=False, task='E6-T12e4a')]
    for report in raw_reports:
        raw.translations(report['acceptance'], raw_fixtures, raw_hardware, raw_cases, raw_pairs, originals)
    raw_pixels = raw.verify_gpu(raw_reports[0]['acceptance'], raw_hardware, raw_cases, raw_pairs)
    raw.verify_sabotage(raw_reports[1]['acceptance'], raw_cases, raw_hardware)
    integer_directory = output / 'integer-regression'
    modes = ['signed-compare', 'all-ones-mask', 'ucmp-selection']
    integer_reports = [constants.verify_browser(integer_directory / 'hardware', head, contract, task='E6-T12e4b')]
    integer_reports += [constants.verify_browser(integer_directory / ('sabotage-' + mode), head, contract,
                                                passed=False, task='E6-T12e4b') for mode in modes]
    for report in integer_reports:
        integer.translations(report['acceptance'], integer_fixtures, integer_hardware, integer_cases, integer_pairs, originals)
        require(report['acceptance']['operationDefinitions'] == integer_hardware['operationDefinitions'], 'unchanged authored integer operations')
        integer.verify_finite(report['acceptance'], integer_hardware, integer_cases)
    integer_pixels = integer.verify_gpu(integer_reports[0]['acceptance'], integer_hardware, integer_cases, integer_pairs)
    for mode, report in zip(modes, integer_reports[1:]):
        integer.verify_sabotage(report['acceptance'], integer_cases, integer_hardware, mode)
    require(raw_pixels == 14880 and integer_pixels == 17856, 'complete retained interpolation pixel oracles')
    legacy = verify_legacy(output, head, contract)
    names = {source['path'] for report in raw_reports + integer_reports for source in report['sources']}
    names.update(source['path'] for source in native['sources'] + native['rawFixtures'] + native['integerFixtures'])
    names.update(source['path'] for source in legacy['sources'])
    names.update(HELPERS + [native_gate.INTEGER_BASELINE, native_gate.LEGACY_BASELINE])
    # The native loader is the only adapted proof boundary. Source identity of
    # these prior browser validators/wrappers/hardware programs is retained.
    unchanged = ['tools/virgl-raw-bits/receipt.py', 'tools/virgl-integer-masks/receipt.py',
                 'tools/verify-virgl-raw-bits.mjs', 'tools/verify-virgl-integer-masks.mjs',
                 'renderer/virgl-shader/tests/raw-bits.mjs', 'renderer/virgl-shader/tests/integer-masks.mjs',
                 'renderer/virgl-shader/tests/raw-bit-hardware.json', 'renderer/virgl-shader/tests/integer-mask-hardware.json']
    for name in unchanged:
        require(constants.git('show', f'{HELD_HEAD}:{name}') == (ROOT / name).read_bytes(), 'prior browser proof implementation unchanged')
        names.add(name)
    sources = []
    for name in sorted(names):
        if '/build/' not in name:
            item = binding(ROOT / name)
            verify_source(item, head)
            sources.append(item)
    reports = [binding(output / directory / 'report.json', output) for directory in (
        'raw-regression/hardware', 'raw-regression/sabotage', 'integer-regression/hardware',
        *['integer-regression/sabotage-' + mode for mode in modes])]
    return {'heldIntegerHead': HELD_HEAD, 'recordedHead': head,
            'boundary': 'One current native sanitizer covers retained v1/v2 inputs with six explicit historical promotions; unchanged prior browser oracles recheck actual output and pressure.',
            'rawCases': len(raw_cases), 'rawPairs': len(raw_pairs), 'integerCases': len(integer_cases), 'integerPairs': len(integer_pairs),
            'rawWords': 480, 'integerWords': 704, 'integerFiniteSelections': 16,
            'rawInterpolationPixels': raw_pixels, 'integerInterpolationPixels': integer_pixels,
            'migrations': native['migrations'], 'heldNative': binding(ROOT / native_gate.INTEGER_BASELINE),
            'reports': reports, 'legacy': {key: value for key, value in legacy.items() if key != 'sources'}, 'sources': sources}
