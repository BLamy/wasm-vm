#!/usr/bin/env python3
"""Bind checked shader pairs and owned renderer variants to original inputs."""
import importlib.util
import json
from pathlib import Path
import struct
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


def check_records(directory, receipt):
    for record in receipt['records']:
        path = (directory / record['path']).resolve()
        require(path.is_relative_to(directory), 'record path escapes evidence directory')
        check_digest(path, record['sha256'])


def projection(entries):
    return sorted(({key: item[key] for key in ('semanticIndex', 'componentMask', 'interpolation')}
                   for item in entries if item['semantic'] == 'GENERIC'), key=lambda item: item['semanticIndex'])


def verify_native(native, fixtures, corpus, output):
    require(native['schema'] == 'wasm-vm-pairs-native-v1' and native['status'] == 'passed',
            'native pair sanitizer acceptance')
    require(native['sanitizers'] == ['address', 'undefined'], 'pair sanitizers')
    require(native['seeds'] == ['6102ab3d', 'b487095f', '938ad217', '27a461cb']
            and native['mutationsPerSeed'] == 1024, 'recorded deterministic pair mutation seeds')
    check_digest(output / 'native/native.log', native['logSha256'])
    check_digest(ROOT / 'renderer/virgl-shader/build/pair-sanitize/pair-test', native['binarySha256'])
    require({item['sha256']: item['result'] for item in native['originals']} == corpus
            and len(native['originals']) == 19, 'all unchanged native original outcomes')
    for original in native['originals']:
        require(binding(ROOT / original['path']) == {key: original[key] for key in ('path', 'bytes', 'sha256')},
                'original input binding')
    require(native['fixture'] == binding(ROOT / 'renderer/virgl-shader/tests/pair-cases.json'),
            'shared native pair fixture')
    require(len(native['cases']) == len(fixtures), 'native pair case count')
    stream = bytearray(b'VGP1' + struct.pack('<I', 19))
    require([item['sha256'] for item in native['originals']] == sorted(corpus), 'native original order')
    for original in native['originals']:
        raw = (ROOT / original['path']).read_bytes()
        stream += struct.pack('<III', int(original['stage'] == 'fragment'), int(original['result']['ok']), len(raw)) + raw
    stream += struct.pack('<I', len(fixtures))
    for case, fixture in zip(native['cases'], fixtures):
        require(case['name'] == fixture['name'] and case['ok'] is fixture['ok']
                and case['result']['ok'] is fixture['ok'], 'native pair outcome')
        for stage in ('vertex', 'fragment'):
            require(case[stage + 'Sha256'] == sha(fixture[stage + 'Text'].encode()), 'native pair text binding')
        if fixture['ok']:
            result, expected = case['result'], fixture['expected']
            require(result['interfaceKey'] == expected['interfaceKey'], 'literal pair interface identity')
            require(projection(result['vertex']['metadata']['outputs']) == expected['vertexOutputs']
                    and projection(result['fragment']['metadata']['inputs']) == expected['fragmentInputs'],
                    'literal semantic interpolation projections')
            for stage in ('vertex', 'fragment'):
                require(result[stage]['metadata']['profile'] == 'virgl-webgl2-straight-line-v5'
                        and result[stage]['metadata']['stage'] == stage, 'bounded pair metadata profile')
        else:
            require(set(case['result']) == {'ok', 'error'}, 'failed pair exposes partial outputs')
        name, vertex, fragment = (fixture[key].encode('ascii') for key in ('name', 'vertexText', 'fragmentText'))
        stream += struct.pack('<IIII', int(fixture['ok']), len(name), len(vertex), len(fragment)) + name + vertex + fragment
    require(sha(stream) == native['streamSha256'], 'independently reconstructed native input stream')
    for source in native['sources']:
        require(binding(ROOT / source['path']) == source, 'native pair source binding')
    names = {fixture['name'] for fixture in fixtures}
    require(len(names) == len(fixtures) and len(fixtures) <= 256, 'unique bounded pair cases')
    required = {f'generic-{semantic}-mask-{mask}-{mode}' for semantic in range(8)
                for mask in (3, 7, 15) for mode in ('smooth', 'flat')}
    required |= {f'coverage-output-{out}-input-{inp}-{mode}' for out in (3, 7, 15)
                 for inp in (3, 7, 15) for mode in ('smooth', 'flat')}
    require(required <= names, 'semantic/mask/interpolation boundary matrix')
    stats = native['stats']
    require(stats['originals'] == 19 and stats['acceptedOriginals'] == 12 and stats['pairs'] == len(fixtures)
            and stats['truncations'] == 932 and stats['hostileCases'] == 320 and stats['mutations'] == 4096,
            'pair native attack coverage')
    attacks = len(fixtures) + 932 + 320 + 4096
    require(stats['pairRecoveries'] == attacks * 4 and stats['standaloneRecoveries'] == attacks * 2
            and stats['calls'] == 25 + attacks * 7, 'exact native recovery/call accounting')


