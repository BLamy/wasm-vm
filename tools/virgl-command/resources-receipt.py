#!/usr/bin/env python3
"""Bind real GPU resource proof and two original-input corruption controls."""
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
    names = ('hardware', 'sabotage-texture-texel', 'sabotage-index-byte')
    reports = {name: json.loads((directory / name / 'report.json').read_text()) for name in names}
    good = reports['hardware']
    require(good['status'] == 'passed' and good['node']['status'] == 'passed', 'resource proof did not pass')
    require(good['browserResult']['status'] == 'passed', 'browser resource proof did not pass')
    require(good['browserResult']['result']['native'] == good['node'], 'Node/browser native results differ')
    require(good['browserResult']['result']['guestExecution'] is False, 'cannot claim guest execution')
    require(good['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser errors')
    records = []
    for name, report in reports.items():
        report_path = directory / name / 'report.json'
        require(report['task'] == 'E6-T12b' and report['gitHead'] == good['gitHead'], 'wrong task/head')
        require(report['sources'] == good['sources'] and report['inputs'] == good['inputs'], 'source set changed')
        for source in report['sources'] + report['inputs']:
            require(digest((ROOT / source['path']).read_bytes()) == source['sha256'], f"source drift {source['path']}")
        if name != 'hardware':
            require(report['status'] == 'failed' and report['node']['status'] == 'passed', 'sabotage failed outside browser')
            require(report['browserResult']['status'] == 'failed', 'sabotage did not fail browser')
            label = 'original texture GPU bytes' if 'texture' in name else 'original index GPU bytes'
            require(label in report['browserResult']['error']['message'], 'sabotage failed for wrong reason')
            require(report['sabotage']['mode'] == name.removeprefix('sabotage-'), 'wrong mutation')
            require(report['sabotage']['originalSha256'] != report['sabotage']['servedSha256'], 'no mutation')
        coverage_path = report_path.parent / report['browserCoverage']['path']
        require(digest(coverage_path.read_bytes()) == report['browserCoverage']['sha256'], 'browser coverage changed')
        require(json.loads(coverage_path.read_text())['sha256'] == next(s['sha256'] for s in good['sources'] if s['path'] == 'renderer/virgl-command/resources.mjs'), 'browser coverage source mismatch')
        records.append({'path': str(coverage_path.relative_to(directory)), 'sha256': digest(coverage_path.read_bytes())})
        records.append({'path': str(report_path.relative_to(directory)), 'sha256': digest(report_path.read_bytes())})
        screen = report.get('screenshot') or report.get('failureScreenshot')
        require(screen is not None, 'no browser capture')
        screen_path = report_path.parent / screen['path']
        require(digest(screen_path.read_bytes()) == screen['sha256'], 'screenshot changed')
        records.append({'path': str(screen_path.relative_to(directory)), 'sha256': screen['sha256']})
        served = {item['path']: item for item in report['servedFiles']}
        for source in report['sources']:
            if source['path'].startswith('renderer/') and source['path'].endswith('.mjs'):
                require(served['/' + source['path']]['sha256'] == source['sha256'], 'wrong renderer source served')
        expected_fixture = report['sabotage']['servedSha256'] if name != 'hardware' else report['fixtureTransport']['sha256']
        require(served['/fixtures.json']['sha256'] == expected_fixture, 'wrong fixture bytes served')
    decoder_path = directory / 'decoder/report.json'
    decoder = json.loads(decoder_path.read_text())
    require(decoder['status'] == 'passed' and decoder['node']['status'] == 'passed', 'decoder regression failed')
    require(decoder['gitHead'] == good['gitHead'], 'decoder regression head mismatch')
    records.append({'path': 'decoder/report.json', 'sha256': digest(decoder_path.read_bytes())})
    node_coverage_path = directory / 'node-coverage.json'
    require(json.loads(node_coverage_path.read_text())['sha256'] == next(s['sha256'] for s in good['sources'] if s['path'] == 'renderer/virgl-command/resources.mjs'), 'Node coverage source mismatch')
    records.append({'path': 'node-coverage.json', 'sha256': digest(node_coverage_path.read_bytes())})
    receipt = {'schema': 1, 'task': 'E6-T12b', 'status': 'passed', 'gitHead': good['gitHead'],
               'guestExecution': False, 'nodeBrowserNativeEqual': True, 'inputSabotageRejected': ['texture-texel', 'index-byte'],
               'sources': good['sources'], 'inputs': good['inputs'], 'records': records,
               'nodeResultSha256': good['nodeSha256'], 'nodeMs': good['nodeMs'], 'browserMs': good['browserMs']}
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('E6-T12b receipt passed: actual GPU transfers/lifetimes and two input sabotage controls')

if __name__ == '__main__':
    main()
