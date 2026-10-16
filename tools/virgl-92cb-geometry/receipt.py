#!/usr/bin/env python3
"""Check exact-head geometry evidence independently of the capture producer."""
from collections import Counter
from decimal import Decimal
import gzip
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools/virgl-capture'))
from validate import COMMANDS  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
TASK = 'E6-T12g6m5b1'
VERTEX = '7bf4d0d0f981a9feb958d6595302b15d564fc846e6d5ee71874f0921b31e613e'
FRAGMENT = '92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba'
SOURCE_DIR = ROOT / 'evidence/virgl-workload-inventory/captures/es2gears/shaders'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(ok, reason):
    if not ok:
        raise AssertionError(reason)


def f32(word):
    return Decimal.from_float(struct.unpack('<f', struct.pack('<I', word))[0])


def authenticated_packet(lines, cite, cache):
    seq = cite['event']
    require(1 <= seq <= len(lines), 'packet citation event in original stream')
    event = json.loads(lines[seq - 1])
    require(event['seq'] == seq and event['type'] == 'submit_cmd' and
            event.get('phase') == 'enter' and event.get('ctxId') == 5,
            'packet citation belongs to compositor submission')
    ref = event['blobs'][0]
    require(cite['blobSha256'] == ref['sha256'], 'packet citation original blob identity')
    if ref['sha256'] not in cache:
        path = ROOT / 'evidence/virgl-workload-inventory/captures/es2gears/blobs' / (
            ref['sha256'] + '.bin.gz')
        raw = gzip.decompress(path.read_bytes())
        require(len(raw) == ref['bytes'] and sha(raw) == ref['sha256'],
                'authenticated packet blob bytes')
        cache[ref['sha256']] = raw
    raw = cache[ref['sha256']]
    offset = cite['offset']
    require(isinstance(offset, int) and offset >= 0 and offset + 4 <= len(raw),
            'bounded cited packet header')
    header, = struct.unpack_from('<I', raw, offset)
    end = offset + 4 * (1 + (header >> 16))
    require(end <= len(raw) and (header & 255) in COMMANDS and
            sha(raw[offset:end]) == cite['packetSha256'],
            'cited complete original packet digest')
    words = struct.unpack_from('<' + 'I' * (1 + (header >> 16)), raw, offset)
    return COMMANDS[header & 255], words


def check_live_bank_packets(lines, proof, bank_words):
    """Read every emitted word from its packet, then replay its live set at DRAW."""
    cache = {}
    first_draws = {}
    for pair, (vertex, fragment) in zip(proof['pairs'], bank_words):
        for stage, citation, expected in [
            (0, pair['vertexSet'], vertex), (1, pair['fragmentSet'], fragment)]:
            name, words = authenticated_packet(lines, citation, cache)
            require(name == 'SET_CONSTANT_BUFFER' and words[1:3] == (stage, 0) and
                    tuple(words[3:]) == expected,
                    'complete emitted bank differs from authenticated SET_CONSTANT_BUFFER packet')
        draw = pair['firstDraw']
        name, words = authenticated_packet(lines, draw, cache)
        require(name == 'DRAW_VBO' and tuple(words[1:]) ==
                (0, 4, 5, 0, 1, 0, 0, 0, 0, 0, 3, 0),
                'first bank draw is original four-vertex strip')
        first_draws[(draw['event'], draw['offset'])] = pair
    require(len(first_draws) == 3, 'three distinct first-draw packet citations')
    subcontext = 0
    shader = [None, None]
    bank_set = [None, None]
    seen = set()
    last_event = max(seq for seq, _ in first_draws)
    for line in lines[:last_event]:
        event = json.loads(line)
        if event['type'] != 'submit_cmd' or event.get('phase') != 'enter' or event.get('ctxId') != 5:
            continue
        ref = event['blobs'][0]
        if ref['sha256'] not in cache:
            path = ROOT / 'evidence/virgl-workload-inventory/captures/es2gears/blobs' / (
                ref['sha256'] + '.bin.gz')
            raw = gzip.decompress(path.read_bytes())
            require(len(raw) == ref['bytes'] and sha(raw) == ref['sha256'],
                    'replayed submission blob identity')
            cache[ref['sha256']] = raw
        raw = cache[ref['sha256']]
        offset = 0
        while offset < len(raw):
            require(offset + 4 <= len(raw), 'complete replayed packet header')
            header, = struct.unpack_from('<I', raw, offset)
            count = header >> 16
            end = offset + 4 * (count + 1)
            require(end <= len(raw) and (header & 255) in COMMANDS,
                    'bounded replayed packet')
            words = struct.unpack_from('<' + 'I' * (count + 1), raw, offset)
            name = COMMANDS[header & 255]
            cite = {'event': event['seq'], 'blobSha256': ref['sha256'],
                    'offset': offset, 'packetSha256': sha(raw[offset:end])}
            if name == 'SET_SUB_CTX':
                subcontext = words[1]
            elif name == 'DESTROY_SUB_CTX' and words[1] == 2:
                shader = [None, None]; bank_set = [None, None]
            elif subcontext == 2:
                if name == 'BIND_SHADER' and words[2] in (0, 1):
                    shader[words[2]] = words[1]
                elif name == 'SET_CONSTANT_BUFFER' and words[1] in (0, 1) and words[2] == 0:
                    bank_set[words[1]] = cite
                elif name == 'DRAW_VBO' and (event['seq'], offset) in first_draws:
                    pair = first_draws[(event['seq'], offset)]
                    require(shader == [439, 440] and
                            bank_set == [pair['vertexSet'], pair['fragmentSet']],
                            'cited complete banks are live at original first DRAW')
                    seen.add((event['seq'], offset))
            offset = end
    require(seen == set(first_draws), 'all three first draws have live authenticated banks')