def verify_browser_sources(output, name, head, contract):
    report = read_json(output / name / 'report.json')
    require(report['task'] == 'E6-T12e2' and report['gitHead'] == head, 'pair browser identity')
    require(report['status'] == ('passed' if name == 'hardware' else 'failed'), 'pair browser outcome')
    require(report['guestExecution'] is False, 'pair proof cannot claim a guest boot')
    require(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'pair browser errors')
    require(report['trackedChanges'] == [], 'browser observed unfrozen sources')
    gate.verify_files(report['sources'])
    gate.verify_files(report['servedFiles'])
    observed = {'browserVersion': report['browser']['version'],
                **{key: report['host'][key] for key in ('platform', 'architecture', 'release')},
                'renderer': report['acceptance']['renderer']['renderer']}
    require(observed in contract['browserMatrix']['qualified'], 'pair proof used unqualified hardware/browser')
    require(report['browser']['gpu']['featureStatus'][report['browser']['webglFeature']] == 'enabled',
            'pair proof needs enabled hardware WebGL')
    photo = report['screenshot'] if name == 'hardware' else report['failureScreenshot']
    require(photo['path'] == ('browser.png' if name == 'hardware' else 'failure.png'), 'pair screenshot path')
    check_digest(output / name / photo['path'], photo['sha256'])
    served = {item['path']: item for item in report['servedFiles']}
    needed = ('renderer/virgl-shader/index.mjs', 'renderer/virgl-shader/build/wasm/virgl-shader.wasm',
              'renderer/virgl-shader/tests/pairs.mjs', 'renderer/virgl-command/state.mjs',
              'renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/resources.mjs',
              'renderer/virgl-command/tests/flat-pairs.mjs')
    require(all(path in served for path in needed), 'pair proof did not consume the actual compiler/renderer')
    sources = {item['path']: item for item in report['sources']}
    require(all(path in sources and sources[path]['sha256'] == served[path]['sha256'] for path in needed),
            'pair compiler/renderer served hashes differ from source bindings')
    coverage = report['browserCoverage']
    require(coverage['path'] == 'browser-coverage.json', 'coverage path')
    check_digest(output / name / coverage['path'], coverage['sha256'])
    scripts = read_json(output / name / coverage['path'])['scripts']
    require({item['source'] for item in scripts} == {'renderer/virgl-command/state.mjs', 'renderer/virgl-shader/index.mjs'},
            'compiler wrapper and renderer source-bound coverage')
    require(all(item['sha256'] == sources[item['source']]['sha256'] for item in scripts), 'coverage source mismatch')
    return report


