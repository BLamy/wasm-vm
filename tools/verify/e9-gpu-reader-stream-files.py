#!/usr/bin/env python3
"""Independent byte/count oracle for real native long-journal storage captures.

No emulator or browser journal codec is imported. This is a storage proof,
not a whole-history replay or full Linux/desktop qualification.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--directory', type=Path, required=True)
parser.add_argument('--output', type=Path)
a = parser.parse_args()
out = a.directory.resolve()
proof = a.output.resolve() if a.output else out / 'independent-reader-oracle'
assert proof.is_relative_to(out), 'oracle output must remain inside the capture directory'
proof.mkdir(exist_ok=False)
source = Path(__file__).read_bytes()
(proof / 'executed-oracle.py').write_bytes(source)
sha = lambda b: hashlib.sha256(b).hexdigest()
report_bytes = (out / 'report.json').read_bytes()
browser = json.loads(report_bytes)
report = {'status': 'running', 'scope': 'independent complete bounded GPU history reads; no full replay/workload/performance verdict',
          'workerReportSha256': sha(report_bytes), 'oracleSourceSha256': sha(source), 'cases': []}


def exact(v):
    assert isinstance(v, str) and re.fullmatch(r'0|[1-9][0-9]{0,19}', v)
    assert int(v) <= (1 << 64) - 1
    return int(v)


def position(row):
    assert row['phase'] in ['before', 'observe'] and isinstance(row['ordinal'], int) and 0 <= row['ordinal'] <= (1 << 32) - 1
    assert exact(row['retired']) <= exact(row['transition'])
    return (exact(row['transition']), ['before', 'observe'].index(row['phase']), row['ordinal'], exact(row['sequence']))


try:
    assert browser['status'] == browser['result']['status'] == 'recorded'
    assert browser['errors'] == browser['missing'] == browser['external'] == []
    store = json.loads((out / 'saved/storage.json').read_bytes())['stores']
    chunks = {r['key']: r['bytes'] for r in store['chunks']}
    objects = {r['key']: r['value'] for r in store['objects']}
    assert len(chunks) == len(store['chunks']) and len(objects) == len(store['objects'])
    for key, size in chunks.items():
        assert re.fullmatch('[a-f0-9]{64}', key) and 0 < size <= 4194304
        raw = (out / 'saved/chunks' / (key + '.bin')).read_bytes()
        assert len(raw) == size and sha(raw) == key

    def stream(ref):
        value = objects[ref['sha256']]
        assert value['version'] == 1 and value['sha256'] == ref['sha256'] and value['length'] == ref['length']
        assert 0 < exact(value['length']) <= 4 * 1024**3 and 1 <= len(value['parts']) <= 4096
        for part in value['parts']:
            assert exact(part['length']) == chunks[part['sha256']]
            yield (out / 'saved/chunks' / (part['sha256'] + '.bin')).read_bytes()

    def content(ref, limit):
        assert exact(ref['length']) <= limit
        value = b''.join(stream(ref))
        assert len(value) == exact(ref['length']) and sha(value) == ref['sha256']
        return value

    for key, value in objects.items():
        digest, total = hashlib.sha256(), 0
        for part in stream({'sha256': key, 'length': value['length']}):
            total += len(part)
            digest.update(part)
        assert total == exact(value['length']) and digest.hexdigest() == key
    limits = next(row['value'] for row in store['metadata'] if row['key'] == 'limits')
    assert limits == {'maxBytes': 2147483648, 'maxCheckpoints': 4096}
    report['store'] = {'chunks': len(chunks), 'objects': len(objects), 'physicalBytes': sum(chunks.values()), 'limits': limits}
    sessions = {r['key']: r['value'] for r in store['sessions']}

    def identity(row, payload):
        return {**{k: row[k] for k in ['transition', 'retired', 'phase', 'ordinal', 'sequence', 'channel', 'outcome', 'ticket']},
                'length': len(payload), 'sha256': sha(payload)}

    def raw_rows(case):
        for index, ref in enumerate(case['rawBatches']):
            assert ref['file'] == case['variant'] + '-batch-' + str(index).zfill(5) + '.json'
            raw = (out / ref['file']).read_bytes()
            assert len(raw) == ref['bytes'] and sha(raw) == ref['sha256']
            for row in json.loads(raw):
                yield row, bytes(row['bytes'])

    def saved_rows(manifest):
        for index in manifest['events']:
            raw = content(index['content'], 4194304)
            records = json.loads(raw)
            assert len(records) == index['count']
            assert records[0]['sequence'] == index['first']['sequence'] and records[-1]['sequence'] == index['last']['sequence']
            for record in records:
                intent = json.loads(bytes(record['intent']))
                payload = bytes(intent['header']) if record['kind'] == 'gpu' else (bytes(record['payload']['bytes']) if record['payload']['storage'] == 'inline' else content(record['payload']['content'], 1048576))
                if intent['channel'] == 19:
                    payload = bytes(intent['header']) + payload
                assert intent['version'] == 1
                row = {**record, 'channel': intent['channel'], 'outcome': intent['outcome'], 'ticket': intent['ticket']}
                yield row, payload

    def witness_rows(commitment):
        pages = []
        ref = commitment['tail']
        remaining = commitment['count']
        while ref:
            page = json.loads(content(ref, 8192))
            assert page['version'] == 2 and 0 < len(page['rows']) <= 16
            assert page['before'] + len(page['rows']) == remaining
            pages.append((ref, page))
            remaining = page['before']
            ref = page['previous']
        assert remaining == 0 and len(pages) == commitment['pages']
        result = [row for ref, page in reversed(pages) for row in page['rows']]
        assert len(result) == commitment['count'] and result[0] == commitment['first'] and result[-1] == commitment['last']
        assert all(position(b) > position(a) for a, b in zip(result, result[1:]))
        return result

    compact = lambda value: json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode()
    pos_dict = lambda row: {key: row[key] for key in ['transition', 'phase', 'ordinal', 'sequence', 'retired']}

    def row_hash_update(digest, row, payload, body=None):
        header = {**pos_dict(row), 'kind': 'observation' if row['channel'] in [17, 18, 23] else 'host',
                  'channel': row['channel'], 'ticket': row['ticket'], 'outcome': row['outcome'],
                  'body': body, 'byteLength': len(payload)}
        encoded = compact(header)
        digest.update(struct.pack('<II', len(encoded), len(payload)))
        digest.update(encoded)
        digest.update(payload)

    def check_reader(case, manifest):
        read = next(r for r in browser['read']['cases'] if r['variant'] == case['variant'])
        meta = read['metadata']
        assert meta['storageAuthenticated'] and not meta['nativeAdmitted']
        assert meta['begin'] == manifest['begin'] and meta['end'] == manifest['end']
        assert meta['session'] == {'id': case['id'], 'manifestSha256': case['saved']['manifestSha256'],
                                   'revision': case['saved']['revision'], 'generation': '0'}
        assert meta['receipts'] == case['receipts'] and meta['receiptWindows'] == len(read['windows'])
        raw = iter(raw_rows(case))
        durable = iter(saved_rows(manifest))
        all_hash = hashlib.sha256(b'wasm-vm-gpu-receipts-v1\0')
        previous = manifest['begin']
        prior_digest = None
        count, owned_bytes = 0, 0
        seen_tickets = set()
        for index, window in enumerate(read['windows']):
            assert window['index'] == index and window['session'] == meta['session']
            assert window['stream'] == 'receipts' and not window['nativeAdmitted']
            assert 0 < len(window['receipts']) == window['range']['count'] <= 4096
            digest = hashlib.sha256(b'wasm-vm-gpu-receipts-v1\0')
            after = pos_dict(previous)
            rows, bodies, total = [], {}, 0
            for row in window['receipts']:
                recorded, payload = next(raw)
                saved_row, saved_payload = next(durable)
                assert identity(recorded, payload) == identity(saved_row, saved_payload)
                assert row['byteLength'] == len(payload) and row['bytesSha256'] == sha(payload)
                assert all(row[k] == recorded[k] for k in ['transition', 'retired', 'phase', 'ordinal', 'sequence', 'channel', 'outcome', 'ticket'])
                assert exact(row['sequence']) == exact(previous['sequence']) + 1 and position(row) > position(previous)
                assert row['ticket'] not in seen_tickets and exact(row['ticket']) < (1 << 64) - 1
                seen_tickets.add(row['ticket'])
                body = row.get('body')
                if body:
                    value = content(body, 32 * 1048576)
                    assert sha(value) == body['sha256']
                    bodies[body['sha256']] = body
                row_hash_update(digest, recorded, payload, body)
                row_hash_update(all_hash, recorded, payload, body)
                rows.append(pos_dict(row))
                total += len(payload)
                previous = row
            assert total <= 67108864
            assert window['range'] == {'afterPosition': after, 'firstPosition': rows[0], 'lastPosition': rows[-1],
                                       'firstSequence': rows[0]['sequence'], 'lastSequence': rows[-1]['sequence'],
                                       'count': len(rows), 'ownedReceiptBytes': total}
            assert window['predecessor'] == {'windowIndex': index - 1 if index else None, 'windowDigest': prior_digest,
                                             'lastPosition': after, 'lastSequence': after['sequence']}
            assert window['receiptDigest'] == digest.hexdigest()
            assert window['referencedBodies'] == list(bodies.values())
            assert len(window['payloads']) == len(bodies) <= 256
            assert sum(p['length'] for p in window['payloads']) <= 67108864
            for payload in window['payloads']:
                assert payload['sha256'] == payload['bytesSha256'] and str(payload['length']) == bodies[payload['sha256']]['length']
            identity_value = {'domain': 'wasm-vm-gpu-history-window-v1', 'session': meta['session'], 'stream': 'receipts',
                              'index': index, 'range': window['range'], 'predecessor': window['predecessor'],
                              'receiptDigest': window['receiptDigest'], 'referencedBodies': window['referencedBodies']}
            assert sha(compact(identity_value)) == window['windowDigest']
            prior_digest = window['windowDigest']
            count += len(rows)
            owned_bytes += total
        assert next(raw, None) is None and next(durable, None) is None
        assert count == case['receipts'] and owned_bytes == case['envelopeBytes'] and all_hash.hexdigest() == meta['receiptDigest']
        commitment = meta['commitment']
        expected_witnesses = witness_rows(commitment)
        assert [row for page in read['pages'] for row in page['rows']] == expected_witnesses
        assert all(p['range']['count'] <= 16 and p['range']['ownedReceiptBytes'] <= 8192 for p in read['pages'])
        assert not any(p['nativeAdmitted'] for p in read['pages'])
        stats = read['resident']
        assert stats['receiptWindowRows'] == max(w['range']['count'] for w in read['windows']) <= 4096
        assert stats['receiptWindowBytes'] == max(w['range']['ownedReceiptBytes'] for w in read['windows']) <= 67108864
        assert stats['gpuBodyWindowBytes'] <= 67108864 and stats['gpuBodyWindowCount'] <= 256
        assert stats['storeChunkBytes'] <= 1048576 and stats['eventChunkBytes'] <= 4194304 and stats['clockSectionBytes'] <= 4 * 1048576 + 256 * 32 + 64
        assert stats['witnessPageRows'] <= 16 and stats['witnessPageBytes'] <= 8192
        assert stats['measurement']['receiptRowLimit'] == 4096 and stats['measurement']['receiptByteLimit'] == stats['measurement']['gpuBodyByteLimit'] == 67108864
        assert stats['measurement']['dataBufferUpperBoundBytes'] >= stats['receiptWindowBytes'] + stats['gpuBodyWindowBytes']
        if case['variant'] == 'count':
            assert len(read['windows']) == 2 and read['windows'][0]['range']['lastPosition'] == {'transition': '0', 'phase': 'before', 'ordinal': 4096, 'sequence': '4096', 'retired': '0'}
            assert read['windows'][1]['range']['firstPosition']['ordinal'] == 4097
            assert any(w['transition'] == '0' and w['ordinal'] == 2048 and w['sequence'] == '2048' for w in expected_witnesses)
        return {'windows': len(read['windows']), 'rows': count, 'ownedReceiptBytes': owned_bytes, 'receiptDigest': all_hash.hexdigest(), 'maxWindowRows': stats['receiptWindowRows'], 'maxWindowBytes': stats['receiptWindowBytes']}

    for case in browser['result']['cases']:
        saved = sessions[case['id']]
        manifest_bytes = bytes(saved['manifest'])
        assert sha(manifest_bytes) == case['saved']['manifestSha256']
        manifest = json.loads(manifest_bytes)
        assert manifest['id'] == case['id'] and manifest['policy']['mode'] == 'exact-replay'
        assert manifest['machine']['ram_bytes'] == '1073741824' and manifest['policy']['clock'] == {'mode': 'icount', 'divider': 64, 'timebase_hz': '10000000', 'interactive': None}
        expected_inputs = 4100 if case['variant'] == 'count' else 1
        expected_blocks = 0 if case['variant'] == 'count' else 256
        raw_iter = iter(raw_rows(case))
        previous = manifest['begin']
        count, total, inputs, committed_inputs, blocks, serial = 0, 0, 0, 0, [], bytearray()
        interval_counts = [0] * len(manifest['checkpoints'])
        interval_bytes = [0] * len(manifest['checkpoints'])
        for row, payload in saved_rows(manifest):
            actual, raw_payload = next(raw_iter)
            assert identity(row, payload) == identity(actual, raw_payload), 'raw/durable receipt mismatch'
            assert exact(row['sequence']) == exact(previous['sequence']) + 1 and position(row) > position(previous)
            assert exact(row['retired']) >= exact(previous['retired'])
            count += 1
            total += len(payload)
            interval = 0
            for i, point in enumerate(manifest['checkpoints'][1:], 1):
                if position(row) > position(point['position']):
                    interval = i
            interval_counts[interval] += 1
            interval_bytes[interval] += len(payload)
            if row['channel'] == 1:
                inputs += 1
                assert payload == b'a' and row['outcome'] == ['0', '1', str(inputs), '0']
                assert row['transition'] == row['retired'] == '0' and exact(row['sequence']) == inputs
            elif row['channel'] == 2:
                committed_inputs += len(payload)
                assert 0 < len(payload) <= 16 and payload == b'a' * len(payload)
                assert row['outcome'] == ['0', str(len(payload)), str(expected_inputs - committed_inputs), '0']
            elif row['channel'] == 21:
                serial.extend(payload)
            else:
                assert row['channel'] == 19, 'unexpected fixture channel'
                assert payload[:8] == b'WVDEVC01' and len(payload) == 262210 and payload[16] == 1
                request_id = struct.unpack_from('<Q', payload, 8)[0]
                chunk = struct.unpack_from('<I', payload, 17)[0]
                assert chunk == len(blocks) and request_id == chunk + 1
                assert struct.unpack_from('<I', payload, 53)[0] == struct.unpack_from('<I', payload, 62)[0] == 262144
                assert payload[57] == 0 and struct.unpack_from('<I', payload, 58)[0] == 0
                body = payload[66:]
                assert body == bytes([chunk]) * 262144 and sha(body) == payload[21:53].hex()
                assert row['outcome'][0] == '0' and exact(row['outcome'][1]) == request_id and exact(row['outcome'][2]) == 262144 and exact(row['outcome'][3]) > 0
                blocks.append({'chunk': chunk, 'sha256': sha(body), 'sequence': row['sequence']})
            previous = row
        assert next(raw_iter, None) is None
        assert count == case['receipts'] and total == case['envelopeBytes'] and inputs == committed_inputs == expected_inputs and len(blocks) == expected_blocks
        assert serial == b'STREAM_START\nSTREAM_UART_OK\nSTREAM_BLOCKS_OK\nSTREAM_DONE\n' == case['serial'].encode()
        assert exact(previous['sequence']) == exact(manifest['end']['sequence']) and position(previous) <= position(manifest['end'])
        assert len(manifest['checkpoints']) == 3
        assert max(interval_counts) <= 4096 and max(interval_bytes) <= 67108864
        assert case['maxPendingRows'] <= 256 and case['maxPendingBytes'] <= 4194304
        assert case['maxIntervalRows'] == max(interval_counts) and case['maxIntervalBytes'] == max(interval_bytes)
        for frame in case['checkpoints']:
            assert frame['windowAfter']['rows'] == frame['windowAfter']['bytes'] == 0
        commitment = json.loads(bytes(next(e['bytes'] for e in manifest['extensions'] if e['kind'] == 'e9-exact-witness-pages-v2')))
        witnesses = witness_rows(commitment)
        assert commitment['finished'] and len(witnesses) == 3 and all(any(position(w) == position(point['position']) for w in witnesses) for point in manifest['checkpoints'])
        assert bytes(witnesses[0]['digest']).hex() == case['initial']['digest'] and bytes(witnesses[-1]['digest']).hex() == case['final']['digest']
        logical_ref = case['logicalState']
        logical = (out / logical_ref['file']).read_bytes()
        assert sha(logical) == logical_ref['sha256'] and len(logical) == logical_ref['bytes']
        digest = sha(b'wasm-vm-gpu-guest-state-v1\0' + struct.pack('<Q', len(logical)) + logical + bytes.fromhex(case['final']['ramDigest']))
        assert digest == case['final']['digest']
        assert count > 4096 if case['variant'] == 'count' else total > 67108864
        reader = check_reader(case, manifest)
        report['cases'].append({'reader': reader, 'variant': case['variant'], 'receipts': count, 'envelopeBytes': total, 'inputs': inputs,
                                'blocks': blocks, 'intervalRows': interval_counts, 'intervalBytes': interval_bytes,
                                'manifestSha256': sha(manifest_bytes), 'finalDigest': digest, 'serialHex': serial.hex()})
    physical = browser['result']['physical']
    assert physical['status'] == 'recorded' and physical['channels']['22'] > 0 and physical['channels']['23'] > 0
    physical_manifest = json.loads(bytes(sessions[physical['id']]['manifest']))
    report['physical'] = check_reader(physical, physical_manifest)
    for payload in physical['payloads']:
        artifact = payload['artifact']
        data = (out / artifact['file']).read_bytes()
        assert len(data) == artifact['bytes'] == payload['length'] and sha(data) == artifact['sha256'] == payload['sha256']
    assert any(p['length'] == 16384 for p in physical['payloads'])
    for marker in ['SESSION_QUERY_VISIBLE_1', 'SESSION_QUERY_EMPTY_0', 'SESSION_READBACK_GREEN_16384', 'SESSION_FRAME_AND_DISK_OK', 'SESSION_EXPECTED_GPU_ERROR_1205', 'SESSION_DONE']:
        assert marker in physical['serial']
    logical_ref = physical['logicalState']
    logical = (out / logical_ref['file']).read_bytes()
    assert sha(logical) == logical_ref['sha256'] and len(logical) == logical_ref['bytes']
    assert sha(b'wasm-vm-gpu-guest-state-v1\0' + struct.pack('<Q', len(logical)) + logical + bytes.fromhex(physical['final']['ramDigest'])) == physical['final']['digest']
    assert browser['read']['candidates'] == 0 and browser['read']['smallV1']['receipts'] == 2048
    if 'attacks' in browser:
        assert len(browser['attacks']['checks']) >= 15 and browser['attacks']['candidates'] == browser['attacks']['consumerCallbacks'] == 0
    assert Path(__file__).read_bytes() == source
    report['status'] = 'passed'
except Exception as error:
    report['status'] = 'failed'
    report['error'] = repr(error)
    raise
finally:
    (proof / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': report['status'], 'cases': [{k: row[k] for k in ['variant', 'receipts', 'envelopeBytes', 'intervalRows', 'intervalBytes']} for row in report['cases']]}))
