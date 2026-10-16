"""Explicit E6a compatibility checks for unchanged legacy renderer workloads.

The E3b top-level receipt deliberately pins its old compiler and remains intact.
This adapter checks current recordings against its complete verified results,
reuses its narrow independent oracles, and permits only the new renderer boundary.
It never writes or fabricates a historical receipt.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HELD_HEAD = '5561bf3d8a16d2e847b7772909bf772f2c8c57d5'
LEGACY = 'evidence/virgl-constants/worker'
LEGACY_NATIVE_SHA256 = '1ecee077496f3eea591ff4ac3a14afef91a33700d69d92b174d82bad3881ffef'
DOMAIN = 'renderer/virgl-command/constant-domain.mjs'
STATE = 'renderer/virgl-command/state.mjs'
REGISTRATIONS = {
    'tools/verify-virgl-object-state.mjs', 'tools/verify-virgl-async-jobs.mjs',
    'tools/verify-virgl-draw-replay.mjs', 'tools/verify-virgl-control.mjs',
    'tools/verify-virgl-constants.mjs', 'tools/verify-virgl-pairs.mjs',
    'tools/virgl-command/submit-sources.json', 'tools/virgl-command/scanout-sources.json',
}
TASKS = {'decoder': 'E6-T12a', 'resources': 'E6-T12b', 'state': 'E6-T12c', 'draw': 'E6-T12d'}
BASELINES = [LEGACY + '/native/native-report.json', LEGACY + '/flat-regression/report.json',
             LEGACY + '/regression/hardware/report.json',
             *[LEGACY + '/regression/regression/' + name + '/report.json' for name in TASKS],
             'evidence/virgl-dot-reciprocals/worker/native/native-report.json']


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


base = load('domain_legacy_constants', 'tools/virgl-constants/receipt.py')
pairs_gate = load('domain_legacy_pairs', 'tools/virgl-pairs/receipt.py')
require, sha, read, binding = base.require, base.sha, base.read, base.binding


def held(path):
    raw = base.git('show', f'{HELD_HEAD}:{path}')
    require(raw == (ROOT / path).read_bytes(), f'verified baseline altered: {path}')
    return json.loads(raw)


def unchanged_or_registration(path):
    """Permit exactly one new source-list entry, without changing old oracles."""
    raw = (ROOT / path).read_bytes()
    if path in (STATE, DOMAIN) or '/build/' in path:
        return
    old = base.git('show', f'{HELD_HEAD}:{path}')
    if path in REGISTRATIONS:
        quote = b'"' if path.endswith('.json') else b"'"
        item = quote + DOMAIN.encode() + quote + b','
        require(raw.count(item) == 1, f'exactly one domain source registration: {path}')
        start = raw.index(item)
        # Existing compact and spaced source lists retain their literal layout.
        variants = [raw[:start] + raw[start + len(item):]]
        if raw[start + len(item):].startswith(b' '):
            variants.append(raw[:start] + raw[start + len(item) + 1:])
        require(old in variants, f'only domain source registration may change: {path}')
    elif (path.startswith(('renderer/virgl-command/', 'tools/virgl-command/',
                            'tools/virgl-constants/', 'tools/virgl-pairs/'))
          and Path(path).suffix in ('.mjs', '.py', '.json')) or path.startswith('tools/verify-virgl-') or path in {
              'tools/lib/virgl-browser-runner.mjs', 'tools/setup-virgl-emsdk.sh'}:
        require(raw == old, f'legacy runtime, input or independent oracle changed: {path}')


def verify_native(directory, head):
    native = read(directory / 'native/native-report.json')
    old = held(LEGACY + '/native/native-report.json')
    require(sha((ROOT / LEGACY / 'native/native-report.json').read_bytes()) == LEGACY_NATIVE_SHA256,
            'exact verified E3b native baseline')
    require(native['schema'] == old['schema'] == 'wasm-vm-constants-native-v1'
            and native['status'] == 'passed' and native['profile'] == base.PROFILE, 'current legacy native identity')
    require(native['fixture'] == old['fixture'] == binding(ROOT / base.FIXTURE), 'unchanged authored legacy shaders')
    require(native['cases'] == old['cases'] and native['originals'] == old['originals']
            and native['stats'] == old['stats'] == {'originals': 19, 'acceptedOriginals': 12, 'cases': 8, 'calls': 27},
            'all current legacy input identities and full serialized outputs equal verified E3b')
    e6 = held('evidence/virgl-dot-reciprocals/worker/native/native-report.json')
    originals = {item['sha256']: item['result'] for item in native['originals']}
    require(originals == {item['sha256']: item['result'] for item in e6['originals']}, 'full originals also equal verified E6')
    require(Path(native['binary']).resolve() == ROOT / 'renderer/virgl-shader/build/native/virgl-shader'
            and sha(Path(native['binary']).read_bytes()) == native['binarySha256'], 'actual current legacy native executable')
    expected_sources = {item['path'] for item in old['sources']}
    require(len(native['sources']) == len(expected_sources)
            and {item['path'] for item in native['sources']} == expected_sources, 'complete native source inventory')
    for source in native['sources'] + [native['fixture']] + native['originals']:
        base.verify_source(source, head)
    log = (directory / 'native/native.log').read_bytes()
    require(sha(log) == native['logSha256'], 'actual complete native transcript digest')
    records = [json.loads(line) for line in log.splitlines()]
    entries = native['originals'] + native['cases']
    require(len(records) == len(entries) == 27, 'complete native invocations')
    for record, entry in zip(records, entries):
        raw = record['stdout'].encode('ascii')
        identity = entry.get('inputSha256', entry.get('sha256'))
        require(record['label'] == entry.get('name', identity)
                and record['command'] == [native['binary'], entry['stage']]
                and record['inputSha256'] == identity and record['returnCode'] == 0 and record['stderr'] == '',
                'native transcript identifies actual command/input/outcome')
        require(raw.endswith(b'\n') and raw.count(b'\n') == 1 and sha(raw) == entry['stdoutSha256']
                and len(raw) - 1 == entry['resultBytes'] and json.loads(raw) == entry['result'], 'full native serialization')
    return native, read(ROOT / base.FIXTURE), {entry['name']: entry for entry in native['cases']}, originals


def verify_report(directory, task, head, qualified, baseline, *, passed=True, browser=True, mutation=None):
    report = read(directory / 'report.json')
    outcome = 'passed' if passed else 'failed'
    require(report['task'] == task and report['gitHead'] == head and report['status'] == outcome
            and report['guestExecution'] is False and report['trackedChanges'] == [], 'frozen isolated legacy report identity')
    require(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'no legacy browser errors')
    sources = {item['path']: item for item in report['sources'] + report['inputs']}
    require(len(sources) == len(report['sources']) + len(report['inputs']), 'unique complete legacy sources and inputs')
    expected_sources = {item['path'] for item in baseline['sources']}
    if STATE in expected_sources:
        expected_sources.add(DOMAIN)
    require({item['path'] for item in report['sources']} == expected_sources, 'complete historical source inventory plus sole consumer import')
    for source in sources.values():
        base.verify_source(source, head)
        unchanged_or_registration(source['path'])
    require(report['inputs'] == baseline['inputs'] and report['fixtureTransport'] == baseline['fixtureTransport'],
            'identical original command/resource input transport')
    if 'node' in report:
        require(report['node']['status'] == 'passed' and report['node'] == baseline['node'], 'complete unchanged Node regression output')
        require(sha(json.dumps(report['node'], separators=(',', ':'), ensure_ascii=False).encode()) == report['nodeSha256'],
                'serialized Node output digest')
    if not browser:
        return report
    result = report['browserResult']
    require(result['status'] == outcome and (not passed or result['result']['status'] == 'passed'), 'actual browser suite outcome')
    require(sha(json.dumps(result, separators=(',', ':'), ensure_ascii=False).encode()) == report['browserResultSha256'],
            'serialized browser result digest')
    served = {item['path']: item for item in report['servedFiles']}
    require(len(served) == len(report['servedFiles']) and served['/fixtures.json']['sha256'] == report['fixtureTransport']['sha256'],
            'unique served files and exact fixture transport')
    for name, item in served.items():
        if name in ('/', '/fixtures.json'):
            continue
        path = name.removeprefix('/')
        require(path in sources, f'unbound served legacy source: {name}')
        expected = mutation['servedSha256'] if mutation and path == mutation['path'] else sources[path]['sha256']
        require(item['sha256'] == expected, f'actual served legacy source: {name}')
    if '/' + STATE in served:
        require('/' + DOMAIN in served and DOMAIN in sources, 'actual imported constant-domain consumer is source-bound')
    if task != 'E6-T12b':
        require('/renderer/virgl-shader/build/wasm/virgl-shader.wasm' in served, 'actual compiler served for legacy renderer proof')
    coverage = report['browserCoverage']
    raw = (directory / coverage['path']).read_bytes()
    require(sha(raw) == coverage['sha256'], 'actual legacy coverage digest')
    measured = json.loads(raw)
    scripts = measured.get('scripts', [measured] if 'source' in measured else [])
    require(scripts, 'legacy execution source coverage')
    for script in scripts:
        require('/' + script['source'] in served and script['sha256'] == served['/' + script['source']]['sha256'],
                'coverage of actual served runtime')
    screen = report['screenshot' if passed else 'failureScreenshot']
    require(sha((directory / screen['path']).read_bytes()) == screen['sha256'], 'actual browser screenshot')
    a, b = report['browser'], qualified['browser']
    require(a['headless'] is False and a['gpu']['featureStatus'][a['webglFeature']] == 'enabled'
            and a['version'] == b['version'] and a['gpu']['devices'] == b['gpu']['devices']
            and a['gpu']['auxAttributes']['glRenderer'] == b['gpu']['auxAttributes']['glRenderer']
            and all(report['host'][k] == qualified['host'][k] for k in ('platform', 'architecture', 'release')),
            'same qualified actual GPU/browser as constant hardware proof')
    require(not any(any(marker in arg.lower() for marker in ('swiftshader', 'llvmpipe', 'softpipe', 'lavapipe', '--disable-gpu'))
                    for arg in a['commandLine']), 'hardware renderer only')
    return report


def verify_frames(proof, baseline, originals, asynchronous=False):
    original, old = proof['original'], baseline['original']
    require(proof['guestExecution'] is False and original['packetCount'] == 210
            and original['gpuDraws'] == 3 and original['checkedPixels'] == 768, 'complete original renderer replay')
    require([s['event'] for s in original['submissions']] == [161, 173, 185, 197, 209, 221, 233, 249]
            and [f['readback']['offset'] for f in original['frames']] == [64, 4160, 8256], 'original ordering and readback addresses')
    for key in ('initialization', 'lifecycle', 'translations'):
        require(original[key] == old[key], f'complete original renderer inputs and outcomes: {key}')
    for current, previous in zip(original['submissions'], old['submissions']):
        omit = {'states', 'turns'} if asynchronous else set()
        require({k: v for k, v in current.items() if k not in omit} == {k: v for k, v in previous.items() if k not in omit},
                'complete original command framing, selected identities and applied draw results')
        if asynchronous:
            def progress(states):
                result = []
                for state in states:
                    if not result or state != result[-1]:
                        result.append(state)
                return result
            require(type(current['turns']) is int and current['turns'] > 0
                    and progress(current['states']) == progress(previous['states']),
                    'async progress preserves semantic boundaries while repeated polling may vary')
    def stable_frames(frames):
        return [{**frame, 'actualGlCall': {k: v for k, v in frame['actualGlCall'].items() if k != 'turn'}} for frame in frames]
    require(stable_frames(original['frames']) == stable_frames(old['frames']),
            'all original framebuffer hashes, selected bindings and pixel records equal verified baseline')
    if asynchronous:
        turns = [frame['actualGlCall']['turn'] for frame in original['frames']]
        require(all(type(turn) is int and turn > 0 for turn in turns) and turns == sorted(set(turns)),
                'actual asynchronous draws occur on ordered positive turns')
    colors = [[[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255]],
              [[255, 0, 0, 255], [0, 128, 0, 255], [0, 0, 0, 255], [255, 128, 0, 255]],
              [[64, 0, 191, 255], [0, 64, 191, 255], [0, 0, 255, 255], [64, 64, 191, 255]]]
    for frame, expected in zip(original['frames'], colors):
        require(frame['pixels']['pixels'] == 256 and frame['pixels']['checks'] == [
            {'quadrant': q, 'rectangle': [4 + 16 * (q % 2), 4 + 16 * (q // 2), 8, 8], 'expected': color, 'pixels': 64}
            for q, color in enumerate(expected)], 'literal independently specified original quadrant colors')
    for translation in original['translations']:
        digest = sha(translation['text'].encode('ascii'))
        require(digest in originals and {'ok': True, 'glsl': translation['glsl'], 'metadata': translation['metadata']} == originals[digest],
                'renderer uses exact independently proven native original')
    cleanup = original['cleanup']
    require(all(value == 0 for owner in ('state', 'resources') for value in cleanup[owner].values()), 'all original owner budgets released')
    require(proof['attacks'] == baseline['attacks'], 'complete unchanged bounded renderer attack outcomes')
    poison = proof['outputReferencePoison']
    require(poison['bytes'] == 12288 and poison['hashes'] == [f['readback']['rgbaSha256'] for f in original['frames']],
            'reference-output poison cannot determine actual rendering')
    if asynchronous:
        for key in ('summary', 'selection', 'rows', 'ownership', 'lifecycle', 'budgets', 'contexts', 'capabilities', 'coverage'):
            require(proof[key] == baseline[key], f'complete retained async state/ownership outcomes: {key}')
        sequencing = original['sequencing']
        require(proof['primaryAsyncReplay'] is True and [sequencing[k] for k in ('stagedCopies', 'pboReads', 'collections')] == [3, 3, 6],
                'actual async staging and collection paths')
        require(original['heartbeatTicks'] > 0 and sequencing['turns'] > 0 and sequencing['polls'] > 0
                and all(s['result']['gpuComplete'] is True for s in original['submissions']), 'actual yielding and GPU completion')
        require([e['layout']['tightBytes'] for e in original['exchanges'] if e['status'] == 'needs-input'] == [64, 12, 16],
                'original inputs cross fresh asynchronous DMA boundary')
        require(all(cleanup['async'][k] == 0 for k in ('reads', 'transfers', 'stagingBytes'))
                and all(cleanup['actualGl'][k] == 0 for k in ('liveObjects', 'liveSyncs')), 'asynchronous objects and budgets released')
        require([s['name'] for s in proof['schedules']] == ['baseline', 'one withheld signal', 'seeded zero to three withheld signals']
                and proof['schedules'][2]['seed'] == 608135816 and len(proof['attacks']) == 93, 'complete varied original async schedules')
    else:
        require(proof['primaryDrawReplay'] is True and len(proof['attacks']) == 37, 'original synchronous draw proof')


def verify_async(directory, head, qualified, originals):
    receipt = read(directory / 'receipt.json')
    require(receipt['task'] == 'E6-T11b1' and receipt['status'] == 'passed' and receipt['gitHead'] == head
            and receipt['guestExecution'] is False and receipt['synchronousRegressions'] == list(TASKS)
            and receipt['sourceControlsRejected'] == ['early-collect', 'index-class'], 'complete exact-head async receipt')
    base.verify_records(directory, receipt)
    for item in receipt['sources'] + receipt['inputs']:
        base.verify_source(item, head)
    baseline = held(LEGACY + '/regression/hardware/report.json')
    good = verify_report(directory / 'hardware', 'E6-T11b1', head, qualified, baseline)
    verify_frames(good['browserResult']['result'], baseline['browserResult']['result'], originals, True)
    edits = {
        'early-collect': ('const status = gl.clientWaitSync(entry.sync, 0, 0);', 'const status = gl.CONDITION_SATISFIED; /* sabotage: omit required GPU wait */', 'async CPU collection requires a signaled fence'),
        'index-class': ('// WebGL forbids copies across element-array/other-data classes.\n              gl.bindVertexArray(vao);\n              const target = meta.kind === "index-buffer" ? gl.ELEMENT_ARRAY_BUFFER : gl.ARRAY_BUFFER;', '// sabotage: wrong permanent buffer class\n              gl.bindVertexArray(vao);\n              const target = gl.COPY_WRITE_BUFFER;', 'async index staging uses element-array class'),
    }
    reports = [good]
    source = ROOT / 'renderer/virgl-command/resources.mjs'
    for mode, (before, after, error) in edits.items():
        require(source.read_text().count(before) == 1, 'unique retained async mutation site')
        mutation = {'mode': mode, 'path': str(source.relative_to(ROOT)), 'originalSha256': sha(source.read_bytes()),
                    'servedSha256': sha(source.read_text().replace(before, after).encode())}
        report = verify_report(directory / ('sabotage-' + mode), 'E6-T11b1', head, qualified, baseline, passed=False, mutation=mutation)
        require(report['sabotage'] == mutation and report['sources'] == good['sources'] and report['inputs'] == good['inputs']
                and error in report['browserResult']['error']['message'], 'actual retained source fault reaches intended sequencing oracle')
        reports.append(report)
    for name, task in TASKS.items():
        old = held(LEGACY + '/regression/regression/' + name + '/report.json')
        report = verify_report(directory / 'regression' / name, task, head, qualified, old, browser=name != 'decoder')
        reports.append(report)
        if name == 'decoder':
            continue
        proof, previous = report['browserResult']['result'], old['browserResult']['result']
        if name == 'resources':
            require(proof == previous, 'complete unchanged actual resource bytes, readbacks, ownership and fault outcomes')
        elif name == 'state':
            for key in ('summary', 'originalResults', 'lifecycle', 'originalReflection', 'states', 'translations', 'attacks',
                        'faultControls', 'finalStateBudgets', 'finalResourceBudgets'):
                require(proof[key] == previous[key], f'actual original state/clear/reflection oracle: {key}')
            require(all(value == 0 for key in ('finalStateBudgets', 'finalResourceBudgets') for value in proof[key].values()),
                    'complete state and resource cleanup')
        else:
            verify_frames(proof, previous, originals)
            for key in ('isolated', 'quotas'):
                require(proof[key] == previous[key], f'synchronous lifecycle and quota oracle: {key}')
    sources = {item['path']: item for report in reports for item in report['sources']}
    inputs = {item['path']: item for report in reports for item in report['inputs']}
    require(receipt['sources'] == sorted(sources.values(), key=lambda e: e['path'])
            and receipt['inputs'] == sorted(inputs.values(), key=lambda e: e['path'])
            and receipt['browserResultSha256'] == good['browserResultSha256'], 'nested receipt reconstructed from actual constituent reports')
    record_paths = []
    labels = ['hardware', 'sabotage-early-collect', 'sabotage-index-class', *['regression/' + name for name in TASKS]]
    for label, report in zip(labels, reports):
        record_paths.append(directory / label / 'report.json')
        if 'browserResult' in report:
            record_paths.extend([directory / label / report['browserCoverage']['path'],
                                 directory / label / (report.get('screenshot') or report['failureScreenshot'])['path']])
    expected_records = {str(path.relative_to(directory)): binding(path, directory) for path in record_paths}
    require(len(receipt['records']) == len(expected_records)
            and {r['path']: r for r in receipt['records']} == expected_records, 'complete nested receipt artifact inventory reconstructed')
    return receipt, reports


def verify_flat(directory, head, contract, originals):
    report = base.verify_browser(directory, head, contract, task='E6-T12e2')
    proof = report['acceptance']
    old = held(LEGACY + '/flat-regression/report.json')['acceptance']
    require(proof['status'] == 'passed' and proof['guestExecution'] is False and proof['productionVirgl'] is False
            and proof['sabotage'] is None, 'actual legacy pair boundary')
    shader, renderer = proof['shaderPairs'], proof['rendererPairs']
    require(set(shader) == set(old['shaderPairs']) and all(shader[k] == old['shaderPairs'][k]
            for k in shader if k != 'allocationFailures'),
            'complete legacy shader pair results, inputs, API attacks and direct draws unchanged')
    # Native heap addresses changed during earlier compiler growth; ownership,
    # sizes and complete results are the historical contract, not pointer values.
    failures = shader['allocationFailures']
    require([entry['allocation'] for entry in failures] == [1, 2], 'both input allocations fail independently')
    for entry, expected in zip(failures, old['shaderPairs']['allocationFailures']):
        require(set(entry) == set(expected) and entry['result'] == expected['result']
                and entry['compilerCalls'] == entry['liveInputs'] == 0, 'allocation failure skips compilation and leaks no inputs')
        for actual, previous in [(entry, expected), (entry['recovery'], expected['recovery'])]:
            allocations = actual['allocations']
            require(set(actual) == set(previous) and actual['result'] == previous['result']
                    and actual['compilerCalls'] == previous['compilerCalls'] and actual['liveInputs'] == 0
                    and len(allocations) == len(previous['allocations']), 'same-instance allocation recovery')
            for allocation, old_allocation in zip(allocations, previous['allocations']):
                require(set(allocation) == set(old_allocation) and allocation['bytes'] == old_allocation['bytes']
                        and allocation['failed'] is old_allocation['failed']
                        and type(allocation['ptr']) is int and (allocation['ptr'] == 0 if allocation['failed'] else allocation['ptr'] > 0),
                        'bounded input ownership and intended allocation failure')
            live = [a['ptr'] for a in allocations if not a['failed']]
            require(len(set(live)) == len(live) and actual['frees'] == list(reversed(live)), 'release only distinct owned input pointers')
    require({e['sha256']: e['result'] for e in shader['corpus']} == originals and len(shader['cases']) == 114, 'full original and pair parity')
    require(renderer['status'] == 'passed' and len(renderer['draws']) == 44 and len(renderer['faults']) == 12
            and len(renderer['quota']) == 2, 'complete flat renderer ownership/fault workload')
    for draw in shader['draws'] + renderer['draws']:
        pairs_gate.verify_pixels(draw)
    for fault in renderer['faults']:
        pairs_gate.verify_failed_link(fault['failure'])
    require(renderer == old['rendererPairs'], 'complete flat lifecycle, selected program, failure and quota outcomes unchanged')
    return report


def verify(output, head, contract):
    output = Path(output).resolve()
    directory = output / 'legacy'
    require(contract['production'] == json.loads(base.git('show', f'{HELD_HEAD}:docs/gpu-3d-contract.json'))['production'],
            'production negotiation unchanged')
    compiler = base.git('ls-tree', '-r', '--name-only', HELD_HEAD, '--', 'renderer/virgl-shader').decode().splitlines()
    for path in compiler:
        require((ROOT / path).read_bytes() == base.git('show', f'{HELD_HEAD}:{path}'), f'compiler unchanged from verified E6: {path}')
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
        STATE, DOMAIN, base.FIXTURE, 'docs/gpu-3d-contract.json', 'tools/virgl-constant-domains/regressions.py',
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
        if name not in compiler and not name.startswith(('evidence/', 'tools/virgl-constant-domains/')):
            unchanged_or_registration(name)
        sources.append(item)
    for report in (hardware, sabotage, flat):
        served = {e['path'] for e in report['servedFiles']}
        require(DOMAIN in served and STATE in served, 'actual current consumer modules served to legacy constants/pairs')
    return {'schema': 'wasm-vm-constant-domain-legacy-v1', 'heldCompilerHead': HELD_HEAD, 'recordedHead': head,
        'boundary': 'Current legacy native/Wasm outputs equal verified E3b/E6; unchanged historical independent oracles rechecked with only the new shared constant-domain consumer and exact import registrations. Historical E3b top-level receipt is not claimed.',
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