def main():
    require(len(sys.argv) == 2, 'usage: receipt.py EVIDENCE_DIRECTORY')
    output = Path(sys.argv[1]).resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    contract = read_json(ROOT / 'docs/gpu-3d-contract.json')
    require(contract['production'] == gate.PRODUCTION, 'production GPU negotiation must remain disabled')
    components = read_json(output / 'components/receipt.json')
    draws = read_json(output / 'draw/receipt.json')
    for name, receipt, task in (('components', components, 'E6-T12e1'), ('draw', draws, 'E6-T12d')):
        require(receipt['task'] == task and receipt['status'] == 'passed' and receipt['gitHead'] == head,
                'prior acceptance task/head/outcome')
        gate.verify_files([{'path': item['path'], 'sha256': item['sha256'],
                            'size': item.get('bytes', item.get('size'))} for item in receipt['sources']])
        check_records(output / name, receipt)
    require(components['shaderOutcomes'] == {'translated': 12, 'unsupported-feature': 7},
            'exact twelve original shader acceptances')
    corpus = read_json(output / 'components/regression/contract/receipt.json')['capturedShaderResults']
    require(len(corpus) == 19 and set(corpus) == set(contract['capturedShaders']), 'all nineteen original identities')
    require(corpus[gate.FLAT_SHADER]['ok'] is True, 'unchanged original flat fragment rejected')
    fixtures = read_json(ROOT / 'renderer/virgl-shader/tests/pair-cases.json')
    native = read_json(output / 'native/native-report.json')
    verify_native(native, fixtures, corpus, output)
    reports = {name: verify_browser_sources(output, name, head, contract) for name in ('hardware', 'sabotage')}
    verify_pair_execution(reports, native, fixtures, corpus)

    names = {item['path'] for item in components['sources'] + draws['sources']}
    names.update(item['path'] for item in reports['hardware']['sources'])
    names.update(str(path.relative_to(ROOT)) for path in (ROOT / 'tools/virgl-pairs').glob('*.py'))
    names.update(('tools/verify-virgl-pairs.sh', 'tools/verify-virgl-pairs.mjs', 'tools/virgl-contract/test_verify.py'))
    sources = []
    for name in sorted(names):
        if '/build/' in name:
            continue  # Generated compiler is bound to its sources and recorded toolchain below.
        entry = binding(ROOT / name)
        frozen = subprocess.check_output(['git', 'show', f'{head}:{name}'], cwd=ROOT)
        require(sha(frozen) == entry['sha256'], f'source differs from frozen head: {name}')
        sources.append(entry)
    for filename, digest in components['compilerSha256'].items():
        check_digest(Path(filename), digest)
    records = [binding(path, output) for path in sorted(output.rglob('*'))
               if path.is_file() and path != output / 'receipt.json' and path.name != 'acceptance.log']
    receipt = {'schema': 1, 'task': 'E6-T12e2', 'status': 'passed', 'gitHead': head,
               'boundary': 'Original flat fragment with translated shader pairs and owned renderer variants; no guest GPU activation.',
               'production': contract['production'], 'shaderOutcomes': components['shaderOutcomes'],
               'nativeCases': len(fixtures), 'sources': sources, 'records': records,
               'compilerSha256': components['compilerSha256']}
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('E6-T12e2 passed: 12/19 unchanged originals, derived shader pairs, actual renderer pixels and bounded variant ownership.')


