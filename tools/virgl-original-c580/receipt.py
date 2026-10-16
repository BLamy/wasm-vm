#!/usr/bin/env python3
"""Recompute full original pair and physical-output claims from recorded bytes."""
from pathlib import Path
import hashlib
import json
import math
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
TASK = 'E6-T12g6m5a'
SOURCE = 'evidence/virgl-workload-inventory/captures/es2gears/shaders/'
VERTEX = '403b0529c632d3d2ffe4584ede810f5745e8b76ca2ab4f575e1073d8f29fcf0c'
FRAGMENT = 'c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(value, reason):
    if not value:
        raise AssertionError(reason)


def f32(word):
    return struct.unpack('<f', struct.pack('<I', word))[0]


def result_lines(path):
    results = {'EXACT': {}, 'DEFAULT': {}}
    lines = path.read_text().splitlines()
    require(lines[-1] == 'STATUS passed' and len(lines) == 7, 'complete native/Wasm result stream')
    for line in lines[:-1]:
        kind, index, payload = line.split(' ', 2)
        require(kind in results and index in '012' and int(index) not in results[kind],
                'unique complete original pair result')
        results[kind][int(index)] = json.loads(payload)
    require(all(len(entries) == 3 for entries in results.values()), 'all three native pairs')
    return results


