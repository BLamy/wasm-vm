#!/usr/bin/env python3
"""Bind component/range acceptance to unchanged captured bodies and frozen sources."""
import importlib.util
import json
from fractions import Fraction
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('contract_gate', ROOT / 'tools/virgl-contract/verify.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
require, sha, read_json = gate.require, gate.sha, gate.read_json


def binding(path, relative_to=ROOT):
    data = path.read_bytes()
    return {'path': str(path.relative_to(relative_to)), 'bytes': len(data), 'sha256': sha(data)}


def check_digest(path, expected):
    require(path.is_file() and sha(path.read_bytes()) == expected, f'stale or missing evidence: {path}')


def main():
    require(len(sys.argv) == 2, 'usage: receipt.py EVIDENCE_DIRECTORY')
    output = Path(sys.argv[1]).resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    contract = read_json(ROOT / 'docs/gpu-3d-contract.json')
    require(contract['production'] == gate.PRODUCTION, 'production GPU scope changed')
    regression = read_json(output / 'regression/receipt.json')
    require(regression['status'] == 'passed' and regression['task'] == 'E6-T10d'
            and regression['head'] == head, 'regression receipt status/head')
    for filename, digest in regression['sourceSha256'].items():
        check_digest(ROOT / filename, digest)
    for filename, digest in regression['compilerSha256'].items():
        check_digest(Path(filename), digest)
    for filename, digest in regression['reports'].items():
        check_digest(output / 'regression' / filename, digest)
    require(regression['capturedPixels'] == 768 and regression['literalPixels'] == 4336
            and regression['wasmAttacks'] == 112 and regression['wasmRecoveries'] == 1792,
            'prior shader regression coverage')
    expected_outcomes = {'translated': 12, 'unsupported-feature': 7}
    require(regression['shaderOutcomes'] == expected_outcomes, 'original 19-hash outcomes')
    corpus = read_json(output / 'regression/contract/receipt.json')['capturedShaderResults']
    require(set(corpus) == set(contract['capturedShaders']) and len(corpus) == 19,
            'original corpus identities')

    fixture_path = ROOT / 'renderer/virgl-shader/tests/component-cases.json'
    fixtures = read_json(fixture_path)
    require(len(fixtures) == 249 and sum(item['ok'] for item in fixtures) == 157,
            'component positive/negative boundary coverage')
    native = read_json(output / 'native/native-report.json')
    require(native['schema'] == 'wasm-vm-components-native-v1' and native['status'] == 'passed',
            'native sanitizer result')
    require(native['sanitizers'] == ['address', 'undefined'] and native['mutationsPerSeed'] == 1024,
            'native sanitizer/mutation coverage')
    require(native['fixture'] == binding(fixture_path), 'native shared fixture identity')
    check_digest(output / 'native/native.log', native['logSha256'])
    check_digest(ROOT / 'renderer/virgl-shader/build/component-sanitize/component-test', native['binarySha256'])
    require({item['sha256'] for item in native['inputs']} == gate.COMPONENT_SHADERS,
            'native original bodies')
    for item in native['inputs']:
        source = ROOT / item['path']
        require(binding(source) == {key: item[key] for key in ('path', 'bytes', 'sha256')},
                'native captured source binding')
        require(item['result'] == corpus[item['sha256']] and item['result']['ok'] is True,
                'native original translation parity')
        require(sha(item['result']['glsl'].encode()) == item['glslSha256'], 'native GLSL digest')
    require(len(native['cases']) == len(fixtures), 'native fixture result count')
    for fixture, case in zip(fixtures, native['cases']):
        require(case['name'] == fixture['name'] and case['stage'] == fixture['stage']
                and case['inputSha256'] == sha(fixture['text'].encode())
                and case['ok'] is fixture['ok'] and case['result']['ok'] is fixture['ok'],
                'native fixture outcome or identity')

    reports = {}
    for name in ('hardware', 'sabotage'):
        report = read_json(output / name / 'report.json')
        require(report['task'] == 'E6-T12e1' and report['gitHead'] == head, 'browser task/head')
        require(report['guestExecution'] is False and report['currentGuest3dAdvertisement'] is False,
                'isolated browser scope')
        require(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser errors')
        require(report['status'] == ('passed' if name == 'hardware' else 'failed'), 'browser status')
        gate.verify_files(report['sources'])
        gate.verify_files(report['servedFiles'])
        observed = {'browserVersion': report['browser']['version'],
                    **{key: report['host'][key] for key in ('platform', 'architecture', 'release')},
                    'renderer': report['acceptance']['renderer']['renderer']}
        require(observed in contract['browserMatrix']['qualified'], 'unqualified hardware/browser')
        photo = report['screenshot'] if name == 'hardware' else report['failureScreenshot']
        require(photo['path'] == ('browser.png' if name == 'hardware' else 'failure.png'), 'screenshot path')
        check_digest(output / name / photo['path'], photo['sha256'])
        reports[name] = report

    # Suite-specific pixel and native/Wasm parity checks are kept here so a
    # passing browser status alone cannot produce an acceptance receipt.
    verify_browser(reports['hardware']['acceptance'], reports['sabotage']['acceptance'],
                   corpus, fixtures, native)

    source_names = set(regression['sourceSha256'])
    source_names.update(str(path.relative_to(ROOT)) for path in (ROOT / 'tools/virgl-components').glob('*.py'))
    source_names.update(('tools/verify-virgl-components.sh', 'tools/verify-virgl-components.mjs',
                         'tools/virgl-contract/test_verify.py'))
    sources = []
    for name in sorted(source_names):
        path = ROOT / name
        entry = binding(path)
        frozen = subprocess.check_output(['git', 'show', f'{head}:{name}'], cwd=ROOT)
        require(sha(frozen) == entry['sha256'], f'source differs from frozen head: {name}')
        sources.append(entry)
    records = [binding(path, output) for path in sorted(output.rglob('*'))
               if path.is_file() and path != output / 'receipt.json' and path.name != 'acceptance.log']
    receipt = {'schema': 1, 'task': 'E6-T12e1', 'status': 'passed', 'gitHead': head,
               'boundary': 'Four unchanged captured shader bodies through bounded v4 frontend and independent hardware pixels; no guest GPU activation.',
               'sources': sources, 'records': records, 'shaderOutcomes': expected_outcomes,
               'production': contract['production'], 'nativeCases': len(fixtures),
               'newOriginalHashes': sorted(gate.COMPONENT_SHADERS),
               'compilerSha256': regression['compilerSha256']}
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('E6-T12e1 passed: 12/19 original shaders, four new hardware shader oracles, native/Wasm parity and bounded grammar attacks.')


def verify_browser(hardware, sabotage, corpus, fixtures, native):
    require(hardware['status'] == 'passed' and hardware['sabotage'] is None
            and hardware['omissions'] == [] and hardware['guestExecution'] is False
            and hardware['commandStreamReplay'] is False and hardware['productionVirgl'] is False,
            'hardware execution claim')
    require(len(hardware['corpus']) == 19
            and {entry['sha256']: entry['result'] for entry in hardware['corpus']} == corpus,
            'all original native/Wasm outputs and metadata must match exactly')
    for item in hardware['corpus']:
        require(binding(ROOT / item['path']) == {key: item[key] for key in ('path', 'bytes', 'sha256')},
                'browser original source binding')
        require(item['glslSha256'] == (sha(item['result']['glsl'].encode()) if item['result']['ok'] else None),
                'browser original GLSL digest')
    require(len(hardware['translations']) == 4
            and {item['sha256'] for item in hardware['translations']} == gate.COMPONENT_SHADERS,
            'four newly executed original identities')
    for item in hardware['translations']:
        require(item in hardware['corpus'], 'executed translation must be an unchanged corpus entry')
    boundary = hardware['boundary']
    require(boundary['fixtureSha256'] == native['fixture']['sha256']
            and boundary['cases'] == native['cases'], 'every native/Wasm boundary output must match')
    require(boundary['recovery'] == {'rounds': 2, 'conversions': len(fixtures) * 8,
                                    'outputsAndMetadataIdentical': True}, 'Wasm rejection recovery')
    require(hardware['limits'] == {'textBytes': 16384, 'tokens': 8192, 'glslBytes': 65536,
                                  'instructions': 128, 'registerIndex': 7, 'temporaryRegisterIndex': 9},
            'published per-file bounds')

    fragments = ['003270109615e05345631cf8a2273ebc1bf3d86c7590e05ddc8424c441db7605',
                 '9819066def2df1cd09f36f142fd2bc6b659395aa21bea6db7f58fbcc122c7c83']
    vertices = ['403b0529c632d3d2ffe4584ede810f5745e8b76ca2ab4f575e1073d8f29fcf0c',
                'e9bc6d3b61e3cda2c215ac8b44a432e2eb1bd4891cfa921c6f914fd3fd86b551']
    # Literal source-independent RGBA expectations: alpha is never scaled.
    phases = [
        [[0, 0, 0, 255], [0, 0, 0, 128], [0, 0, 0, 64], [0, 0, 0, 0]],
        [[120, 20, 40, 255], [10, 100, 30, 128], [40, 20, 120, 64], [80, 110, 20, 0]],
        [[240, 40, 80, 255], [20, 200, 60, 128], [80, 40, 240, 64], [160, 220, 40, 0]],
    ]
    expectations = []
    for digest in fragments:
        for colors in phases:
            pixels = {}
            for quadrant, color in enumerate(colors):
                for y in range(4 + 16 * (quadrant // 2), 12 + 16 * (quadrant // 2)):
                    for x in range(4 + 16 * (quadrant % 2), 12 + 16 * (quadrant % 2)):
                        pixels[(x, y)] = color
            expectations.append((digest, False, pixels))
    for digest in vertices:
        for sign in (1, -1):
            pixels = {}
            for y in range(32):
                for x in range(32):
                    # Rational inverse of the specified affine quadrilateral.
                    # No shader output, uniform values or readback enters it.
                    px, py = sign * Fraction(2 * x - 31, 32), sign * Fraction(2 * y - 31, 32)
                    u, v = (32 * px + 8 * py - 6) / 17, (-8 * px + 32 * py + 10) / 17
                    edge = max(abs(u), abs(v))
                    if edge < Fraction(4, 5):
                        pixels[(x, y)] = [255, 64, 128, 255]
                    elif edge > Fraction(6, 5):
                        pixels[(x, y)] = [0, 0, 255, 255]
            expectations.append((digest, True, pixels))
    require(len(hardware['draws']) == len(expectations), 'all ten hardware draws')
    total = 0
    for draw, (digest, depth, expected) in zip(hardware['draws'], expectations):
        require(draw['shaderSha256'] == digest and draw['depth'] is depth, 'draw original/depth binding')
        require(draw['checkedPixels'] == len(expected) and len(draw['checks']) == len(expected), 'pixel count')
        observed = {tuple(check['pixel']): check for check in draw['checks']}
        require(set(observed) == set(expected), 'independent pixel coordinates/uniqueness')
        for point, rgba in expected.items():
            require(observed[point]['expected'] == rgba and observed[point]['observed'] == rgba,
                    f'independent pixel mismatch at {draw["name"]} / {point}')
        stage = 'vertex' if depth else 'fragment'
        require(draw[stage + 'GlslSha256'] == sha(corpus[digest]['glsl'].encode()),
                'actual compiled original must match native/Wasm translation')
        require('failure' not in draw, 'successful draw cannot retain a failure')
        total += len(expected)
    require(total == hardware['checkedPixels'] and total > 4000, 'complete independent pixel coverage')

    require(sabotage['status'] == 'failed' and sabotage['sabotage'] == 'masked-write'
            and len(sabotage['omissions']) == 1 and len(sabotage['draws']) == 7,
            'masked-write control must reach the first original vertex draw')
    omission = sabotage['omissions'][0]
    require(omission['kind'] == 'masked-write' and omission['shaderSha256'] == vertices[0]
            and omission['originalGlslSha256'] == sha(corpus[vertices[0]]['glsl'].encode())
            and omission['servedGlslSha256'] != omission['originalGlslSha256'], 'recorded source omission')
    require('gl_Position.z = 0.0;' in omission['replacement'], 'omission fixes only the dropped lane')
    original = corpus[vertices[0]]['glsl']
    require(original.count(omission['original']) == 1, 'omission must identify one original assignment')
    changed = original.replace(omission['original'], omission['replacement'], 1)
    require(sha(changed.encode()) == omission['servedGlslSha256'], 'exact omitted source digest')
    failure = sabotage['draws'][-1]['failure']
    point = tuple(failure['pixel'])
    require(expectations[6][2][point] == failure['expected'] == [255, 64, 128, 255]
            and failure['observed'] == [0, 0, 255, 255], 'omission must fail a foreground depth pixel')
    require('independent pixel' in sabotage['failure']['message'], 'control failed wrong oracle')


if __name__ == '__main__':
    main()
