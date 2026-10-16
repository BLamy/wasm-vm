#!/usr/bin/env python3
"""Recheck the complete numeric gate with six source-bound adjacent negatives.

Every earlier recorded-data oracle runs unchanged. Only the six explicitly
reconstructed TGSI substitutions may differ from the verified C2 input set;
their complete error results and all other results remain exact.
"""
from __future__ import annotations
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HELD_HEAD = '67ca333c05fb70d719c49b3dc5cb8c1f8bb2f6de'
HELPERS = ['tools/virgl-constants/receipt.py', 'tools/virgl-numeric-floats/receipt.py',
           'tools/virgl-numeric-floats/native_receipt.py', 'tools/virgl-numeric-floats/regressions.py',
           'tools/virgl-numeric-floats/browser_receipt.py', 'tools/virgl-component-floats/native_receipt.py']


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
component_native = load('component_regression_component_native', HELPERS[5])
require, sha, read, binding = base.require, base.sha, base.read, base.binding


def verify(output, head, contract):
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
    current, _, _, _, _, _ = component_native.verify_native(output, head)
    native, fixtures, hardware, cases, pairs, originals = native_gate.verify_native(directory, head)
    # The component checker reconstructs the migration manifest independently
    # and compares every complete result with the verified C2 baseline. Bind
    # the nested gate's actual inputs/results to those same recorded entries.
    for key in ('rawCases', 'rawPairs', 'integerCases', 'integerPairs', 'floatCases', 'floatPairs', 'originals'):
        require(native[key] == current[key], 'nested and component retained full native results agree')
    require(native['cases'] == current['numericCases'] and native['pairs'] == current['numericPairs']
            and native['fixtures'] == current['numericFixtures'],
            'nested C2 native workload is exactly the six migrated inputs plus every retained input')
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
    unchanged = HELPERS[:-1] + [
        'tools/virgl-numeric-floats/native.py', 'tools/virgl-numeric-floats/oracle.py',
        'tools/virgl-numeric-floats/cold.py', 'tools/verify-virgl-numeric-floats.sh',
        'tools/verify-virgl-numeric-floats.mjs', 'renderer/virgl-shader/tests/numeric-floats.mjs',
        'renderer/virgl-shader/native_tests/numeric_floats.c',
        'renderer/virgl-shader/tests/numeric-float-hardware.json']
    for path in unchanged:
        require(base.git('show', f'{HELD_HEAD}:{path}') == (ROOT / path).read_bytes(),
                'prior gate implementation and all hardware fixtures unchanged')
    names = {source['path'] for source in receipt['sources'] + prior['sources']}
    names.update(unchanged + [HELPERS[-1], 'tools/virgl-component-floats/regressions.py',
                             current['migrationsSource']['path']])
    sources = []
    for path in sorted(names):
        if '/build/' not in path:
            item = binding(ROOT / path)
            base.verify_source(item, head)
            sources.append(item)
    return {'heldNumericHead': HELD_HEAD, 'recordedHead': head,
            'boundary': 'Complete numeric gate and prior gates independently rechecked; exactly six source-bound adjacent negative replacements retain all previous result bytes.',
            'numericCases': len(cases), 'numericPairs': len(pairs), 'numericWords': numeric_words,
            'textureWords': texture_words, 'numericCrossConsumerDraws': numeric_cross + texture_cross,
            'numericTexturePixels': texture_pixels, 'numericInterpolationPixels': pair_pixels,
            'migrations': current['migrations'],
            'migrationSource': current['migrationsSource'],
            'receipt': binding(directory / 'receipt.json', output),
            'reports': [binding(directory / name / 'report.json', output) for name in
                        ('hardware', *['sabotage-' + mode for mode in modes])],
            'prior': {key: value for key, value in prior.items() if key != 'sources'}, 'sources': sources}
