#!/usr/bin/env python3
"""Cross-check the frozen renderer decision against raw guest evidence and browser proof."""
from __future__ import annotations

import argparse
from collections import Counter
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
CATEGORIES = ('opcodes', 'objects', 'shaderInstructions', 'apiCalls', 'shaderStageCounts', 'resourceFormats')
WORKLOADS = ('textured-scene', 'kmscube', 'glmark2-es2', 'compositor')
PRODUCTION = {'virglFeature': False, 'numCapsets': 0, 'capsets': [], 'guestRendererImplemented': False}


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f'duplicate JSON key {key}')
            result[key] = value
        return result
    return json.loads(path.read_text(), object_pairs_hook=unique)


def check_matrix(contract, totals, manifests, shaders, vertices):
    require(contract['schema'] == 'wasm-vm-virgl-browser-contract-v1', 'contract schema')
    require(contract['production'] == PRODUCTION, 'production 3D must remain disabled')
    require(contract['captureManifests'] == manifests, 'capture manifest identity differs')
    require(set(contract['matrix']) == set(CATEGORIES), 'matrix categories differ')
    for category in CATEGORIES:
        entries = contract['matrix'][category]
        require(set(entries) == set(totals[category]), f'{category}: missing/extra feature')
        for name, row in entries.items():
            require(type(row['corpusOccurrences']) is int and row['corpusOccurrences'] == totals[category][name],
                    f'{category}.{name}: count differs')
            require(row['status'] in ('supported', 'implementable', 'rejected'), f'{category}.{name}: status')
            require(isinstance(row['mapping'], str) and len(row['mapping']) >= 30
                    and not re.search(r'\bTBD\b', row['mapping']), f'{category}.{name}: missing mapping')
            if row['status'] == 'supported':
                require(category == 'shaderStageCounts' or
                        (category == 'shaderInstructions' and name in ('ADD', 'MOV', 'MUL', 'TEX', 'END')),
                        f'{category}.{name}: unsupported current implementation claim')
            if name.endswith('_PRECISE') or (category == 'resourceFormats' and name == '17'):
                require(row['status'] == 'rejected', f'{category}.{name}: must remain rejected')
    expected_shaders = {digest: {'stage': info['stage'], 'currentBridge': 'rejected'}
                        for digest, info in shaders.items()}
    require(contract['capturedShaders'] == expected_shaders, 'captured shader identity/status differs')
    require(set(contract['vertexFormats']) == set(vertices), 'vertex format coverage differs')
    for key, count in vertices.items():
        row = contract['vertexFormats'][key]
        require(row['corpusOccurrences'] == count and row['status'] == 'implementable', 'vertex format count/status')
    require(set(contract['shaderSyntax']) == {
        'declaration-ranges-and-order', 'declaration-masks', 'semantics-and-interpolation',
        'UINT32-immediates', 'partial-destination-writes', 'source-swizzles-and-negation',
        'indirect-constant-index', 'structured-target-annotations', 'FS_COLOR0_WRITES_ALL_CBUFS',
        'TEX-2D-FLOAT', 'PRECISE'}, 'shader syntax coverage differs')
    require(contract['shaderSyntax']['PRECISE']['status'] == 'rejected', 'precise syntax must be rejected')


