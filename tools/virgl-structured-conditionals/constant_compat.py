"""Current-head replay of E6b's real compiler GPU and isolated source-fault leaves.

The supplied retained groups are an in-memory view of the E7 native recording.
No historical native report or full-gate receipt is manufactured or retagged.
"""
from pathlib import Path

from compat_common import (ROOT, E6B, HELD_HEAD, require, read, binding, held, source,
                           unchanged, consumer_source, profile_delta, load)

PREFIX = 'tools/virgl-constant-compiler/'


def verify(output, head, native):
    output = Path(output).resolve() / 'constant-regression'
    baseline = held(E6B + '/receipt.json')
    require(baseline['task'] == 'E6-T12e6b' and baseline['status'] == 'passed',
            'verified E6b GPU baseline remains source bound')
    helpers = [PREFIX + name for name in ('browser_receipt.py', 'lifecycle_receipt.py', 'oracle.py', 'faults.py')]
    for name in helpers + ['tools/verify-virgl-constant-compiler.mjs',
                           'renderer/virgl-command/tests/constant-compiler.mjs',
                           'renderer/virgl-command/tests/constant-compiler-oracle.mjs',
                           'renderer/virgl-command/tests/constant-compiler-shaders.json',
                           'tools/lib/virgl-browser-runner.mjs']:
        unchanged(name)
    browser = load('e7_constant_compiler_browser', PREFIX + 'browser_receipt.py')
    faults = load('e7_constant_compiler_faults', PREFIX + 'faults.py')
    for name in browser.RUNTIME:
        consumer_source(name)
    view = {'cases': native['constantCases'], 'pairs': native['constantPairs'],
            'originals': native['originals']}
    clean_by_sha = {entry['inputSha256']: entry['result'] for entry in view['cases']}
    fault_directory = output / 'fault-artifacts'
    fault_summary = faults.verify(fault_directory, head, clean_by_sha)
    manifest = read(fault_directory / 'manifest.json')
    proof = browser.verify(output, head, view, manifest)
    require(proof['preview'] is False and proof['status'] == 'passed', 'complete recorded E6b GPU regression')
    names = {item['path'] for item in proof['sources'] + manifest['sources']}
    names.update(helpers + [E6B + '/receipt.json',
                 'tools/virgl-structured-conditionals/constant_compat.py',
                 'tools/virgl-structured-conditionals/compat_common.py'])
    sources = []
    for name in sorted(names):
        if '/build/' not in name:
            item = binding(ROOT / name)
            source(item, head)
            sources.append(item)
    return {'schema': 'wasm-vm-e7-constant-compiler-compat-v1', 'status': 'passed',
            'recordedHead': head, 'heldHead': HELD_HEAD, 'predecessorFullGateClaimed': False,
            'boundary': 'Unchanged real E6b compiler-input GPU oracles replayed using all exact retained native results; both compiled C source faults rebuild on the current source head.',
            'profileExtension': profile_delta(), 'baseline': binding(ROOT / E6B / 'receipt.json'),
            'modes': proof['modes'], 'compilerFaults': fault_summary,
            'records': [*proof['records'], binding(fault_directory / 'manifest.json', output)],
            'sources': sources}