def verify_pair_execution(reports, native, fixtures, corpus):
    hardware, sabotage = (reports[name]['acceptance'] for name in ('hardware', 'sabotage'))
    require(hardware['status'] == 'passed' and hardware['guestExecution'] is False
            and hardware['productionVirgl'] is False and hardware['sabotage'] is None, 'pair execution boundary')
    shader, renderer = hardware['shaderPairs'], hardware['rendererPairs']
    require(shader['status'] == renderer['status'] == 'passed', 'both pair execution paths')
    for proof in (shader, sabotage['shaderPairs']):
        require(len(proof['corpus']) == 19 and {item['sha256']: item['result'] for item in proof['corpus']} == corpus,
                'complete standalone native/Wasm parity')
        for item in proof['corpus']:
            require(binding(ROOT / item['path']) == {key: item[key] for key in ('path', 'bytes', 'sha256')},
                    'browser original source binding')
            require(item['glslSha256'] == (sha(item['result']['glsl'].encode()) if item['result']['ok'] else None),
                    'browser original generated source binding')
        require(proof['fixtureSha256'] == native['fixture']['sha256'] and len(proof['cases']) == len(fixtures),
                'complete shared browser pair cases')
        for actual, expected in zip(proof['cases'], native['cases']):
            require(actual == {key: expected[key] for key in ('name', 'vertexSha256', 'fragmentSha256', 'result')},
                    'exact native/Wasm pair result parity')
        require(proof['recovery'] == {'rounds': 2, 'conversions': len(fixtures) * 8}, 'disjoint interface recoveries')
        require(proof['accessorCalls'] == 0 and len(proof['apiAttacks']) == 19, 'bounded pair API attack coverage')
        require(all(set(attack['result']) == {'ok', 'error'} and attack['result']['ok'] is False
                    for attack in proof['apiAttacks']), 'no partial stages on rejected JS request')
        require(proof['maximumInputs']['vertexBytes'] == proof['maximumInputs']['fragmentBytes'] == 16384,
                'combined exact per-stage text bounds')
    anchors = {item['name']: item for item in shader['anchors']}
    require(set(anchors) == {'smooth', 'flat', 'mixed', 'disjoint'}, 'all hardware interface anchors')
    cases_by_inputs = {(case['vertexSha256'], case['fragmentSha256']): case['result'] for case in native['cases']}
    for anchor in anchors.values():
        require(sha(anchor['vertexText'].encode()) == anchor['vertexSha256']
                and sha(anchor['fragmentText'].encode()) == anchor['fragmentSha256'], 'draw anchor input digest')
        require(cases_by_inputs[(anchor['vertexSha256'], anchor['fragmentSha256'])] == anchor['result'],
                'native parity for exact hardware pair texts and metadata')
    require(anchors['flat']['fragmentSha256'] == gate.FLAT_SHADER, 'hardware flat fragment must be original bytes')
    require(anchors['flat']['result']['fragment'] == {key: corpus[gate.FLAT_SHADER][key] for key in ('glsl', 'metadata')},
            'pair fragment matches original standalone translation')
    require(shader['maximumInputs']['result'] == anchors['flat']['result'], 'maximum-length recovery identity')
    for proof in (shader, sabotage['shaderPairs']):
        require([case['allocation'] for case in proof['allocationFailures']] == [1, 2], 'both input allocation failures')
        for case in proof['allocationFailures']:
            require(set(case['result']) == {'ok', 'error'} and case['result']['ok'] is False
                    and case['result']['error']['code'] == 'allocation-failed'
                    and case['compilerCalls'] == 0 and case['liveInputs'] == 0,
                    'allocation failure must skip compiler and release owned inputs')
            attempts = case['allocations']
            require(len(attempts) == case['allocation'] and attempts[-1]['failed'] is True
                    and attempts[-1]['ptr'] == 0, 'intended allocation failed')
            require(case['frees'] == [item['ptr'] for item in reversed(attempts[:-1])], 'failure frees only owned inputs')
            recovery = case['recovery']
            require(recovery['result'] == anchors['flat']['result'] and recovery['compilerCalls'] == 1
                    and recovery['liveInputs'] == 0 and len(recovery['allocations']) == 2,
                    'same-instance recovery after allocation failure')
            require(all(item['failed'] is False and item['ptr'] > 0 for item in recovery['allocations'])
                    and recovery['frees'] == [item['ptr'] for item in reversed(recovery['allocations'])],
                    'recovery input ownership and reverse cleanup')
    expected_phases = [('smooth', [0, 1, 2]), ('flat', [0, 1, 2]), ('smooth', [0, 1, 2]),
                       ('flat', [1, 2, 0]), ('smooth', [1, 2, 0]), ('flat', [0, 1, 2]),
                       ('mixed', [0, 1, 2]), ('mixed', [1, 2, 0])]
    require([(draw['mode'], draw['order']) for draw in shader['draws']] == expected_phases, 'direct pair switching phases')
    for draw in shader['draws']:
        verify_pixels(draw)
        anchor = anchors[draw['mode']]['result']
        require(draw['interfaceKey'] == anchor['interfaceKey'], 'draw effective interpolation identity')
        for stage in ('vertex', 'fragment'):
            require(draw[stage + 'GlslSha256'] == sha(anchor[stage]['glsl'].encode()), 'actual compiled pair source')
        require(draw['programLogs'] == {'vertex': '', 'fragment': '', 'link': ''}, 'shader pair compilation/link diagnostics')
    flat_bytes = len(anchors['flat']['result']['vertex']['glsl'].encode())
    require(len(renderer['draws']) == 44, 'all renderer lifecycle/fault/recovery draws')
    require([(draw['mode'], draw['order']) for draw in renderer['draws'][:6]] == expected_phases[:6],
            'renderer smooth/flat switching and reuse')
    for draw in renderer['draws']:
        verify_pixels(draw)
        program = draw['program']
        require(program['interfaceKey'] == anchors[draw['mode']]['result']['interfaceKey'], 'renderer interpolation identity')
        expected_bytes = len(anchors[draw['mode']]['result']['vertex']['glsl'].encode()) if draw['mode'] != 'smooth' else 0
        require(program['variantBytes'] == expected_bytes, 'owned vertex variant bytes')
        require(program['key'] == f"{program['vertexGeneration']}:{program['fragmentGeneration']}:{program['interfaceKey']}",
                'selector generation and interpolation program identity')
        require(draw['programId'] == draw['requestedProgramId'], 'hardware executes the selected linked program')
    phases = renderer['draws']
    require(phases[0]['programId'] == phases[2]['programId'] == phases[4]['programId']
            and phases[1]['programId'] == phases[3]['programId'] == phases[5]['programId']
            and phases[0]['programId'] != phases[1]['programId'], 'smooth and flat programs are distinct and reused')
    require({entry['name'] for entry in renderer['lifecycle']} == {'bound-vertex-handle-reuse',
            'fragment-generation-interface-reuse', 'context-subcontext-isolation-reuse'}, 'selector/context generation lifecycle')
    fault_codes = {'createShader': 'backend-error', 'compile-status': 'shader-error', 'createProgram': 'backend-error',
                   'link-status': 'shader-link-error', 'createBuffer': 'backend-error', 'reflection': 'shader-reflection-error',
                   **{name: 'shader-link-error' for name in ('missing-pair', 'bad-interface', 'bad-fragment', 'bad-qualifier', 'bad-type', 'bad-mask')}}
    require({entry['name'] for entry in renderer['faults']} == set(fault_codes), 'all renderer failure boundaries')
    for fault in renderer['faults']:
        failure = fault['failure']
        require(failure['result']['ok'] is False and failure['result']['error']['code'] == fault_codes[fault['name']],
                'intended renderer failure classification')
        verify_failed_link(failure)
    require(len(renderer['quota']) == 2, 'both sides of exact variant quota')
    for delta, quota in zip((-1, 0), renderer['quota']):
        require(quota['flatBytes'] == flat_bytes and quota['limit'] == quota['baseBytes'] + flat_bytes + delta,
                'exact variant byte limit')
        if delta == -1:
            verify_failed_link(quota['failure'])
            require(quota['failure']['result']['error']['code'] == 'limit-exceeded'
                    and all(not event['call'].startswith('create') for event in quota['failure']['events']),
                    'variant quota checked before allocation')
    rigs = [renderer['primary'], renderer['mixed'], *renderer['faults'], *renderer['quota'], renderer['negatives']]
    for rig in rigs:
        require(all(value == 0 for value in rig['finalBudgets'].values()) and rig['glObjects']['live'] == 0
                and rig['glObjects']['created'] > 0, 'renderer and native GL object cleanup')
        for pair in rig['pairTranslations']:
            identity = tuple(sha(pair['request'][stage + 'Text'].encode()) for stage in ('vertex', 'fragment'))
            require(cases_by_inputs[identity] == pair['original'], 'renderer pair inputs match full native results')
    require(all(value == 0 for value in renderer['finalBudgets'].values()), 'primary final budgets')
    require(sabotage['status'] == 'failed' and sabotage['sabotage'] == 'flat-reuse'
            and len(sabotage['rendererPairs']['draws']) == 2, 'stale-program control reaches first flat draw')
    failed = sabotage['rendererPairs']['draws'][1]
    control = failed['sabotage']
    require(control['mode'] == 'flat-reuse' and control['requested']['programId'] != control['executed']['programId']
            and control['requested']['interfaceKey'] == anchors['flat']['result']['interfaceKey']
            and control['executed']['interfaceKey'] == anchors['smooth']['result']['interfaceKey']
            and control['requested']['variantBytes'] == flat_bytes and control['executed']['variantBytes'] == 0,
            'sabotage executes the separate smooth program')
    require(failed['failure'] == {'pixel': [4, 4], 'expected': [0, 255, 0, 255], 'observed': [36, 36, 0, 255]}
            and 'independent flat pixel' in sabotage['failure']['message'], 'stale reuse fails intended independent pixel')
    links = {event['id']: event for event in sabotage['rendererPairs']['primary']['glEvents'] if event['call'] == 'linkProgram'}
    require(all(links[control[kind]['programId']]['status'] is True for kind in ('requested', 'executed')),
            'sabotage must use two successfully linked real programs')


