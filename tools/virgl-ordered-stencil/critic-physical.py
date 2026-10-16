#!/usr/bin/env python3
"""Audit actual consumed fences by image writer or physically queried buffer."""
import gzip
import hashlib
import json
from pathlib import Path
import sys

sha = lambda raw: hashlib.sha256(raw).hexdigest()
DRAWS = {'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'}
IMAGE_WRITERS = DRAWS | {'clearBufferiv', 'clearBufferuiv', 'clearBufferfv',
                        'clear', 'texSubImage2D', 'blitFramebuffer'}
BUFFER_WRITERS = {'bufferData', 'bufferSubData', 'copyBufferSubData'}
SIGNALED = {37146, 37148}


def audit_row(row):
    syncs = {s['id']: s for s in row['fenceObjects']}
    assert len(syncs) == len(row['fenceObjects'])
    counts = dict(consumedSyncs=0, disposalOnlySyncs=0, blitWriters=0,
                  fencedCPUReads=0, synchronousCPUReads=0, normalizedRetirements=0)
    citations = []
    for s in syncs.values():
        assert s['identity'] == 'WebGLSync' and s['deleted'] == 1
        assert all(p['sync'] == s['id'] and p['sequence'] > s['createdSequence'] for p in s['polls'])
        if 'completed' in s:
            c = s['completed']
            assert c['actual'] in SIGNALED and c['delivered'] in SIGNALED
            assert any(p['sequence'] == c['sequence'] and p['actual'] == c['actual']
                       and p['delivered'] == c['delivered'] for p in s['polls'])
            counts['consumedSyncs'] += 1
        else:
            assert row.get('boundary', {}).get('kind') in ['owner-first', 'renderer-first']
            counts['disposalOnlySyncs'] += 1

    def consumed(c, writer, read_sequence):
        s = syncs[c['sync']]
        assert c['actual'] in SIGNALED and c['delivered'] in SIGNALED
        assert s['createdSequence'] > writer and writer < c['sequence'] <= read_sequence
        assert 'completed' in s and s['completed'] == c
        assert any(p['sequence'] == c['sequence'] and p['actual'] == c['actual']
                   and p['delivered'] == c['delivered'] for p in s['polls'])
        return s['createdSequence']

    # An image read is ordered after all preceding image writes. Staging buffer
    # copies cannot write this attachment and do not change its writer authority.
    image_writer = 0
    for e in row['events']:
        if e['name'] in IMAGE_WRITERS:
            image_writer = e['sequence']
            counts['blitWriters'] += e['name'] == 'blitFramebuffer'
        if e['name'] == 'readPixels' and e['cpu']:
            if e.get('synchronousReadback'):
                assert e['nativeReadReturned'] and e['type'] == 'Uint8Array'
                assert e['bytes'] > 0 and e['target'] is not None and e['args'][4:6] == [6408, 5121]
                counts['synchronousCPUReads'] += 1
            else:
                c = e['completion']; created = consumed(c, image_writer, e['sequence'])
                assert e['sequence'] > c['sequence'] and e['target'] is not None
                counts['fencedCPUReads'] += 1
                citations.append(dict(resourceKind='image', resource=e['target'], readSequence=e['sequence'],
                                      writerSequence=image_writer, fenceCreatedSequence=created, completion=c))

    # These bindings are native getParameter results, rather than renderer name
    # metadata. Each CPU collection must follow the writer of that exact buffer.
    buffer_writers = {}
    for e in row['orderedBufferOps']:
        if e['name'] in BUFFER_WRITERS:
            buffer_writers[e['buffer']] = e['beforeEventSequence']
        elif e['name'] == 'getBufferSubData':
            assert e['buffer'] in buffer_writers
            writer = buffer_writers[e['buffer']]; c = e['completion']
            created = consumed(c, writer, e['beforeEventSequence'])
            counts['fencedCPUReads'] += 1
            citations.append(dict(resourceKind='buffer', resource=e['buffer'], readSequence=e['beforeEventSequence'],
                                  writerSequence=writer, fenceCreatedSequence=created, completion=c))
    for e in row.get('orderedIndices', []):
        assert e['deleted'] and e['nativeBuffer'] in buffer_writers
        assert e['inspection']['normalizedBuffers'] <= 64
        assert e['inspection']['normalizedBytes'] <= 65536 * 12
        assert e['inspection']['normalizationScratchBytes'] <= 65536 * 12
        retire = e['retirement']; assert retire['inspection']['normalizationScratchBytes'] == 0
        uses = [s['after']['eventSequence'] for s in row['orderedStates']
                if s['name'] in DRAWS and s['before']['native']['ebo'] == e['nativeBuffer']]
        writer = max([buffer_writers[e['nativeBuffer']]] + uses)
        created = consumed(retire['completion'], writer, retire['eventSequence'])
        counts['normalizedRetirements'] += 1
        citations.append(dict(resourceKind='normalized-buffer', resource=e['nativeBuffer'],
                              readSequence=retire['eventSequence'], writerSequence=writer,
                              fenceCreatedSequence=created, completion=retire['completion']))
    assert all(o['deleted'] == 1 for o in row['nativeObjects'])
    assert all(v == 0 for owner in ['renderer', 'resources'] for v in row['final'][owner]['budgets'].values())
    assert all(p['held'] for p in row.get('predictions', []))
    return counts, citations


def audit(directory):
    directory = Path(directory); raw = (directory / 'report.json').read_bytes(); report = json.loads(raw)
    evidence = report['browserResult'].get('result') or report['partial']
    assert report['status'] == report['browserResult']['status'] == 'passed'
    assert report['browserErrors'] == dict(console=[], page=[], requests=[])
    assert not evidence['guestExecution'] and not evidence['productionNegotiation']
    counts = dict(runs=0, bodies=0); citations = []
    for ref in evidence['blobs']:
        zipped = (directory / ref['path']).read_bytes(); body = gzip.decompress(zipped)
        assert sha(zipped) == ref['gzipSha256'] and len(body) == ref['bytes'] and sha(body) == ref['sha256']
        counts['bodies'] += 1
    for ref in evidence['runs']:
        body = (directory / ref['path']).read_bytes()
        assert len(body) == ref['bytes'] and sha(body) == ref['sha256']; row = json.loads(body)
        local, points = audit_row(row); counts['runs'] += 1
        for k, v in local.items(): counts[k] = counts.get(k, 0) + v
        citations.append(dict(run=row['name'], bodySha256=sha(body), points=points))
    result = dict(schema='d45-critic-physical-v1', status='passed', reportSha256=sha(raw), counts=counts,
                  allCompleteBodiesReopened=True, imageAndBufferWriterAuthoritiesSeparate=True, citations=citations)
    (directory / 'critic-physical-audit.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(dict(status=result['status'], reportSha256=result['reportSha256'], counts=counts)))


if __name__ == '__main__':
    audit(sys.argv[1])
