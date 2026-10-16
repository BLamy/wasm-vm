#!/usr/bin/env python3
"""Authenticate frozen records; derive pixels from literal packets and actual GPU bytes."""
from fractions import Fraction as F
from pathlib import Path
import hashlib
import json
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
COUNTS = {28: 1, 29: 2, 30: 3, 31: 4}
FAULTS = {'scalar': 'scalar-format28', 'rgba': 'rgba-format31', 'perspective': 'clip-w2'}
VS = 'VERT\nDCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n0: MOV OUT[0], IN[0]\n1: MOV OUT[1], IN[1]\n2: END\n'
FS = 'FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n'
WFS = 'FRAG\nPROPERTY FS_COORD_ORIGIN LOWER_LEFT\nPROPERTY FS_COORD_PIXEL_CENTER HALF_INTEGER\nDCL IN[0], POSITION, LINEAR\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0].wwww\n1: END\n'


def need(condition, reason):
    if not condition:
        raise ValueError(reason)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def packets(encoded):
    raw, at = bytes.fromhex(encoded), 0
    while at < len(raw):
        header = struct.unpack_from('<I', raw, at)[0]
        length, kind, op = header >> 16, header >> 8 & 255, header & 255
        end = at + 4 + length * 4
        need(end <= len(raw), 'packet crosses recorded end')
        words = list(struct.unpack_from('<' + str(length) + 'I', raw, at + 4))
        yield op, kind, words, raw[at:end], at
        at = end
    need(at == len(raw), 'packet framing')


def state(row):
    elements, shaders, active, buffers = {}, {}, {}, []
    bound, index, drawing = None, None, None
    for submission in row['history']:
        if submission['contextId'] != row['contextId']:
            continue
        decoded = list(packets(submission['packetHex']))
        applied = len(decoded) if submission['result']['ok'] else submission['result']['appliedCommands']
        need(0 <= applied <= len(decoded), 'applied prefix exceeds original packets')
        if not submission['result']['ok']:
            need(applied < len(decoded) and submission['result']['error']['opcode'] == decoded[applied][0]
                 and submission['result']['error']['byteOffset'] == decoded[applied][4], 'failed prefix provenance')
        for op, kind, words, raw, at in decoded[:applied]:
            if op == 1 and kind == 5:
                elements[words[0]] = [words[i:i + 4] for i in range(1, len(words), 4)]
            elif op == 2 and kind == 5:
                bound = words[0]
            elif op == 1 and kind == 4:
                need(raw[24 + words[2] - 1] == 0, 'shader NUL')
                shaders[words[0]] = raw[24:24 + words[2] - 1].decode('ascii')
            elif op == 31:
                active[words[1]] = words[0]
            elif op == 6:
                buffers = [words[i:i + 3] for i in range(0, len(words), 3)]
            elif op == 11:
                index = words
            elif op == 8:
                drawing = words
    need(bound in elements and drawing is not None and index is not None, 'incomplete independent state')
    need(shaders[active[0]] == VS and shaders[active[1]] in [FS, WFS], 'unrecognized semantic shader')
    need(list(packets(row['packetHex']))[-1][0] == 8, 'record ends with draw')
    need(drawing[1:3] == [4, 5] and drawing[4:10] == [1, 0, 0, 0, 0, 0]
         and drawing[11] == 0, 'draw is not the claimed strip')
    return elements[bound], buffers, index, drawing, shaders[active[1]] == WFS, shaders[active[0]], shaders[active[1]]


def f32(raw, at):
    return F(struct.unpack_from('<f', raw, at)[0])


def quantize(value):
    value = min(F(1), max(F(0), value)) * 255
    return (2 * value.numerator + value.denominator) // (2 * value.denominator)


