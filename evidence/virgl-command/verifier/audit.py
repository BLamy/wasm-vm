#!/usr/bin/env python3
"""Recheck the worker/clean-clone evidence and classify decoder coverage."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path):
    return json.loads(path.read_text())
def require_digest(path, expected):
    assert digest(path) == expected, str(path)

frozen = 'b2636b5073b1e81f2172b6b0b268fea7ce381f0d'
worker = ROOT / 'evidence/virgl-command/worker'
cold = ROOT / 'evidence/virgl-command/cold-clone'
verified_files = set()
for directory in (worker, cold / 'acceptance'):
    receipt = read(directory / 'receipt.json')
    assert receipt['gitHead'] == frozen and receipt['status'] == 'passed'
    for item in receipt['sources'] + receipt['inputs']:
        require_digest(ROOT / item['path'], item['sha256'])
        verified_files.add(str(ROOT / item['path']))
    for item in receipt['records']:
        require_digest(directory / item['path'], item['sha256'])
        verified_files.add(str(directory / item['path']))
cold_report = read(cold / 'report.json')
assert cold_report['gitHead'] == cold_report['cloneHead'] == frozen
assert cold_report['statusBefore'] == cold_report['statusAfter'] == ''
assert cold_report['status'] == 'passed' and cold_report['exitCode'] == 0
require_digest(cold / 'acceptance/receipt.json', cold_report['receiptSha256'])
require_digest(cold / 'cold.log', cold_report['logSha256'])
worker_result = read(worker / 'parity/report.json')
assert worker_result['node'] == worker_result['browserResult']['result']
assert worker_result['browserErrors'] == {'console': [], 'page': [], 'requests': []}
original = read(worker / 'receipt.json')
assert subprocess.check_output(['git', 'diff', frozen, '--', *[s['path'] for s in original['sources']]], cwd=ROOT) == b''
assert subprocess.check_output(['git', 'diff', 'af6b5509', '--', 'crates', 'web', 'renderer/virgl-shader'], cwd=ROOT) == b''

coverage = read(worker / 'coverage.json')
source = (ROOT / coverage['source']).read_text()
classifications = []
for function in coverage['coverage']['functions']:
    assert function['ranges'][0]['count'] > 0, function['functionName']
    for block in function['ranges']:
        start, end = block['startOffset'], block['endOffset']
        if block['count']:
            continue
        excerpt = source[start:end].strip()
        if excerpt.startswith('default:'):
            reason = 'Private dispatch default is unreachable after the outer command/object allowlists at decoder lines 493-495.'
        elif excerpt.startswith('throw error;'):
            reason = 'Unexpected implementation/platform defect rethrow cannot be induced by validated guest byte data; all guest rejection paths use DecodeFault.'
        else:
            raise AssertionError(('unclassified branch', excerpt))
        classifications.append({'function': function['functionName'], 'startLine': source[:start].count('\n') + 1,
                                'endLine': source[:end].count('\n') + 1, 'classification': 'justified unreachable',
                                'reason': reason, 'source': excerpt})
assert len(classifications) == 3
own = read(HERE / 'report.json')
assert own['status'] == 'passed' and own['errors'] == []
assert own['nativeCanonicalSha256'] == own['browserCanonicalSha256']
require_digest(HERE / 'browser.png', own['screenshotSha256'])
assert read(HERE / 'sabotage.json')['observedFailure'] == 'invalid-to-valid recovery'
artifacts = []
for name in ['predictions.md', 'attacks.mjs', 'run.mjs', 'report.json', 'browser.png', 'sabotage.mjs', 'sabotage.json']:
    artifacts.append({'path': name, 'sha256': digest(HERE / name)})
report = {'status': 'passed', 'runtimeHead': frozen, 'decoderSha256': coverage['sha256'],
          'workerReceiptSha256': digest(worker / 'receipt.json'), 'coldReceiptSha256': digest(cold / 'acceptance/receipt.json'),
          'recheckedFiles': len(verified_files), 'workerNodeBrowserEqual': True, 'coldCloneClean': True,
          'unchangedCRustWasmProduction': True, 'functionsWithPositiveCounts': len(coverage['coverage']['functions']),
          'zeroCountRangeClassification': classifications, 'otherRecordedRanges': 'all executed',
          'newArtifactHashes': artifacts}
(HERE / 'audit.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': report['status'], 'functions': report['functionsWithPositiveCounts'],
                  'zeroRanges': len(classifications), 'recheckedFiles': len(verified_files)}))