def main(directory):
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    require(not subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=ROOT,
                                        text=True).strip(), 'committed exact-head sources')
    raw = (directory / 'geometry.bin').read_bytes()
    proof = json.loads((directory / 'geometry.json').read_text())
    require(len(raw) == 8 + 16 * 4 + 3 * 164 * 4 and raw[:4] == b'G921' and
            struct.unpack_from('<I', raw, 4)[0] == 3 and
            proof['schema'] == 'virgl-original-92cb-geometry-v1' and
            proof['binarySha256'] == sha(raw), 'complete three-bank geometry artifact')
    quad = struct.unpack_from('<16I', raw, 8)
    require(list(quad) == proof['geometryWords'] and
            [tuple(f32(quad[i * 4 + lane]) for lane in range(4)) for i in range(4)] ==
            [(Decimal(0), Decimal(0), Decimal(0), Decimal(0)),
             (Decimal(0), Decimal(1), Decimal(0), Decimal(1)),
             (Decimal(1), Decimal(0), Decimal(1), Decimal(0)),
             (Decimal(1), Decimal(1), Decimal(1), Decimal(1))],
            'independent decoded [0,1] quad')
    require(proof['vertexSha256'] == VERTEX and proof['fragmentSha256'] == FRAGMENT and
            all(sha((SOURCE_DIR / (digest + '.tgsi')).read_bytes()) == digest
                for digest in (VERTEX, FRAGMENT)), 'unchanged full source identity')
    events = (ROOT / 'evidence/virgl-workload-inventory/captures/es2gears/events.jsonl').read_bytes()
    require(proof['eventsSha256'] == sha(events) and proof['draws'] == 1957 and
            proof['snapshots'] == 1069 and len(proof['transfer']) == 1 and
            proof['transfer'][0]['event'] == 5328 and proof['transfer'][0]['offset'] == 56,
            'capture stream and unique quad upload')
    require(len(proof['drawCitations']) == 1957 and len(proof['pairs']) == 3 and
            sum(pair['draws'] for pair in proof['pairs']) == 1957,
            'full draw and pair inventory')
    counts = Counter(c['pairSha256'] for c in proof['drawCitations'])
    require(counts == Counter({p['sha256']: p['draws'] for p in proof['pairs']}),
            'every draw cites one complete pair')
    require(all(c['draw']['event'] >= c['snapshotEvent'] and
                c['snapshotSha256'] ==
                'ea9c2d35066239343903a8fde34b1d8403b8a236c6cd54b9affbea15a16f3b8c'
                for c in proof['drawCitations']), 'each draw has its preceding quad snapshot')
    bank_words = [struct.unpack_from('<164I', raw, 8 + 16 * 4 + i * 164 * 4)
                  for i in range(3)]
    check_live_bank_packets(events.splitlines(), proof,
                            [(tuple(words[:16]), tuple(words[16:])) for words in bank_words])
    require((directory / 'native.out').read_bytes() == (directory / 'wasm.out').read_bytes(),
            'byte-identical native and Wasm results')
    lines = (directory / 'native.out').read_text().splitlines()
    require(len(lines) == 7 and lines[-1] == 'STATUS passed', 'complete executable audit')
    bounds = []
    for index, pair in enumerate(proof['pairs']):
        words = bank_words[index]
        require(sha(struct.pack('<164I', *words)) == pair['sha256'] and
                pair['vertexWords'] == 16 and pair['fragmentWords'] == 148,
                'canonical full paired source-bank record')
        fragment = words[16:]
        require(f32(fragment[24]) == 2 and
                f32(fragment[0]) == f32(fragment[1]) == 4,
                'captured positive integer exponent and center')
        axis_bounds = []
        for axis in range(2):
            scale, center = f32(fragment[16 + axis]), f32(fragment[axis])
            require(scale >= 0 and scale <= 2048, 'independently finite scale')
            maximum = max(abs(-center), abs(scale - center))
            require(maximum == int(maximum) and maximum < 2048,
                    'exact endpoint envelope on every interpolated UV')
            axis_bounds.append(int(maximum))
        prefix = f'BANK {index} baseX<={axis_bounds[0]} baseY<={axis_bounds[1]} paired='
        require(lines[index * 2].startswith(prefix), 'native/Wasm exact endpoint bound')
        pair_result = json.loads(lines[index * 2][len(prefix):])
        require(pair_result == {'ok': False, 'error': {'code': 'unsupported-feature',
                'message': 'TGSI is malformed or outside the documented straight-line profile.'}},
                'complete original pair still rejected without geometry authority')
        ordinary = lines[index * 2 + 1]
        require(ordinary.startswith(f'DEFAULT {index} ') and
                json.loads(ordinary.split(' ', 2)[2]) == pair_result,
                'ordinary original pair still gated')
        bounds.append(axis_bounds)
    source_names = [
        'Makefile', 'renderer/virgl-shader/build.sh',
        'renderer/virgl-shader/native_tests/original_92cb_geometry.c',
        'tools/verify-virgl-original-92cb-geometry.sh',
        'tools/virgl-92cb-geometry/capture.py',
        'tools/virgl-92cb-geometry/README.md',
        'tools/virgl-92cb-geometry/receipt.py',
        'tools/virgl-92cb-geometry/cold.py',
        'tools/virgl-92cb-geometry/seal.py',
        'tasks/epic-6-transcendence/E6-T12g6m5b1-92cb-geometry-provenance.md',
    ]
    file_names = ['geometry.bin', 'geometry.json', 'capture.log', 'self-test.log',
                  'native-build.log', 'native.out', 'wasm-build.log', 'wasm.out',
                  'guard-check.log', 'geometry-fault.log', 'exponent-fault.log',
                  'bank-fault.log',
                  'native-coverage.json']
    generated = ['renderer/virgl-shader/build/original-92cb-geometry-sanitize/original-92cb-geometry-test',
                 'renderer/virgl-shader/build/original-92cb-geometry-wasm/original-92cb-geometry.js',
                 'renderer/virgl-shader/build/original-92cb-geometry-wasm/original-92cb-geometry.wasm']
    receipt = {'schema': 'virgl-original-92cb-geometry-worker-receipt-v1',
               'task': TASK, 'status': 'passed', 'gitHead': head,
               'draws': proof['draws'], 'snapshots': proof['snapshots'],
               'bounds': bounds, 'productionGeometryAuthority': False,
               'files': {name: sha((directory / name).read_bytes()) for name in file_names},
               'sources': {name: sha((ROOT / name).read_bytes()) for name in source_names},
               'generated': {name: sha((ROOT / name).read_bytes()) for name in generated}}
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'{proof["draws"]} authenticated quad draws; {len(bounds)} banks; '
          'native/Wasm identical; original full pair gated')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
