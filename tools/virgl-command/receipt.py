#!/usr/bin/env python3
"""Bind pure-JS decoder parity and a targeted independent-oracle sabotage."""
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
    report_paths = [directory / name / 'report.json' for name in ('parity', 'sabotage')]
    parity, sabotage = [json.loads(p.read_text()) for p in report_paths]
    require(parity['status'] == 'passed' and parity['node']['status'] == 'passed', 'decoder parity did not pass')
    require(parity['browserResult']['status'] == 'passed', 'browser did not pass')
    require(parity['node'] == parity['browserResult']['result'], 'Node/browser result mismatch')
    require(parity['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser error')
    require(parity['guestExecution'] is False, 'parser evidence cannot claim guest execution')
    require(sabotage['status'] == 'failed' and sabotage['node']['status'] == 'passed', 'sabotage failed outside browser')
    require(sabotage['browserResult']['status'] == 'failed', 'sabotage did not reach independent oracle')
    require('packet byteLength' in sabotage['browserResult']['error']['message'], 'wrong sabotage failure')
    require(sabotage['sabotage']['mode'] == 'packet-length', 'wrong sabotage')
    require(sabotage['sabotage']['originalSha256'] != sabotage['sabotage']['servedSha256'], 'sabotage changed no bytes')
    require(parity['gitHead'] == sabotage['gitHead'], 'source head changed')
    require(parity['sources'] == sabotage['sources'] and parity['inputs'] == sabotage['inputs'], 'sources differ')
    records = []
    for report, report_path in zip((parity, sabotage), report_paths):
        require(report['task'] == 'E6-T12a', 'wrong task')
        for source in report['sources'] + report['inputs']:
            data = (ROOT / source['path']).read_bytes()
            require(digest(data) == source['sha256'], f"source drift: {source['path']}")
        records.append({'path': str(report_path.relative_to(directory)), 'sha256': digest(report_path.read_bytes())})
        screenshot = report.get('screenshot') or report.get('failureScreenshot')
        require(screenshot is not None, 'missing browser capture')
        image_path = report_path.parent / screenshot['path']
        require(digest(image_path.read_bytes()) == screenshot['sha256'], 'screenshot changed')
        records.append({'path': str(image_path.relative_to(directory)), 'sha256': screenshot['sha256']})
        served = {r['path']: r for r in report['servedFiles']}
        decoder = served['/renderer/virgl-command/decoder.mjs']['sha256']
        actual = next(s['sha256'] for s in report['sources'] if s['path'] == 'renderer/virgl-command/decoder.mjs')
        require(decoder == (report['sabotage']['servedSha256'] if 'sabotage' in report else actual), 'wrong decoder served')
        require(served['/fixtures.json']['sha256'] == report['fixtureTransport']['sha256'], 'wrong fixture bytes served')
    coverage_path = directory / 'coverage.json'
    coverage = json.loads(coverage_path.read_text())
    require(digest((ROOT / coverage['source']).read_bytes()) == coverage['sha256'], 'coverage source changed')
    require(len(coverage['coverage']['functions']) > 0, 'empty coverage counters')
    records.append({'path': 'coverage.json', 'sha256': digest(coverage_path.read_bytes())})
    receipt = {'schema': 1, 'task': 'E6-T12a', 'status': 'passed', 'gitHead': parity['gitHead'],
               'guestExecution': False, 'nodeBrowserEqual': True, 'packetLengthSabotageRejected': True,
               'records': records, 'sources': parity['sources'], 'inputs': parity['inputs'],
               'nodeMs': parity['nodeMs'], 'browserMs': parity['browserMs'],
               'nodeResultSha256': parity['nodeSha256']}
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('E6-T12a receipt passed: original commands, Node/browser parity and packet-length sabotage')

if __name__ == '__main__':
    main()