def main():
    evidence = Path(sys.argv[1])
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    require(not subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=ROOT,
                                        text=True).strip(), 'final proof uses committed tracked sources')
    require((evidence / 'native.out').read_bytes() == (evidence / 'wasm.out').read_bytes(),
            'byte-identical native and Wasm full pair results')
    native = result_lines(evidence / 'native.out')
    binary = (evidence / 'banks.bin').read_bytes()
    provenance = json.loads((evidence / 'banks.json').read_text())
    require(binary[:4] == b'VOB1' and struct.unpack_from('<I', binary, 4)[0] == 3 and
            len(binary) == 8 + 3 * 148 * 4 and provenance['binarySha256'] == sha(binary),
            'complete authenticated paired bank file')
    require(provenance['draws'] == 2271 and sum(p['draws'] for p in provenance['pairs']) == 2271,
            'all original draw occurrences')
    original = [((ROOT / (SOURCE + identifier + '.tgsi')).read_bytes(), identifier)
                for identifier in (VERTEX, FRAGMENT)]
    require(all(sha(raw) == digest for raw, digest in original), 'literal original source bytes')
    require(provenance['vertexSha256'] == VERTEX and provenance['fragmentSha256'] == FRAGMENT,
            'capture source identity')
    banks = []
    for index, pair in enumerate(provenance['pairs']):
        words = struct.unpack_from('<148I', binary, 8 + index * 148 * 4)
        require(sha(struct.pack('<148I', *words)) == pair['sha256'] and
                pair['vertexWords'] == 12 and pair['fragmentWords'] == 136,
                'complete captured paired bank identity')
        banks.append((words[:12], words[12:]))

    browser = json.loads((evidence / 'browser/report.json').read_bytes())
    acceptance = browser['acceptance']
    require(browser['task'] == TASK and browser['gitHead'] == head and
            browser['status'] == acceptance['status'] == 'passed' and
            browser['browserErrors'] == {'console': [], 'page': [], 'requests': []} and
            not browser['trackedChanges'], 'zero-error exact-head physical WebGL run')
    require(browser['browser']['launch']['headless'] is False and
            browser['browser']['gpu']['featureStatus'][browser['browser']['webglFeature']] == 'enabled' and
            'ANGLE' in acceptance['renderer'] and
            'software' not in acceptance['renderer'].lower(), 'physical GPU identity')
    require(acceptance['inputs'] == {'vertexSha256': VERTEX, 'fragmentSha256': FRAGMENT,
                                     'banksSha256': sha(binary)}, 'served complete originals')
    require(len(acceptance['pairs']) == 3 and len(acceptance['frames']) == 6 and
            len(acceptance['rejections']) == 3, 'all original banks, edges and negatives')
    checked = survivors = discards = 0
    for i, entry in enumerate(acceptance['pairs']):
        private = native['EXACT'][i]
        require(private['ok'] and private == entry['result'] and
                not native['DEFAULT'][i]['ok'] and
                native['DEFAULT'][i] == entry['ordinary'],
                'complete browser/native/Wasm result and ordinary gating')
        vertex, fragment = banks[i]
        metadata = private['fragment']['metadata']
        domain = metadata['constantExactDomains'][0]
        require(domain['count'] == 34 and len(domain['components']) == 136 and
                all(component == {'register': j // 4, 'component': j % 4, 'word': fragment[j]}
                    for j, component in enumerate(domain['components'])),
                'all exact fragment bank words represented in metadata')
        require(private['vertex']['metadata']['profile'] == 'virgl-webgl2-straight-line-v5' and
                private['fragment']['metadata']['profile'] == 'virgl-webgl2-raw-bits-v42',
                'unchanged vertex and private fragment boundary')
        for edge in ('near', 'far'):
            frame = next(f for f in acceptance['frames'] if f['bank'] == i and f['edge'] == edge)
            require(frame['sourceSha256'] == FRAGMENT and len(frame['pixels']) == 16 and
                    frame['logs'] == {'vertex': '', 'fragment': '', 'link': ''},
                    'physical full-source link and complete pixels')
            for reflection, expected_words, count in zip(frame['reflection'],
                                                          (vertex, fragment), (3, 34)):
                require(reflection['count'] == count and reflection['words'] == list(expected_words),
                        'physical complete raw uniform upload and reflection')
            width, height = f32(fragment[0]), f32(fragment[1])
            for pixel in frame['pixels']:
                x, y = pixel['x'], pixel['y']
                sx = (0 if edge == 'near' else width - 4) + x + .5
                sy = (0 if edge == 'near' else height - 4) + y + .5
                survive = min(sx, width-sx, sy, height-sy) <= 1
                expected = [1, 1, 1, 1] if survive else [0, 0, 1, 1]
                actual = pixel['actual']
                require(pixel['expected'] and len(actual) == 4 and
                        all(math.isfinite(a) and abs(a - b) <= .02
                            for a, b in zip(actual, expected)),
                        f'independent original pixel {i}/{edge}/{x}/{y}')
                checked += 1
                survivors += survive
                discards += not survive
    require((checked, survivors, discards) == (96, 42, 54),
            'both near and far original discard edges across all banks')
    for fault in ('discard', 'output'):
        attack = json.loads((evidence / f'browser-fault-{fault}/report.json').read_bytes())
        require(attack['task'] == TASK and attack['gitHead'] == head and
                attack['status'] == attack['acceptance']['status'] == 'failed' and
                'independent full original pixel bank0 near' in attack['failure']['message'] and
                attack['browserErrors'] == {'console': [], 'page': [], 'requests': []},
                f'{fault} physical source fault contradicts primary pixel oracle')

    files = ['banks.bin', 'banks.json', 'capture.log', 'guard-check.log',
             'native-build.log', 'native.out', 'wasm-build.log', 'wasm.out',
             'production-wasm-build.log', 'native-coverage.json',
             'browser/report.json', 'browser/browser.png', 'browser/browser-coverage.json',
             'browser-fault-discard/report.json', 'browser-fault-discard/failure.png',
             'browser-fault-output/report.json', 'browser-fault-output/failure.png']
    sources = ['Makefile', 'renderer/virgl-shader/build.sh',
               'renderer/virgl-shader/native_tests/original_c580.c',
               'renderer/virgl-shader/tests/original-c580.mjs',
               'tools/virgl-original-c580/capture-pairs.py',
               'tools/virgl-original-c580/browser.mjs',
               'tools/virgl-original-c580/receipt.py',
               'tools/virgl-original-c580/cold.py',
               'tools/virgl-original-c580/seal.py',
               'tools/verify-virgl-original-c580.sh',
               'tasks/epic-6-transcendence/E6-T12g6m5a-c580-full-original.md']
    generated = ['renderer/virgl-shader/build/original-c580-sanitize/original-c580-test',
                 'renderer/virgl-shader/build/original-c580-wasm/original-c580.js',
                 'renderer/virgl-shader/build/original-c580-wasm/original-c580.data',
                 'renderer/virgl-shader/build/original-c580-wasm/original-c580.wasm',
                 'renderer/virgl-shader/build/wasm/virgl-shader.mjs',
                 'renderer/virgl-shader/build/wasm/virgl-shader.wasm']
    require(all((evidence / name).is_file() for name in files), 'complete worker evidence')
    for name in sources:
        actual = (ROOT / name).read_bytes()
        expected = subprocess.check_output(['git', 'show', f'{head}:{name}'], cwd=ROOT)
        require(actual == expected, f'exact-head source {name}')
    receipt = {'schema': 'virgl-original-c580-worker-receipt-v1', 'task': TASK,
               'status': 'passed', 'gitHead': head, 'checkedPixels': checked,
               'survivors': survivors, 'discards': discards,
               'files': {name: sha((evidence / name).read_bytes()) for name in files},
               'sources': {name: sha((ROOT / name).read_bytes()) for name in sources},
               'generated': {name: sha((ROOT / name).read_bytes()) for name in generated},
               'guestExecution': False, 'productionNegotiation': False}
    (evidence / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'Original c580: {checked} physical pixels, {survivors} survivors, '
          f'{discards} discards, native/Wasm full-pair bytes matched')


if __name__ == '__main__':
    main()