def audit_frame(row, check_native=True):
    elements, buffers, index, words, coordinates, vs, fs = state(row)
    need(elements[0][3] == 31 and elements[1][3] == row['format'] and coordinates == bool(row.get('coordinates')), 'format/semantic custody')
    native, dump = row['native'], row['dump']
    need(dump['complete'] and all(value == 0 for value in dump['dropped'].values())
         and not dump['presented'] and len(dump['draws']) == 1, 'bounded complete draw capture')
    draw = dump['draws'][0]
    command = draw['command']
    need(command['contextId'] == row['contextId'] and command['mode'] == 5 and command['count'] == 4, 'captured draw identity')
    program = next(p for p in dump['programs'] if p['generation'] == draw['programGeneration'])
    need(program['vertexTGSI'] == vs and program['fragmentTGSI'] == fs, 'packet/program custody')
    state_key = json.loads(draw['stateKey'])
    need([[e[k] for k in ['sourceOffset', 'instanceDivisor', 'vertexBufferIndex', 'sourceFormat']]
          for e in state_key['vertexElements']['elements']] == elements, 'captured vertex-element fields')
    if words[3]:
        need(words[0] == 0 and index[1:] == [2, 2], 'index binding size/offset')
        raw_index = bytes.fromhex(native['index']['bufferHex'])
        selected = list(struct.unpack_from('<4H', raw_index, 2))
        need(native['index']['resourceId'] == index[0] and 65535 not in selected, 'actual retained index identity/restart')
        need(command['indexResourceId'] == index[0] and command['indexResourceGeneration'] == native['index']['generation'], 'index generation custody')
        expected_args = ['drawElements', [5, 4, 5123, 2]]
    else:
        selected = list(range(words[0], words[0] + 4))
        expected_args = ['drawArrays', [5, words[0], 4]]
    need([native['op'], native['args']] == expected_args, 'native draw range/mode')
    need([command['actualMinIndex'], command['actualMaxIndex']] == [min(selected), max(selected)], 'actual min/max are not wire hints')
    values = {}
    for attribute in native['attributes']:
        number = int(attribute['name'].removeprefix('in_'))
        source_offset, divisor, slot, format_id = elements[number]
        stride, buffer_offset, resource_id = buffers[slot]
        need(divisor == 0 and format_id in COUNTS and source_offset % 4 == buffer_offset % 4 == stride % 4 == 0, 'independent layout/alignment')
        count, offset = COUNTS[format_id], source_offset + buffer_offset
        raw = bytes.fromhex(attribute['bufferHex'])
        need(len(raw) == attribute['byteLength'] and resource_id == attribute['resourceId'], 'native retained bytes/resource')
        fetched = []
        for vertex in selected:
            at = offset + vertex * stride
            need(at + count * 4 <= len(raw), 'independent actual fetch exceeds snapshot')
            fetched.append([f32(raw, at + lane * 4) for lane in range(count)] + [F(0), F(0), F(0), F(1)][count:])
        values[number] = fetched
        if check_native:
            need([attribute['enabled'], attribute['components'], attribute['type'], attribute['stride'], attribute['offset'], attribute['defaults']]
                 == [True, count, 5126, stride, offset, [0, 0, 0, 1]], 'native attribute size/type/stride/defaults')
            fetch = next(f for f in command['vertexFetches'] if f['attributeIndex'] == number)
            need([fetch['resourceId'], fetch['resourceGeneration'], fetch['components'], fetch['stride'], fetch['offset'], fetch['firstByte'], fetch['requiredEnd']]
                 == [resource_id, attribute['generation'], count, stride, offset, offset + min(selected) * stride, offset + max(selected) * stride + count * 4], 'captured fetch extent/generation')
            bound_buffer = state_key['vertexBuffers'][slot]
            need(bound_buffer['generation'] == attribute['generation'] and bound_buffer['metadata']['byteLength'] == len(raw)
                 and [bound_buffer['fields'][k] for k in ['stride', 'offset', 'resourceHandle']] == buffers[slot], 'state-cache buffer identity')
            reflected = next(a for a in program['reflection']['attributes'] if a['index'] == number)
            need(reflected['name'] == attribute['name'] and reflected['location'] == attribute['location'], 'native attribute/reflection custody')
    positions = values[0]
    w = positions[0][3]
    need(w > 0 and all(p[3] == w and p[2] == 0 for p in positions), 'uniform positive clip W and Z')
    need([[p[0] / w, p[1] / w] for p in positions] == [[-1, -1], [-1, 1], [1, -1], [1, 1]], 'homogeneous full-quad coverage')
    if coordinates:
        color = [1 / w] * 4
    else:
        color = values[1][0]
        need(all(v == color for v in values[1]), 'constant interpolated input prediction')
    return [quantize(value) for value in color]


