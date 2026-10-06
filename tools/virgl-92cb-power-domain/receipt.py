#!/usr/bin/env python3
"""Independent audit of all physical first-power float pixels."""
import base64
from fractions import Fraction
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
VERTEX = ROOT / ('evidence/virgl-workload-inventory/captures/es2gears/shaders/'
                 '7bf4d0d0f981a9feb958d6595302b15d564fc846e6d5ee71874f0921b31e613e.tgsi')
FRAGMENT = ROOT / ('evidence/virgl-workload-inventory/captures/es2gears/shaders/'
                   '92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi')
RASTER = ROOT / 'target/evidence/virgl-92cb-raster'
WIDTH, HEIGHT = 1024, 768


def sha(data):
    return hashlib.sha256(data).hexdigest()


def check(ok, reason):
    if not ok:
        raise AssertionError(reason)


def number(word):
    value, = struct.unpack('<f', struct.pack('<I', word))
    check(value == value and abs(value) != float('inf'), 'finite captured bank word')
    return Fraction(*value.as_integer_ratio())


def geometry(binary):
    check(len(binary) == 2040 and binary[:4] == b'G921' and
          struct.unpack_from('<I', binary, 4)[0] == 3,
          'complete three-bank original geometry')
    check(struct.unpack_from('<16I', binary, 8) == (
        0, 0, 0, 0, 0, 0x3f800000, 0, 0x3f800000,
        0x3f800000, 0, 0x3f800000, 0,
        0x3f800000, 0x3f800000, 0x3f800000, 0x3f800000),
          'exact original four-vertex position and UV strip')
    banks = []
    for bank in range(3):
        vertex = struct.unpack_from('<16I', binary, 72 + bank * 656)
        fragment = struct.unpack_from('<148I', binary, 136 + bank * 656)
        check(fragment[0] == fragment[1] == 0x40800000 and
              fragment[24] == 0x40000000, 'original center and square exponent')
        banks.append((vertex, fragment))
    return banks


def axis_values(vertex, fragment, axis, dimension):
    scale = Fraction(512 if axis == 0 else 384)
    start = scale * (number(vertex[8 + axis]) + 1)
    end = scale * (number(vertex[0 if axis == 0 else 5]) +
                   number(vertex[8 + axis]) + 1)
    check(number(vertex[4 if axis == 0 else 1]) == 0 and end > start,
          'original positive axis-aligned transform')
    coefficient = number(fragment[16 + axis])
    center = number(fragment[axis])
    values = []
    for pixel in range(dimension):
        point = Fraction(2 * pixel + 1, 2)
        values.append(float(coefficient * (point - start) / (end - start) - center)
                      if start <= point <= end else None)
    return values


