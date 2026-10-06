#!/usr/bin/env python3
"""Independently replay every private pc0..222 physical float readback."""
import base64
import gzip
import json
from pathlib import Path
import subprocess
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from receipt import WIDTH, HEIGHT, axis_values, check, geometry, sha  # noqa: E402

VERTEX = ROOT / ('evidence/virgl-workload-inventory/captures/es2gears/shaders/'
                 '7bf4d0d0f981a9feb958d6595302b15d564fc846e6d5ee71874f0921b31e613e.tgsi')
FRAGMENT = ROOT / ('evidence/virgl-workload-inventory/captures/es2gears/shaders/'
                   '92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi')
GEOMETRY = ROOT / 'target/evidence/virgl-92cb-raster/geometry.bin'
RASTER = ROOT / 'target/evidence/virgl-92cb-raster/raster.json'
GEOMETRY_SHA = '0d8bf78697b9be39a58c9274e221a89a9903f8587dfa2cf5cf5b754ae82e27ac'


def inspect_bank(row, vertex, fragment, index):
    cert = row['certificate']
    check(cert == {'kind': 'original-92cb-pc221-222-v1', 'bank': index,
                   'completeVertexSha256': VERTEX.stem,
                   'completeFragmentSha256': FRAGMENT.stem,
                   'geometrySha256': GEOMETRY_SHA,
                   'viewport': [0, 0, WIDTH, HEIGHT], 'samples': 0,
                   'colorFormat': 34836, 'mode': 5, 'first': 0, 'count': 4,
                   'drawTimeRecheckRequired': True, 'productionDrawAuthority': False},
          'complete source/bank/geometry and conditional draw certificate')
    attributes = {item['name']: item['location'] for item in row['attributes']}
    expected_attributes = [
        {'location': attributes[name], 'offset': offset, 'enabled': True,
         'size': 2, 'type': 5126, 'normalized': False, 'stride': 16,
         'divisor': 0, 'bufferMatches': True, 'expectedOffset': offset}
        for name, offset in [('in_0', 0), ('in_1', 8)]]
    check(row['boundVertexWords'] == list(vertex) and
          row['boundFragmentWords'] == list(fragment) and
          row['boundAttributes'] == expected_attributes and
          row['attachment'] == {'objectType': 5890, 'textureMatches': True,
                                'componentType': 5126,
                                'channelBits': [32, 32, 32, 32]},
          'reflected physical uniforms, VAO and float attachment match the certified draw')
    check(row['vertexGlslSha256'] == sha(row['vertexGlsl'].encode()) and
          row['fragmentGlslSha256'] == sha(row['fragmentGlsl'].encode()) and
          row['fragmentGlsl'].count('pow(') >= 2 and
          'fsout_c0' in row['fragmentGlsl'] and
          row['fragmentMetadata']['stage'] == 'fragment' and
          row['fragmentMetadata']['profile'] == 'virgl-webgl2-raw-bits-v42' and
          row['fragmentMetadata']['samplers'] == [] and
          row['fragmentMetadata']['uniforms'] == [
              {'name': 'fsconst0', 'type': 'uvec4[]', 'count': 37,
               'encoding': 'float32-bits'}] and
          row['vertexMetadata']['stage'] == 'vertex' and
          any(item['name'] == 'vso_g0' and item['interpolation'] == 'smooth'
              for item in row['vertexMetadata']['outputs']) and
          {item['name']: (item['size'], item['type']) for item in row['uniforms']}.items() >=
          {'vsconst0[0]': (4, 36296), 'fsconst0[0]': (37, 36296)}.items() and
          {item['name'] for item in row['attributes']} == {'in_0', 'in_1'} and
          all(item['type'] == 35666 for item in row['attributes']) and
          len(row['blocks']) == 1 and
          row['blocks'][0]['members'][0]['name'] == 'winsys_adjust_y' and
          row['blocks'][0]['members'][0]['value'] == 1 and
          row['drawState'] == {'viewport': [0, 0, WIDTH, HEIGHT],
                               'samples': 0, 'framebufferStatus': 36053,
                               'colorFormat': 34836, 'mode': 5, 'count': 4} and
          row['rendererAtDraw'] == 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)' and
          row['precisionAtDraw'] == {
              'vertex': {'rangeMin': 127, 'rangeMax': 127, 'precision': 23},
              'fragment': {'rangeMin': 127, 'rangeMax': 127, 'precision': 23}} and
          row['logs'] == {'vertex': '', 'fragment': '', 'link': ''},
          'generated and reflected original prefix program')
    zipped = base64.b64decode(row['readbackGzipBase64'], validate=True)
    check(sha(zipped) == row['readbackGzipSha256'], 'compressed physical readback digest')
    raw = gzip.decompress(zipped)
    check(len(raw) == WIDTH * HEIGHT * 16 and sha(raw) == row['readbackSha256'],
          'complete unmodified physical float readback')
    xs = axis_values(vertex, fragment, 0, WIDTH)
    ys = axis_values(vertex, fragment, 1, HEIGHT)
    covered = branches = 0
    minimum, maximum = float('inf'), 0.0
    active_minimum, active_maximum = float('inf'), 0.0
    max_error = max_relative = 0.0
    samples = []
    for y, ideal_y in enumerate(ys):
        for x, ideal_x in enumerate(xs):
            dx, dy, px, py = struct.unpack_from('<4f', raw, (y * WIDTH + x) * 16)
            if ideal_x is None or ideal_y is None:
                check((dx, dy, px, py) == (-10000.0,) * 4,
                      f'uncovered original prefix pixel bank{index} ({x},{y})')
                continue
            covered += 1
            for ideal in (ideal_x, ideal_y):
                base = abs(ideal)
                check(.49 < base <= 2048, f'ideal first-power base bank{index} ({x},{y})')
                minimum = min(minimum, base)
                maximum = max(maximum, base)
            if ideal_x < 0 and ideal_y < 0:
                branches += 1
                check(dx < 0 and dy < 0, f'active original branch bank{index} ({x},{y})')
                for actual, ideal, power in ((dx, ideal_x, px), (dy, ideal_y, py)):
                    error = abs(actual - ideal)
                    base = abs(actual)
                    relative = abs(power - base * base) / (base * base)
                    check(error < .1 and .25 < base <= 2048 and
                          power >= 0 and power != float('inf') and relative <= 1 / 16384,
                          f'original first POW bank{index} ({x},{y})')
                    max_error = max(max_error, error)
                    max_relative = max(max_relative, relative)
                    active_minimum = min(active_minimum, base)
                    active_maximum = max(active_maximum, base)
            else:
                check((dx, dy, px, py) == (0.0,) * 4,
                      f'inactive original branch bank{index} ({x},{y})')
            if ((abs(ideal_x) < 6 and abs(ideal_y) < 6) or
                    (x in (0, WIDTH // 2, WIDTH - 1) and
                     y in (0, HEIGHT // 2, HEIGHT - 1))):
                samples.append((x, y, (dx, dy, px, py), (ideal_x, ideal_y)))
    check(row['covered'] == covered and row['branches'] == branches and
          abs(row['minimum'] - minimum) < 1e-4 and
          abs(row['maximum'] - maximum) < 1e-4,
          'independent coverage and ideal extrema')
    check((abs(row['activeMinimum'] - active_minimum) < 1e-6 if branches else
           row['activeMinimum'] is None),
          'independent active minimum')
    check(abs(row['maxDeltaError'] - max_error) < 1e-4 and
          abs(row['maxPowerRelativeError'] - max_relative) < 1e-12 and
          (abs(row['activeMaximum'] - active_maximum) < 1e-6 if branches else
           row['activeMaximum'] is None) and len(row['samples']) == len(samples),
          'independent maximum and physical power reductions')
    for observed, expected in zip(row['samples'], samples):
        x, y, actual, ideal = expected
        check((observed['x'], observed['y']) == (x, y) and
              observed['actual'] == list(actual) and
              all(abs(a - b) < 1e-4 for a, b in zip(observed['ideal'], ideal)),
              'independent original boundary samples')
    return {'bank': index, 'covered': covered, 'branches': branches,
            'idealMinimum': minimum, 'activeMinimum': active_minimum if branches else None,
            'maxDeltaError': max_error, 'maxPowerRelativeError': max_relative,
            'readbackSha256': row['readbackSha256']}


def main(directory):
    check(not subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'],
                                      cwd=ROOT, text=True).strip(),
          'exact-head tracked source required')
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    report = json.loads((directory / 'report.json').read_text())
    accepted = report['acceptance']
    check(report['status'] == accepted['status'] == 'passed' and
          report['task'] == 'E6-T12g6m5b2b2' and report['gitHead'] == head and
          report['trackedChanges'] == [] and
          report['browserErrors'] == {'console': [], 'page': [], 'requests': []} and
          accepted['fault'] is None and accepted['guestExecution'] is False and
          accepted['productionDrawAuthority'] is False and
          accepted['compilerAuthority'] == 'conditional pc221/222 prefix only' and
          len(accepted['banks']) == 3 and
          accepted['renderer'] == 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)' and
          accepted['precision'] == {
              'vertex': {'rangeMin': 127, 'rangeMax': 127, 'precision': 23},
              'fragment': {'rangeMin': 127, 'rangeMax': 127, 'precision': 23}} and
          report['browser']['gpu']['featureStatus'][report['browser']['webglFeature']] == 'enabled',
          'exact-head physical private compiler evidence scope')
    check(sha(VERTEX.read_bytes()) == VERTEX.stem and
          sha(FRAGMENT.read_bytes()) == FRAGMENT.stem and
          sha(GEOMETRY.read_bytes()) == GEOMETRY_SHA and
          json.loads(RASTER.read_text())['geometryBinarySha256'] == GEOMETRY_SHA and
          (directory.parent / 'geometry.bin').read_bytes() == GEOMETRY.read_bytes() and
          (directory.parent / 'raster.json').read_bytes() == RASTER.read_bytes(),
          'verified complete original source and geometry')
    listed_sources = {row['path']: row['sha256'] for row in report['sources']}
    listed_served = {row['path']: row['sha256'] for row in report['servedFiles']}
    for path in [VERTEX, FRAGMENT, GEOMETRY, RASTER,
                 ROOT / 'renderer/virgl-shader/tests/original-92cb-private-power.mjs',
                 ROOT / 'renderer/virgl-shader/index.mjs']:
        relative = path.relative_to(ROOT).as_posix()
        check(listed_sources[relative] == listed_served[relative] == sha(path.read_bytes()),
              'recorded and served complete original private inputs')
    results = [inspect_bank(row, vertex, fragment, index)
               for index, (row, (vertex, fragment)) in enumerate(
                   zip(accepted['banks'], geometry(GEOMETRY.read_bytes())))]
    check([row['branches'] for row in results] == [16, 0, 16] and
          sum(row['covered'] for row in results) == 1612644,
          'all original active and inactive physical pixels')
    native = (directory.parent / 'native.out').read_text()
    check(native == (directory.parent / 'wasm.out').read_text() and
          native.count('BANK ') == 3 and
          'STATUS passed; conditional private prefix only' in native,
          'native/Wasm private compiler identity and full-original rejection')
    fault_messages = {
        'source': 'complete original vertex/fragment source SHA',
        'bank': 'original center and square exponent',
        'negative': 'finite positive original numeric coefficient and center',
        'nonfinite': 'finite positive original numeric coefficient and center',
        'geometry': 'exact original four-vertex position/UV strip',
        'zero-crossing': 'authenticated private original prefix',
        'post-source': 'draw-time compiler certificate',
        'post-bank': 'draw-time compiler certificate',
        'post-geometry': 'draw-time compiler certificate',
        'post-parsed-bank': 'owned quad and both bound stage banks',
        'post-parsed-quad': 'owned quad and both bound stage banks',
        'post-sample': 'draw-time compiler certificate',
        'viewport': 'physical WebGL2 draw state still satisfies private certificate',
        'post-bound-exponent': 'bound physical fsconst0 words still equal the certified bank',
        'post-bound-vertex': 'bound physical vsconst0 words still equal the certified bank',
        'post-bound-attribute': 'physical VAO input bindings still equal the certified original quad',
        'post-bound-color': 'physical float framebuffer attachment still satisfies private certificate',
    }
    for fault, message in fault_messages.items():
        failed = json.loads((directory.parent / f'fault-{fault}/report.json').read_text())
        check(failed['status'] == 'failed' and failed['gitHead'] == head and
              failed['trackedChanges'] == [] and message in failed['failure']['message'],
              f'private {fault} fault rejected at the expected boundary')
    check(sha((directory / 'browser.png').read_bytes()) == report['screenshot']['sha256'] and
          sha((directory / 'browser-coverage.json').read_bytes()) ==
          report['browserCoverage']['sha256'],
          'recorded private physical image and browser coverage')
    (directory / 'physical-audit.json').write_text(json.dumps({
        'schema': 'virgl-original-92cb-private-power-audit-v1',
        'status': 'passed', 'gitHead': head, 'results': results}, indent=2) + '\n')
    files = ['predecessor.log', 'geometry.bin', 'raster.json',
             'native-build.log', 'native.out', 'wasm-build.log',
             'production-wasm-build.log', 'wasm.out', 'native.profraw',
             'native.profdata', 'native-coverage.json', 'browser/report.json',
             'browser/browser.png', 'browser/browser-coverage.json',
             'browser/physical-audit.json']
    for fault in fault_messages:
        files.extend([f'fault-{fault}.log', f'fault-{fault}/report.json'])
    sources = ['Makefile', 'renderer/virgl-shader/bridge.c',
               'renderer/virgl-shader/bridge.h', 'renderer/virgl-shader/raw_bits.c',
               'renderer/virgl-shader/raw_bits.h', 'renderer/virgl-shader/build.sh',
               'renderer/virgl-shader/index.mjs',
               'renderer/virgl-shader/private_92cb_inputs.h',
               'renderer/virgl-shader/native_tests/original_92cb_private_power.c',
               'renderer/virgl-shader/tests/original-92cb-private-power.mjs',
               'tools/verify-virgl-original-92cb-private-power.sh',
               'tools/virgl-92cb-power-domain/pin_private_inputs.py',
               'tools/virgl-92cb-power-domain/private_browser.mjs',
               'tools/virgl-92cb-power-domain/private_receipt.py',
               'tools/virgl-92cb-power-domain/receipt.py',
               'tools/virgl-92cb-power-domain/private_cold.py',
               'tools/virgl-92cb-power-domain/private_seal.py',
               'tasks/epic-6-transcendence/E6-T12g6m5b2b2-92cb-private-power-compiler.md']
    generated = ['renderer/virgl-shader/build/original-92cb-private-power-sanitize/original-92cb-private-power-test',
                 'renderer/virgl-shader/build/original-92cb-private-power-wasm/original-92cb-private-power.js',
                 'renderer/virgl-shader/build/original-92cb-private-power-wasm/original-92cb-private-power.wasm',
                 'renderer/virgl-shader/build/wasm/virgl-shader.mjs',
                 'renderer/virgl-shader/build/wasm/virgl-shader.wasm']
    receipt = {'schema': 'virgl-original-92cb-private-power-receipt-v1',
               'task': 'E6-T12g6m5b2b2', 'status': 'passed', 'gitHead': head,
               'observedPixels': 1612644, 'compilerAuthority': 'private-pc221-222',
               'productionDrawAuthority': False,
               'files': {name: sha((directory.parent / name).read_bytes()) for name in files},
               'sources': {name: sha((ROOT / name).read_bytes()) for name in sources},
               'generated': {name: sha((ROOT / name).read_bytes()) for name in generated}}
    (directory.parent / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('1,612,644 original private-prefix pixels independently replayed')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
