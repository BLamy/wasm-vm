#!/usr/bin/env python3
"""Fresh critic authentication; never rebuild a binary to export an old profile."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
WORKER = OUT.parent / 'worker'
HEAD = '38d7f930e012d8430e112d5dc3192a17ea4e164d'
CLAIM = 'b3dd41b2633adf4dd5d29d8cac848294b8fa4e9f'

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def main():
    expected = {
        'manifest.json': 'fa75a5bb326f970d56a8634696e8cdf6e38213b0ba0ac6939946e5c84af16d90',
        'records.json': 'f1cda6ea72729fdb682cebf9bdc48c06c9c672741e7570e07baed8725dd9a639',
        'recording.tar.gz': 'aa1fc589c46a0ce20fac6b76284583aefa4be61878d78a5b2c9aedf16ad955d2'
    }
    for name, digest in expected.items():
        assert sha((WORKER / name).read_bytes()) == digest, name
    manifest = json.loads((WORKER / 'manifest.json').read_bytes())
    index = json.loads((WORKER / 'records.json').read_bytes())
    assert manifest['sourceHead'] == index['sourceHead'] == HEAD
    assert manifest['records'] == len(index['records']) == 104
    records = {entry['path']: entry for entry in index['records']}
    assert len(records) == len(index['records'])
    actual = {}
    with tarfile.open(WORKER / 'recording.tar.gz', 'r:gz') as archive:
        for member in archive.getmembers():
            name = PurePosixPath(member.name)
            assert member.isfile() and not name.is_absolute() and '..' not in name.parts
            assert member.name not in actual and member.name in records
            raw = archive.extractfile(member).read()
            entry = records[member.name]
            assert len(raw) == entry['bytes'] == member.size
            assert sha(raw) == entry['sha256'], member.name
            actual[member.name] = raw
    assert actual.keys() == records.keys()
    # Keep original real bytes for repeatable audits; no generated reconstruction.
    for name, raw in actual.items():
        file = OUT / 'unpacked' / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(raw)
    hot = json.loads(actual['hot/receipt.json'])
    cold = json.loads(actual['cold/acceptance/receipt.json'])
    cold_report = json.loads(actual['cold/report.json'])
    assert sha(actual['hot/receipt.json']) == manifest['hotReceiptSha256']
    assert sha(actual['cold/acceptance/receipt.json']) == manifest['coldReceiptSha256']
    assert sha(actual['cold/report.json']) == manifest['coldReportSha256']
    assert all(v['gitHead'] == HEAD and v['status'] == 'passed' for v in [hot, cold, cold_report])
    assert cold_report['cloneHead'] == HEAD and cold_report['statusBefore'] == cold_report['statusAfter'] == ''
    assert cold_report['exitCode'] == 0
    assert sha(actual['cold/cold.log']) == cold_report['logSha256']
    assert sha(actual['cold/acceptance/receipt.json']) == cold_report['receiptSha256']
    bindings = []
    for prefix, receipt, generated, fault in [('hot/', hot, 'generated/', 'fault-source/'),
                                            ('cold/acceptance/', cold, 'cold-generated/', 'cold-fault-source/')]:
        for entry in receipt['records']:
            raw = actual[prefix + entry['path']]
            assert len(raw) == entry['bytes'] and sha(raw) == entry['sha256'], prefix + entry['path']
        for entry in receipt['sources']:
            path = entry['path']
            if path.startswith('renderer/virgl-shader/build/'):
                raw = actual[generated + path.removeprefix('renderer/virgl-shader/build/')]
            elif path.startswith('target/virgl-exact-bank-fault/'):
                raw = actual[fault + path.removeprefix('target/virgl-exact-bank-fault/')]
            else:
                raw = git('show', HEAD + ':' + path)
                assert raw == git('show', CLAIM + ':' + path) == (ROOT / path).read_bytes(), path
            assert len(raw) == entry['bytes'] and sha(raw) == entry['sha256'], path
        native = json.loads(actual[prefix + 'native/report.json'])
        original_binary = generated + native['binary']['path'].removeprefix('renderer/virgl-shader/build/')
        assert sha(actual[original_binary]) == native['binary']['sha256']
        assert not actual[prefix + 'native/native.stderr']
        assert sha(actual[prefix + 'native/cases.bin']) == native['fixtureSha256']
        assert sha(actual[prefix + 'native/native.log']) == native['stdoutSha256']
        bindings.append({'prefix': prefix, 'originalBinary': original_binary,
                         'sha256': sha(actual[original_binary]), 'sourceCount': len(receipt['sources']),
                         'recordCount': len(receipt['records'])})
    # Verify preserved original cold executable bytes in their original clone.
    original_cold = Path(cold_report['clone']) / 'renderer/virgl-shader/build/known-branch-sanitize/known-branch-test'
    assert sha(original_cold.read_bytes()) == sha(actual['cold-generated/known-branch-sanitize/known-branch-test'])
    prior = git('diff', '--name-only', manifest['base'], CLAIM, '--', 'evidence').decode().splitlines()
    assert all(path.startswith('evidence/virgl-exact-bank/') for path in prior)
    result = {'schema': 1, 'task': 'E6-T12g6m3a', 'prediction': 'P1', 'status': 'HELD',
              'claimHead': CLAIM, 'sourceHead': HEAD, 'digests': expected, 'members': len(actual),
              'bindings': bindings, 'coldClone': cold_report['clone'], 'coldLogSha256': cold_report['logSha256'],
              'removedEnvironmentNames': cold_report['removedEnvironmentNames'],
              'oldEvidenceChanges': [], 'originalColdBinaryAuthenticated': True}
    (OUT / 'authentication.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))

if __name__ == '__main__':
    main()
