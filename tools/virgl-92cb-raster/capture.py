#!/usr/bin/env python3
"""Replay original compositor raster state; emit facts, never shader authority."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/virgl-92cb-geometry'))
from capture import CAPTURE, blob, citation, require, sha  # noqa: E402
sys.path.insert(0, str(ROOT / 'tools/virgl-capture'))
from validate import COMMANDS, OBJECTS, validate_capture  # noqa: E402

VIEWPORT = (0, 0x44000000, 0x43c00000, 0x3f000000,
            0x44000000, 0x43c00000, 0x3f000000)
RESOURCE = (2, 67, 1024, 768, 0, 0)  # target, format, width, height, samples, flags
DEPTH = (2, 20, 1024, 768, 0, 0)


def packet_rows(data, event, reference):
    offset = 0
    while offset < len(data):
        require(offset + 4 <= len(data), 'complete raster packet header')
        header, = struct.unpack_from('<I', data, offset)
        opcode, kind, length = header & 255, (header >> 8) & 255, header >> 16
        end = offset + 4 * (length + 1)
        require(opcode in COMMANDS and kind in OBJECTS and end <= len(data),
                'bounded raster packet')
        words = struct.unpack_from('<' + 'I' * (length + 1), data, offset)
        yield COMMANDS[opcode], OBJECTS[kind], words, citation(event, reference, offset, data[offset:end])
        offset = end


def resource_shape(event):
    return tuple(event[name] for name in ('target', 'format', 'width', 'height',
                                          'nrSamples', 'flags'))


def live_surface(objects, resources, handle, expected, role):
    require(handle > 0, role + ' surface bound')
    surface = objects.get(('SURFACE', handle))
    require(surface is not None, role + ' surface object live')
    words, created = surface
    require(len(words) == 6 and words[3:] ==
            (expected[1], 0, 0), role + ' surface format, level and layer')
    resource = resources.get(words[2])
    require(resource is not None and resource_shape(resource) == expected,
            role + ' single-sample resource lifetime and extent')
    return {'handle': handle, 'resourceId': words[2], 'surfaceCreate': created,
            'resourceCreateEvent': resource['seq']}


def axis_envelope(v, f, axis, dimension):
    # Literal vertex pc0..4 sets clip W=1 and an axis-aligned affine position.
    # Single-sample smooth interpolation is at (pixel + 0.5) under ES 3.00.
    viewport_scale = 512.0 if axis == 0 else 384.0
    start = viewport_scale * v[8 + axis] + viewport_scale
    end = viewport_scale * (v[axis if axis == 0 else 5] + v[8 + axis]) + viewport_scale
    require(0.0 < end - start < 2048.0, 'finite positive original window span')
    covered = [(pixel, f[16 + axis] * ((pixel + .5 - start) / (end - start)))
               for pixel in range(dimension) if start <= pixel + .5 <= end]
    require(covered, 'original quad covers a sample center')
    distances = [(abs(value - f[axis]), pixel, value) for pixel, value in covered]
    distance, pixel, value = min(distances)
    require(distance > .49, 'ideal center separated from first-power zero')
    # Only pc216/217's two ordered tests enter pc221/222. The branch can
    # further shrink the envelope to [0,4]; this list is a center oracle.
    active = [(pixel, value) for pixel, value in covered if value < f[axis]]
    return {'windowStart': start, 'windowEnd': end,
            'coveredCenterCount': len(covered), 'nearestPixel': pixel,
            'nearestCoordinate': value, 'minimumIdealBase': distance,
            'maximumIdealBase': max(row[0] for row in distances),
            'branchCenterCount': len(active),
            'branchMaximumIdealBase': max((f[axis] - val for _, val in active), default=0.0)}


def main(output):
    validate_capture(CAPTURE)
    previous = ROOT / 'target/evidence/virgl-92cb-geometry'
    geometry = json.loads((previous / 'geometry.json').read_text())
    raw = (previous / 'geometry.bin').read_bytes()
    require(geometry['schema'] == 'virgl-original-92cb-geometry-v1' and
            geometry['draws'] == 1957 and geometry['binarySha256'] == sha(raw) and
            len(geometry['drawCitations']) == 1957, 'verified predecessor draw inventory')
    resources = {}
    objects = {}
    sub = 0
    shader = [None, None]
    viewport = framebuffer = None
    rows = []
    color_resources = Counter()
    depth_resources = Counter()
    viewport_packets = Counter()
    framebuffer_packets = Counter()
    for line in (CAPTURE / 'events.jsonl').read_bytes().splitlines():
        event = json.loads(line)
        typ = event['type']
        if typ == 'resource_create' and event.get('phase') == 'enter':
            rid = event['resourceId']
            require(rid not in resources, 'no live resource ID reuse')
            resources[rid] = event
        elif typ == 'resource_unref' and event.get('phase') == 'enter':
            require(event['resourceId'] in resources, 'resource unref has live owner')
            del resources[event['resourceId']]
        if typ != 'submit_cmd' or event.get('phase') != 'enter' or event.get('ctxId') != 5:
            continue
        reference = event['blobs'][0]
        for name, kind, words, cite in packet_rows(blob(reference), event, reference):
            if name == 'SET_SUB_CTX':
                sub = words[1]
            elif name == 'DESTROY_SUB_CTX' and words[1] == 2:
                objects = {}; shader = [None, None]
                viewport = framebuffer = None
            elif sub == 2:
                if name == 'CREATE_OBJECT' and kind in ('SURFACE', 'MSAA_SURFACE'):
                    require((kind, words[1]) not in objects, 'no live surface-handle reuse')
                    objects[(kind, words[1])] = (words, cite)
                elif name == 'DESTROY_OBJECT' and kind in ('SURFACE', 'MSAA_SURFACE'):
                    require((kind, words[1]) in objects, 'destroy live surface')
                    del objects[(kind, words[1])]
                elif name == 'BIND_SHADER' and words[2] in (0, 1):
                    shader[words[2]] = words[1]
                elif name == 'SET_VIEWPORT_STATE':
                    viewport = (words, cite)
                elif name == 'SET_FRAMEBUFFER_STATE':
                    framebuffer = (words, cite)
                elif name == 'DRAW_VBO' and shader == [439, 440]:
                    require(len(rows) < 1957 and
                            geometry['drawCitations'][len(rows)]['draw'] == cite,
                            'same ordered original draw as verified geometry')
                    require(viewport is not None and viewport[0][1:] == VIEWPORT and
                            viewport[1]['event'] == 648 and viewport[1]['offset'] == 4844,
                            'live single original viewport packet')
                    require(framebuffer is not None and len(framebuffer[0]) == 4 and
                            framebuffer[0][1] == 1, 'one live color framebuffer')
                    color = live_surface(objects, resources, framebuffer[0][3], RESOURCE, 'color')
                    depth = (live_surface(objects, resources, framebuffer[0][2], DEPTH, 'depth')
                             if framebuffer[0][2] else None)
                    require(('MSAA_SURFACE', framebuffer[0][3]) not in objects,
                            'bound color is ordinary single-sample surface')
                    rows.append({'draw': cite, 'pairSha256': geometry['drawCitations'][len(rows)]['pairSha256'],
                                 'viewport': viewport[1], 'framebuffer': framebuffer[1],
                                 'color': color, 'depth': depth})
                    color_resources[color['resourceId']] += 1
                    if depth: depth_resources[depth['resourceId']] += 1
                    viewport_packets[viewport[1]['packetSha256']] += 1
                    framebuffer_packets[framebuffer[1]['packetSha256']] += 1
    require(len(rows) == 1957 and len(viewport_packets) == 1 and
            color_resources == Counter({21: 1953, 72: 4}) and
            len(framebuffer_packets) == 400, 'complete original raster draw state')
    banks = []
    for index, pair in enumerate(geometry['pairs']):
        v = struct.unpack_from('<16f', raw, 72 + index * 656)
        f = struct.unpack_from('<148f', raw, 136 + index * 656)
        require(f[0] == f[1] == 4.0 and f[24] == 2.0,
                'original first-power center and exponent')
        banks.append({'pairSha256': pair['sha256'], 'draws': pair['draws'],
                      'axis': [axis_envelope(v, f, 0, 1024),
                               axis_envelope(v, f, 1, 768)]})
    report = {'schema': 'virgl-original-92cb-raster-v1',
              'sourceEventsSha256': sha((CAPTURE / 'events.jsonl').read_bytes()),
              'geometryBinarySha256': sha(raw), 'draws': len(rows),
              'viewportPacket': rows[0]['viewport'],
              'viewportWords': list(VIEWPORT),
              'viewportPacketDraws': dict(viewport_packets),
              'framebufferPackets': len(framebuffer_packets),
              'colorResourceDraws': dict(color_resources),
              'depthResourceDraws': dict(depth_resources),
              'banks': banks, 'drawCitations': rows,
              'singleSampleCenterRule': 'GLSL ES 3.00 section 4.3.9',
              'numericCompilerAuthority': False,
              'productionDrawAuthority': False}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(f'{len(rows)} original draws; one 512x384 viewport; '
          f'{len(framebuffer_packets)} live framebuffer packets; single-sample 1024x768')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
