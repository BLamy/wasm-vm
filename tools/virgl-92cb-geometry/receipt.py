#!/usr/bin/env python3
"""Check exact-head geometry evidence independently of the capture producer."""
from collections import Counter
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys

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
    require((directory / 'native.out').read_bytes() == (directory / 'wasm.out').read_bytes(),
            'byte-identical native and Wasm results')
    lines = (directory / 'native.out').read_text().splitlines()
    require(len(lines) == 7 and lines[-1] == 'STATUS passed', 'complete executable audit')
    bounds = []
    for index, pair in enumerate(proof['pairs']):
        words = struct.unpack_from('<164I', raw, 8 + 16 * 4 + index * 164 * 4)
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
