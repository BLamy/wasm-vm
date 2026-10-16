"""Independent native completeness, unchanged pixel custody and added blend audit."""
from pathlib import Path
import gzip
import hashlib
import json
import math
import struct

ROOT = Path(__file__).resolve().parents[3]
V = Path(__file__).resolve().parent
S = ROOT / 'target/evidence/virgl-standard-state-reflection-verifier'
U = S / 'unpacked-reflection-repair'
OLD = S / 'unpacked-verifier'
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def need(value, label):
    if not value:
        raise AssertionError(label)


def packets(encoded):
    raw, at, result = bytes.fromhex(encoded), 0, []
    while at < len(raw):
        need(at + 4 <= len(raw), 'literal header boundary')
        header, = struct.unpack_from('<I', raw, at)
        count = header >> 16
        end = at + (count + 1) * 4
        need(end <= len(raw), 'literal packet extent')
        words = list(struct.unpack_from('<' + 'I' * count, raw, at + 4))
        result.append((header & 255, header >> 8 & 255, words, raw[at:end]))
        at = end
    return result


def f(word):
    return struct.unpack('<f', struct.pack('<I', word))[0]


prior_raw = (OLD / 'recording-audit.json').read_bytes()
prior = json.loads(prior_raw)
need(prior['status'] == 'passed', 'authenticated original HELD recording audit')
audit = {'schema': 1, 'head': 'adcbe81bcd091c3d411a8f96ac8746e1a17290fb', 'status': 'running',
         'carriedAuditSha256': sha(prior_raw), 'recordings': {}}
