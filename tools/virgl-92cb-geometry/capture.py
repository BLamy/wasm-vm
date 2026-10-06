#!/usr/bin/env python3
"""Authenticate the draw-time inputs of the original 7bf4/92cb compositor pair.

This produces evidence, not a reusable shader or DRAW admission token. In
particular, no compiler call here can ensure a later draw uses these vertices.
"""
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
CAPTURE = ROOT / 'evidence/virgl-workload-inventory/captures/es2gears'
VERTEX = '7bf4d0d0f981a9feb958d6595302b15d564fc846e6d5ee71874f0921b31e613e'
FRAGMENT = '92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba'
QUAD = (0, 0, 0, 0, 0, 0x3f800000, 0, 0x3f800000,
        0x3f800000, 0, 0x3f800000, 0, 0x3f800000,
        0x3f800000, 0x3f800000, 0x3f800000)
ELEMENTS = (0, 0, 0, 29, 0, 0, 1, 29)  # two R32G32_FLOAT inputs
BUFFERS = ((16, 0, 41), (16, 8, 41))
DRAW = (0, 4, 5, 0, 1, 0, 0, 0, 0, 0, 3, 0)  # four nonindexed strip vertices
sys.path.insert(0, str(ROOT / 'tools/virgl-capture'))
from validate import COMMANDS, OBJECTS, validate_capture  # noqa: E402


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(ok, reason):
    if not ok:
        raise AssertionError(reason)


def blob(reference):
    path = CAPTURE / 'blobs' / (reference['sha256'] + '.bin.gz')
    raw = gzip.decompress(path.read_bytes())
    require(len(raw) == reference['bytes'] and sha(raw) == reference['sha256'],
            'authenticated original blob')
    return raw


def citation(event, reference, offset, raw):
    return {'event': event['seq'], 'blobSha256': reference['sha256'],
            'offset': offset, 'packetSha256': sha(raw)}


def checked_quad(raw):
    require(len(raw) >= 64, 'complete four-vertex backing')
    words = struct.unpack_from('<16I', raw)
    require(words == QUAD, 'captured two-attribute [0,1] quad')
    return words


def checked_draw(elements, buffers, words, resource, snapshot):
    require(elements == ELEMENTS, 'captured float2 vertex element formats and slots')
    require(buffers == BUFFERS, 'captured vertex-buffer stride, offsets and resource')
    require(words == DRAW, 'captured nonindexed, single-instance four-vertex strip')
    require(resource == (0, 64, 16, 64, 1), 'live vertex-only buffer properties')
    require(snapshot is not None and snapshot['reason'] == 'submit',
            'draw-time submission backing snapshot')
    return checked_quad(blob(snapshot['blobs'][0]))


def complete_banks(vertex, fragment):
    require(vertex is not None and fragment is not None and
            len(vertex[0]) == 16 and len(fragment[0]) == 148,
            'complete original paired slot-zero banks')
    v, f = vertex[0], fragment[0]
    require(f[6 * 4] == 0x40000000 and f[0] == f[1] == 0x40800000 and
            f[4 * 4] in (0x44780000, 0x44814000, 0x439b0000),
            'captured exponent, center and scale words')
    return tuple(v) + tuple(f)


def self_test():
    raw = struct.pack('<16I', *QUAD)
    assert checked_quad(raw) == QUAD
    for index, value in [(0, 0x80000000), (5, 0x7f800000),
                         (10, 0x7fc00000), (15, 0x40000000)]:
        changed = list(QUAD); changed[index] = value
        try:
            checked_quad(struct.pack('<16I', *changed))
        except AssertionError:
            pass
        else:
            raise AssertionError('changed negative, nonfinite or out-of-range vertex accepted')
    snap = {'reason': 'submit', 'blobs': []}
    for elements, buffers, draw, resource in [
        (ELEMENTS[:-1] + (30,), BUFFERS, DRAW, (0, 64, 16, 64, 1)),
        (ELEMENTS, ((16, 0, 41), (16, 12, 41)), DRAW, (0, 64, 16, 64, 1)),
        (ELEMENTS, BUFFERS, (0, 4, 5, 1) + DRAW[4:], (0, 64, 16, 64, 1)),
        (ELEMENTS, BUFFERS, DRAW, (0, 64, 16, 64, 2)),
    ]:
        try:
            checked_draw(elements, buffers, draw, resource, snap)
        except AssertionError:
            pass
        else:
            raise AssertionError('changed draw ownership/format admitted')


