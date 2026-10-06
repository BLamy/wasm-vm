#!/usr/bin/env python3
"""Independently re-read original packets and exact center arithmetic."""
from collections import Counter
from fractions import Fraction
import gzip
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
CAPTURE = ROOT / 'evidence/virgl-workload-inventory/captures/es2gears'
sys.path.insert(0, str(ROOT / 'tools/virgl-capture'))
from validate import COMMANDS, OBJECTS, validate_capture  # noqa: E402


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def check(condition, reason):
    if not condition:
        raise AssertionError(reason)


def original_blob(reference):
    raw = gzip.decompress((CAPTURE / 'blobs' / (reference['sha256'] + '.bin.gz')).read_bytes())
    check(len(raw) == reference['bytes'] and sha(raw) == reference['sha256'],
          'independent original raster blob authentication')
    return raw


def packets(event):
    reference = event['blobs'][0]
    raw = original_blob(reference)
    at = 0
    while at < len(raw):
        check(at + 4 <= len(raw), 'bounded original packet header')
        header, = struct.unpack_from('<I', raw, at)
        opcode, kind, length = header & 255, (header >> 8) & 255, header >> 16
        end = at + 4 * (length + 1)
        check(opcode in COMMANDS and kind in OBJECTS and end <= len(raw),
              'complete original raster packet')
        words = struct.unpack_from('<' + 'I' * (length + 1), raw, at)
        citation = {'event': event['seq'], 'blobSha256': reference['sha256'],
                    'offset': at, 'packetSha256': sha(raw[at:end])}
        yield COMMANDS[opcode], OBJECTS[kind], words, citation
        at = end


def surface(handle, objects, resources, expected):
    check(handle > 0 and ('SURFACE', handle) in objects, 'live ordinary surface')
    words, cited = objects['SURFACE', handle]
    check(len(words) == 6 and tuple(words[3:]) == (expected[1], 0, 0),
          'exact original surface level/layer/format')
    resource = resources.get(words[2])
    check(resource is not None and
          tuple(resource[name] for name in ('target', 'format', 'width', 'height',
                                           'nrSamples', 'flags')) == expected,
          'live single-sample framebuffer resource')
    return {'handle': handle, 'resourceId': words[2], 'surfaceCreate': cited,
            'resourceCreateEvent': resource['seq']}


