#!/usr/bin/env python3
"""Bind original full draw replay and six independently targeted input corruptions."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]

def digest(data):
    return hashlib.sha256(data).hexdigest()

def require(condition, message):
    if not condition:
        raise ValueError(message)

def main():
    directory = Path(sys.argv[1]).resolve()
    attacks = ('vertex', 'index', 'texel', 'constant', 'blend', 'readback-offset')
    names = ('hardware', *(f'sabotage-{attack}' for attack in attacks))
    reports = {name: json.loads((directory / name / 'report.json').read_text()) for name in names}
    good = reports['hardware']
    require(good['status'] == 'passed' and good['browserResult']['status'] == 'passed', 'draw proof did not pass')
    require(good['browserResult']['result']['status'] == 'passed', 'draw suite did not pass')
    require(good['browserResult']['result']['guestExecution'] is False, 'cannot claim guest execution')
    require(good['browserResult']['result']['primaryDrawReplay'] is True, 'must prove actual draws')
    require(good['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser errors')
    primary = good['browserResult']['result']['original']
    require(primary['packetCount'] == 210 and primary['gpuDraws'] == 3 and primary['checkedPixels'] == 768,
            'original draw/packet/pixel counts differ')
    require([entry['event'] for entry in primary['submissions']] == [161, 173, 185, 197, 209, 221, 233, 249], 'not all original submissions')
    require([frame['readback']['offset'] for frame in primary['frames']] == [64, 4160, 8256], 'wrong independent readback locations')
    require(all(not value for owner in ('state', 'resources') for value in primary['cleanup'][owner].values()), 'original cleanup leaks')
    poison = good['browserResult']['result']['outputReferencePoison']
    require(poison['bytes'] == 12288 and poison['hashes'] == [frame['readback']['rgbaSha256'] for frame in primary['frames']],
            'reference-output contamination check missing')
    records = []
    for name, report in reports.items():
        report_path = directory / name / 'report.json'
        require(report['task'] == 'E6-T12d' and report['gitHead'] == good['gitHead'], 'wrong task/head')
        require(report['sources'] == good['sources'] and report['inputs'] == good['inputs'], 'source set changed')
        for source in report['sources'] + report['inputs']:
            require(digest((ROOT / source['path']).read_bytes()) == source['sha256'], f"source drift {source['path']}")
        if name != 'hardware':
            require(report['status'] == 'failed' and report['browserResult']['status'] == 'failed', 'sabotage did not fail browser')
            label = 'original draw replay event 161: out-of-bounds' if name == 'sabotage-index' else 'original phase'
            if name != 'sabotage-index':
                require('interior pixel' in report['browserResult']['error']['message'], 'not a pixel oracle failure')
            require(label in report['browserResult']['error']['message'], 'sabotage failed for wrong reason')
            require(report['sabotage']['mode'] == name.removeprefix('sabotage-'), 'wrong mutation')
            require(report['sabotage']['originalSha256'] != report['sabotage']['servedSha256'], 'no mutation')
        coverage_path = report_path.parent / report['browserCoverage']['path']
        require(digest(coverage_path.read_bytes()) == report['browserCoverage']['sha256'], 'browser coverage changed')
        for script in json.loads(coverage_path.read_text())['scripts']:
            require(script['sha256'] == next(s['sha256'] for s in good['sources'] if s['path'] == script['source']), 'coverage source mismatch')
        records.append({'path': str(coverage_path.relative_to(directory)), 'sha256': digest(coverage_path.read_bytes())})
        records.append({'path': str(report_path.relative_to(directory)), 'sha256': digest(report_path.read_bytes())})
        screen = report.get('screenshot') or report.get('failureScreenshot')
        require(screen is not None, 'no browser capture')
        screen_path = report_path.parent / screen['path']
        require(digest(screen_path.read_bytes()) == screen['sha256'], 'screenshot changed')
        records.append({'path': str(screen_path.relative_to(directory)), 'sha256': screen['sha256']})
        served = {item['path']: item for item in report['servedFiles']}
        for source in report['sources']:
            if source['path'].startswith('renderer/') and source['path'].endswith(('.mjs', '.wasm')):
                require(served['/' + source['path']]['sha256'] == source['sha256'], 'wrong renderer source served')
        expected_fixture = report['sabotage']['servedSha256'] if name != 'hardware' else report['fixtureTransport']['sha256']
        require(served['/fixtures.json']['sha256'] == expected_fixture, 'wrong fixture bytes served')
    regression_path = directory / 'state/receipt.json'
    regression = json.loads(regression_path.read_text())
    require(regression['status'] == 'passed' and regression['task'] == 'E6-T12c', 'state regression failed')
    require(regression['gitHead'] == good['gitHead'], 'state regression head mismatch')
    current_sources = {source['path']: source['sha256'] for source in good['sources']}
    for source in regression['sources']:
        if source['path'] in current_sources:
            require(source['sha256'] == current_sources[source['path']], 'state regression used different shared source bytes')
    records.append({'path': str(regression_path.relative_to(directory)), 'sha256': digest(regression_path.read_bytes())})
    receipt = {'schema': 1, 'task': 'E6-T12d', 'status': 'passed', 'gitHead': good['gitHead'],
               'guestExecution': False, 'inputSabotageRejected': list(attacks),
               'sources': good['sources'], 'inputs': good['inputs'], 'records': records,
               'browserResultSha256': good['browserResultSha256'], 'browserMs': good['browserMs']}
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('E6-T12d receipt passed: original draw/pixel replay, isolation and six input sabotage controls')

if __name__ == '__main__':
    main()
