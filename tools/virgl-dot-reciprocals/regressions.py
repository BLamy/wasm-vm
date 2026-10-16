#!/usr/bin/env python3
"""Recheck predecessor data with an explicit scalar-task compatibility boundary.

Every earlier GPU oracle and C2 gate runs unchanged. The separately checked
component compatibility transcript permits exactly two new source-bound DP3
negative substitutions relative to the verified E5 input set.
"""
from __future__ import annotations
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HELD_HEAD = '3adaa72f95fd88b8fefd5caa32d6407df22af1dd'
HELPERS = ['tools/virgl-constants/receipt.py', 'tools/virgl-numeric-floats/receipt.py',
           'tools/virgl-numeric-floats/native_receipt.py', 'tools/virgl-numeric-floats/regressions.py',
           'tools/virgl-numeric-floats/browser_receipt.py']


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


base = load('component_regression_base', HELPERS[0])
numeric = load('component_regression_numeric', HELPERS[1])
native_gate = load('component_regression_native', HELPERS[2])
prior_gate = load('component_regression_prior', HELPERS[3])
extra = load('component_regression_browser', HELPERS[4])
require, sha, read, binding = base.require, base.sha, base.read, base.binding


def verify_numeric(output, head, contract, current):
    output = Path(output)
    directory = output / 'numeric-regression'
    receipt = read(directory / 'receipt.json')
    require(receipt['task'] == 'E6-T12e4c2' and receipt['status'] == 'passed' and receipt['gitHead'] == head
            and receipt['production'] == contract['production']
            and receipt['shaderOutcomes'] == {'translated': 12, 'unsupported-feature': 7},
            'complete current-head numeric regression receipt')
    base.verify_records(directory, receipt)
    for source in receipt['sources']:
        base.verify_source(source, head)
    native, fixtures, hardware, cases, pairs, originals = native_gate.verify_native(directory, head)
    # The explicit compatibility checker reconstructs the two new migrations
    # independently and compares every full result with the verified E5 baseline. Bind
    # the nested gate's actual inputs/results to those same recorded entries.
    for key in ('rawCases', 'rawPairs', 'integerCases', 'integerPairs', 'floatCases', 'floatPairs', 'originals'):
        require(native[key] == current[key], 'nested and component retained full native results agree')
    require(native['cases'] == current['numericCases'] and native['pairs'] == current['numericPairs']
            and native['fixtures'] == current['numericFixtures'],
            'nested C2 workload equals the explicitly checked current compatibility inputs')
    modes = ['stale-shadow', 'numeric-decode', 'sampler-index']
    browser = base.verify_browser(directory / 'hardware', head, contract, task='E6-T12e4c2')
    controls = [base.verify_browser(directory / ('sabotage-' + mode), head, contract,
                                   passed=False, task='E6-T12e4c2') for mode in modes]
    for report in [browser, *controls]:
        proof = report['acceptance']
        numeric.translations(proof, fixtures, hardware, cases, pairs, originals)
        require(proof['operationDefinitions'] == hardware['operationDefinitions'], 'unchanged authored numeric operations')
        require([entry['name'] for entry in proof['cases']] == [entry['name'] for entry in fixtures]
                and [entry['name'] for entry in proof['anchors']] == [entry['name'] for entry in hardware['shaders']]
                and [entry['name'] for entry in proof['pairs']] == [entry['name'] for entry in hardware['pairs']]
                and [entry['sha256'] for entry in proof['corpus']] == list(originals)
                and [entry['name'] for entry in proof['rejectionPairs']] == [
                    f'rejected-{stage}-{code}-pair' for stage in ('vertex', 'fragment')
                    for code in ('parse-error', 'unsupported-feature')],
                'complete ordered numeric workload without substituted or omitted cases')
        require(proof['caseFixture'] == binding(ROOT / 'renderer/virgl-shader/tests/numeric-float-cases.json')
                and proof['hardwareFixture'] == binding(ROOT / 'renderer/virgl-shader/tests/numeric-float-hardware.json'),
                'both actual numeric fixture source bindings')
        first = hardware['numericVectors'][0]
        require(proof['literalWitnesses'] == {'input': first, 'expected': {
            definition['name']: numeric.oracle.numeric_words(definition['oracle'], first)
            for definition in hardware['numericPrograms']}}, 'independent numeric literal witnesses')
        extra.verify_orientation(proof, cases, helpers=vars(numeric))
    proof = browser['acceptance']
    numeric.verify_source_contracts(proof, hardware, cases)
    numeric_words, numeric_cross = numeric.verify_numeric(proof, hardware, cases)
    texture_words, texture_cross, texture_pixels = numeric.verify_textures(proof, hardware, cases)
    pair_pixels = numeric.verify_pairs(proof, hardware, pairs)
    require(proof['checkedWords'] == numeric_words + texture_words == 352
            and proof['checkedTexturePixels'] == texture_pixels == 4096
            and numeric_cross + texture_cross == 48 and pair_pixels == 25792,
            'complete independent numeric, texture and interpolation oracle counts')
    require(proof['status'] == 'passed' and proof['sabotage'] is None and proof['omissions'] == []
            and proof['objects']['live'] == 0 and proof['objects']['created'] == proof['objects']['deleted'],
            'complete numeric hardware proof releases all GL objects')
    for mode in modes:
        extra.verify_sabotage(directory / ('sabotage-' + mode), mode, browser, cases, hardware, helpers=vars(numeric))
    prior = prior_gate.verify(directory, head, contract)
    require(receipt['numericWords'] == numeric_words == 288 and receipt['textureWords'] == texture_words == 64
            and receipt['crossConsumerDraws'] == numeric_cross + texture_cross == 48
            and receipt['texturePixels'] == texture_pixels == 4096
            and receipt['interpolationPixels'] == pair_pixels == 25792 and receipt['orientationCaptures'] == 2
            and receipt['profiles'] == numeric.PROFILES
            and receipt['regressions'] == {key: value for key, value in prior.items() if key != 'sources'},
            'nested receipt counts and complete earlier proof agree with independent recheck')
    wasm_path = ROOT / 'renderer/virgl-shader/build/wasm/virgl-shader.wasm'
    require(receipt['compilerSha256'] == {'nativeSanitizer': native['binarySha256'], 'wasm': sha(wasm_path.read_bytes())},
            'all nested proof uses the current compiler binaries')
    unchanged = HELPERS + [
        'tools/virgl-numeric-floats/native.py', 'tools/virgl-numeric-floats/oracle.py',
        'tools/virgl-numeric-floats/cold.py', 'tools/verify-virgl-numeric-floats.sh',
        'tools/verify-virgl-numeric-floats.mjs', 'renderer/virgl-shader/tests/numeric-floats.mjs',
        'renderer/virgl-shader/native_tests/numeric_floats.c',
        'renderer/virgl-shader/tests/numeric-float-hardware.json']
    for path in unchanged:
        require(base.git('show', f'{HELD_HEAD}:{path}') == (ROOT / path).read_bytes(),
                'prior gate implementation and all hardware fixtures unchanged')
    names = {source['path'] for source in receipt['sources'] + prior['sources']}
    names.update(unchanged + ['tools/virgl-dot-reciprocals/regressions.py',
                             current['migrationsSource']['path']])
    sources = []
    for path in sorted(names):
        if '/build/' not in path:
            item = binding(ROOT / path)
            base.verify_source(item, head)
            sources.append(item)
    return {'heldComponentHead': HELD_HEAD, 'recordedHead': head,
            'boundary': 'Complete C2 gate and prior gates independently rechecked and cross-bound to the exact predecessor compatibility transcript.',
            'numericCases': len(cases), 'numericPairs': len(pairs), 'numericWords': numeric_words,
            'textureWords': texture_words, 'numericCrossConsumerDraws': numeric_cross + texture_cross,
            'numericTexturePixels': texture_pixels, 'numericInterpolationPixels': pair_pixels,
            'migrations': current['migrations'],
            'migrationSource': current['migrationsSource'],
            'receipt': binding(directory / 'receipt.json', output),
            'reports': [binding(directory / name / 'report.json', output) for name in
                        ('hardware', *['sabotage-' + mode for mode in modes])],
            'prior': {key: value for key, value in prior.items() if key != 'sources'}, 'sources': sources}


