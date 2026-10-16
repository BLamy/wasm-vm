#!/usr/bin/env python3
"""Seal the original hot/cold recordings and exact binaries for a fresh critic."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
GENERATED = ['renderer/virgl-shader/build/exact-reciprocal-sanitize/exact-reciprocal-test',
             'renderer/virgl-shader/build/wasm/virgl-shader.mjs',
             'renderer/virgl-shader/build/wasm/virgl-shader.wasm',
             'target/virgl-exact-reciprocal-fault/raw_bits.c',
             'target/virgl-exact-reciprocal-fault/bridge.c',
             'target/virgl-exact-reciprocal-fault/virgl-shader.wasm',
             'target/virgl-exact-reciprocal-fault/manifest.json']


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    p = argparse.ArgumentParser()
    for name in ['hot', 'cold', 'output']:
        p.add_argument('--' + name, required=True, type=Path)
    a = p.parse_args()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    hot = json.loads((a.hot / 'receipt.json').read_bytes())
    cold = json.loads((a.cold / 'report.json').read_bytes())
    second = json.loads((a.cold / 'acceptance/receipt.json').read_bytes())
    for item in [hot, cold, second]:
        if item['status'] != 'passed' or item['gitHead'] != head:
            raise ValueError('only passed exact-head recordings may be sealed')
    if cold['cloneHead'] != head or cold['statusBefore'] or cold['statusAfter']:
        raise ValueError('cold clone not pristine')
    if sha((a.cold / 'acceptance/receipt.json').read_bytes()) != cold['receiptSha256']:
        raise ValueError('cold receipt drift')
    members = {}
    for prefix, directory, receipt in [('hot', a.hot, hot),
                                       ('cold', a.cold / 'acceptance', second)]:
        for entry in receipt['records']:
            raw = (directory / entry['path']).read_bytes()
            if len(raw) != entry['bytes'] or sha(raw) != entry['sha256']:
                raise ValueError('recording drift: ' + prefix + '/' + entry['path'])
        for file in sorted(directory.rglob('*')):
            if file.is_file():
                members[prefix + '/' + str(file.relative_to(directory))] = file.read_bytes()
    members['cold/report.json'] = (a.cold / 'report.json').read_bytes()
    members['cold/cold.log'] = (a.cold / 'cold.log').read_bytes()
    for entry in hot['sources']:
        raw = (ROOT / entry['path']).read_bytes()
        if len(raw) != entry['bytes'] or sha(raw) != entry['sha256']:
            raise ValueError('source drift: ' + entry['path'])
    for prefix, directory, acceptance in [('generated', ROOT, a.hot),
                                          ('cold-generated', Path(cold['clone']), a.cold / 'acceptance')]:
        run = json.loads((acceptance / 'native-wasm.json').read_bytes())
        for name in GENERATED:
            raw = (directory / name).read_bytes()
            if name.endswith('exact-reciprocal-test') and sha(raw) != run['binarySha256']:
                raise ValueError('native binary drift: ' + prefix)
            if name.endswith('build/wasm/virgl-shader.wasm') and sha(raw) != run['wasmSha256']:
                raise ValueError('Wasm binary drift: ' + prefix)
            members[prefix + '/' + name] = raw
    a.output.mkdir(parents=True, exist_ok=True)
    records = {'schema': 'virgl-exact-reciprocal-worker-records-v1', 'task': 'E6-T12g6m4a',
               'sourceHead': head, 'records': [dict(path=name, bytes=len(raw), sha256=sha(raw))
                                               for name, raw in sorted(members.items())]}
    index = (json.dumps(records, indent=2) + '\n').encode()
    (a.output / 'records.json').write_bytes(index)
    archive = io.BytesIO()
    with gzip.GzipFile(fileobj=archive, mode='wb', mtime=0) as zipped:
        with tarfile.open(fileobj=zipped, mode='w') as tar:
            for name, raw in sorted(members.items()):
                info = tarfile.TarInfo(name)
                info.size, info.mtime, info.mode = len(raw), 0, 0o644
                tar.addfile(info, io.BytesIO(raw))
    packed = archive.getvalue()
    (a.output / 'recording.tar.gz').write_bytes(packed)
    manifest = {'schema': 'virgl-exact-reciprocal-worker-seal-v1',
                'task': 'E6-T12g6m4a', 'sourceHead': head, 'records': len(members),
                'archive': {'path': 'recording.tar.gz', 'bytes': len(packed), 'sha256': sha(packed)},
                'recordIndex': {'path': 'records.json', 'bytes': len(index), 'sha256': sha(index)},
                'hotReceiptSha256': sha((a.hot / 'receipt.json').read_bytes()),
                'coldReportSha256': sha((a.cold / 'report.json').read_bytes()),
                'coldReceiptSha256': sha((a.cold / 'acceptance/receipt.json').read_bytes()),
                'originalDraws': hot['originalDraws'],
                'nativeCases': hot['nativeCases'], 'physicalFrames': hot['physicalFrames'],
                'checkedChannels': hot['checkedChannels'],
                'guestExecution': False, 'productionNegotiation': False}
    (a.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest))


if __name__ == '__main__':
    main()
