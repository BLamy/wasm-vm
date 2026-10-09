#!/usr/bin/env python3
"""Authenticate current physical raster draws and all affected retained gates."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
GENERATED = {'renderer/virgl-shader/build/wasm/virgl-shader.mjs',
             'renderer/virgl-shader/build/wasm/virgl-shader.wasm'}
FAULTS = {'depth-direction': 'mid-depth occluder literal physical pixels',
          'winding': 'lower-left Gallium winding literal physical pixels',
          'negative-y': 'negative-Y asymmetric triangle',
          'scissor': 'lower-left scissor and full clear literal physical pixels',
          'fetch-size': 'z=-0.999 in front of mid-depth literal physical pixels'}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def need(condition, reason):
    if not condition:
        raise ValueError(reason)


def main(directory):
    directory = Path(directory).resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    files, sources, generated = {}, {}, {}

    def record(path, expected=None):
        raw = path.read_bytes()
        digest = sha(raw)
        need(expected is None or expected == digest, 'record drift: ' + str(path))
        files[path.relative_to(directory).as_posix()] = digest
        return raw

    def source(item):
        name = item['path']
        raw = (ROOT / name).read_bytes()
        need(len(raw) == item['bytes'] and sha(raw) == item['sha256'], 'source drift: ' + name)
        selected = generated if name in GENERATED else sources
        need(name not in selected or selected[name] == sha(raw), 'inconsistent source: ' + name)
        selected[name] = sha(raw)
        if name not in GENERATED:
            committed = subprocess.check_output(['git', 'show', f'{head}:{name}'], cwd=ROOT)
            need(committed == raw, 'source is not frozen at head: ' + name)

    def physical(name, passed=True):
        at = directory / name
        report = json.loads(record(at / 'report.json'))
        need(report['gitHead'] == head and report['task'] == 'E6-T12h', 'wrong raster head/task')
        need(report['status'] == ('passed' if passed else 'failed'), 'wrong raster status: ' + name)
        for item in report['sources'] + report['inputs']:
            source(item)
        need(report['native']['status'] == 'passed' and all(x['held'] for x in report['native']['assertions']), 'native guards failed')
        need(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser errors')
        need(report['browser']['headless'] is False, 'headless physical evidence')
        status = report['browser']['gpu']['featureStatus']
        need(status.get('webgl2', status.get('webgl')) == 'enabled', 'physical WebGL disabled')
        need(not any(x.lower().find('swiftshader') >= 0 or x.lower().find('llvmpipe') >= 0 or x.startswith('--disable-gpu') for x in report['browser']['commandLine']), 'software renderer flags')
        record(at / report['screenshot']['path'], report['screenshot']['sha256'])
        coverage = json.loads(record(at / report['browserCoverage']['path'], report['browserCoverage']['sha256']))
        served = {x['path']: x for x in report['servedFiles']}
        need(served['/fixtures.json']['sha256'] == report['fixtureTransport']['sha256'], 'fixture transport mismatch')
        mutation = report.get('sabotage', {})
        for script in coverage['scripts']:
            expected = mutation['servedSha256'] if script['source'] == mutation.get('path') else sources[script['source']]
            need(script['sha256'] == expected and served['/' + script['source']]['sha256'] == expected, 'coverage/served runtime mismatch')
        for item in report['sources']:
            key = '/' + item['path']
            if key in served:
                expected = mutation['servedSha256'] if item['path'] == mutation.get('path') else item['sha256']
                need(served[key]['sha256'] == expected, 'served source mismatch: ' + key)
        return report

    good = physical('hardware')
    need(good['browserResult']['status'] == 'passed', 'physical raster failed')
    result = good['browserResult']['result']
    need(result['status'] == 'passed' and result['guestExecution'] is False and result['productionNegotiation'] is False, 'wrong authority')
    need(good['native'] == good['browserResult']['native'], 'Node/browser guards differ')
    need(all(x['held'] for x in result['assertions']), 'literal physical prediction failed')
    need([(x['workload'], len(x['calls'])) for x in result['originals']] == [('kmscube', 6), ('es2gears', 3)], 'original draws missing')
    need(len(result['literals']['compares']) == 8 and len(result['literals']['faults']) >= 7, 'compare/fetch/attachment matrix incomplete')
    need([x['delay'] for x in result['jobs']] == [0, 1, 3] and all(x['gpuComplete'] and len(x['calls']) == 3 for x in result['jobs']), 'owned nonindexed fence proof absent')
    need(result['restored']['frames'][0]['sha256'] == result['restored']['frames'][2]['sha256'], 'A/B/A pixel mismatch')
    for mode, prediction in FAULTS.items():
        bad = physical('fault-' + mode, False)
        need(bad['sources'] == good['sources'] and bad['inputs'] == good['inputs'], 'fault source set differs')
        need(bad['browserResult']['status'] == 'failed' and prediction in bad['browserResult']['error']['message'], 'unrelated failure counted as fault: ' + mode)
        mutation = bad['sabotage']
        need(mutation['mode'] == mode and mutation['path'] == 'renderer/virgl-command/state.mjs', 'wrong fault boundary')
        need(mutation['originalSha256'] != mutation['servedSha256'], 'fault did not change source')
        fault = record(directory / ('fault-' + mode) / 'fault-source.mjs', mutation['servedSha256'])
        original = (ROOT / mutation['path']).read_bytes()
        need(original.count(mutation['needle'].encode()) == 1 and fault == original.replace(mutation['needle'].encode(), mutation['replacement'].encode()), 'fault bytes are not the named mutation')
    held = json.loads(record(directory / 'regression/receipt.json'))
    need(held['task'] == 'E6-T12g5' and held['status'] == 'passed' and held['gitHead'] == head, 'affected regression receipt wrong')
    for item in held['sources'] + held['inputs']:
        source(item)
    for item in held['records']:
        record(directory / 'regression' / item['path'], item['sha256'])
    roles = json.loads(record(directory / 'required-format-roles.json'))
    need(roles['status'] == 'passed' and roles['roleChecks'] == 288 and roles['rejectedBeforeAllocation'] == 35
         and roles['wireChecks'] == 3905 and roles['retainedIdReuse'] is True, 'promoted format-role regression failed')
    for name in ['tools/virgl-command/raster-seal.py', 'tools/virgl-command/raster-README.md',
                 'renderer/virgl-command/tests/required-format-roles.mjs',
                 'renderer/virgl-command/draw-README.md',
                 'tasks/epic-6-transcendence/E6-T12h-virgl-raster-depth-state.md']:
        raw = (ROOT / name).read_bytes()
        source({'path': name, 'bytes': len(raw), 'sha256': sha(raw)})
    receipt = {'schema': 'virgl-raster-depth-receipt-v1', 'task': 'E6-T12h', 'status': 'passed', 'gitHead': head,
               'guestExecution': False, 'productionNegotiation': False, 'authority': 'isolated-original-draw-state',
               'hardwareAssertions': len(result['assertions']), 'originalDraws': 9,
               'physicalSourceFaultsRejected': list(FAULTS), 'sources': sources, 'generated': generated, 'files': files}
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('E6-T12h receipt passed: nine original draws, physical depth/scissor/winding, owned arrays and current retained gates')


if __name__ == '__main__':
    main(sys.argv[1])