def qualify_browser(contract, report):
    require(contract['browserMatrix']['default'] == 'reject', 'browser matrix must default to rejection')
    require(contract['browserMatrix']['qualificationScope'] == 'prototype-only', 'qualification scope')
    observed = {'browserVersion': report['browser']['version'],
                **{key: report['host'][key] for key in ('platform', 'architecture', 'release')},
                'renderer': report['acceptance']['renderer']['renderer']}
    require(observed in contract['browserMatrix']['qualified'], 'unqualified browser/host')
    require(not re.search(r'swiftshader|llvmpipe|softpipe|lavapipe', observed['renderer'], re.I), 'software renderer')
    require(report['status'] == 'passed' and report['guestExecution'] is False
            and report['currentGuest3dAdvertisement'] is False and report['capturedGuestShadersSupported'] is False,
            'invalid browser proof scope/status')
    require(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser errors')
    acceptance = report['acceptance']
    require(acceptance['status'] == 'passed' and acceptance['guestExecution'] is False, 'translation proof')
    require(len(acceptance['draws']) == 9 and acceptance['checkedPixels'] == 4336, 'literal draw coverage differs')
    require(all(draw['glError'] == 0 for draw in acceptance['draws']), 'draw GL error')
    probes = report['backendProbes']
    require(probes['status'] == 'passed' and probes['guestExecution'] is False, 'backend probe scope')
    names = {probe['name']: probe for probe in probes['probes']}
    require(set(names) == {'precise-qualifier-litmus', 'texture-view-swizzle',
                          'virtual-context-state-replay', 'asynchronous-fence-event-loop'}, 'API probe coverage')
    require(all(probe['status'] == 'passed' for probe in names.values()), 'failed API probe')
    precise = names['precise-qualifier-litmus']
    require(precise['baseline']['compiled'] is True and precise['precise']['compiled'] is False,
            'precise negative control differs')
    for case in names['texture-view-swizzle']['cases']:
        require(case['expected'] == case['observed'], 'swizzle pixel mismatch')
    require({case['name'] for case in names['texture-view-swizzle']['cases']} == {'bgra', 'bgrx', 'rgbx'}, 'view cases')
    fence = names['asynchronous-fence-event-loop']
    require(fence['expected'] == fence['observed'] and fence['timeoutNanoseconds'] == 0, 'fence pixels/wait')
    require(fence['events'].index('unrelated-timer-ran') < fence['events'].index('fence-signaled-after-yield'),
            'fence did not yield event loop')
    for limit, minimum in contract['futureGles3HostPrerequisites'].items():
        require(probes['limits'][limit] >= minimum, f'future prerequisite missing: {limit}')
    return observed


def verify_files(items):
    for item in items:
        path = ROOT / item['path']
        require(path.resolve().is_relative_to(ROOT.resolve()), 'evidence source path escapes repository')
        data = path.read_bytes()
        require(len(data) == item['size'] and sha(data) == item['sha256'], f'stale browser source: {item["path"]}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser-report', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    contract = read_json(ROOT / 'docs/gpu-3d-contract.json')
    spec = importlib.util.spec_from_file_location('virgl_capture_validate', ROOT / 'tools/virgl-capture/validate.py')
    capture = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = capture
    spec.loader.exec_module(capture)
    totals = {key: Counter() for key in CATEGORIES}
    manifests, shaders, vertices = {}, {}, Counter()
    for workload in WORKLOADS:
        directory = ROOT / 'evidence/virgl-corpus/captures' / workload
        summary, extracted = capture.validate_capture(directory)
        capture.generated_outputs(directory, summary, extracted)
        manifests[workload] = summary['manifestSha256']
        for key in CATEGORIES:
            totals[key].update(summary[key])
        for digest, info in extracted.items():
            shaders[digest] = info
        require(summary['versions']['guest'] == {
            'architecture': contract['pins']['guestArchitecture'], 'mesa': contract['pins']['mesa'],
            'hyprland': contract['pins']['hyprland']}, 'guest pin mismatch')
        require(summary['versions']['host']['virglCommit'] == contract['pins']['virglCommit']
                and summary['versions']['host']['virglrenderer'] == contract['pins']['virglrenderer'], 'renderer pin mismatch')
        for submit in summary['submissions']:
            raw = directory / 'blobs' / (submit['sha256'] + '.bin')
            # Full capture validation above already bounded, hashed and checked these bytes.
            data = raw.read_bytes() if raw.exists() else gzip.decompress(raw.with_suffix('.bin.gz').read_bytes())
            words = struct.unpack('<' + 'I' * (len(data) // 4), data)
            offset = 0
            while offset < len(words):
                header = words[offset]
                length = header >> 16
                if capture.COMMANDS[header & 255] == 'CREATE_OBJECT' and capture.OBJECTS[(header >> 8) & 255] == 'VERTEX_ELEMENTS':
                    require(length >= 1 and (length - 1) % 4 == 0, 'vertex element packet shape')
                    for index in range((length - 1) // 4):
                        vertices[str(words[offset + 5 + 4 * index])] += 1
                offset += length + 1
    check_matrix(contract, totals, manifests, shaders, vertices)
    rejection_results = {}
    executable = ROOT / 'renderer/virgl-shader/build/native/virgl-shader'
    for digest, info in sorted(shaders.items()):
        result = subprocess.run([str(executable), {'VERT': 'vertex', 'FRAG': 'fragment'}[info['stage']]],
                                input=info['text'], capture_output=True, check=True, timeout=5)
        value = json.loads(result.stdout)
        require(value.get('ok') is False and value['error']['code'] in ('unsupported-feature', 'parse-error'),
                f'captured shader support changed: {digest}')
        rejection_results[digest] = value
    with tempfile.TemporaryDirectory(prefix='virgl-capset-layout-') as temporary:
        binary = Path(temporary) / 'layout'
        command = [os.environ.get('CC', 'clang'), '-std=c11', '-Wall', '-Wextra', '-Werror', '-pedantic',
                   str(ROOT / 'tools/virgl-contract/caps_layout.c'), '-o', str(binary)]
        subprocess.run(command, check=True, timeout=30)
        actual = subprocess.check_output([str(binary)], timeout=5)
        require(actual == (ROOT / 'renderer/virgl-contract/capset-layout.json').read_bytes(), 'capset ABI layout differs')
    browser = read_json(args.browser_report)
    qualified = qualify_browser(contract, browser)
    verify_files(browser['sources'])
    verify_files(browser['servedFiles'])
    required_browser_sources = {'tools/verify-virgl-contract-browser.mjs', 'renderer/virgl-contract/browser.mjs',
                                'renderer/virgl-shader/bridge.c', 'renderer/virgl-shader/index.mjs'}
    require(required_browser_sources <= {item['path'] for item in browser['sources']}, 'missing browser source bindings')
    require(any(item['path'].endswith('/virgl-shader.wasm') for item in browser['servedFiles']), 'missing served Wasm')
    screenshot = browser['screenshot']
    require(screenshot['path'] == 'browser.png', 'screenshot path')
    require(sha((args.browser_report.parent / screenshot['path']).read_bytes()) == screenshot['sha256'], 'screenshot digest')
    source_names = ['docs/gpu-3d-decision.md', 'docs/gpu-3d-contract.json', 'Makefile',
                    'tools/verify-virgl-contract.sh', 'tools/verify-virgl-contract-browser.mjs',
                    'tools/virgl-contract/verify.py', 'tools/virgl-contract/caps_layout.c',
                    'tools/virgl-contract/test_verify.py', 'renderer/virgl-contract/browser.mjs',
                    'renderer/virgl-contract/capset-layout.json']
    receipt = {'status': 'passed', 'scope': contract['scope'], 'production': PRODUCTION,
               'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
               'sourceSha256': {name: sha((ROOT / name).read_bytes()) for name in source_names},
               'browserReportSha256': sha(args.browser_report.read_bytes()), 'qualifiedPrototype': qualified,
               'captureManifests': manifests, 'featureCounts': {key: len(value) for key, value in totals.items()},
               'vertexFormats': dict(vertices), 'capturedShaderResults': rejection_results,
               'rejectionsByCode': dict(Counter(value['error']['code'] for value in rejection_results.values())),
               'layoutSha256': sha(actual)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, indent=2, sort_keys=True) + '\n')
    print(json.dumps({key: receipt[key] for key in ('status', 'featureCounts', 'vertexFormats', 'rejectionsByCode')}, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(f'VirGL contract verification failed: {error}', file=sys.stderr)
        raise SystemExit(1)
