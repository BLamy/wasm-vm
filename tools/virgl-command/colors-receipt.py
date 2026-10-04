#!/usr/bin/env python3
"""Bind frozen color storage proof, affected regressions and physical source faults."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
GENERATED = {'renderer/virgl-shader/build/wasm/virgl-shader.mjs',
             'renderer/virgl-shader/build/wasm/virgl-shader.wasm'}
REGRESSIONS = {'decoder': 'E6-T12a', 'resources': 'E6-T12b',
               'state': 'E6-T12c', 'draw': 'E6-T12d', 'async': 'E6-T11b1'}
FAULTS = {'channel-order': 'physical sampled RGBA 2 keeps channels/precision/alpha/origin',
          'destination-alpha': 'draw 233 physical channels and destination alpha at 8,8'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def main():
    directory = Path(sys.argv[1]).resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    records, sources, inputs, frozen = {}, {}, {}, {}

    def artifact(file, expected=None):
        raw = file.read_bytes()
        actual = digest(raw)
        require(expected is None or actual == expected, f'artifact drift: {file}')
        relative = str(file.relative_to(directory))
        records[relative] = {'path': relative, 'bytes': len(raw), 'sha256': actual}
        return raw

    def read_report(name, task, passed=True, browser=True):
        file = directory / name / 'report.json'
        report = json.loads(artifact(file))
        require(report['task'] == task and report['gitHead'] == head, f'wrong task/head: {name}')
        require(report['status'] == ('passed' if passed else 'failed'), f'wrong status: {name}')
        for items, collected in ((report['sources'], sources), (report['inputs'], inputs)):
            for item in items:
                path = item['path']
                raw = (ROOT / path).read_bytes()
                require(digest(raw) == item['sha256'] and len(raw) == item['bytes'], f'source drift: {path}')
                if path not in GENERATED:
                    if path not in frozen:
                        frozen[path] = subprocess.check_output(['git', 'show', f'{head}:{path}'], cwd=ROOT)
                    require(frozen[path] == raw, f'source not frozen at HEAD: {path}')
                require(path not in collected or collected[path] == item, f'inconsistent source binding: {path}')
                collected[path] = item
        native = report.get('native', report.get('node'))
        if native is not None:
            require(native['status'] == 'passed', f'native guards failed: {name}')
        if not browser:
            return report
        require(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, f'browser errors: {name}')
        require(report['browserResult']['status'] == ('passed' if passed else 'failed'), f'wrong browser status: {name}')
        gpu = report['browser']['gpu']['featureStatus']
        require(gpu.get('webgl2', gpu.get('webgl')) == 'enabled', f'GPU disabled: {name}')
        require(report['browser']['headless'] is False, f'headless GPU proof: {name}')
        screen = report.get('screenshot') or report.get('failureScreenshot')
        require(screen is not None, f'missing browser recording: {name}')
        artifact(file.parent / screen['path'], screen['sha256'])
        measured = report['browserCoverage']
        coverage = json.loads(artifact(file.parent / measured['path'], measured['sha256']))
        scripts = coverage.get('scripts', [coverage] if 'source' in coverage else [])
        require(scripts, f'no runtime coverage: {name}')
        served = {item['path']: item for item in report['servedFiles']}
        mutation = report.get('sabotage', {})
        for script in scripts:
            path = script['source']
            expected = mutation['servedSha256'] if path == mutation.get('path') else sources[path]['sha256']
            require(script['sha256'] == expected, f'coverage source differs: {name}')
        for item in report['sources']:
            path = item['path']
            if path.startswith('renderer/') and path.endswith(('.mjs', '.wasm')) and '/' + path in served:
                expected = mutation['servedSha256'] if path == mutation.get('path') else item['sha256']
                require(served['/' + path]['sha256'] == expected, f'wrong module served: {name}')
        require(served['/fixtures.json']['sha256'] == report['fixtureTransport']['sha256'], f'wrong fixture transport: {name}')
        return report

    good = read_report('hardware', 'E6-T12g2')
    require(good['native'] == good['browserResult']['native'], 'Node/browser guards differ')
    result = good['browserResult']['result']
    require(result['status'] == 'passed' and result['guestExecution'] is False, 'wrong proof boundary')
    require(result['assertions'] and all(x['held'] for x in result['assertions']), 'physical/ownership assertion failed')
    require(all(x['held'] for x in good['native']['assertions']), 'metadata/role assertion failed')
    require([x['format'] for x in result['formats']] == [2, 67, 233], 'required color format missing')
    require([x['componentBits'] for x in result['formats']] == [[8, 8, 8, 0], [8, 8, 8, 8], [10, 10, 10, 2]],
            'actual attachment component precision differs')
    originals = result['originals']
    require([(x['metadata']['format'], x['citation']['event']) for x in originals[:2]] == [(2, 176), (233, 5115)],
            'wrong original color surface packets')
    require(originals[2]['format'] == 67 and originals[2]['citation']['event'] == 140 and
            originals[2]['physicalSha256'] == originals[2]['backingSha256'], 'original CPU upload not physically matched')
    require([x['format'] for x in result['copies']] == [2, 67, 233], 'copy transfer coverage missing')
    require([(x['oldFormat'], x['newFormat']) for x in result['generations']] == [(2, 233), (233, 2), (67, 233)],
            'cross-format retained generation cases missing')
    require(len(result['budgets']['pressure']) == 6 and result['budgets']['injectedIncompleteFramebuffer'],
            'quota/allocation rollback proof missing')
    draw = {x['format']: x for x in result['draws']}
    require(draw[233]['destinationAlphaBlend'] == [1023, 0, 0, 3] and draw[2]['destinationAlphaBlend'] == [255, 0, 0, 255]
            and draw[67]['destinationAlphaBlend'] == [0, 0, 0, 0], 'physical destination alpha blend differs')
    require([draw[f]['sourceAlphaBlend'] for f in (2, 67, 233)] == [[0, 0, 0, 255], [0, 0, 0, 0], [0, 0, 0, 3]],
            'source fragment alpha was changed')
    for mode, failure in FAULTS.items():
        bad = read_report('sabotage-' + mode, 'E6-T12g2', passed=False)
        require(bad['sources'] == good['sources'] and bad['inputs'] == good['inputs'], 'fault boundary sources differ')
        mutation = bad['sabotage']
        require(mutation['mode'] == mode and mutation['originalSha256'] != mutation['servedSha256'], 'source fault absent')
        artifact(directory / ('sabotage-' + mode) / 'fault-source.mjs', mutation['servedSha256'])
        require(failure in bad['browserResult']['error']['message'], 'fault rejected outside independent physical pixel oracle')
    for name, task in REGRESSIONS.items():
        read_report('regression/' + name, task, browser=name != 'decoder')
    receipt = {'schema': 1, 'task': 'E6-T12g2', 'status': 'passed', 'gitHead': head,
               'guestExecution': False, 'productionNegotiation': False, 'formats': [2, 67, 233],
               'physicalSourceFaultsRejected': list(FAULTS), 'nativeAssertions': len(good['native']['assertions']),
               'hardwareAssertions': len(result['assertions']), 'sources': list(sources.values()),
               'inputs': list(inputs.values()), 'records': list(records.values())}
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('E6-T12g2 receipt passed: required color storage, physical pixels, owned transfers and two source faults')


if __name__ == '__main__':
    main()
