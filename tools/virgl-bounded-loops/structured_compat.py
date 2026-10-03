"""Replay held E7 GPU/fault leaves using E9's unchanged complete E7 result groups.

The native view exists only in memory. No predecessor report is synthesized,
retagged, or supplied to its historical top-level gate.
"""
from pathlib import Path

from compat_common import (ROOT, E7, HELD_HEAD, require, read, binding, held, source,
                           unchanged, consumer_source, profile_delta, load, same)

PREFIX = 'tools/virgl-structured-conditionals/'
FIXTURE = 'renderer/virgl-command/tests/structured-conditionals-shaders.json'
HELPERS = [PREFIX + name for name in ('browser_receipt.py', 'oracle.py', 'faults.py', 'fault_wasm.mjs')]
DEPENDENCIES = [
    'tools/virgl-constant-compiler/browser_receipt.py', 'tools/virgl-constant-compiler/lifecycle_receipt.py',
    'tools/virgl-constant-compiler/oracle.py', 'tools/virgl-dot-reciprocals/oracle.py',
    'tools/virgl-component-floats/oracle.py', 'tools/virgl-numeric-floats/oracle.py',
]


def native_view(native):
    baseline = held(E7 + '/native/native-report.json')
    for current, prior in [('structuredCases', 'cases'), ('structuredPairs', 'pairs'), ('structuredFixtures', 'fixtures')]:
        require(same(native[current], baseline[prior]), f'all full retained E7 native records: {current}')
    require(same(native['originals'], baseline['originals']), 'all full original E7 outcomes')
    for item in native['structuredFixtures']:
        unchanged(item['path'])
        require(same(item, binding(ROOT / item['path'])), 'literal E7 fixtures remain exact')
    return {'cases': native['structuredCases'], 'pairs': native['structuredPairs'],
            'fixtures': native['structuredFixtures'], 'originals': native['originals']}


def verify(output, head, native):
    output = Path(output).resolve() / 'structured-regression'
    baseline = held(E7 + '/receipt.json')
    require(baseline['task'] == 'E6-T12e7' and baseline['status'] == 'passed', 'verified E7 baseline remains source bound')
    for name in HELPERS + DEPENDENCIES + [FIXTURE, 'tools/verify-virgl-structured-conditionals.mjs',
            'renderer/virgl-command/tests/structured-conditionals.mjs',
            'renderer/virgl-command/tests/structured-conditionals-oracle.mjs', 'tools/lib/virgl-browser-runner.mjs']:
        unchanged(name)
    browser = load('e9_held_structured_gpu', PREFIX + 'browser_receipt.py')
    faults = load('e9_held_structured_faults', PREFIX + 'faults.py')
    for name in browser.RUNTIME:
        consumer_source(name)
    view = native_view(native)
    clean_by_sha = {}
    for entry in view['cases']:
        digest = entry['inputSha256']
        require(digest not in clean_by_sha or same(clean_by_sha[digest], entry['result']),
                'identical E7 shader bodies retain identical complete results')
        clean_by_sha[digest] = entry['result']
    fault_directory = output / 'fault-artifacts'
    fault_summary = faults.verify(fault_directory, head, clean_by_sha)
    manifest = read(fault_directory / 'manifest.json')
    proof = browser.verify(output, head, view, manifest)
    require(proof['preview'] is False and proof['status'] == 'passed', 'complete exact-head E7 GPU leaf replay')
    names = {item['path'] for item in proof['sources'] + manifest['sources']}
    names.update(HELPERS + DEPENDENCIES + [E7 + '/receipt.json', E7 + '/native/native-report.json',
                 'tools/virgl-bounded-loops/structured_compat.py', 'tools/virgl-bounded-loops/compat_common.py'])
    sources = []
    for name in sorted(names):
        if '/build/' not in name:
            item = binding(ROOT / name)
            source(item, head)
            sources.append(item)
    return {'schema': 'wasm-vm-e9-structured-conditional-compat-v1', 'status': 'passed',
            'recordedHead': head, 'heldHead': HELD_HEAD, 'predecessorFullGateClaimed': False,
            'boundary': 'Unchanged literal E7 branch and join GPU oracles replayed against exact retained native results; both actual compiler source faults rebuild at the current head. Historical complete E7 gate is not claimed.',
            'profileExtension': profile_delta(), 'baseline': binding(ROOT / E7 / 'receipt.json'),
            'cases': len(view['cases']), 'pairs': len(view['pairs']), 'modes': proof['modes'], 'compilerFaults': fault_summary,
            'records': [*proof['records'], binding(fault_directory / 'manifest.json', output)], 'sources': sources}
