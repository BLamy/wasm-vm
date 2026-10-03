#!/usr/bin/env python3
"""Bind the new frontend proof to exact sources and independently checked pixels."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('contract_gate', ROOT / 'tools/virgl-contract/verify.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
require = gate.require
sha = gate.sha
output = Path(sys.argv[1])
contract = gate.read_json(ROOT / 'docs/gpu-3d-contract.json')
contract_receipt = gate.read_json(output / 'contract/receipt.json')
require(contract_receipt['status'] == 'passed', 'contract acceptance failed')
for filename, digest in contract_receipt['sourceSha256'].items():
    require(sha((ROOT / filename).read_bytes()) == digest, f'stale contract source {filename}')
require(contract_receipt['browserReportSha256'] == sha((output / 'contract/browser/report.json').read_bytes()),
        'contract browser receipt mismatch')
reports = {}
for name in ('literal', 'captured', 'sabotage'):
    report = gate.read_json(output / name / 'report.json')
    reports[name] = report
    require(report['guestExecution'] is False, 'unexpected guest execution claim')
    require(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser errors')
    gate.verify_files(report['sources'])
    gate.verify_files(report['servedFiles'])
    observed = {'browserVersion': report['browser']['version'],
                **{key: report['host'][key] for key in ('platform', 'architecture', 'release')},
                'renderer': report['acceptance']['renderer']['renderer']}
    require(observed in contract['browserMatrix']['qualified'], 'unqualified proof browser')
    photo = report['failureScreenshot'] if name == 'sabotage' else report['screenshot']
    require(photo['path'] == ('failure.png' if name == 'sabotage' else 'browser.png'), 'screenshot path')
    require(sha((output / name / photo['path']).read_bytes()) == photo['sha256'], 'screenshot digest')
    require(report['status'] == ('failed' if name == 'sabotage' else 'passed'), 'unexpected proof status')
literal = reports['literal']['acceptance']
require(len(literal['draws']) == 9 and literal['checkedPixels'] == 4336, 'literal regression coverage')
captured = reports['captured']['acceptance']
require(captured['status'] == 'passed' and captured['commandStreamReplay'] is False
        and captured['sabotage'] is None and captured['checkedPixels'] == 768
        and len(captured['draws']) == 3, 'captured execution boundary')
require({item['sha256'] for item in captured['translations']} == gate.PIXEL_PAIR, 'exact captured shader pair')
for item in captured['translations']:
    native = contract_receipt['capturedShaderResults'][item['sha256']]
    require(native['ok'] and native['glsl'] == item['glsl'] and native['metadata'] == item['metadata'],
            'native/Wasm shader or metadata mismatch')
    require(sha(item['sourceText'].encode()) == item['sha256'] and sha(item['glsl'].encode()) == item['glslSha256'],
            'captured shader input/output digest')
require(captured['bindings']['sameProgramAcrossPhases'] is True and captured['bindings']['programCount'] == 1,
        'constant updates must use same program')
require(captured['bindings']['indices'] == [0, 1, 2, 2, 1, 3], 'original index buffer')
require(all(item['boundComponents'] == 2 and item['strideBytes'] == 16
            and item['offsetBytes'] in (0, 8) for item in captured['bindings']['attributes']), 'original vertex layout')
expected_phases = [
    [[255,0,0,255], [0,255,0,255], [0,0,255,255], [255,255,0,255]],
    [[255,0,0,255], [0,128,0,255], [0,0,0,255], [255,128,0,255]],
    [[64,0,191,255], [0,64,191,255], [0,0,255,255], [64,64,191,255]],
]
for draw, expected in zip(captured['draws'], expected_phases):
    require(draw['checkedPixels'] == 256 and draw['expectedQuadrants'] == expected and draw['glError'] == 0,
            'captured phase coverage/oracle')
    require([check['observed'] for check in draw['checks']] == expected, 'captured phase pixel mismatch')
attacks = captured['grammarAttacks']
fixture = ROOT / 'renderer/virgl-shader/tests/captured-invalid.json'
require(attacks['sourceSha256'] == sha(fixture.read_bytes()) and len(attacks['cases']) == 112
        and attacks['recoveries'] == 1792, 'Wasm adversarial/recovery coverage')
sabotage = reports['sabotage']['acceptance']
require(sabotage['sabotage'] == 'texture-texel' and len(sabotage['draws']) == 1,
        'sabotage must reach the first actual draw')
require(sabotage['draws'][0]['failure'] == {'x': 4, 'y': 4, 'expected': [255,0,0,255], 'observed': [0,0,0,255]},
        'sabotage must fail the independent pixel oracle')
native = gate.read_json(output / 'native/native-report.json')
require(native['status'] == 'passed' and native['negativeCases'] == 112
        and native['negativeFixtureSha256'] == sha(fixture.read_bytes())
        and native['logSha256'] == sha((output / 'native/native.log').read_bytes()), 'native attack evidence')
require(native['binarySha256'] == sha((ROOT / 'renderer/virgl-shader/build/captured-sanitize/captured-test').read_bytes()),
        'native binary digest')
for item in native['inputs']:
    require(item['sha256'] in gate.PIXEL_PAIR and sha((ROOT / item['path']).read_bytes()) == item['sha256'], 'native input')
files = [path for path in (ROOT / 'renderer/virgl-shader').rglob('*')
         if path.is_file() and 'build' not in path.parts and '__pycache__' not in path.parts]
files += [ROOT / name for name in ('Makefile', 'docs/gpu-3d-decision.md', 'docs/gpu-3d-contract.json',
    'tools/lib/virgl-browser-runner.mjs', 'tools/verify-virgl-shader.mjs', 'tools/verify-virgl-captured-shaders.mjs',
    'tools/verify-virgl-captured-shaders.sh', 'tools/virgl-captured-shaders/native.py',
    'tools/virgl-captured-shaders/receipt.py', 'tools/virgl-contract/verify.py')]
compilers = [Path(shutil.which(os.environ.get('CC', 'clang'))).resolve()]
emcc = Path(shutil.which(os.environ['EMCC']) or os.environ['EMCC']).resolve()
sdk = next((parent for parent in emcc.parents if (parent / 'upstream/emscripten/emcc.py').exists()), None)
require(sdk is not None, 'pinned emsdk compiler provenance missing')
compilers += [emcc, *[sdk / name for name in ('upstream/emscripten/emcc.py', 'upstream/bin/clang',
                                          'upstream/bin/wasm-ld', 'upstream/bin/wasm-opt')]]
receipt = {'status': 'passed', 'task': 'E6-T10d',
    'claim': 'Two unmodified captured shaders execute with explicit workload bindings; no command-stream replay or guest GPU advertisement.',
    'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
    'sourceSha256': {str(path.relative_to(ROOT)): sha(path.read_bytes()) for path in sorted(set(files))},
    'compilerSha256': {str(path): sha(path.read_bytes()) for path in compilers},
    'reports': {str(path.relative_to(output)): sha(path.read_bytes()) for path in sorted(output.rglob('*.json'))
                if path.name != 'receipt.json' or path.parent != output},
    'shaderOutcomes': contract_receipt['shaderOutcomes'],
    'capturedPixels': 768, 'literalPixels': 4336, 'wasmAttacks': 112, 'wasmRecoveries': 1792,
    'sabotage': 'rejected at phase0 pixel(4,4)', 'production': contract['production']}
(output / 'receipt.json').write_text(json.dumps(receipt, indent=2, sort_keys=True) + '\n')
print('E6-T10d acceptance passed: 2 captured shaders / 3 phases / 768 pixels; literal, native, Wasm, corpus and sabotage gates passed.')
