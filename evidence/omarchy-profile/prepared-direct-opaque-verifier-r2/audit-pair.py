#!/usr/bin/env python3
"""Independent streaming audit of a real exported pair. Never restores or edits it."""
import gzip
import hashlib
import json
from pathlib import Path
import struct
import sys


def identity(filename):
    digest, size = hashlib.sha256(), 0
    with filename.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk); size += len(chunk)
    return dict(size=size, sha256=digest.hexdigest())


class CheckedStream:
    def __init__(self, filename):
        self.stream = gzip.open(filename, 'rb')
        self.digest, self.size = hashlib.sha256(), 0

    def read(self, length, required=True):
        data = self.stream.read(length)
        if required: assert len(data) == length, ('truncated payload', length, len(data))
        self.digest.update(data); self.size += len(data)
        return data

    def skip(self, length):
        digest = hashlib.sha256()
        while length:
            data = self.read(min(length, 1024 * 1024))
            digest.update(data); length -= len(data)
        return digest.hexdigest()


def audit(report_file, run_file):
    report, run = json.loads(report_file.read_text()), json.loads(run_file.read_text())
    pair = report['pair']
    manifest = json.loads(Path(report['candidate']['source']['chunkManifest']['filename']).read_text())
    canonical = {key: manifest[key] for key in ['version', 'image_len', 'chunk_size', 'layout', 'chunks']}
    base = hashlib.sha256(json.dumps(canonical, separators=(',', ':')).encode()).hexdigest()
    assert manifest['image_len'] == 4294967296 and manifest['chunk_size'] == 262144 and len(manifest['chunks']) == 16384
    assert base == report['loaderIdentity']['baseBinding'] == pair['base'] == run['pair']['base']
    assert pair['paused'] is True and pair['restoreDecision'] == 'resume'
    seed_source = report['candidate']['source']['bootSnapshot']['sha256'] + ':' + report['candidate']['source']['overlayDelta']['sha256']
    seed = hashlib.sha256(seed_source.encode()).hexdigest()
    assert report['captureOverlayStore'] == dict(seed=seed, name='wvov-'+base+'-seed-'+seed)
    for key in ['stats', 'settled']:
        stats = report['capturePersistence'][key]
        assert stats['pendingBlocks'] == 0 and stats['flushWaiting'] is False and stats['writeWaiting'] is False
    result = dict(report=identity(report_file), base=base, generation=pair['generation'], seed=seed)
    for role in ['snapshot', 'delta']:
        filename = Path(pair[role]['filename'])
        assert filename.is_file() and not filename.is_symlink()
        assert filename.parent == Path(run['pairDirectory'])
        result[role] = identity(filename)
        assert all(result[role][key] == pair[role][key] for key in ['size', 'sha256'])
    snapshot = CheckedStream(Path(pair['snapshot']['filename']))
    try:
        header = snapshot.read(84)
        assert header[:8] == b'WVMRESU1' and struct.unpack_from('<I', header, 8)[0] == 1
        assert header[12:44] == b'0.0.1'.ljust(32, b'\0') and header[12:44].hex() == pair['coreId'] == run['pair']['coreId']
        assert header[44:76].hex() == base and struct.unpack_from('<Q', header, 76)[0] == pair['generation']
        seen, sections = set(), []
        while framing := snapshot.read(8, required=False):
            assert len(framing) == 8
            tag, length = struct.unpack('<II', framing)
            assert 1 <= tag <= 16 and tag not in seen
            seen.add(tag)
            section = dict(tag=tag, offset=snapshot.size, length=length)
            if tag != 2:
                section['payloadSha256'] = snapshot.skip(length)
            else:
                remaining, expanded, records = length, 0, 0
                while remaining:
                    assert remaining >= 5
                    kind, span = struct.unpack('<BI', snapshot.read(5)); remaining -= 5
                    assert kind in [0, 1] and expanded + span <= 1073741824
                    if kind:
                        assert span <= remaining
                        snapshot.skip(span); remaining -= span
                    expanded += span; records += 1
                # The unchanged Omarchy profile in web/main.js selects ramMib:1024.
                assert expanded == 1073741824
                section.update(expandedBytes=expanded, sparseRecords=records)
            sections.append(section)
        # The pinned R3 oracle and unchanged Machine::save_resume construction
        # both contain all 16 device/CPU/RAM/clock sections in this order.
        # A header-only or RAM-only blob cannot satisfy real pair completeness.
        assert [row['tag'] for row in sections] == [1, 2, 3, 4, 5, 8, 6, 7, 12, 13, 14, 15, 16, 10, 11, 9]
        assert snapshot.size == pair['snapshotBytes']
        assert snapshot.digest.hexdigest() == run['pair']['rawSnapshotSha256']
        result['snapshot'].update(rawBytes=snapshot.size, rawSha256=snapshot.digest.hexdigest(), sections=sections)
    finally:
        snapshot.stream.close()
    delta = CheckedStream(Path(pair['delta']['filename']))
    try:
        header = delta.read(61)
        assert header[:5] == b'WVOD1'
        assert struct.unpack_from('<I', header, 5)[0] == 4096 and struct.unpack_from('<Q', header, 9)[0] == 4294967296
        assert header[17:49].hex() == base and struct.unpack_from('<Q', header, 49)[0] == pair['generation']
        count = struct.unpack_from('<I', header, 57)[0]
        assert count == pair['blocks'] == run['pair']['blocks']
        previous, indices, payloads = -1, hashlib.sha256(), hashlib.sha256()
        for number in range(count):
            raw_index = delta.read(8); index = struct.unpack('<Q', raw_index)[0]
            assert previous < index < 1048576, (number, index, previous)
            indices.update(raw_index); payloads.update(delta.read(4096)); previous = index
        assert delta.read(1, required=False) == b''
        assert delta.size == 61 + 4104 * count
        assert delta.digest.hexdigest() == run['pair']['rawDeltaSha256']
        result['delta'].update(rawBytes=delta.size, rawSha256=delta.digest.hexdigest(), blocks=count,
            indicesSha256=indices.hexdigest(), payloadsSha256=payloads.hexdigest(), lastIndex=previous)
    finally:
        delta.stream.close()
    return result


if __name__ == '__main__':
    print(json.dumps(audit(Path(sys.argv[1]), Path(sys.argv[2])), indent=2))