def main(target):
    validate_capture(CAPTURE)
    for digest, handle, stage in [(VERTEX, 439, 'VERT'), (FRAGMENT, 440, 'FRAG')]:
        require(sha((CAPTURE / 'shaders' / (digest + '.tgsi')).read_bytes()) == digest,
                'complete original source bytes')
        original = json.loads((CAPTURE / 'summary.json').read_text())['shaders'][digest]
        require(any(o['context'] == 5 and o['subcontext'] == 2 and
                    o['handle'] == handle and o['stage'] == stage
                    for o in original['occurrences']), 'original shader occurrence')
    event_path = CAPTURE / 'events.jsonl'
    events = event_path.read_bytes()
    manifest = json.loads((CAPTURE / 'manifest.json').read_text())
    require(sha(events) == manifest['events']['sha256'], 'exact validated event stream')
    resource = None
    created_once = False
    snapshot = None
    snapshot_count = 0
    snapshot_hashes = Counter()
    sub = 0
    active = {'shader': [None, None], 'createdShaders': set(), 'bank': [None, None],
              'elements': {}, 'bound': None, 'buffers': None}
    pair_rows = {}
    draw_count = 0
    draw_citations = []
    transfer_citations = []
    command_blobs = set()
    last_snapshot_seq = 0
    for line in events.splitlines():
        event = json.loads(line)
        typ = event['type']
        if typ == 'resource_create' and event.get('phase') == 'enter' and event['resourceId'] == 41:
            require(resource is None and not created_once, 'one original resource lifetime')
            created_once = True
            resource = (event['target'], event['format'], event['bind'],
                        event['width'], event['height'])
        elif typ == 'resource_unref' and event.get('phase') == 'enter' and event['resourceId'] == 41:
            require(resource is not None, 'live resource unref')
            resource = None; snapshot = None
        elif typ == 'backing_snapshot' and event['resourceId'] == 41:
            require(resource is not None, 'backing belongs to live resource')
            raw = blob(event['blobs'][0])
            if event['reason'] == 'submit':
                checked_quad(raw)
                last_snapshot_seq = event['seq']
            snapshot = event
            snapshot_count += 1
            snapshot_hashes[sha(raw)] += 1
        elif (typ in ('transfer_write_iov', 'transfer_read_iov', 'resource_detach_iov') and
              event.get('resourceId') == 41 and event.get('phase') == 'enter'):
            require(typ == 'resource_detach_iov' and draw_count == 1957,
                    'no untracked host-side buffer mutation before final draw')
        if typ != 'submit_cmd' or event.get('phase') != 'enter':
            continue
        ref = event['blobs'][0]
        data = blob(ref)
        command_blobs.add(ref['sha256'])
        offset = 0
        while offset < len(data):
            require(offset + 4 <= len(data), 'complete command header')
            header, = struct.unpack_from('<I', data, offset)
            opcode, kind, length = header & 255, (header >> 8) & 255, header >> 16
            end = offset + 4 * (length + 1)
            require(opcode in COMMANDS and kind in OBJECTS and end <= len(data),
                    'bounded known packet')
            words = struct.unpack_from('<' + 'I' * (length + 1), data, offset)
            name, obj = COMMANDS[opcode], OBJECTS[kind]
            cite = citation(event, ref, offset, data[offset:end])
            if name in ('RESOURCE_INLINE_WRITE', 'COPY_TRANSFER3D',
                        'RESOURCE_COPY_REGION', 'BLIT') and 41 in words[1:]:
                raise AssertionError('no GPU mutation of original vertex resource')
            if name == 'TRANSFER3D' and len(words) > 1 and words[1] == 41:
                require(event['ctxId'] == 5 and sub == 2 and event['seq'] == 5328 and
                        offset == 56 and
                        tuple(words[1:]) == (41, 0, 162, 0, 0, 0, 0, 0, 64, 1, 1, 0, 1),
                        'single original quad upload from snapshotted guest backing')
                transfer_citations.append(cite)
            if event['ctxId'] != 5:
                offset = end
                continue
            if name == 'SET_SUB_CTX':
                require(length == 1, 'subcontext selection')
                sub = words[1]
            elif name == 'DESTROY_SUB_CTX' and words[1] == 2:
                active = {'shader': [None, None], 'createdShaders': set(), 'bank': [None, None],
                          'elements': {}, 'bound': None, 'buffers': None}
            elif sub == 2:
                if name == 'CREATE_OBJECT' and obj == 'SHADER' and words[1] in (439, 440):
                    active['createdShaders'].add(words[1])
                elif name == 'DESTROY_OBJECT' and obj == 'SHADER':
                    active['createdShaders'].discard(words[1])
                if name == 'BIND_SHADER' and words[2] in (0, 1):
                    if words[1] in (439, 440):
                        require(words[1] in active['createdShaders'],
                                'bound original shader has live object')
                    active['shader'][words[2]] = words[1]
                elif name == 'CREATE_OBJECT' and obj == 'VERTEX_ELEMENTS':
                    active['elements'][words[1]] = tuple(words[2:])
                elif name == 'DESTROY_OBJECT' and obj == 'VERTEX_ELEMENTS':
                    active['elements'].pop(words[1], None)
                elif name == 'BIND_OBJECT' and obj == 'VERTEX_ELEMENTS':
                    active['bound'] = words[1]
                elif name == 'SET_VERTEX_BUFFERS':
                    require((len(words) - 1) % 3 == 0, 'vertex-buffer packet width')
                    active['buffers'] = tuple(tuple(words[i:i + 3])
                                              for i in range(1, len(words), 3))
                elif name == 'SET_CONSTANT_BUFFER' and words[1] in (0, 1) and words[2] == 0:
                    active['bank'][words[1]] = (tuple(words[3:]), cite)
                elif name == 'DRAW_VBO' and active['shader'] == [439, 440]:
                    require({439, 440} <= active['createdShaders'],
                            'both complete original shader objects live at draw')
                    require(resource is not None and event['seq'] >= last_snapshot_seq > 0,
                            'live resource and preceding snapshot')
                    checked_draw(active['elements'].get(active['bound']), active['buffers'],
                                 tuple(words[1:]), resource, snapshot)
                    pair = complete_banks(*active['bank'])
                    raw_pair = struct.pack('<164I', *pair)
                    digest = sha(raw_pair)
                    if digest not in pair_rows:
                        pair_rows[digest] = {'raw': raw_pair, 'draws': 0,
                                             'firstDraw': cite,
                                             'vertexSet': active['bank'][0][1],
                                             'fragmentSet': active['bank'][1][1]}
                    pair_rows[digest]['draws'] += 1
                    draw_citations.append({'draw': cite, 'snapshotEvent': snapshot['seq'],
                                           'snapshotSha256': snapshot['blobs'][0]['sha256'],
                                           'pairSha256': digest})
                    draw_count += 1
            offset = end
        require(offset == len(data), 'complete command blob consumed')
    require(resource is None and draw_count == 1957 and len(pair_rows) == 3 and
            len(transfer_citations) == 1, 'all original paired draws and resource lifetime')
    require(snapshot_count == 1069 and snapshot_hashes ==
            Counter({'ea9c2d35066239343903a8fde34b1d8403b8a236c6cd54b9affbea15a16f3b8c': 1068,
                     'ad7facb2586fc6e966c004d7d1d16b024f5805ff7cb47c7a85dabd8b48892ca7': 1}),
            'every snapshotted quad backing from attach to last draw')
    ordered = sorted(pair_rows)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b'G921' + struct.pack('<I', 3) +
                       struct.pack('<16I', *QUAD) +
                       b''.join(pair_rows[d]['raw'] for d in ordered))
    provenance = {'schema': 'virgl-original-92cb-geometry-v1',
                  'eventsSha256': sha(events), 'vertexSha256': VERTEX,
                  'fragmentSha256': FRAGMENT, 'draws': draw_count,
                  'snapshots': snapshot_count, 'snapshotHashes': dict(snapshot_hashes),
                  'commandBlobsRead': len(command_blobs),
                  'geometryWords': list(QUAD), 'transfer': transfer_citations,
                  'binarySha256': sha(target.read_bytes()),
                  'pairs': [{'sha256': d, 'draws': pair_rows[d]['draws'],
                             'vertexWords': 16, 'fragmentWords': 148,
                             'firstDraw': pair_rows[d]['firstDraw'],
                             'vertexSet': pair_rows[d]['vertexSet'],
                             'fragmentSet': pair_rows[d]['fragmentSet']}
                            for d in ordered],
                  'drawCitations': draw_citations,
                  'scope': 'captured packets only; no future DRAW/geometry authority'}
    target.with_suffix('.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print(f'{draw_count} original draws, {snapshot_count} snapshots, '
          f'{len(pair_rows)} complete banks; bounded captured quad only')


if __name__ == '__main__':
    if len(sys.argv) == 2 and sys.argv[1] == '--self-test':
        self_test()
        print('geometry ownership mutations rejected')
    elif len(sys.argv) == 2:
        main(Path(sys.argv[1]))
    else:
        raise SystemExit('usage: capture.py [--self-test|output.bin]')
