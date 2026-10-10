#!/usr/bin/env python3
"""Deterministically seal the fresh critic's recorded observations and verdict."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def verify():
    manifest = json.loads((HERE / 'manifest.json').read_bytes())
    raw_index = (HERE / 'records.json').read_bytes()
    raw_archive = (HERE / 'recording.tar.gz').read_bytes()
    assert sha(raw_index) == manifest['recordIndexSha256']
    assert sha(raw_archive) == manifest['archiveSha256']
    rows = json.loads(raw_index)['records']
    indexed = {r['path']: r for r in rows}
    found = set()
    with tarfile.open(fileobj=io.BytesIO(raw_archive), mode='r:gz') as archive:
        for member in archive:
            assert member.isfile() and member.name in indexed and member.name not in found
            assert not Path(member.name).is_absolute() and '..' not in Path(member.name).parts
            raw = archive.extractfile(member).read()
            assert len(raw) == indexed[member.name]['bytes'] and sha(raw) == indexed[member.name]['sha256']
            found.add(member.name)
    assert found == set(indexed) and len(found) == manifest['records']
    print(json.dumps(manifest))


def seal():
    assert json.loads((HERE / 'prediction-results.json').read_bytes())['verdict'] == 'verified'
    assert json.loads((HERE / 'coverage-audit.json').read_bytes())['status'] == 'passed'
    assert json.loads((HERE / 'promoted-final/independent-audit.json').read_bytes())['status'] == 'passed'
    assert (HERE / 'promoted-final/acceptance.log').read_bytes().endswith(b'STANDARD_DRAW_ADVERSARIAL_COMPLETE\n')
    members = {}
    for path in HERE.iterdir():
        if path.is_file() and path.name not in ['manifest.json', 'records.json', 'recording.tar.gz']:
            members['critic/' + path.name] = path.read_bytes()
    for name in ['promoted-final', 'promoted-sabotage-initial', 'retained-routing', 'node-wire', 'node-coverage', 'sources']:
        for path in sorted((HERE / name).rglob('*')):
            if path.is_file() and '__pycache__' not in path.parts:
                members['critic/' + str(path.relative_to(HERE))] = path.read_bytes()
    replay = ROOT / 'target/evidence/virgl-standard-draw-critic-replay'
    receipt = json.loads((replay / 'receipt.json').read_bytes())
    assert receipt['status'] == 'passed'
    for name, digest in receipt['files'].items():
        raw = (replay / name).read_bytes()
        assert sha(raw) == digest
        members['replay/' + name] = raw
    members['replay/receipt.json'] = (replay / 'receipt.json').read_bytes()
    for name, digest in receipt['generated'].items():
        raw = (ROOT / name).read_bytes()
        assert sha(raw) == digest
        members['generated/' + name] = raw
    worker = json.loads((HERE.parent / 'worker/manifest.json').read_bytes())
    records = {'schema': 'standard-draw-fresh-critic-records-v1', 'task': 'E6-T11d6',
               'frozenRuntime': 'c9963d71add68b550d9f26a2b9e9d417f3daa437',
               'records': [dict(path=name, bytes=len(raw), sha256=sha(raw)) for name, raw in sorted(members.items())]}
    raw_index = (json.dumps(records, indent=2)+'\n').encode()
    (HERE / 'records.json').write_bytes(raw_index)
    stream = io.BytesIO()
    with gzip.GzipFile(fileobj=stream, mode='wb', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as archive:
            for name, raw in sorted(members.items()):
                info = tarfile.TarInfo(name)
                info.size, info.mtime, info.mode = len(raw), 0, 0o644
                archive.addfile(info, io.BytesIO(raw))
    raw_archive = stream.getvalue()
    (HERE / 'recording.tar.gz').write_bytes(raw_archive)
    manifest = dict(schema='standard-draw-fresh-critic-seal-v1', task='E6-T11d6', verdict='verified',
                    frozenRuntime=records['frozenRuntime'], workerClaim='f7801621',
                    dependency='761a912a88823954e3424f7b003c15887e7c9034', records=len(members),
                    archiveBytes=len(raw_archive), archiveSha256=sha(raw_archive), recordIndexSha256=sha(raw_index),
                    workerArchiveSha256=worker['archiveSha256'], workerIndexSha256=worker['recordIndexSha256'],
                    runtimeHunks=20, runtimeAddedLines=41, executedRuntimeLines=37, structuralCommentLines=4,
                    semanticCoverageGaps=0, originalFramesPerRun=37, originalPixelsPerRun=10296,
                    promotedFrames=4, promotedPixels=2240, promotedRejections=15,
                    authority='isolated-standard-instanced-draws', guestExecution=False,
                    productionDrawAuthority=False, fullGuestApiClaim=False)
    (HERE / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    verify()


if __name__ == '__main__':
    verify() if '--verify' in sys.argv else seal()
