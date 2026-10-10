#!/usr/bin/env python3
"""Seal only chosen critic records and this session's three local GPU runs."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
TOP = ['predictions.json', 'novel-plan.json', 'authenticate.py', 'authentication.json', 'runtime.diff',
       'coverage_audit.py', 'coverage-audit.json', 'coverage-audit.log', 'hot-audit.json', 'hot-audit.log',
       'cold-audit.json', 'cold-audit.log', 'independent-audit.json', 'independent-audit.log',
       'fault-list-order-audit.json', 'fault-provoking-audit.json', 'independent.log', 'fault-list-order.log', 'fault-provoking.log',
       'hot-audit-initial.json', 'hot-audit-initial.log', 'hot-audit-drain-initial.json', 'hot-audit-drain-initial.log',
       'cold-audit-drain-initial.json', 'cold-audit-drain-initial.log', 'audit-harness-correction.json',
       'verdict.json', 'checks.json', 'policy.log', 'queue.log', 'seal.py']


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    members, source_rows = {}, {}
    for name in TOP:
        members[name] = (HERE / name).read_bytes()
    for dirname in ['independent', 'fault-list-order', 'fault-provoking']:
        directory = HERE / dirname
        report = json.loads((directory / 'report.json').read_text())
        assert report['status'] == ('passed' if dirname == 'independent' else 'failed')
        assert report['browserErrors'] == {'console': [], 'page': [], 'requests': []}
        assert report['fixedMemory'] == {'bytes': 16777216, 'stageExport': 'function', 'pairExport': 'function'}
        served = {row['path']: row['sha256'] for row in report['servedFiles']}
        for row in report['sources']:
            raw = (ROOT / row['path']).read_bytes()
            assert len(raw) == row['bytes'] and sha(raw) == row['sha256']
            source_rows[row['path']] = row['sha256']
            members['sources/' + row['path']] = raw
            if '/' + row['path'] in served:
                mutation = report.get('mutation')
                expected = mutation['servedSha256'] if mutation and row['path'] == mutation['path'] else row['sha256']
                assert served['/' + row['path']] == expected
        for item in sorted(directory.rglob('*')):
            if item.is_file():
                members[dirname + '/' + item.relative_to(directory).as_posix()] = item.read_bytes()
    for name in ['renderer/virgl-command/tests/standard-primitive-assembly-adversarial.mjs',
                 'tools/virgl-command/standard-assembly-adversarial-oracle.mjs', 'tools/virgl-command/standard-assembly-adversarial-audit.mjs']:
        raw = (ROOT / name).read_bytes()
        source_rows[name] = sha(raw)
        members['sources/' + name] = raw
    for name in ['hot/acceptance.log', 'hot/harness-correction.json', 'hot/harness-correction.log', 'cold/report.json', 'cold/acceptance.log']:
        members['worker-reference/' + name] = (HERE / 'unpacked' / name).read_bytes()
    members['worker-reference/manifest.json'] = (HERE.parent / 'worker/manifest.json').read_bytes()
    records = {'schema': 'virgl-standard-primitive-assembly-critic-records-v1', 'task': 'E6-T11d10',
               'workerSubmission': '391643b02e5b59018da3cae9f650122cc7d83172',
               'records': [{'path': name, 'bytes': len(raw), 'sha256': sha(raw)} for name, raw in sorted(members.items())]}
    index = (json.dumps(records, indent=2) + '\n').encode()
    (HERE / 'records.json').write_bytes(index)
    packed = io.BytesIO()
    with gzip.GzipFile(fileobj=packed, mode='wb', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as tar:
            for name, raw in sorted(members.items()):
                info = tarfile.TarInfo(name)
                info.size, info.mtime, info.mode = len(raw), 0, 0o644
                tar.addfile(info, io.BytesIO(raw))
    archive = packed.getvalue()
    (HERE / 'recording.tar.gz').write_bytes(archive)
    # Independently reopen the output once before claiming critic custody.
    expected = {r['path']: r for r in records['records']}
    reopened = set()
    with tarfile.open(HERE / 'recording.tar.gz', 'r:gz') as tar:
        for item in tar:
            assert item.isfile() and item.name in expected and item.name not in reopened
            raw = tar.extractfile(item).read(); row = expected[item.name]
            assert len(raw) == row['bytes'] and sha(raw) == row['sha256']
            reopened.add(item.name)
    assert reopened == set(expected)
    manifest = {'schema': 'virgl-standard-primitive-assembly-critic-seal-v1', 'task': 'E6-T11d10', 'verdict': 'verified',
                'sourceHead': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                'runtimeSourceSha256': source_rows['renderer/virgl-command/state.mjs'], 'records': len(members),
                'archiveSha256': sha(archive), 'archiveBytes': len(archive), 'recordIndexSha256': sha(index),
                'workerArchiveSha256': '51ff1c7fa589480cdc626d715771364164aa3540086dbc9ea443986503d84177',
                'sources': source_rows, 'guestExecution': False, 'productionNegotiation': False, 'productionDrawAuthority': False,
                'authority': 'isolated-standard-primitive-assembly', 'reopenedAllRecords': True}
    (HERE / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({key: manifest[key] for key in ['records', 'archiveSha256', 'archiveBytes', 'recordIndexSha256']}))


if __name__ == '__main__':
    main()