def replay(report, predecessor):
    check(report['draws'] == 1957 and len(report['drawCitations']) == 1957,
          'complete recorded original raster draw set')
    resources, objects = {}, {}
    sub, shader, viewport, framebuffer = 0, [None, None], None, None
    count = 0
    color_ids, depth_ids, viewport_ids, framebuffer_ids = Counter(), Counter(), Counter(), set()
    for line in (CAPTURE / 'events.jsonl').read_bytes().splitlines():
        event = json.loads(line)
        if event['type'] == 'resource_create' and event.get('phase') == 'enter':
            rid = event['resourceId']
            check(rid not in resources, 'resource lifetime does not overlap reuse')
            resources[rid] = event
        elif event['type'] == 'resource_unref' and event.get('phase') == 'enter':
            check(event['resourceId'] in resources, 'resource unref was live')
            del resources[event['resourceId']]
        if event['type'] != 'submit_cmd' or event.get('phase') != 'enter' or event.get('ctxId') != 5:
            continue
        for name, kind, words, cite in packets(event):
            if name == 'SET_SUB_CTX':
                sub = words[1]
            elif name == 'DESTROY_SUB_CTX' and words[1] == 2:
                objects = {}; shader = [None, None]
                viewport = framebuffer = None
            elif sub == 2:
                if name == 'CREATE_OBJECT' and kind in ('SURFACE', 'MSAA_SURFACE'):
                    check((kind, words[1]) not in objects, 'surface handle not reused live')
                    objects[kind, words[1]] = (words, cite)
                elif name == 'DESTROY_OBJECT' and kind in ('SURFACE', 'MSAA_SURFACE'):
                    check((kind, words[1]) in objects, 'destroy original live surface')
                    del objects[kind, words[1]]
                elif name == 'BIND_SHADER' and words[2] in (0, 1):
                    shader[words[2]] = words[1]
                elif name == 'SET_VIEWPORT_STATE':
                    viewport = (words, cite)
                elif name == 'SET_FRAMEBUFFER_STATE':
                    framebuffer = (words, cite)
                elif name == 'DRAW_VBO' and shader == [439, 440]:
                    check(count < 1957, 'no extra original draw')
                    row = report['drawCitations'][count]
                    check(row['draw'] == cite and
                          row['pairSha256'] == predecessor['drawCitations'][count]['pairSha256'],
                          'reported draw order and authenticated bank are original')
                    check(viewport and row['viewport'] == viewport[1] and
                          tuple(viewport[0][1:]) == tuple(report['viewportWords']) and
                          tuple(report['viewportWords']) ==
                          (0, 0x44000000, 0x43c00000, 0x3f000000,
                           0x44000000, 0x43c00000, 0x3f000000) and
                          viewport[1] == report['viewportPacket'],
                          'original viewport packet is live at every draw')
                    check(framebuffer and len(framebuffer[0]) == 4 and
                          framebuffer[0][1] == 1 and row['framebuffer'] == framebuffer[1],
                          'one-color framebuffer packet is live at every draw')
                    color = surface(framebuffer[0][3], objects, resources,
                                    (2, 67, 1024, 768, 0, 0))
                    depth = (surface(framebuffer[0][2], objects, resources,
                                     (2, 20, 1024, 768, 0, 0))
                             if framebuffer[0][2] else None)
                    check(row['color'] == color and row['depth'] == depth and
                          ('MSAA_SURFACE', framebuffer[0][3]) not in objects,
                          'live ordinary single-sample color/depth attachments')
                    color_ids[color['resourceId']] += 1
                    if depth:
                        depth_ids[depth['resourceId']] += 1
                    viewport_ids[viewport[1]['packetSha256']] += 1
                    framebuffer_ids.add((framebuffer[1]['event'], framebuffer[1]['offset']))
                    count += 1
    check(count == 1957 and color_ids == Counter({21: 1953, 72: 4}) and
          depth_ids == Counter({20: 1953}) and len(viewport_ids) == 1 and
          report['viewportPacketDraws'] == dict(viewport_ids) and
          report['colorResourceDraws'] == dict(color_ids) and
          report['depthResourceDraws'] == dict(depth_ids) and
          len(framebuffer_ids) == 400 and report['framebufferPackets'] == 400,
          'original complete viewport/framebuffer replay')


def exact_float(word):
    value, = struct.unpack('<f', struct.pack('<I', word))
    check(value == value and abs(value) != float('inf'), 'finite original transform word')
    return Fraction(*value.as_integer_ratio())


def check_envelopes(report, predecessor, binary, native):
    check(binary[:4] == b'G921' and struct.unpack_from('<I', binary, 4)[0] == 3,
          'original three-bank geometry header')
    lines = native.splitlines()
    check(len(lines) == 7 and lines[-1] == 'STATUS passed; no shader or future-DRAW authority',
          'complete recorded numerical auditor')
    pattern = re.compile(r'BANK (\d) AXIS (\d) COVERED (\d+) NEAREST (\d+) MIN_MICRO (\d+) '
                         r'MAX_MICRO (\d+) BRANCH (\d+) BRANCH_MAX_MICRO (\d+)')
    for bank, item in enumerate(report['banks']):
        check(item['pairSha256'] == predecessor['pairs'][bank]['sha256'] and
              item['draws'] == predecessor['pairs'][bank]['draws'],
              'complete original paired bank identity and draw count')
        vertex = struct.unpack_from('<16I', binary, 72 + bank * 656)
        fragment = struct.unpack_from('<148I', binary, 136 + bank * 656)
        for axis, dimension in ((0, 1024), (1, 768)):
            match = pattern.fullmatch(lines[bank * 2 + axis])
            check(match is not None and tuple(map(int, match.group(1, 2))) == (bank, axis),
                  'native/Wasm bank/axis order')
            observed = tuple(map(int, match.groups()[2:]))
            scale = Fraction(512 if axis == 0 else 384)
            offset = exact_float(vertex[8 + axis])
            diagonal = exact_float(vertex[0 if axis == 0 else 5])
            cross = exact_float(vertex[4 if axis == 0 else 1])
            check(cross == 0 and diagonal > 0, 'independent original axis transform')
            first = scale * (offset + 1)
            last = scale * (offset + diagonal + 1)
            coefficient = exact_float(fragment[16 + axis])
            center = exact_float(fragment[axis])
            covered = []
            for pixel in range(dimension):
                window = Fraction(2 * pixel + 1, 2)
                if first <= window <= last:
                    value = coefficient * (window - first) / (last - first)
                    covered.append((abs(value - center), pixel, value))
            check(covered, 'nonempty original covered centers')
            closest = min(covered)
            branch = [value for _, _, value in covered if value < center]
            minimum, nearest = closest[:2]
            maximum = max(value for value, _, _ in covered)
            branch_maximum = max((center - value for value in branch), default=Fraction(0))
            check(minimum > Fraction(49, 100), 'exact ideal center gap above .49')
            expected = (len(covered), nearest, int(minimum * 1000000),
                        int(maximum * 1000000), len(branch), int(branch_maximum * 1000000))
            check(all(abs(a - b) <= (1 if i in (2, 3, 5) else 0)
                      for i, (a, b) in enumerate(zip(observed, expected))),
                  'independent rational envelope matches native/Wasm')
            axis_report = item['axis'][axis]
            check(axis_report['nearestPixel'] == nearest and
                  axis_report['coveredCenterCount'] == len(covered) and
                  axis_report['branchCenterCount'] == len(branch) and
                  all(abs(axis_report[name] - float(value)) < 1e-9 for name, value in (
                      ('windowStart', first), ('windowEnd', last),
                      ('nearestCoordinate', closest[2]),
                      ('minimumIdealBase', minimum),
                      ('maximumIdealBase', maximum),
                      ('branchMaximumIdealBase', branch_maximum))),
                  'producer center inventory matches rational replay')


