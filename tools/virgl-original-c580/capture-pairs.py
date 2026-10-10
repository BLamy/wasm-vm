#!/usr/bin/env python3
"""Authenticate complete paired banks at every original 403b/c580 DRAW."""
from pathlib import Path
import gzip
import hashlib
import json
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
CAPTURE = ROOT / 'evidence/virgl-workload-inventory/captures/es2gears'
VERTEX = '403b0529c632d3d2ffe4584ede810f5745e8b76ca2ab4f575e1073d8f29fcf0c'
FRAGMENT = 'c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f'
sys.path.insert(0, str(ROOT / 'tools/virgl-capture'))
from validate import COMMANDS  # noqa: E402


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(value, reason):
    if not value:
        raise AssertionError(reason)


def main():
    target = Path(sys.argv[1])
    events = (CAPTURE / 'events.jsonl').read_bytes()
    inventory = json.loads((ROOT / 'evidence/virgl-workload-inventory/es2gears-inventory.json').read_text())
    require(sha(events) == inventory['eventsSha256'], 'authenticated event stream')
    summary = json.loads((CAPTURE / 'summary.json').read_text())['shaders']
    for digest, handle, stage in [(VERTEX, 444, 'VERT'), (FRAGMENT, 445, 'FRAG')]:
        require(sha((CAPTURE / 'shaders' / (digest + '.tgsi')).read_bytes()) == digest,
                'complete original shader source')
        occurrences = summary[digest]['occurrences']
        require(any(o['context'] == 5 and o['subcontext'] == 2 and o['handle'] == handle
                    and o['stage'] == stage for o in occurrences), 'captured shader identity')

    subcontext = 0
    state = {}
    pairs = {}
    draw_count = 0
    blob_digests = set()
    for line in events.splitlines():
        event = json.loads(line)
        if event['type'] != 'submit_cmd' or event.get('phase') != 'enter' or event.get('ctxId') != 5:
            continue
        ref = event['blobs'][0]
        data = gzip.decompress((CAPTURE / 'blobs' / (ref['sha256'] + '.bin.gz')).read_bytes())
        require(sha(data) == ref['sha256'] and len(data) == ref['bytes'], 'complete command blob')
        blob_digests.add(ref['sha256'])
        offset = 0
        while offset < len(data):
            require(offset + 4 <= len(data), 'packet header')
            header, = struct.unpack_from('<I', data, offset)
            opcode, length = header & 255, header >> 16
            end = offset + 4 * (length + 1)
            require(opcode in COMMANDS and end <= len(data), 'bounded known packet')
            words = struct.unpack_from('<' + 'I' * (length + 1), data, offset)
            name = COMMANDS[opcode]
            if name == 'SET_SUB_CTX':
                require(length == 1, 'subcontext packet')
                subcontext = words[1]
            elif name == 'DESTROY_SUB_CTX':
                state.pop(words[1], None)
            elif subcontext == 2:
                active = state.setdefault(2, {'shader': [None, None], 'bank': [None, None]})
                if name == 'BIND_SHADER' and words[2] in (0, 1):
                    active['shader'][words[2]] = words[1]
                elif name == 'SET_CONSTANT_BUFFER' and words[1] in (0, 1) and words[2] == 0:
                    active['bank'][words[1]] = (words[3:], event['seq'], ref['sha256'],
                                                 offset, sha(data[offset:end]))
                elif name.startswith('DRAW') and active['shader'] == [444, 445]:
                    vertex, fragment = active['bank']
                    require(vertex is not None and fragment is not None and
                            len(vertex[0]) == 12 and len(fragment[0]) == 136,
                            'complete original paired slot-zero banks')
                    require(fragment[0][29 * 4] == 0 and fragment[0][30 * 4] == 0x40000000,
                            'original zero cap and exponent')
                    require(fragment[0][23 * 4] == 1 and fragment[0][24 * 4] == 0 and
                            fragment[0][28 * 4] == 0x3f800000 and
                            fragment[0][3 * 4 + 3] == 0x3f800000,
                            'captured color and discard branch preconditions')
                    raw = struct.pack('<148I', *vertex[0], *fragment[0])
                    digest = sha(raw)
                    if digest not in pairs:
                        pairs[digest] = {'raw': raw, 'draws': 0, 'firstDraw': {
                            'event': event['seq'], 'blobSha256': ref['sha256'],
                            'offset': offset, 'packetSha256': sha(data[offset:end])},
                            'vertexSet': {'event': vertex[1], 'blobSha256': vertex[2],
                                          'offset': vertex[3], 'packetSha256': vertex[4]},
                            'fragmentSet': {'event': fragment[1], 'blobSha256': fragment[2],
                                            'offset': fragment[3], 'packetSha256': fragment[4]}}
                    pairs[digest]['draws'] += 1
                    draw_count += 1
            offset = end
        require(offset == len(data), 'entire command blob consumed')
    require(draw_count == 2271 and len(pairs) == 3, 'all original c580 draws and paired banks')
    ordered = sorted(pairs)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b'VOB1' + struct.pack('<I', len(ordered)) +
                       b''.join(pairs[digest]['raw'] for digest in ordered))
    provenance = {'schema': 'virgl-original-c580-paired-banks-v1',
                  'eventsSha256': sha(events), 'vertexSha256': VERTEX,
                  'fragmentSha256': FRAGMENT, 'draws': draw_count,
                  'commandBlobsRead': len(blob_digests), 'binarySha256': sha(target.read_bytes()),
                  'pairs': [{'sha256': digest, 'draws': pairs[digest]['draws'],
                             'vertexWords': 12, 'fragmentWords': 136,
                             'firstDraw': pairs[digest]['firstDraw'],
                             'vertexSet': pairs[digest]['vertexSet'],
                             'fragmentSet': pairs[digest]['fragmentSet']}
                            for digest in ordered]}
    target.with_suffix('.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print(f'{draw_count} authenticated full-pair draws across {len(ordered)} banks')


if __name__ == '__main__':
    main()