def main(directory):
    directory = Path(directory).resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    files, sources, generated = {}, {}, {}

    def record(name, expected=None):
        raw = (directory / name).read_bytes()
        need(expected is None or sha(raw) == expected, 'record drift: ' + name)
        files[name] = sha(raw)
        return raw

    def source(name, expected=None):
        raw = (ROOT / name).read_bytes()
        need(expected is None or sha(raw) == expected, 'source drift: ' + name)
        if '/build/' in name:
            generated[name] = sha(raw)
        else:
            need(subprocess.check_output(['git', 'show', f'{head}:{name}'], cwd=ROOT) == raw, 'source not frozen: ' + name)
            sources[name] = sha(raw)

    enum = {'objectType': 5, 'formats': [28, 29, 30, 31], 'byteWidths': [4, 8, 12, 16], 'wordCounts': [5, 65], 'firstFields': [2, 3, 4, 5]}
    for mode in ['native', 'sanitize']:
        need(json.loads(record('abi/' + mode + '.json')) == enum, 'independent pinned C layout mismatch')
        need(len(record('abi/float-vertex-' + mode)) > 0, 'compiled enum oracle missing')
    wire = json.loads(record('wire/report.json'))
    need(wire['status'] == 'passed' and wire['gitHead'] == head and wire['task'] == 'E6-T11d3', 'wire head/status')
    need(wire['native']['admitted'] == 4 and wire['native']['rejected'] == 252 and len(wire['native']['assertions']) == 630
         and all(row['held'] for row in wire['native']['assertions']), 'wire matrix/boundaries')

    def physical(name, fault=None):
        report = json.loads(record(name + '/report.json'))
        need(report['gitHead'] == head and report['task'] == 'E6-T11d3' and report['status'] == ('failed' if fault else 'passed'), 'physical head/status')
        need(report['native'] == wire['native'] and report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser wire/errors')
        browser = report['browser']
        need(not browser['headless'] and browser['gpu']['featureStatus'].get('webgl2', browser['gpu']['featureStatus'].get('webgl')) == 'enabled', 'physical WebGL2')
        need(not any(any(word in arg.lower() for word in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe']) or arg.startswith('--disable-gpu')
                     for arg in browser['commandLine']), 'software flags')
        for item in report['sources']:
            source(item['path'], item['sha256'])
        record(name + '/' + report['screenshot']['path'], report['screenshot']['sha256'])
        coverage = json.loads(record(name + '/' + report['browserCoverage']['path'], report['browserCoverage']['sha256']))
        served = {item['path']: item['sha256'] for item in report['servedFiles']}
        mutation = report.get('mutation', {})
        need(mutation.get('mode') == fault, 'wrong fault')
        if fault:
            changed = record(name + '/mutation-source.mjs', mutation['servedSha256'])
            original = (ROOT / mutation['path']).read_bytes()
            need(sha(original) == mutation['originalSha256'] and original.count(mutation['needle'].encode()) == 1
                 and original.replace(mutation['needle'].encode(), mutation['replacement'].encode()) == changed, 'actual mutation custody')
        for item in report['sources']:
            if '/' + item['path'] in served:
                expected = mutation['servedSha256'] if item['path'] == mutation.get('path') else item['sha256']
                need(served['/' + item['path']] == expected, 'served source mismatch')
        need(len(coverage['scripts']) == 5 and all(item['sha256'] == served['/' + item['source']] for item in coverage['scripts']), 'served V8 coverage custody')
        if fault:
            rows = report['partial']['frames']
            need(rows[-1]['name'] == FAULTS[fault] and FAULTS[fault] + ' independent physical pixels' in report['browserResult']['error']['message'], 'unrelated failure counted as sensitivity')
            raw = record(name + '/' + report['faultPixels']['path'], report['faultPixels']['sha256'])
        else:
            result = report['browserResult']['result']
            need(result['status'] == 'passed' and not result['guestExecution'] and not result['productionNegotiation']
                 and all(row['held'] for row in result['assertions']), 'physical predicates/authority')
            rows = result['records']
            need(len(rows) == result['frames'] == 57 and len(result['rejections']) == 23 and result['quantizationBudget'] == 1, 'complete frame/rejection matrix')
            need([job['delay'] for job in result['jobs']] == [0, 1, 3] and all(job['gpuComplete'] and job['fences'] == 3 for job in result['jobs']), 'actual varied read/completion fences')
            raw = record(name + '/' + report['physicalPixels']['path'], report['physicalPixels']['sha256'])
            need(sha(raw) == result['rawSha256'], 'browser/raw custody')
            need({row['format'] for row in rows} == set(COUNTS), 'physical format coverage')
        need(len(raw) == len(rows) * 1024, 'physical raw extent')
        failures = []
        for i, row in enumerate(rows):
            expected = audit_frame(row, not fault)
            need(row['expected'] == expected, 'independent packet/GPU-byte oracle differs: ' + row['name'])
            frame = raw[i * 1024:(i + 1) * 1024]
            if any(abs(value - expected[lane]) > 1 for at in range(0, 1024, 4) for lane, value in enumerate(frame[at:at + 4])):
                failures.append(row['name'])
        need(failures == ([FAULTS[fault]] if fault else []), 'physical sensitivity mismatch: ' + str(failures))
        return len(rows)

    frames = physical('hardware')
    faults = {fault: physical('fault-' + fault, fault) for fault in FAULTS}
    held = json.loads(record('regression/receipt.json'))
    need(held['task'] == 'E6-T12h' and held['status'] == 'passed' and held['gitHead'] == head, 'affected retained gates')
    for name, digest in held['sources'].items():
        source(name, digest)
    for name, digest in held['generated'].items():
        source(name, digest)
    for name, digest in held['files'].items():
        record('regression/' + name, digest)
    promoted = json.loads(record('promoted-blend/report.json'))
    need(promoted['status'] == 'passed' and promoted['gitHead'] == head and promoted['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'promoted blend result')
    need(promoted['browserResult']['result']['frames'] == 22 and all(row['held'] for row in promoted['browserResult']['result']['assertions']), 'promoted blend predicates')
    for item in promoted['sources']:
        source(item['path'], item['sha256'])
    names = subprocess.check_output(['git', 'ls-files', 'renderer/virgl-shader'], cwd=ROOT, text=True).splitlines()
    names += ['Makefile', 'renderer/virgl-command/README.md', 'renderer/virgl-command/draw-README.md', 'renderer/virgl-command/state-README.md',
              'renderer/virgl-command/float-vertex-README.md', 'renderer/virgl-command/tests/float-vertex-fetch.mjs', 'renderer/virgl-command/tests/raster-depth.mjs',
              'tools/verify-virgl-float-vertex-fetch.sh', 'tools/verify-virgl-float-vertex-fetch.mjs', 'tools/virgl-command/float-vertex-enums.c',
              *['tools/virgl-command/float-vertex-' + suffix + '.py' for suffix in ['receipt', 'cold', 'seal']]]
    for name in names:
        source(name)
    for path in sorted(directory.rglob('*')):
        if path.is_file() and path.name not in {'acceptance.log', 'receipt.json'}:
            record(path.relative_to(directory).as_posix())
    receipt = {'schema': 1, 'task': 'E6-T11d3', 'status': 'passed', 'gitHead': head, 'sources': sources, 'generated': generated, 'files': files,
               'guestExecution': False, 'productionNegotiation': False, 'authority': 'isolated-float-vertex-fetch', 'frames': frames,
               'checkedPhysicalPixels': frames * 256, 'faultFrames': faults, 'quantizationBudget': 1}
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'Authenticated {frames} physical vertex frames, {len(files)} records, {len(sources)} exact-head sources')


if __name__ == '__main__':
    main(sys.argv[1])
