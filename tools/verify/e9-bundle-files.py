#!/usr/bin/env python3
"""Independently authenticate exported closure bytes and imported native witnesses."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
from urllib.parse import urljoin

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--directory', type=Path, required=True)
a = p.parse_args()
out = a.directory.resolve()
browser = json.loads((out / 'report.json').read_text())
assert browser['status'] == 'passed'
sha = lambda data: hashlib.sha256(data).hexdigest()
report = {'status': 'running', 'browserSha256': sha((out / 'report.json').read_bytes()), 'cases': []}


def source_objects(source):
    saved = Path(source['directory']) / 'saved'
    raw = (saved / 'storage.json').read_bytes()
    assert sha(raw) == source['storageSha256']
    storage = json.loads(raw)
    parts = {}
    for row in storage['stores']['chunks']:
        data = (saved / 'chunks' / (row['key'] + '.bin')).read_bytes()
        assert len(data) == row['bytes'] and sha(data) == row['key']
        parts[row['key']] = data
    objects = {}
    for row in storage['stores']['objects']:
        data = b''.join(parts[part['sha256']] for part in row['value']['parts'])
        assert len(data) == int(row['value']['length']) and sha(data) == row['key']
        objects[row['key']] = data
    return storage, objects


try:
    sources = {kind: source_objects(value) for kind, value in browser['sources'].items()}
    for case in browser['cases']:
        data = (out / case['archive']['file']).read_bytes()
        assert len(data) == case['archive']['bytes'] and sha(data) == case['archive']['sha256']
        assert data[:8] == b'WVBUND01' and struct.unpack_from('<I', data, 8)[0] == 1
        header_len = struct.unpack_from('<I', data, 12)[0]
        assert 0 < header_len <= 8 * 1024 * 1024
        header_bytes = data[16:16 + header_len]
        header = json.loads(header_bytes)
        assert header_bytes == json.dumps(header, separators=(',', ':'), ensure_ascii=False).encode()
        assert list(header) == ['version', 'encoding', 'portability', 'runtime', 'manifest', 'objects', 'uncompressedBytes']
        assert header['version'] == 1 and header['encoding'] == 'raw' and header['portability'] == 'wasm-vm-installed-build-v1'
        refs = header['objects']
        assert 0 < len(refs) <= 65536 and [r['sha256'] for r in refs] == sorted(set(r['sha256'] for r in refs))
        objects = {}
        at = 16 + header_len
        for ref in refs:
            assert list(ref) == ['sha256', 'length'] and 0 < int(ref['length']) <= 640 * 1024 * 1024
            body = data[at:at + int(ref['length'])]
            assert len(body) == int(ref['length']) and sha(body) == ref['sha256']
            objects[ref['sha256']] = body
            at += len(body)
        assert at == len(data) and sum(map(len, objects.values())) == int(header['uncompressedBytes']) <= 4 * 1024**3
        mref = header['manifest']
        manifest_bytes = objects[mref['sha256']]
        assert len(manifest_bytes) == int(mref['length']) <= 1024 * 1024
        assert mref['sha256'] == case['archive']['manifestSha256']
        manifest = json.loads(manifest_bytes)
        assert manifest['id'] == case['id'] and manifest['policy']['mode'] == 'exact-replay'
        storage, source = sources[case['kind']]
        row = next(r['value'] for r in storage['stores']['sessions'] if r['key'] == manifest['id'])
        assert bytes(row['manifest']) == manifest_bytes
        required = {mref['sha256']}

        def add(ref):
            assert ref['sha256'] in objects and len(objects[ref['sha256']]) == int(ref['length'])
            required.add(ref['sha256'])

        for asset in manifest['assets']:
            add(asset['content'])
        for event in manifest['events']:
            add(event['content'])
            for record in json.loads(objects[event['content']['sha256']]):
                payload = record['payload']
                if payload['storage'] == 'blob':
                    add(payload['content'])
        full_frames = delta_frames = 0
        for point in manifest['checkpoints']:
            add(point['machine'])
            if point['gpu'] is not None:
                add(point['gpu'])
            root_hash = point['disk_root']
            assert root_hash in objects
            required.add(root_hash)
            disk = json.loads(objects[root_hash])
            assert disk['base'] == manifest['machine']['base_image']
            for block in disk['blocks']:
                add({'sha256': block['sha256'], 'length': '4096'})
            frame = objects[point['machine']['sha256']]
            full_frames += frame[:8] == b'WVKEYB01'
            if frame[:8] == b'WVKEYF01':
                delta_frames += 1
                descriptor = json.loads(frame[8:])
                add(descriptor['parent'])
                add(descriptor['frame'])
                for chunk in descriptor['chunks']:
                    add(chunk)
        assert required == set(objects), 'not the exact transitive recording closure'
        for digest in required - {mref['sha256']}:
            assert source[digest] == objects[digest], 'archive differs from authenticated source CAS'
        assert header['runtime']['wasm'] == manifest['machine']['wasm_build']
        original_name = 'B.resume' if case['name'] == 'software-child' else 'D.resume' if case['name'] == 'software-deltas' else 'P.resume'
        original = Path(browser['sources'][case['kind']]['directory']) / original_name
        imported = out / case['view']['raw']['file']
        assert original.read_bytes() == imported.read_bytes()
        assert sha(imported.read_bytes()) == case['view']['raw']['sha256']
        assert case['view']['active']['digest'] == case['source']['active']['digest']
        assert case['view']['pixel'] == case['source']['pixel']
        assert all(item['outcome']['status'] == 'error' and item['preserved'] for item in case['attacks'])
        assert all(item['writerCalls'] == 0 and item['freshId'] != case['id'] for item in case['attacks'])
        if case['name'] != 'software-parent':
            assert 'duplicate-known-witness-field-rehashed' in {item['name'] for item in case['attacks']}
        if case['name'] == 'software-deltas':
            assert full_frames > 0 and delta_frames > 0
            names = {item['name'] for item in case['attacks']}
            assert {'later-native-CPU-truncation-rehashed', 'rehashed-RAM-delta-with-stale-full-digest'} <= names
        if case['name'] == 'software-child':
            blocked = case['ambiguousWitnessGc']
            assert blocked['failure']['code'] == 'UnsupportedRetention' and blocked['before'] == blocked['after']
            assert blocked['survivorRetained'] and blocked['preserved']
            assert sha(bytes(blocked['orphan'])) == blocked['orphanRef']['sha256']
            assert blocked['cleanup']['collected'] and blocked['cleanup']['reclaimedBytes'] == len(blocked['orphan'])
            assert len(case['quota']['stagedUniqueObjects']) == 1 and case['quota']['cleanup']['reclaimedBytes'] > 0
            assert case['postCommitRefreshRace']['held']['busy'] and not case['postCommitRefreshRace']['held']['entered']
        assert case['delete']['state']['statistics']['sessions'] == 0 and case['delete']['state']['statistics']['payloadBytes'] == 0
        report['cases'].append({'name': case['name'], 'manifestSha256': mref['sha256'], 'objects': len(objects),
                                'uncompressedBytes': int(header['uncompressedBytes']), 'nativeSha256': sha(imported.read_bytes()),
                                'negativeCases': len(case['attacks']), 'fullFrames': full_frames, 'deltaFrames': delta_frames,
                                'completeClosure': True, 'sourceBytesEqual': True})
    for ignored in browser.get('allowedFavicon404', []):
        assert ignored['location']['url'] == urljoin(browser['base'], '/favicon.ico')
        assert ignored['text'].startswith('Failed to load resource: the server responded with a status of 404 ')
    assert len(report['cases']) == 4 and not browser['errors'] and not browser['external'] and not browser['blocked']
    assert browser['sourceCachesUnavailableToImport'] and all(row['label'].startswith('export-') for row in browser['fixtureReads'])
    assert all(not profile['instructionGuard']['calls'] for profile in browser['profiles'])
    assert browser['closedRefreshRace']['unchangedDOM'] and browser['closedRefreshRace']['preservedOriginal']
    assert browser['closedGpuPreviewRace']['unchangedDOM'] and browser['closedGpuPreviewRace']['preservedOriginal']
    mobile = browser['mobileLayout']
    assert mobile['document'] <= mobile['viewport'] and mobile['panelScroll'] <= mobile['panel'] and mobile['detailsScroll'] <= mobile['details']
    report['status'] = 'passed'
except BaseException as error:
    report['status'] = 'failed'
    report['failure'] = repr(error)
    raise
finally:
    (out / 'independent-files.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