def main(directory):
    check(not subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=ROOT, text=True).strip(),
          'exact-head tracked source required')
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    validate_capture(CAPTURE)
    report = json.loads((directory / 'raster.json').read_text())
    binary = (directory / 'geometry.bin').read_bytes()
    predecessor = json.loads((ROOT / 'target/evidence/virgl-92cb-geometry/geometry.json').read_text())
    check(report['schema'] == 'virgl-original-92cb-raster-v1' and
          report['sourceEventsSha256'] == sha((CAPTURE / 'events.jsonl').read_bytes()) and
          report['geometryBinarySha256'] == sha(binary) == predecessor['binarySha256'] and
          report['singleSampleCenterRule'] == 'GLSL ES 3.00 section 4.3.9' and
          report['numericCompilerAuthority'] is False and
          report['productionDrawAuthority'] is False,
          'original raster evidence scope and sources')
    replay(report, predecessor)
    native = (directory / 'native.out').read_text()
    check(native == (directory / 'wasm.out').read_text(), 'native/Wasm numerical identity')
    check_envelopes(report, predecessor, binary, native)
    files = ['raster.json', 'geometry.bin', 'predecessor.log', 'capture.log', 'native-build.log',
             'native.out', 'wasm-build.log', 'wasm.out', 'viewport-fault.log',
             'sample-fault.log', 'bank-fault.log', 'native-coverage.json']
    sources = ['Makefile', 'renderer/virgl-shader/build.sh',
               'renderer/virgl-shader/native_tests/original_92cb_raster.c',
               'tools/verify-virgl-original-92cb-raster.sh',
               'tools/virgl-92cb-raster/capture.py',
               'tools/virgl-92cb-raster/faults.py',
               'tools/virgl-92cb-raster/receipt.py',
               'tools/virgl-92cb-raster/README.md',
               'tools/virgl-92cb-raster/cold.py',
               'tools/virgl-92cb-raster/seal.py',
               'tasks/epic-6-transcendence/E6-T12g6m5b2a-92cb-raster-provenance.md']
    generated = ['renderer/virgl-shader/build/original-92cb-raster-sanitize/original-92cb-raster-test',
                 'renderer/virgl-shader/build/original-92cb-raster-wasm/original-92cb-raster.js',
                 'renderer/virgl-shader/build/original-92cb-raster-wasm/original-92cb-raster.wasm']
    receipt = {'schema': 'virgl-original-92cb-raster-receipt-v1',
               'task': 'E6-T12g6m5b2a', 'status': 'passed', 'gitHead': head,
               'draws': 1957, 'framebufferPackets': 400,
               'files': {name: sha((directory / name).read_bytes()) for name in files},
               'sources': {name: sha((ROOT / name).read_bytes()) for name in sources},
               'generated': {name: sha((ROOT / name).read_bytes()) for name in generated},
               'numericCompilerAuthority': False, 'productionDrawAuthority': False}
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('1957 original single-sample raster draws; rational center envelopes; no compiler authority')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
