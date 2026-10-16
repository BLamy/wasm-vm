#!/usr/bin/env python3
"""Seal full hot/cold packet/native/V8 records for a fresh adversarial verifier."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
CONFIRMATION = b'Frozen original packed words, native planes and retained ranges authenticated.\n'
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def main():
    hot, cold, output = [Path(value).resolve() for value in sys.argv[1:4]]
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=ROOT, text=True).strip():
        raise ValueError('freeze tracked source before sealing')
    hot_receipt = json.loads((hot/'receipt.json').read_text())
    cold_report = json.loads((cold/'report.json').read_text())
    cold_receipt = json.loads((cold/'acceptance/receipt.json').read_text())
    for record in [hot_receipt, cold_report, cold_receipt]:
        if record['status'] != 'passed' or record['gitHead'] != head:
            raise ValueError('only passed exact-head evidence may be sealed')
    if cold_report['cloneHead'] != head or cold_report['statusBefore'] or cold_report['statusAfter']:
        raise ValueError('cold clone was not pristine')
    if sha((cold/'acceptance/receipt.json').read_bytes()) != cold_report['receiptSha256']:
        raise ValueError('cold receipt drift')
    members = {}
    for prefix, directory, receipt in [('hot', hot, hot_receipt), ('cold', cold/'acceptance', cold_receipt)]:
        for name, digest in receipt['files'].items():
            raw = (directory/name).read_bytes()
            if sha(raw) != digest:
                if name == 'acceptance.log' and raw.endswith(CONFIRMATION) and sha(raw[:-len(CONFIRMATION)]) == digest:
                    members[prefix+'/'+name+'.final'] = raw
                    raw = raw[:-len(CONFIRMATION)]
                else:
                    raise ValueError('record drift '+prefix+'/'+name)
            members[prefix+'/'+name] = raw
        for name, digest in receipt['sources'].items():
            original = subprocess.check_output(['git', 'show', head+':'+name], cwd=ROOT)
            if sha(original) != digest:
                raise ValueError('source drift '+name)
        binary_root = ROOT if prefix == 'hot' else Path(cold_report['clone'])
        for name, digest in receipt['generated'].items():
            raw = (binary_root/name).read_bytes()
            if sha(raw) != digest:
                raise ValueError('generated drift '+name)
            members[prefix+'-generated/'+name] = raw
        members[prefix+'/receipt.json'] = (directory/'receipt.json').read_bytes()
    for name in ['report.json', 'cold.log']:
        members['cold/'+name] = (cold/name).read_bytes()
    output.mkdir(parents=True, exist_ok=True)
    index = (json.dumps(dict(schema='original-packed-float-image-records-v1', task='E6-T11d27', sourceHead=head,
                            records=[dict(path=name, bytes=len(raw), sha256=sha(raw)) for name, raw in sorted(members.items())]), indent=2)+'\n').encode()
    (output/'records.json').write_bytes(index)
    archive = io.BytesIO()
    with gzip.GzipFile(fileobj=archive, mode='wb', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as tar:
            for name, raw in sorted(members.items()):
                info = tarfile.TarInfo(name)
                info.size, info.mtime, info.mode = len(raw), 0, 0o644
                tar.addfile(info, io.BytesIO(raw))
    raw = archive.getvalue()
    (output/'recording.tar.gz').write_bytes(raw)
    manifest = dict(schema='original-packed-float-image-seal-v1', task='E6-T11d27', sourceHead=head,
                    records=len(members), archiveSha256=sha(raw), archiveBytes=len(raw), recordIndexSha256=sha(index),
                    hotReceiptSha256=sha((hot/'receipt.json').read_bytes()), coldReportSha256=sha((cold/'report.json').read_bytes()),
                    coldReceiptSha256=sha((cold/'acceptance/receipt.json').read_bytes()), guestExecution=False,
                    productionNegotiation=False, authority='isolated-original-packed-float-images', productionDrawAuthority=False)
    (output/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps(manifest))


if __name__ == '__main__':
    main()
