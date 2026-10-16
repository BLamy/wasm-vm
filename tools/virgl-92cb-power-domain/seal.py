#!/usr/bin/env python3
"""Seal hot/cold physical first-power records for a fresh verifier."""
from pathlib import Path
import gzip
import hashlib
import io
import json
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    hot, cold, output = [Path(value).resolve() for value in sys.argv[1:4]]
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    hot_receipt = json.loads((hot / 'receipt.json').read_text())
    cold_report = json.loads((cold / 'report.json').read_text())
    cold_receipt = json.loads((cold / 'acceptance/receipt.json').read_text())
    for record in (hot_receipt, cold_report, cold_receipt):
        if record['status'] != 'passed' or record['gitHead'] != head:
            raise ValueError('only passed exact-head physical evidence may be sealed')
    if cold_report['cloneHead'] != head or cold_report['statusBefore'] or cold_report['statusAfter']:
        raise ValueError('cold clone was not pristine')
    if sha((cold / 'acceptance/receipt.json').read_bytes()) != cold_report['receiptSha256']:
        raise ValueError('cold receipt drift')
    members = {}
    for prefix, directory, receipt in [('hot', hot, hot_receipt),
                                       ('cold', cold / 'acceptance', cold_receipt)]:
        for name, digest in receipt['files'].items():
            if sha((directory / name).read_bytes()) != digest:
                raise ValueError(prefix + ' file drift: ' + name)
        for name, digest in receipt['sources'].items():
            original = subprocess.check_output(['git', 'show', f'{head}:{name}'], cwd=ROOT)
            if sha(original) != digest:
                raise ValueError(prefix + ' source drift: ' + name)
        binary_root = ROOT if prefix == 'hot' else Path(cold_report['clone'])
        for name, digest in receipt['generated'].items():
            data = (binary_root / name).read_bytes()
            if sha(data) != digest:
                raise ValueError(prefix + ' generated binary drift: ' + name)
            members[prefix + '-generated/' + name] = data
        for name in sorted([*receipt['files'], 'receipt.json']):
            members[prefix + '/' + name] = (directory / name).read_bytes()
    members['cold/report.json'] = (cold / 'report.json').read_bytes()
    members['cold/cold.log'] = (cold / 'cold.log').read_bytes()
    output.mkdir(parents=True, exist_ok=True)
    records = {'schema': 'virgl-original-92cb-physical-power-records-v1',
               'task': 'E6-T12g6m5b2b1', 'sourceHead': head,
               'records': [{'path': name, 'bytes': len(data), 'sha256': sha(data)}
                           for name, data in sorted(members.items())]}
    index = (json.dumps(records, indent=2) + '\n').encode()
    (output / 'records.json').write_bytes(index)
    archive = io.BytesIO()
    with gzip.GzipFile(fileobj=archive, mode='wb', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as tar:
            for name, data in sorted(members.items()):
                info = tarfile.TarInfo(name)
                info.size, info.mtime, info.mode = len(data), 0, 0o644
                tar.addfile(info, io.BytesIO(data))
    packed = archive.getvalue()
    (output / 'recording.tar.gz').write_bytes(packed)
    manifest = {'schema': 'virgl-original-92cb-physical-power-seal-v1',
                'task': 'E6-T12g6m5b2b1', 'sourceHead': head, 'records': len(members),
                'archiveSha256': sha(packed), 'archiveBytes': len(packed),
                'recordIndexSha256': sha(index),
                'hotReceiptSha256': sha((hot / 'receipt.json').read_bytes()),
                'coldReportSha256': sha((cold / 'report.json').read_bytes()),
                'coldReceiptSha256': sha((cold / 'acceptance/receipt.json').read_bytes()),
                'guestExecution': False, 'portableDomainCertified': False,
                'compilerAuthority': False, 'productionDrawAuthority': False}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest))


if __name__ == '__main__':
    main()
