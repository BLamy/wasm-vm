#!/usr/bin/env python3
"""Reopen complete original/native bodies and audit consumed physical fences."""
import gzip
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/virgl-unorm-depth'))
from lifetimes import audit_lifetimes

sha = lambda raw: hashlib.sha256(raw).hexdigest()


def audit(directory):
    directory = Path(directory)
    report_raw = (directory/'report.json').read_bytes()
    report = json.loads(report_raw)
    evidence = report['browserResult'].get('result') or report['partial']
    assert report['status'] == 'passed' and report['browserResult']['status'] == 'passed'
    assert report['browserErrors'] == dict(console=[], page=[], requests=[])
    assert evidence['guestExecution'] is False and evidence['productionNegotiation'] is False
    counts = dict(runs=0, bodies=0, consumedSyncs=0, disposalOnlySyncs=0,
                  blitWriters=0, fencedCPUReads=0, synchronousCPUReads=0)
    for entry in evidence['blobs']:
        zipped = (directory/entry['path']).read_bytes()
        assert sha(zipped) == entry['gzipSha256']
        raw = gzip.decompress(zipped)
        assert sha(raw) == entry['sha256'] and len(raw) == entry['bytes']
        counts['bodies'] += 1
    for ref in evidence['runs']:
        row = ref
        if 'path' in ref:
            raw = (directory/ref['path']).read_bytes()
            assert sha(raw) == ref['sha256'] and len(raw) == ref['bytes']
            row = json.loads(raw)
        counts['runs'] += 1
        # Several independent staging buffers can be in flight together.
        # Pixel reads retain the held native rule; buffer reads use their
        # physically queried binding and the last writer of that exact buffer.
        physical = audit_lifetimes(dict(row, events=[e for e in row['events']
                                                    if e['name'] != 'getBufferSubData']))
        writers = {}
        for event in row['orderedBufferOps']:
            if event['name'] in ['copyBufferSubData', 'bufferSubData', 'bufferData']:
                writers[event['buffer']] = event['beforeEventSequence']
            elif event['name'] == 'getBufferSubData':
                completion = event['completion']
                sync = next(s for s in row['fenceObjects'] if s['id'] == completion['sync'])
                assert completion['actual'] in [37146, 37148] and completion['delivered'] in [37146, 37148]
                assert completion['sequence'] > writers.get(event['buffer'], 0)
                assert sync['createdSequence'] > writers.get(event['buffer'], 0)
                assert event['beforeEventSequence'] >= completion['sequence']
                assert any(p['sequence'] == completion['sequence'] and p['actual'] == completion['actual']
                           and p['delivered'] == completion['delivered'] for p in sync['polls'])
                counts['fencedCPUReads'] += 1
        # Image blits can follow a buffer ticket's fence without writing that
        # buffer. Apply the additional image-writer rule to actual pixel reads.
        blit = 0
        syncs = {s['id']: s for s in row['fenceObjects']}
        for event in row['events']:
            if event['name'] == 'blitFramebuffer':
                blit = event['sequence']
            if event['name'] == 'readPixels' and event['cpu'] and not event.get('synchronousReadback'):
                completion = event['completion']
                assert completion['sequence'] > blit
                assert syncs[completion['sync']]['createdSequence'] > blit
        for name in ['fencedCPUReads', 'synchronousCPUReads']:
            counts[name] += physical[name]
        counts['consumedSyncs'] += sum('completed' in f for f in row['fenceObjects'])
        counts['disposalOnlySyncs'] += sum('completed' not in f for f in row['fenceObjects'])
        counts['blitWriters'] += sum(e['name'] == 'blitFramebuffer' for e in row['events'])
        for entry in row.get('orderedIndices', []):
            assert entry['deleted']
            assert entry['inspection']['normalizedBuffers'] <= 64
            assert entry['inspection']['normalizedBytes'] <= 65536*12
            assert entry['inspection']['normalizationScratchBytes'] <= 65536*12
            assert entry['retirement']['inspection']['normalizationScratchBytes'] == 0
        for history in row['history']:
            assert len(history['hex']) % 8 == 0
        assert all(prediction['held'] for prediction in row.get('predictions', []))
    result = dict(schema='original-ordered-stencil-physical-v1', status='passed',
                  reportSha256=sha(report_raw), counts=counts,
                  oracleImportsProductCode=False, allCompleteBodiesReopened=True)
    (directory/'physical-audit.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result))


if __name__ == '__main__':
    audit(sys.argv[1])
