"""Current-compiler replay of unchanged legacy renderer leaf validators.

The historical top-level compiler-unchanged assertion remains intact in its
original module. This successor wrapper does not call or manufacture that gate.
"""
from pathlib import Path
import json
from compat_common import ROOT, HELD_HEAD as CONSUMER_HEAD, unchanged, load

prior = load('e6b_legacy_renderer_leaves', 'tools/virgl-constant-domains/regressions.py')
base, HELD_HEAD = prior.base, prior.HELD_HEAD
require, sha, read, binding = prior.require, prior.sha, prior.read, prior.binding
REGISTRATIONS, BASELINES, TASKS = prior.REGISTRATIONS, prior.BASELINES, prior.TASKS
STATE, DOMAIN = prior.STATE, prior.DOMAIN
verify_native, verify_async, verify_flat = prior.verify_native, prior.verify_async, prior.verify_flat
unchanged_or_registration = prior.unchanged_or_registration

def verify(output, head, contract):
    output = Path(output).resolve()
    directory = output / 'legacy'
    unchanged('tools/virgl-constant-domains/regressions.py')
    for tree in ('renderer/virgl-command', 'tools/virgl-command', 'tools/virgl-constants', 'tools/virgl-pairs'):
        for name in base.git('ls-tree', '-r', '--name-only', CONSUMER_HEAD, '--', tree).decode().splitlines():
            unchanged(name)
    require(contract['production'] == json.loads(base.git('show', f'{HELD_HEAD}:docs/gpu-3d-contract.json'))['production'],
            'production negotiation unchanged')
    compiler = base.git('ls-tree', '-r', '--name-only', head, '--', 'renderer/virgl-shader').decode().splitlines()
    for path in REGISTRATIONS:
        unchanged_or_registration(path)
    native, fixtures, cases, originals = verify_native(directory, head)
    decoder = base.verify_decoder(directory)
    hardware = base.verify_browser(directory / 'hardware', head, contract)
    sabotage = base.verify_browser(directory / 'sabotage', head, contract, passed=False)
    for report in (hardware, sabotage):
        base.verify_translations(report['acceptance'], fixtures, cases, originals, decoder)
    base.verify_hardware(hardware['acceptance'], cases)
    control = sabotage['acceptance']
    require(control['status'] == 'failed' and len(control['rigs']) == 1 and not control['validationRigs']
            and len(control['rigs'][0]['draws']) == 1, 'high-upload control stops at first actual draw')
    base.verify_rig(control['rigs'][0], cases, sabotage=True)
    source = ROOT / STATE
    before = 'gl.uniform4uiv(uniform.location, words);'
    after = 'gl.uniform4uiv(uniform.location, words.subarray(0, Math.min(words.length, 180)));'
    require(source.read_text().count(before) == 1 and sabotage['sabotage'] == {
        'mode': 'high-upload', 'source': STATE, 'before': before, 'after': after,
        'originalSha256': sha(source.read_bytes()), 'servedSha256': sha(source.read_text().replace(before, after).encode()),
        'expectedFailure': {'name': 'A first high-bank draw', 'pixel': [0, 0],
                            'expected': [64, 191, 128, 191], 'observed': [0, 0, 255, 255]},
        'boundary': 'served-source upload prefix shortened; authored packets, compiler and linked GLSL unchanged'},
        'exact unchanged high-upload fault semantics on current shared restore')
    require('A first high-bank draw independent pixel (0,0)' in control['failure']['message']
            and hardware['sources'] == sabotage['sources'], 'high-upload fault contradicts actual independent framebuffer oracle')
    async_receipt, async_reports = verify_async(directory / 'regression', head, hardware, originals)
    flat = verify_flat(directory / 'flat-regression', head, contract, originals)
    names = set(compiler) | set(REGISTRATIONS) | set(BASELINES) | {
        STATE, DOMAIN, base.FIXTURE, 'docs/gpu-3d-contract.json', 'tools/virgl-constant-domains/regressions.py', 'tools/virgl-constant-compiler/legacy_compat.py',
        'tools/virgl-constants/receipt.py', 'tools/virgl-pairs/receipt.py'}
    reports = [hardware, sabotage, flat, *async_reports]
    names.update(item['path'] for report in reports for item in report['sources'] + report.get('inputs', []))
    names.update(item['path'] for item in native['sources'])
    sources = []
    for name in sorted(names):
        if '/build/' in name:
            continue
        item = binding(ROOT / name)
        base.verify_source(item, head)
        if name not in compiler and not name.startswith(('evidence/', 'tools/virgl-constant-domains/', 'tools/virgl-constant-compiler/')):
            unchanged_or_registration(name)
        sources.append(item)
    for report in (hardware, sabotage, flat):
        served = {e['path'] for e in report['servedFiles']}
        require(DOMAIN in served and STATE in served, 'actual current consumer modules served to legacy constants/pairs')
    return {'schema': 'wasm-vm-e6b-legacy-renderer-compat-v1', 'heldConsumerHead': CONSUMER_HEAD, 'recordedHead': head,
        'boundary': 'Current legacy native/Wasm full outputs equal verified E3b/E6. Unchanged E6a renderer, decoder, state, async, constants and pair oracles re-executed under current compiler; historical compiler-unchanged full gate is not claimed.',
        'nativeCalls': 27, 'originals': 19, 'acceptedOriginals': 12, 'decoderCases': 23,
        'constantPixels': 45056, 'actualConstantRigs': 10, 'validationConstantRigs': 25,
        'asyncPackets': 210, 'asyncInteriorPixels': 768, 'asyncAttacks': 93,
        'synchronousRegressions': list(TASKS), 'pairCases': 114, 'pairDraws': 52,
        'controls': ['high-upload', 'early-collect', 'index-class'],
        'native': binding(directory / 'native/native-report.json', output),
        'asyncReceipt': binding(directory / 'regression/receipt.json', output),
        'reports': [binding(directory / path / 'report.json', output) for path in
            ['hardware', 'sabotage', 'flat-regression', 'regression/hardware', 'regression/sabotage-early-collect',
             'regression/sabotage-index-class', *['regression/regression/' + name for name in TASKS]]],
        'sources': sources, 'compilerSha256': {'native': native['binarySha256'],
            'wasm': sha((ROOT / 'renderer/virgl-shader/build/wasm/virgl-shader.wasm').read_bytes())}}
