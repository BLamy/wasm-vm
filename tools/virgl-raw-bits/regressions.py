#!/usr/bin/env python3
"""Recheck held legacy semantics using fresh constant, async and bank recordings.

The E3b receipt itself deliberately requires an unchanged compiler. This successor
uses its narrow packet/pixel validators while comparing each legacy translation
against that verified baseline; it does not relax the historical receipt.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
HELD_HEAD = 'f643c50d3379e4e27a1daf1784f67287fe36d562'
HELD_NATIVE = 'evidence/virgl-constants/worker/native/native-report.json'
HELD_NATIVE_SHA256 = '1ecee077496f3eea591ff4ac3a14afef91a33700d69d92b174d82bad3881ffef'
HELD_ASYNC = 'evidence/virgl-constants/worker/regression/hardware/report.json'
CONSTANT_FIXTURE = 'renderer/virgl-command/tests/constant-shaders.json'
HELPERS = ['tools/virgl-constants/receipt.py', 'tools/virgl-banks/receipt.py',
           'tools/virgl-raw-bits/regressions.py']


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


constants = load('raw_bit_constant_regression', HELPERS[0])
banks = load('raw_bit_bank_regression', HELPERS[1])
require = constants.require
sha = constants.sha
read = constants.read
binding = constants.binding
verify_source = constants.verify_source


def held_json(path):
    raw = constants.git('show', f'{HELD_HEAD}:{path}')
    require((ROOT / path).read_bytes() == raw, f'held evidence changed: {path}')
    return json.loads(raw)


def regression_head(report, head):
    """Carry prior runs only across this task's browser-recording-only repair.

    Every recorded source and built artifact is still checked below. The narrow
    allowlist forbids using this path to excuse any changed runtime, dependency,
    fixture or legacy oracle; a pristine clone always records the current head.
    """
    recorded = report['gitHead']
    require(re.fullmatch('[0-9a-f]{40}', recorded), 'complete recorded regression head')
    if recorded != head:
        require(subprocess.run(['git', 'merge-base', '--is-ancestor', recorded, head], cwd=ROOT,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0,
                'reused regression must be an ancestor of current evidence harness')
        changed = set(constants.git('diff', '--name-only', recorded, head).decode().splitlines())
        require(changed <= {'tools/verify-virgl-raw-bits.mjs', 'tools/virgl-raw-bits/regressions.py'},
                'only coverage recording and this unchanged-source binding may differ from held regression')
    return recorded


def verify_async(directory, head, originals, qualified_report):
    report = read(directory / 'report.json')
    regression_head(report, head)
    require(report['task'] == 'E6-T11b1' and report['status'] == 'passed',
            'current asynchronous renderer regression')
    require(report['trackedChanges'] == [] and report['guestExecution'] is False and
            report['browserErrors'] == {'console': [], 'page': [], 'requests': []},
            'frozen isolated error-free asynchronous run')
    result = report['browserResult']
    require(result['status'] == result['result']['status'] == 'passed', 'complete asynchronous browser result')
    require(sha(json.dumps(result, separators=(',', ':'), ensure_ascii=False).encode()) == report['browserResultSha256'],
            'complete serialized asynchronous result digest')
    proof = result['result']
    require(proof['guestExecution'] is False and proof['primaryAsyncReplay'] is True, 'explicit async boundary')
    sources = {item['path']: item for item in report['sources'] + report['inputs']}
    require(len(sources) == len(report['sources']) + len(report['inputs']), 'unique async source/input identity')
    for item in sources.values():
        verify_source(item, head)
    served = {item['path']: item for item in report['servedFiles']}
    for name, item in served.items():
        if name in ('/', '/fixtures.json'):
            continue
        source = sources.get(name.removeprefix('/'))
        require(source is not None and item['sha256'] == source['sha256'] and item['bytes'] == source['bytes'],
                f'exact served asynchronous runtime: {name}')
    compiler = '/renderer/virgl-shader/build/wasm/virgl-shader.wasm'
    require(compiler in served and served[compiler]['sha256'] == sources[compiler[1:]]['sha256'],
            'asynchronous run consumed current Wasm compiler')
    held = held_json(HELD_ASYNC)
    require(report['inputs'] == held['inputs'] and report['fixtureTransport'] == held['fixtureTransport'] and
            served['/fixtures.json']['sha256'] == report['fixtureTransport']['sha256'],
            'unchanged original command/resource fixture transport')
    # Unchanged renderer and oracle sources justify retaining their prior attack
    # controls. This run is a regression under the new compiler, not a new claim
    # about their implementation or concurrency boundary.
    for item in report['sources']:
        if item['path'].startswith(('renderer/virgl-command/', 'tools/virgl-command/')) or item['path'] == 'tools/verify-virgl-async-jobs.mjs':
            require(constants.git('show', f'{HELD_HEAD}:{item["path"]}') == (ROOT / item['path']).read_bytes(),
                    'held asynchronous ownership/oracle code unchanged')
    coverage = report['browserCoverage']
    raw_coverage = (directory / coverage['path']).read_bytes()
    require(sha(raw_coverage) == coverage['sha256'], 'async coverage digest')
    scripts = json.loads(raw_coverage)['scripts']
    require([s['source'] for s in scripts] == ['renderer/virgl-command/state.mjs', 'renderer/virgl-command/resources.mjs'],
            'both shared ownership engines recorded')
    for script in scripts:
        require(script['sha256'] == sources[script['source']]['sha256'] == served['/' + script['source']]['sha256'],
                'async coverage describes actual served runtime')
    screen = report['screenshot']
    require(sha((directory / screen['path']).read_bytes()) == screen['sha256'], 'async browser capture')
    browser = report['browser']
    require(browser['headless'] is False and browser['gpu']['featureStatus'][browser['webglFeature']] == 'enabled',
            'actual hardware asynchronous rendering')
    qualified_browser = qualified_report['browser']
    require(browser['version'] == qualified_browser['version'] and
            all(report['host'][key] == qualified_report['host'][key] for key in ('platform', 'architecture', 'release')) and
            browser['gpu']['devices'] == qualified_browser['gpu']['devices'] and
            browser['gpu']['auxAttributes']['glRenderer'] == qualified_browser['gpu']['auxAttributes']['glRenderer'],
            'same actual GPU/browser as independently qualified constant run')
    require(not any(any(marker in arg.lower() for marker in ('swiftshader', 'llvmpipe', 'softpipe', 'lavapipe', '--disable-gpu'))
                    for arg in browser['commandLine']), 'no software GPU flags')
    original = proof['original']
    require(original['packetCount'] == 210 and original['gpuDraws'] == 3 and original['checkedPixels'] == 768,
            'complete original async draw/pixel replay')
    require([entry['event'] for entry in original['submissions']] == [161, 173, 185, 197, 209, 221, 233, 249],
            'unchanged original submission order')
    require([entry['readback']['offset'] for entry in original['frames']] == [64, 4160, 8256], 'original readback offsets')
    require([entry['readback']['rgbaSha256'] for entry in original['frames']] ==
            [entry['readback']['rgbaSha256'] for entry in held['browserResult']['result']['original']['frames']],
            'all three complete async framebuffers match held recording')
    # Literal quadrant colors from the original workload. Hash equality above
    # also checks pixels outside the 768 explicitly probed interior samples.
    colors = [[[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255]],
              [[255, 0, 0, 255], [0, 128, 0, 255], [0, 0, 0, 255], [255, 128, 0, 255]],
              [[64, 0, 191, 255], [0, 64, 191, 255], [0, 0, 255, 255], [64, 64, 191, 255]]]
    for frame, expected in zip(original['frames'], colors):
        require(frame['pixels']['pixels'] == 256 and frame['pixels']['checks'] == [
            {'quadrant': q, 'rectangle': [4 + 16 * (q % 2), 4 + 16 * (q // 2), 8, 8],
             'expected': color, 'pixels': 64} for q, color in enumerate(expected)], 'literal async interior pixel oracle')
    for translation in original['translations']:
        digest = sha(translation['text'].encode('ascii'))
        require(digest in originals and {'ok': True, 'glsl': translation['glsl'], 'metadata': translation['metadata']} == originals[digest],
                'async compiler result exactly matches held/current native original')
    sequencing = original['sequencing']
    require([sequencing[key] for key in ('stagedCopies', 'pboReads', 'collections')] == [3, 3, 6],
            'async original staged readback paths')
    require(original['heartbeatTicks'] > 0 and sequencing['turns'] > 0 and sequencing['polls'] > 0,
            'browser progressed during pending async jobs')
    require(all(entry['result']['gpuComplete'] is True for entry in original['submissions']), 'all submissions reached GPU completion')
    require([entry['layout']['tightBytes'] for entry in original['exchanges'] if entry['status'] == 'needs-input'] == [64, 12, 16],
            'original input bytes cross fresh DMA boundary')
    cleanup = original['cleanup']
    require(all(value == 0 for owner in ('state', 'resources') for value in cleanup[owner].values()) and
            all(cleanup['async'][key] == 0 for key in ('reads', 'transfers', 'stagingBytes')) and
            all(cleanup['actualGl'][key] == 0 for key in ('liveObjects', 'liveSyncs')), 'async ownership cleanup')
    poison = proof['outputReferencePoison']
    require(poison['bytes'] == 12288 and poison['hashes'] == [frame['readback']['rgbaSha256'] for frame in original['frames']],
            'reference-output poisoning does not affect actual rendering')
    require(proof['attacks'] == held['browserResult']['result']['attacks'], 'same 93 bounded async rejection cases')
    require([r['name'] for r in proof['schedules']] ==
            ['baseline', 'one withheld signal', 'seeded zero to three withheld signals'] and
            proof['schedules'][2]['seed'] == 608135816, 'three original bounded asynchronous schedules')
    return report


def verify(output, head, contract):
    """Return source bindings and compact fresh-regression proof for root receipt."""
    output = Path(output)
    legacy = held_json(HELD_NATIVE)
    require(sha((ROOT / HELD_NATIVE).read_bytes()) == HELD_NATIVE_SHA256, 'exact verified E3b native baseline')
    require(legacy['status'] == 'passed' and legacy['schema'] == 'wasm-vm-constants-native-v1', 'held native schema')
    verify_source(legacy['fixture'], head)
    require(legacy['fixture']['path'] == CONSTANT_FIXTURE, 'held constant fixture identity')
    fixtures = read(ROOT / CONSTANT_FIXTURE)
    require(len(fixtures) == len(legacy['cases']) == 8, 'eight old authored constant shaders')
    cases = {}
    for fixture, case in zip(fixtures, legacy['cases']):
        require(case['name'] == fixture['name'] and case['stage'] == fixture['stage'] and case['expected'] == fixture['expected'] and
                case['inputSha256'] == sha(fixture['text'].encode('ascii')), 'held exact authored shader binding')
        cases[case['name']] = case
    originals = {entry['sha256']: entry['result'] for entry in legacy['originals']}
    current_native = read(output / 'native/native-report.json')
    require(current_native['schema'] == 'wasm-vm-raw-bits-native-v1' and current_native['status'] == 'passed' and
            {entry['sha256']: entry['result'] for entry in current_native['originals']} == originals,
            'current native originals equal held full translations')
    constant_output = output / 'constant-regression'
    decoder = constants.verify_decoder(constant_output)
    constant_head = regression_head(read(constant_output / 'hardware/report.json'), head)
    hardware = constants.verify_browser(constant_output / 'hardware', constant_head, contract)
    constants.verify_translations(hardware['acceptance'], fixtures, cases, originals, decoder)
    constants.verify_hardware(hardware['acceptance'], cases)
    for item in hardware['sources']:
        if item['path'].startswith(('renderer/virgl-command/', 'tools/virgl-constants/')) or item['path'] == 'tools/verify-virgl-constants.mjs':
            require(constants.git('show', f'{HELD_HEAD}:{item["path"]}') == (ROOT / item['path']).read_bytes(),
                    'held finite-command decoder/reflection/pixel oracle unchanged')
    async_report = verify_async(output / 'async-regression', head, originals, hardware)
    regression_output = output / 'regression'
    regression = read(regression_output / 'receipt.json')
    bank_head = regression_head(regression, head)
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
    names.update(HELPERS + [CONSTANT_FIXTURE, 'tools/virgl-constants/decoder.mjs', HELD_NATIVE, HELD_ASYNC])
    sources = []
    for name in sorted(names):
        if '/build/' not in name:
            item = binding(ROOT / name)
            verify_source(item, head)
            sources.append(item)
    return {'heldLegacyHead': HELD_HEAD,
            'recordedHeads': {'banks': bank_head, 'constants': constant_head, 'async': async_report['gitHead']},
            'boundary': 'Current browser legacy outputs equal verified native E3b results; current native originals and full bank regression remain exact. Historical unchanged-compiler receipt is retained, not reinterpreted.',
            'constantCases': 23, 'constantPixels': 45056, 'actualConstantRigs': 10, 'validationConstantRigs': 25,
            'asyncPackets': 210, 'asyncInteriorPixels': 768, 'asyncAttacks': len(async_report['browserResult']['result']['attacks']),
            'bankCases': len(bank_fixtures), 'bankReceipt': binding(regression_output / 'receipt.json', output),
            'constantReport': binding(constant_output / 'hardware/report.json', output),
            'constantDecoder': binding(constant_output / 'decoder/decoder-report.json', output),
            'asyncReport': binding(output / 'async-regression/report.json', output),
            'legacyNative': binding(ROOT / HELD_NATIVE), 'sources': sources}
