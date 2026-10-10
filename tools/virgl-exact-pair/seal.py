#!/usr/bin/env python3
"""Seal exact-head hot/cold compiler recordings; no evidence is synthesized."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--hot', type=Path, required=True)
    p.add_argument('--cold', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    hot = json.loads((a.hot / 'receipt.json').read_bytes())
    cold = json.loads((a.cold / 'report.json').read_bytes())
    second = json.loads((a.cold / 'acceptance/receipt.json').read_bytes())
    for value in [hot, cold, second]:
        if value['status'] != 'passed' or value['gitHead'] != head:
            raise ValueError('only passed exact-head recordings may be sealed')
    if cold['statusBefore'] or cold['statusAfter'] or cold['cloneHead'] != head:
        raise ValueError('cold clone was not pristine')
    if sha((a.cold / 'acceptance/receipt.json').read_bytes()) != cold['receiptSha256']:
        raise ValueError('cold receipt digest mismatch')
    if sha((a.cold / 'cold.log').read_bytes()) != cold['logSha256']:
        raise ValueError('cold log digest mismatch')
    members = {}
    for prefix, directory, receipts in [('hot', a.hot, [hot]), ('cold', a.cold, [second])]:
        for receipt in receipts:
            base = directory if prefix == 'hot' else directory / 'acceptance'
            for entry in receipt['records']:
                raw = (base / entry['path']).read_bytes()
                if len(raw) != entry['bytes'] or sha(raw) != entry['sha256']:
                    raise ValueError('stale recording member: ' + entry['path'])
        for file in sorted(directory.rglob('*')):
            if file.is_file():
                members[prefix + '/' + str(file.relative_to(directory))] = file.read_bytes()
    for entry in hot['sources']:
        raw = (ROOT / entry['path']).read_bytes()
        if sha(raw) != entry['sha256'] or len(raw) != entry['bytes']:
            raise ValueError('source drift after recording: ' + entry['path'])
        if entry['path'].startswith('renderer/virgl-shader/build/'):
            members['generated/' + entry['path'].removeprefix('renderer/virgl-shader/build/')] = raw
        elif entry['path'].startswith('target/virgl-exact-pair-fault/'):
            members['fault-source/' + entry['path'].removeprefix('target/virgl-exact-pair-fault/')] = raw
    # Preserve both actual sanitizer binaries; profile records cannot be
    # re-exported from a newly rebuilt or different clone's binary.
    cold_root = Path(cold['clone'])
    for entry in second['sources']:
        if entry['path'].startswith(('renderer/virgl-shader/build/', 'target/virgl-exact-pair-fault/')):
            raw = (cold_root / entry['path']).read_bytes()
            if sha(raw) != entry['sha256'] or len(raw) != entry['bytes']:
                raise ValueError('cold generated source drift: ' + entry['path'])
            if entry['path'].startswith('renderer/virgl-shader/build/'):
                members['cold-generated/' + entry['path'].removeprefix('renderer/virgl-shader/build/')] = raw
            else:
                members['cold-fault-source/' + entry['path'].removeprefix('target/virgl-exact-pair-fault/')] = raw
    a.output.mkdir(parents=True, exist_ok=True)
    index = dict(schema='virgl-exact-pair-worker-records-v1', task='E6-T12g6m3c', sourceHead=head,
        records=[dict(path=name, bytes=len(raw), sha256=sha(raw)) for name, raw in sorted(members.items())])
    records = (json.dumps(index, indent=2) + '\n').encode()
    (a.output / 'records.json').write_bytes(records)
    archive = io.BytesIO()
    with gzip.GzipFile(fileobj=archive, mode='wb', mtime=0) as zipped:
        with tarfile.open(fileobj=zipped, mode='w') as tar:
            for name, raw in sorted(members.items()):
                info = tarfile.TarInfo(name); info.size = len(raw); info.mtime = 0; info.mode = 0o644
                tar.addfile(info, io.BytesIO(raw))
    raw_archive = archive.getvalue()
    (a.output / 'recording.tar.gz').write_bytes(raw_archive)
    manifest = dict(schema='virgl-exact-pair-worker-seal-v1', task='E6-T12g6m3c', sourceHead=head,
        base='8840833b7fc8196a72c7acf2752b2dff684f6670', records=len(members),
        archive=dict(path='recording.tar.gz', bytes=len(raw_archive), sha256=sha(raw_archive)),
        recordIndex=dict(path='records.json', bytes=len(records), sha256=sha(records)),
        hotReceiptSha256=sha((a.hot / 'receipt.json').read_bytes()),
        coldReportSha256=sha((a.cold / 'report.json').read_bytes()),
        coldReceiptSha256=sha((a.cold / 'acceptance/receipt.json').read_bytes()),
        checkedUploadWords=hot['checkedUploadWords'], checkedPixels=hot['checkedPixels'],
        nativeCases=hot['nativeCases'], schemaAttacks=hot['schemaAttacks'], allocationFaults=hot['allocationFaults'],
        ownedWasmPeakUpperBoundBytes=hot['ownedWasmPeakUpperBoundBytes'], trustedHostMetadataWrapper=False,
        productionNegotiation=False, guestExecution=False)
    (a.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest))


if __name__ == '__main__':
    main()
