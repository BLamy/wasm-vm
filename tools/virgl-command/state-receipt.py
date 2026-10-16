#!/usr/bin/env python3
"""Bind real GL state proof and original-wire constant/mask corruption controls."""
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
    names = ('hardware', 'sabotage-constant-bits', 'sabotage-color-mask')
    reports = {name: json.loads((directory / name / 'report.json').read_text()) for name in names}
    good = reports['hardware']
    require(good['status'] == 'passed' and good['browserResult']['status'] == 'passed', 'state proof did not pass')
    require(good['browserResult']['result']['status'] == 'passed', 'state suite did not pass')
    require(good['browserResult']['result']['guestExecution'] is False, 'cannot claim guest execution')
    require(good['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser errors')
    records = []
    for name, report in reports.items():
        report_path = directory / name / 'report.json'
        require(report['task'] == 'E6-T12c' and report['gitHead'] == good['gitHead'], 'wrong task/head')
        require(report['sources'] == good['sources'] and report['inputs'] == good['inputs'], 'source set changed')
        for source in report['sources'] + report['inputs']:
            require(digest((ROOT / source['path']).read_bytes()) == source['sha256'], f"source drift {source['path']}")
        if name != 'hardware':
            require(report['status'] == 'failed' and report['browserResult']['status'] == 'failed', 'sabotage did not fail browser')
            label = 'original fragment constant bits' if 'constant' in name else 'original color mask'
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
    for name in ('decoder', 'resources'):
        regression_path = directory / name / 'report.json'
        regression = json.loads(regression_path.read_text())
        require(regression['status'] == 'passed' and regression['node']['status'] == 'passed', f'{name} regression failed')
        require(regression['gitHead'] == good['gitHead'], f'{name} regression head mismatch')
        records.append({'path': str(regression_path.relative_to(directory)), 'sha256': digest(regression_path.read_bytes())})
    receipt = {'schema': 1, 'task': 'E6-T12c', 'status': 'passed', 'gitHead': good['gitHead'],
               'guestExecution': False, 'inputSabotageRejected': ['constant-bits', 'color-mask'],
               'sources': good['sources'], 'inputs': good['inputs'], 'records': records,
               'browserResultSha256': good['browserResultSha256'], 'browserMs': good['browserMs']}
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('E6-T12c receipt passed: original GL state, shader linkage, clear/isolation and wire sabotage controls')

if __name__ == '__main__':
    main()