def verify_failed_link(failure):
    require(failure['before'] == failure['after'] and failure['liveBefore'] == failure['liveAfter']
            and failure['result']['appliedCommands'] == 0, 'failed link restores publication and ownership')


def verify_pixels(draw):
    require(draw['width'] == draw['height'] == 32 and draw['indices'] == draw['order']
            and draw['order'] in ([0, 1, 2], [1, 2, 0]), 'fixed independent triangle input geometry')
    require(draw['mode'] in ('smooth', 'flat', 'mixed'), 'known interpolation pixel oracle')
    # Unit right triangle, w=1, pixel-center barycentric weights. Compute rounded
    # UNORM8 directly as integers; no shader output, metadata or reference pixels.
    expected = {}
    for x, y in ((4, 4), (12, 4), (20, 4), (4, 12), (12, 12), (4, 20), (8, 8)):
        r, g = (((2 * point + 1) * 255 + 32) // 64 for point in (x, y))
        if draw['mode'] == 'flat':
            r, g = (0, 255) if draw['order'][2] == 2 else (0, 0)
        elif draw['mode'] == 'mixed':
            r = 255 if draw['order'][2] == 2 else 0
        expected[(x, y)] = [r, g, 0, 255]
    for point in ((28, 28), (28, 12), (12, 28)):
        expected[point] = [0, 0, 255, 255]
    require(draw['checkedPixels'] == len(draw['checks']) == len(expected), 'complete independent pixel set')
    checks = {tuple(item['pixel']): item for item in draw['checks']}
    require(set(checks) == set(expected), 'pixel coordinates and uniqueness')
    for point, rgba in expected.items():
        require(checks[point]['expected'] == checks[point]['observed'] == rgba,
                f"independent pair pixel mismatch: {draw['name']} {point}")
    require('failure' not in draw, 'passing draw retains a failure')


if __name__ == '__main__':
    main()