def inspect_bank(row, vertex, fragment):
    bank = row['bank']
    check(row['sourceSha256'] == sha_expected_probe() and
          row['vertexGlslSha256'] == sha(row['vertexGlsl'].encode()) and
          row['vertexMetadata']['stage'] == 'vertex' and
          any(item['name'] == 'vso_g0' and item['interpolation'] == 'smooth'
              for item in row['vertexMetadata']['outputs']) and
          len(row['attributes']) == 2 and
          {item['name'] for item in row['attributes']} == {'in_0', 'in_1'} and
          all(item['type'] == 35666 for item in row['attributes']) and
          {item['name']: (item['size'], item['type']) for item in row['uniforms']}.items() >=
          {'vsconst0[0]': (4, 36296), 'fsconst0[0]': (7, 36296)}.items() and
          len(row['blocks']) == 1 and
          row['blocks'][0]['members'][0]['name'] == 'winsys_adjust_y' and
          row['blocks'][0]['members'][0]['value'] == 1 and
          row['drawState'] == {'viewport': [0, 0, WIDTH, HEIGHT],
                               'samples': 0, 'framebufferStatus': 36053,
                               'colorFormat': 34836, 'mode': 5, 'count': 4} and
          row['logs'] == {'vertex': '', 'fragment': '', 'link': ''},
          'reflected physical original vertex/probe program')
    zipped = base64.b64decode(row['readbackGzipBase64'], validate=True)
    check(sha(zipped) == row['readbackGzipSha256'], 'compressed physical readback digest')
    raw = gzip.decompress(zipped)
    check(len(raw) == WIDTH * HEIGHT * 16 and sha(raw) == row['readbackSha256'],
          'complete unmodified physical float readback')
    xs = axis_values(vertex, fragment, 0, WIDTH)
    ys = axis_values(vertex, fragment, 1, HEIGHT)
    covered = branches = 0
    minimum, maximum, active_minimum, active_maximum = float('inf'), 0.0, float('inf'), 0.0
    max_error = max_relative = 0.0
    samples = []
    for y in range(HEIGHT):
        ideal_y = ys[y]
        for x in range(WIDTH):
            dx, dy, px, py = struct.unpack_from('<4f', raw, (y * WIDTH + x) * 16)
            ideal_x = xs[x]
            if ideal_x is None or ideal_y is None:
                check(dx == -10000.0 and dy == -10000.0 and
                      px == -10000.0 and py == -10000.0,
                      f'no unreported original coverage bank{bank} ({x},{y})')
                continue
            covered += 1
            error = max(abs(dx - ideal_x), abs(dy - ideal_y))
            check(error < .1, f'physical interpolant error bank{bank} ({x},{y})')
            max_error = max(max_error, error)
            for delta in (dx, dy):
                base = abs(delta)
                check(.25 < base <= 2048 and base != float('inf'),
                      f'positive-normal base bank{bank} ({x},{y})')
                minimum = min(minimum, base)
                maximum = max(maximum, base)
            active = dx < 0 and dy < 0
            if active:
                branches += 1
                for delta, power in ((dx, px), (dy, py)):
                    squared = delta * delta
                    relative = abs(power - squared) / squared
                    check(power >= 0 and power != float('inf') and
                          relative <= Fraction(1, 16384),
                          f'physical first POW bank{bank} ({x},{y})')
                    active_minimum = min(active_minimum, abs(delta))
                    active_maximum = max(active_maximum, abs(delta))
                    max_relative = max(max_relative, relative)
            else:
                check(px == py == -10000.0,
                      f'inactive first POW bank{bank} ({x},{y})')
            if ((abs(ideal_x) < 6 and abs(ideal_y) < 6) or
                    (x in (0, WIDTH // 2, WIDTH - 1) and
                     y in (0, HEIGHT // 2, HEIGHT - 1))):
                samples.append({'x': x, 'y': y,
                                'actual': [dx, dy, px, py],
                                'ideal': [ideal_x, ideal_y]})
    check(row['covered'] == covered and row['branches'] == branches and
          abs(row['minimum'] - minimum) < 1e-12 and
          abs(row['maximum'] - maximum) < 1e-12 and
          row['activeMinimum'] == (active_minimum if branches else None) and
          row['activeMaximum'] == (active_maximum if branches else None) and
          abs(row['maxDeltaError'] - max_error) < 1e-4 and
          abs(row['maxPowerRelativeError'] - max_relative) < 1e-12 and
          len(row['samples']) == len(samples),
          'independent full-readback reductions')
    for actual, expected in zip(row['samples'], samples):
        check(actual['x'] == expected['x'] and actual['y'] == expected['y'] and
              actual['actual'] == expected['actual'] and
              all(abs(a - b) < 1e-8 for a, b in zip(actual['ideal'], expected['ideal'])),
              'independent physical center samples')
    return {'bank': bank, 'covered': covered, 'branches': branches,
            'minimum': minimum, 'maximum': maximum,
            'maxDeltaError': max_error, 'maxPowerRelativeError': max_relative}


def sha_expected_probe():
    # Filled by the browser source hash check in main; a named helper keeps
    # the generated GLSL string out of this independent numeric oracle.
    return PROBE_SHA


PROBE_SHA = None


def main(directory):
    global PROBE_SHA
    check(not subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'],
                                      cwd=ROOT, text=True).strip(),
          'exact-head tracked source required')
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'],
                                   cwd=ROOT, text=True).strip()
    report = json.loads((directory / 'report.json').read_text())
    acceptance = report['acceptance']
    check(report['status'] == acceptance['status'] == 'passed' and
          report['task'] == 'E6-T12g6m5b2b1' and
          report['gitHead'] == head and
          report['trackedChanges'] == [] and
          report['browserErrors'] == {'console': [], 'page': [], 'requests': []} and
          acceptance['fault'] is None and
          acceptance['maxAllowedDeltaError'] == .1 and
          acceptance['observedDomain'] == 'positive normal on this renderer and recorded draw only' and
          acceptance['portableDomain'].startswith('not certified:') and
          acceptance['compilerAuthority'] is False and
          acceptance['productionDrawAuthority'] is False and
          len(acceptance['banks']) == 3,
          'exact-head physical browser evidence scope')
    check(sha(VERTEX.read_bytes()) == VERTEX.stem and
          sha(FRAGMENT.read_bytes()) == FRAGMENT.stem,
          'full original paired source identity')
    listed_sources = {row['path']: row['sha256'] for row in report['sources']}
    listed_served = {row['path']: row['sha256'] for row in report['servedFiles']}
    for path in [VERTEX, FRAGMENT,
                 ROOT / 'renderer/virgl-shader/tests/original-92cb-power-domain.mjs',
                 ROOT / 'renderer/virgl-shader/index.mjs']:
        relative = path.relative_to(ROOT).as_posix()
        check(listed_sources[relative] == sha(path.read_bytes()) and
              listed_served[relative] == sha(path.read_bytes()),
              'recorded and served full original physical shader source')
    raster = json.loads((RASTER / 'raster.json').read_text())
    binary = (RASTER / 'geometry.bin').read_bytes()
    check(raster['draws'] == 1957 and
          raster['geometryBinarySha256'] == sha(binary) and
          raster['numericCompilerAuthority'] is False,
          'verified original raster predecessor')
    for name, raw in [('geometry.bin', binary),
                      ('raster.json', (RASTER / 'raster.json').read_bytes())]:
        relative = f'target/evidence/virgl-92cb-raster/{name}'
        check(listed_sources[relative] == listed_served[relative] == sha(raw),
              'recorded original predecessor bytes served to physical draw')
    check('Apple M4 Max' in acceptance['renderer'] and
          all(acceptance['precision'][stage]['precision'] >= 23
              for stage in ('vertex', 'fragment')) and
          report['browser']['gpu']['featureStatus'][report['browser']['webglFeature']] == 'enabled',
          'physical highp renderer and browser GPU')
    module_path = ROOT / 'renderer/virgl-shader/tests/original-92cb-power-domain.mjs'
    module = module_path.read_text()
    marker = 'const probe=`'
    check(module.count(marker) == 1, 'unambiguous probe GLSL source')
    PROBE_SHA = sha(module.split(marker, 1)[1].split('`;', 1)[0].encode())
    results = []
    for index, (row, pair) in enumerate(zip(acceptance['banks'], geometry(binary))):
        check(row['bank'] == index, 'ordered original physical bank')
        results.append(inspect_bank(row, *pair))
    check([row['branches'] for row in results] == [16, 0, 16] and
          sum(row['covered'] for row in results) == 1612644,
          'complete original active and inactive physical pixel set')
    native = (directory.parent / 'native.out').read_text()
    check(native == (directory.parent / 'wasm.out').read_text(),
          'native/Wasm original ideal-center identity')
    native_lines = [line.split() for line in native.splitlines() if line.startswith('BANK ')]
    check(len(native_lines) == 3 and
          [(int(words[1]), int(words[3]), int(words[5])) for words in native_lines] ==
          [(row['bank'], row['covered'], row['branches']) for row in results],
          'native/Wasm and physical original coverage/branch agreement')
    fault_messages = {
        'source': 'complete original vertex/fragment source SHA',
        'bank': 'original center and square exponent',
        'negative': 'finite positive original numeric coefficient and center',
        'nonfinite': 'finite positive original numeric coefficient and center',
        'geometry': 'interpolation/arithmetic gap',
        'viewport': 'interpolation/arithmetic gap',
        'zero-crossing': 'positive-normal original power input',
    }
    for fault, message in fault_messages.items():
        failed = json.loads((directory.parent / f'fault-{fault}/report.json').read_text())
        check(failed['status'] == 'failed' and message in failed['failure']['message'] and
              failed['gitHead'] == head and failed['trackedChanges'] == [],
              f'physical original {fault} fault rejected at exact head')
    native_fault_messages = {
        'bank': 'original center and exact-square exponent',
        'negative': 'finite positive original axis geometry',
        'nonfinite': 'finite original geometric/fragment word',
        'geometry': 'exact original four-vertex strip',
        'zero-crossing': 'ideal original first-power base envelope',
    }
    for fault, message in native_fault_messages.items():
        check(message in (directory.parent / f'native-fault-{fault}.log').read_text(),
              f'native original {fault} fault rejected')
    check(sha((directory / 'browser.png').read_bytes()) == report['screenshot']['sha256'] and
          sha((directory / 'browser-coverage.json').read_bytes()) ==
          report['browserCoverage']['sha256'],
          'recorded physical browser image and coverage')
    (directory / 'physical-audit.json').write_text(json.dumps({
        'schema': 'virgl-original-92cb-physical-audit-v1',
        'status': 'passed', 'gitHead': head,
        'readbackSha256': [row['readbackSha256'] for row in acceptance['banks']],
        'results': results}, indent=2) + '\n')
    files = ['predecessor.log', 'geometry.bin', 'native-build.log', 'native.out',
             'wasm-build.log', 'production-wasm-build.log', 'wasm.out', 'native-coverage.json',
             'browser/report.json', 'browser/browser.png',
             'browser/browser-coverage.json', 'browser/physical-audit.json']
    for fault in fault_messages:
        files.extend([f'fault-{fault}.log', f'fault-{fault}/report.json'])
    for fault in native_fault_messages:
        files.extend([f'native-fault-{fault}.log', f'native-fault-{fault}.bin'])
    sources = ['Makefile', 'renderer/virgl-shader/build.sh',
               'renderer/virgl-shader/native_tests/original_92cb_power_domain.c',
               'renderer/virgl-shader/tests/original-92cb-power-domain.mjs',
               'tools/verify-virgl-original-92cb-power-domain.sh',
               'tools/virgl-92cb-power-domain/browser.mjs',
               'tools/virgl-92cb-power-domain/faults.py',
               'tools/virgl-92cb-power-domain/receipt.py',
               'tools/virgl-92cb-power-domain/cold.py',
               'tools/virgl-92cb-power-domain/seal.py',
               'tools/virgl-92cb-power-domain/README.md',
               'tasks/epic-6-transcendence/E6-T12g6m5b2b1-92cb-physical-power-domain.md']
    generated = ['renderer/virgl-shader/build/original-92cb-power-domain-sanitize/original-92cb-power-domain-test',
                 'renderer/virgl-shader/build/original-92cb-power-domain-wasm/original-92cb-power-domain.js',
                 'renderer/virgl-shader/build/original-92cb-power-domain-wasm/original-92cb-power-domain.wasm',
                 'renderer/virgl-shader/build/wasm/virgl-shader.mjs',
                 'renderer/virgl-shader/build/wasm/virgl-shader.wasm']
    receipt = {'schema': 'virgl-original-92cb-physical-power-receipt-v1',
               'task': 'E6-T12g6m5b2b1', 'status': 'passed', 'gitHead': head,
               'observedPixels': 1612644, 'portableDomainCertified': False,
               'compilerAuthority': False, 'productionDrawAuthority': False,
               'files': {name: sha((directory.parent / name).read_bytes()) for name in files},
               'sources': {name: sha((ROOT / name).read_bytes()) for name in sources},
               'generated': {name: sha((ROOT / name).read_bytes()) for name in generated}}
    (directory.parent / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('1,612,644 original physical float pixels independently replayed')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