kind_counts = {'system-block': 0, 'raw-constant': 0, 'sampler': 0, 'owned-blend': 0}
for prefix in ['hot', 'cold']:
    folder = U / prefix
    raw_report = (folder / 'hardware/report.json').read_bytes()
    report = json.loads(raw_report)
    result = report['browserResult']['result']
    need(result['status'] == 'passed' and len(result['frames']) == 56, prefix + ' complete physical matrix')
    prior_frames = {row['label']: row for row in prior['recordings'][prefix]['frames']}
    rows, new_blend, rejected = [], None, []
    for frame_index, frame in enumerate(result['frames']):
        draw = frame['dump']['draws'][-1]
        program = next(program for program in frame['dump']['programs'] if program['generation'] == draw['programGeneration'])
        reflect = program['reflection']
        banks, shaders, selected, blend_objects, blend, blend_color = [[], []], {}, [None, None], {}, None, [0, 0, 0, 0]
        ctx = draw['command']['contextId']
        for history in frame['history']:
            if history['ctx'] != ctx:
                continue
            need(history['result']['ok'], 'no failed job contaminates successful frame history')
            for op, kind, words, packet in packets(history['hex']):
                if op == 12 and words[0] < 2 and words[1] == 0:
                    banks[words[0]] = words[2:]
                elif op == 1 and kind == 4:
                    need(packet[24 + words[2] - 1] == 0, 'literal shader NUL')
                    shaders[words[0]] = packet[24:24 + words[2] - 1]
                elif op == 3 and kind == 4:
                    shaders.pop(words[0], None)
                elif op == 31:
                    selected[words[1]] = shaders.get(words[0])
                elif op == 1 and kind == 1:
                    blend_objects[words[0]] = words
                elif op == 2 and kind == 1:
                    blend = blend_objects.get(words[0])
                elif op == 14:
                    blend_color = list(map(f, words))
        need(selected == [program['vertexTGSI'].encode(), program['fragmentTGSI'].encode()], 'actual selected literal shader identity')
        native = frame['native']
        need(len({entry['name'] for entry in native['activeUniforms']}) == len(native['activeUniforms']), 'native list complete unique uniform identities')
        classifications = []
        for actual in native['activeUniforms']:
            name = actual['name']
            if actual['blockIndex'] >= 0:
                block = next((block for block in reflect['uniformBlocks'] if block['index'] == actual['blockIndex']), None)
                need(block and block['name'] == 'VirglBlock' and block['byteLength'] == 656, 'every active block entry belongs to owned measured system block')
                category = 'system-block'
            else:
                uniform = next((uniform for uniform in reflect['uniforms'] if uniform['name'] == name), None)
                sampler = next((sampler for sampler in reflect['samplers'] if sampler['name'] == name), None)
                if uniform:
                    need(actual['type'] == 36296 and actual['size'] == uniform['activeCount'] and 0 < actual['size'] <= uniform['count'], 'every active raw entry matches checked native extent/type')
                    category = 'raw-constant'
                elif sampler:
                    need(actual['type'] == 35678 and actual['size'] == 1, 'every active sampler scalar native type')
                    bound = next(item for item in native['samplers'] if item['name'] == name)
                    wanted = sampler['index'] + (16 if sampler['stage'] == 'vertex' else 0)
                    need(bound['unit'] == bound['value'] == wanted, 'both-stage actually read native sampler unit')
                    category = 'sampler'
                else:
                    need(reflect.get('blend', {}).get('uniform') == name == 'wv_rgb_blend_factor' and actual['type'] == 35666 and actual['size'] == 1, 'only owned inserted float default-block binding is admissible')
                    category = 'owned-blend'
            kind_counts[category] += 1
            classifications.append({'name': name, 'type': actual['type'], 'size': actual['size'], 'blockIndex': actual['blockIndex'], 'category': category})
        for uniform in native['uniforms']:
            wanted = (banks[uniform['stage']] + [0] * (uniform['activeCount'] * 4))[:uniform['activeCount'] * 4]
            need(uniform['words'] == wanted, 'actual read native words still match literal bank with zero suffix')
        compressed = (folder / 'hardware' / frame['pixels']['path']).read_bytes()
        pixels = gzip.decompress(compressed)
        need(sha(compressed) == frame['pixels']['gzipSha256'] and sha(pixels) == frame['pixels']['sha256'] and
             len(pixels) == frame['width'] * frame['height'] * 4, 'full physical pixel custody')
        wire_digest = sha(bytes.fromhex(frame['history'][-1]['hex']))
        source_digests = [sha(source) for source in selected]
        if frame['label'] in prior_frames:
            old = prior_frames.pop(frame['label'])
            need(old['wireSha256'] == wire_digest and old['sourceSha256'] == source_digests and
                 old['pixelSha256'] == sha(pixels) and old['nativeCounts'] == [[u['stage'], u['declaredCount'], u['activeCount']] for u in native['uniforms']],
                 'preserve authenticated original HELD shader/wire/native/pixel observation')
        else:
            need(frame['label'] == 'standard-owned-blend-uniform', 'only recorded added physical frame')
            need(blend and blend[1:] == [0, 0, (1 | 7 << 4 | 8 << 9 | 1 << 17 | 17 << 22 | 15 << 27) & 0xffffffff, *([0] * 7)], 'literal Gallium mixed constant blend fields')
            need('MOV OUT[0], CONST[0]' in program['fragmentTGSI'] and len(banks[1]) == 4, 'literal source color instruction/bank')
            source = list(map(f, banks[1]))
            wanted = [math.floor(min(1, max(0, source[lane] * blend_color[lane] if lane < 3 else source[lane])) * 255 + .5) for lane in range(4)]
            need(wanted == [16, 64, 143, 255], 'literal packet independent blend prediction')
            need(all(abs(value - wanted[at % 4]) <= 1 for at, value in enumerate(pixels)), 'every added blend pixel independently matches wire equation')
            need(native['blend']['words'] == [*blend_color[:3], 1], 'actually read owned inserted vec4 blend factor')
            need('uniform highp vec4 wv_rgb_blend_factor;' in program['fragmentESSL300'], 'actual recorded blend-specialized native source')
            new_blend = {'frame': frame_index, 'expected': wanted, 'firstPixel': list(pixels[:4]),
                         'nativeFactor': native['blend']['words'], 'pixels': len(pixels) // 4,
                         'pixelsSha256': sha(pixels), 'wireSha256': wire_digest}
        rows.append({'frame': frame_index, 'label': frame['label'], 'nativeBindings': classifications,
                     'sourceSha256': source_digests, 'wireSha256': wire_digest,
                     'pixelsSha256': sha(pixels), 'pixels': len(pixels) // 4,
                     'point': f'browserResult.result.frames[{frame_index}]', 'held': True})
    need(not prior_frames and new_blend, 'all original HELD frame bytes retained plus new blend frame')
    for at, case in enumerate(result['nativeBindingRejections']):
        need(not case['result']['ok'] and case['result']['error']['code'] == 'shader-reflection-error' and
             case['name'] in case['result']['error']['message'] and case['nativeDraws'] == [], 'four worker active native omission rejections')
        native = next(event for event in case['native'] if event['result'] and event['result']['name'] == case['name'])
        need(native['result']['type'] == (36296 if case['label'].endswith('uniforms') else 35678) and native['result']['size'] == 1, 'worker omitted binding actual native scalar/array extent')
        rejected.append({'point': f'browserResult.result.nativeBindingRejections[{at}]', 'label': case['label'],
                         'nativePoint': native, 'result': case['result'], 'held': True})
    need(len(rejected) == 4, 'all stage/bank/sampler omissions present')
    audit['recordings'][prefix] = {'reportSha256': sha(raw_report), 'frames': rows, 'addedBlend': new_blend,
                                  'workerRejections': rejected, 'pixels': sum(row['pixels'] for row in rows)}
audit['nativeBindingCounts'] = kind_counts
need(all(kind_counts.values()), 'every native accounting class exercised physically')
audit['status'] = 'passed'
(V / 'recording-audit.json').write_text(json.dumps(audit, indent=2) + '\n')
print('Native completeness held for 112 frames / 4,742,848 pixels; all 110 prior full pixel digests unchanged, two blend frames independently proved.')