def verify(output, head, contract):
    """Reexecute all predecessor obligations without forging its historical receipt."""
    output = Path(output)
    directory = output / 'component-regression'
    compatibility = load('scalar_component_compatibility', 'tools/virgl-dot-reciprocals/component_compat_receipt.py')
    current, fixtures, hardware, cases, pairs, originals = compatibility.verify_component(directory, head)
    component = load('scalar_component_receipt', 'tools/virgl-component-floats/receipt.py')
    component_extra = load('scalar_component_browser', 'tools/virgl-component-floats/browser_receipt.py')
    component_division = load('scalar_component_division', 'tools/virgl-component-floats/division_receipt.py')
    modes = ['lrp-order', 'frc-floor', 'div-operands', 'numeric-negate']
    browser = base.verify_browser(directory / 'hardware', head, contract, task='E6-T12e5')
    controls = [base.verify_browser(directory / ('sabotage-' + mode), head, contract,
                                   passed=False, task='E6-T12e5') for mode in modes]
    for report in [browser, *controls]:
        proof = report['acceptance']
        component.translations(proof, fixtures, hardware, cases, pairs, originals)
        require(proof['operationDefinitions'] == hardware['operationDefinitions'], 'unchanged component operation definitions')
        require([entry['name'] for entry in proof['cases']] == [entry['name'] for entry in fixtures]
                and [entry['name'] for entry in proof['anchors']] == [entry['name'] for entry in hardware['shaders']]
                and [entry['name'] for entry in proof['pairs']] == [entry['name'] for entry in hardware['pairs']]
                and [entry['sha256'] for entry in proof['corpus']] == list(originals)
                and [entry['name'] for entry in proof['rejectionPairs']] == [
                    f'rejected-{stage}-{code}-pair' for stage in ('vertex', 'fragment')
                    for code in ('parse-error', 'unsupported-feature')],
                'complete ordered component workload with no substituted or duplicate inputs')
        require(proof['caseFixture'] == binding(ROOT / 'renderer/virgl-shader/tests/component-float-cases.json')
                and proof['hardwareFixture'] == binding(ROOT / 'renderer/virgl-shader/tests/component-float-hardware.json'),
                'both exact unchanged component fixture bindings')
        first = hardware['numericVectors'][0]
        require(proof['literalWitnesses'] == {'input': first, 'expected': {
            name: [component.oracle.word(value) for value in component.oracle.numeric(name, first)]
            for name in ('max', 'frc', 'lrp')}}, 'independent retained component literal witnesses')
        component_extra.verify_orientation(proof, cases, helpers=vars(component))
    proof = browser['acceptance']
    component.verify_source_contracts(proof, hardware, cases)
    numeric_words, numeric_cross = component.verify_numeric(proof, hardware, cases)
    texture_words, texture_cross, texture_pixels = component.verify_textures(proof, hardware, cases)
    division = component_division.verify_division(proof, hardware, cases, helpers=vars(component))
    observations = component_division.verify_observations(proof, hardware, cases, helpers=vars(component))
    pair_pixels = component.verify_pairs(proof, hardware, pairs)
    require(proof['exactWords'] == numeric_words + texture_words + division['exactWords'] == 406
            and proof['boundedDivisionWords'] == division['boundedWords'] == 42
            and proof['checkedWords'] == proof['exactWords'] + proof['boundedDivisionWords'] == 448
            and proof['observedSpecialWords'] == observations['words'] == 96
            and proof['checkedTexturePixels'] == texture_pixels == 4096
            and numeric_cross + texture_cross + division['crossDraws'] == 60 and pair_pixels == 29760,
            'all independent retained component GPU counts derived from complete observations')
    require(proof['status'] == 'passed' and proof['sabotage'] is None and proof['omissions'] == []
            and proof['objects']['live'] == 0 and proof['objects']['created'] == proof['objects']['deleted'],
            'all actual predecessor GL objects released after passing execution')
    for mode in modes:
        component_extra.verify_sabotage(directory / ('sabotage-' + mode), mode, browser, cases, hardware,
                                        helpers=vars(component))
    numeric = verify_numeric(directory, head, contract, current)
    unchanged = [str(path.relative_to(ROOT)) for path in (ROOT / 'tools/virgl-component-floats').glob('*.py')]
    unchanged += ['tools/verify-virgl-component-floats.sh', 'tools/verify-virgl-component-floats.mjs',
                  'renderer/virgl-shader/native_tests/component_floats.c',
                  'renderer/virgl-shader/tests/component-floats.mjs',
                  'renderer/virgl-shader/tests/component-float-cases.json',
                  'renderer/virgl-shader/tests/component-float-hardware.json',
                  'renderer/virgl-shader/tests/component-float-migrations.json']
    for name in unchanged:
        require(base.git('show', f'{HELD_HEAD}:{name}') == (ROOT / name).read_bytes(),
                'retained component policy, workload, harness and GPU oracles remain byte-identical')
    names = {item['path'] for report in [browser, *controls] for item in report['sources']}
    names.update(item['path'] for item in current['sources'] + current['fixtures'])
    names.update(item['path'] for item in numeric['sources'])
    names.update(unchanged)
    names.update(('tools/virgl-dot-reciprocals/regressions.py',
                  'tools/virgl-dot-reciprocals/component_compat.py',
                  'tools/virgl-dot-reciprocals/component_compat_receipt.py',
                  'tools/virgl-dot-reciprocals/native.py', 'tools/virgl-dot-reciprocals/native_receipt.py'))
    sources = []
    for name in sorted(names):
        if '/build/' not in name:
            item = binding(ROOT / name)
            base.verify_source(item, head)
            sources.append(item)
    return {'schema': 'wasm-vm-scalar-component-regression-v1', 'heldComponentHead': HELD_HEAD,
            'recordedHead': head,
            'boundary': 'Explicit verified-E5-plus-two-input compatibility run; every unchanged E5 GPU oracle and the complete C2 gate rechecked. No claim that the unmodified historical E5 full gate accepted a different fixture history.',
            'native': binding(directory / 'native/native-report.json', output),
            'componentCases': len(cases), 'componentPairs': len(pairs),
            'numericWords': numeric_words, 'textureWords': texture_words, 'division': division,
            'specialObservations': observations, 'crossConsumerDraws': 60,
            'texturePixels': texture_pixels, 'interpolationPixels': pair_pixels, 'orientationCaptures': 2,
            'migrations': current['migrations'], 'migrationSource': current['migrationsSource'],
            'reports': [binding(directory / name / 'report.json', output) for name in
                        ('hardware', *['sabotage-' + mode for mode in modes])],
            'numeric': {key: value for key, value in numeric.items() if key != 'sources'}, 'sources': sources}
