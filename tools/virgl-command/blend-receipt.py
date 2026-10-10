#!/usr/bin/env python3
"""Authenticate the frozen source and recompute every physical blend pixel independently."""
from fractions import Fraction as F
from pathlib import Path
import hashlib
import json
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SRC = [1, 2, 3, 4, 5, 6, 7, 8, 17, 18, 19, 20, 21, 23, 24]
DST = [value for value in SRC if value != 6]
GL_FACTORS = {1: 1, 2: 0x300, 3: 0x302, 4: 0x304, 5: 0x306, 6: 0x308,
              7: 0x8001, 8: 0x8003, 17: 0, 18: 0x301, 19: 0x303,
              20: 0x305, 21: 0x307, 23: 0x8002, 24: 0x8004}
GL_EQUATIONS = [0x8006, 0x800a, 0x800b, 0x8007, 0x8008]
FAULT_NAMES = {'equation': 'rgb-0-1-1', 'factor': 'rgb-0-1-4', 'fold': 'rgb-0-7-8'}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def need(condition, reason):
    if not condition:
        raise ValueError(reason)


def clamp(value):
    return min(F(1), max(F(0), value))


def rounded(value):
    return (2 * value.numerator + value.denominator) // (2 * value.denominator)


def factor(which, lane, source, dest, color):
    # Deliberately separate from the JavaScript BigInt oracle and renderer tables.
    if which == 1:
        return F(1)
    if which == 17:
        return F(0)
    if which in [2, 18]:
        value = source[lane]
    elif which in [3, 19]:
        value = source[3]
    elif which in [4, 20]:
        value = dest[3]
    elif which in [5, 21]:
        value = dest[lane]
    elif which == 6:
        return F(1) if lane == 3 else min(source[3], 1 - dest[3])
    elif which in [7, 23]:
        value = color[lane]
    elif which in [8, 24]:
        value = color[3]
    else:
        raise ValueError('unknown independent factor')
    return 1 - value if which >= 18 else value


def prediction(row):
    fmt, t = row['format'], row['target']
    scales = [1023, 1023, 1023, 3] if fmt == 233 else [255] * 4
    stored = [scale if lane == 3 and fmt != 67 else rounded(F(value * scale, 255))
              for lane, (value, scale) in enumerate(zip(row['destination'], scales))]
    source = [clamp(F(str(value))) for value in row['source']]
    color = [clamp(F(str(value))) for value in row['color']]
    dest = [F(value, scale) for value, scale in zip(stored, scales)]
    expected = []
    for lane in range(4):
        if row.get('discarded') or not t['mask'] & (1 << lane) or lane == 3 and fmt != 67:
            expected.append(stored[lane])
            continue
        if row.get('enabled') is False:
            value = source[lane]
        else:
            prefix = 'alpha' if lane == 3 else 'rgb'
            eq = t[prefix + 'Function']
            left = source[lane] * factor(t[prefix + 'SourceFactor'], lane, source, dest, color)
            right = dest[lane] * factor(t[prefix + 'DestinationFactor'], lane, source, dest, color)
            value = [left + right, left - right, right - left,
                     min(source[lane], dest[lane]), max(source[lane], dest[lane])][eq]
        expected.append(rounded(clamp(value) * scales[lane]))
    return expected


def pixels(raw, row):
    need(len(raw) == 1024, 'frame pixel extent')
    if row['format'] != 233:
        return [list(raw[at:at + 4]) for at in range(0, 1024, 4)]
    return [[value & 1023, (value >> 10) & 1023, (value >> 20) & 1023, value >> 30]
            for value in struct.unpack('<256I', raw)]


def packet_check(row):
    raw = bytes.fromhex(row['packetHex'])
    at, blend, color, bank, draw = 0, None, None, None, None
    while at < len(raw):
        header = struct.unpack_from('<I', raw, at)[0]
        count, kind, op = header >> 16, (header >> 8) & 255, header & 255
        end = at + 4 + count * 4
        need(end <= len(raw), 'packet exceeds owned recording')
        words = list(struct.unpack_from('<' + str(count) + 'I', raw, at + 4))
        if op == 1 and kind == 1:
            need(count == 11 and words[1:3] == [0, 0] and words[4:] == [0] * 7,
                 'blend reserved state/multiple targets')
            blend = words[3]
        if op == 14:
            color = words
        if op == 12:
            need(words[:2] == [1, 0], 'source bank stage/offset')
            bank = words[2:]
        if op == 8:
            draw = words
        at = end
    need(at == len(raw) and blend is not None and color is not None and bank is not None,
         'blend packet closure incomplete')
    t = row['target']
    decoded = {'rgbFunction': (blend >> 1) & 7, 'rgbSourceFactor': (blend >> 4) & 31,
               'rgbDestinationFactor': (blend >> 9) & 31, 'alphaFunction': (blend >> 14) & 7,
               'alphaSourceFactor': (blend >> 17) & 31, 'alphaDestinationFactor': (blend >> 22) & 31,
               'mask': (blend >> 27) & 15}
    need(decoded == t and bool(blend & 1) == (row.get('enabled') is not False), 'wire blend custody')
    to_words = lambda values: [struct.unpack('<I', struct.pack('<f', value))[0] for value in values]
    need(color == to_words(row['color']) and bank == to_words(row['source']), 'owned blend/source word custody')
    need(draw == [0, 4, 5, 0, 1, 0, 0, 0, 0, 0, 0xffffffff, 0], 'recorded strip draw')
    dump = row['dump']
    need(dump['complete'] and len(dump['submissions']) == 1 and len(dump['draws']) == 1
         and dump['submissions'][0]['hex'] == raw.hex(), 'runtime frame packet/draw custody')
    need(dump['outcomes'][0]['ok'] and dump['outcomes'][0]['draws'] == 1, 'recorded outcome mismatch')
    return to_words(row['source'])


def native_check(row, words):
    t, native = row['target'], row['native']
    enabled = row.get('enabled') is not False
    rf, af = (t['rgbFunction'], t['alphaFunction']) if enabled else (0, 0)
    sf, df = (t['rgbSourceFactor'], t['rgbDestinationFactor']) if enabled else (1, 17)
    sa, da = (t['alphaSourceFactor'], t['alphaDestinationFactor']) if enabled else (1, 17)
    mixed = enabled and rf < 3 and (sf in [7, 23] and df in [8, 24] or sf in [8, 24] and df in [7, 23])
    fold = mixed and not row.get('discarded')
    need(native['op'] == 'drawArrays' and native['args'] == [5, 0, 4] and native['blend'] == enabled,
         'actual native draw/enable mismatch')
    need(native['equations'] == [GL_EQUATIONS[rf], GL_EQUATIONS[af]], 'actual equation mismatch')
    need(native['factors'] == [1 if rf >= 3 or mixed else GL_FACTORS[sf], 0 if rf >= 3 else GL_FACTORS[df],
                               1 if sa == 6 else GL_FACTORS[sa], GL_FACTORS[da]], 'actual factor mismatch')
    need(native['mask'] == [bool(t['mask'] & (1 << lane)) and (lane != 3 or row['format'] == 67)
                            for lane in range(4)], 'actual color mask and X-alpha preservation')
    # WebGL state queries retain the supplied color; fixed-function blending clamps it.
    need(native['color'] == row['color'], 'actual supplied blend color')
    need(native['sourceWords'] == ([] if row.get('discarded') else words), 'native owned constant upload')
    need((native['fold'] is not None) == fold, 'actual variant selection')
    generation = row['dump']['draws'][0]['programGeneration']
    program = next(item for item in row['dump']['programs'] if item['generation'] == generation)
    if fold:
        color = [clamp(F(str(value))) for value in row['color']]
        values = color[:3] if sf in [7, 23] else [color[3]] * 3
        if sf in [23, 24]:
            values = [1 - value for value in values]
        need(native['fold'] == [float(value) for value in values] + [1], 'owned factor upload')
        need(program['key'].endswith('|blend-source-constant-v1:' + str(sf))
             and program['reflection']['blend'] == {'sourceFactor': sf, 'uniform': 'wv_rgb_blend_factor', 'type': 'vec4', 'count': 1}
             and 'fsout_c0.rgb=clamp(fsout_c0.rgb,0.0,1.0)*wv_rgb_blend_factor.rgb' in program['fragmentESSL300'], 'variant text/reflection/cache key')
    else:
        need('blend-source-constant' not in program['key'] and 'wv_rgb_blend_factor' not in program['fragmentESSL300'],
             'unnecessary variant in factor-free/ordinary/discard path')


def main(directory):
    directory = Path(directory).resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    files, sources, generated = {}, {}, {}

    def source(name, expected=None):
        raw = (ROOT / name).read_bytes()
        digest = sha(raw)
        need(expected is None or digest == expected, 'source drift: ' + name)
        if '/build/' in name:
            generated[name] = digest
        else:
            need(subprocess.check_output(['git', 'show', f'{head}:{name}'], cwd=ROOT) == raw,
                 'source not frozen: ' + name)
            sources[name] = digest

    def record(name, expected=None):
        raw = (directory / name).read_bytes()
        digest = sha(raw)
        need(expected is None or digest == expected, 'record drift: ' + name)
        files[name] = digest
        return raw

    enum_oracle = {'equations': list(range(5)), 'sourceFactors': SRC, 'dualSource': [9, 10, 25, 26]}
    for mode in ['native', 'sanitize']:
        need(json.loads(record('abi/' + mode + '.json')) == enum_oracle, 'independent pinned C ABI mismatch')
        need(len(record('abi/blend-' + mode)) > 0, 'C oracle executable missing')
    wire = json.loads(record('wire/report.json'))
    need(wire['status'] == 'passed' and wire['gitHead'] == head, 'native wire status/head')
    need(len(wire['native']['assertions']) == 536 and wire['native']['admitted'] == 120
         and wire['native']['rejected'] == 136 and all(row['held'] for row in wire['native']['assertions']), 'wire boundary predicates')

    def physical(name, fault=None):
        report = json.loads(record(name + '/report.json'))
        need(report['task'] == 'E6-T11d2' and report['gitHead'] == head and
             report['status'] == ('failed' if fault else 'passed'), 'physical status/head')
        need(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser errors')
        need(report['native'] == wire['native'], 'Node/browser wire parity')
        browser = report['browser']
        need(browser['headless'] is False and browser['gpu']['featureStatus'].get('webgl2', browser['gpu']['featureStatus'].get('webgl')) == 'enabled', 'physical GPU disabled')
        need(not any(any(word in arg.lower() for word in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe'])
                     or arg.startswith('--disable-gpu') for arg in browser['commandLine']), 'software GPU flags')
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
            need(sha(original) == mutation['originalSha256'] and original != changed
                 and original.count(mutation['needle'].encode()) == 1
                 and original.replace(mutation['needle'].encode(), mutation['replacement'].encode()) == changed,
                 'actual sabotage custody')
        for item in report['sources']:
            if '/' + item['path'] in served:
                expected = mutation['servedSha256'] if item['path'] == mutation.get('path') else item['sha256']
                need(served['/' + item['path']] == expected, 'served source mismatch')
        need({item['source'] for item in coverage['scripts']} ==
             {f'renderer/virgl-command/{name}.mjs' for name in ['resources', 'decoder', 'state', 'cache', 'constant-domain']}, 'coverage source closure')
        for item in coverage['scripts']:
            need(item['sha256'] == served['/' + item['source']], 'coverage source mismatch')
        if fault:
            records = report['partial']['frames']
            need(records[-1]['name'] == FAULT_NAMES[fault] and
                 FAULT_NAMES[fault] + ' rational physical pixels' in report['browserResult']['error']['message'], 'unrelated failure counted as sensitivity')
            raw = record(name + '/' + report['faultPixels']['path'], report['faultPixels']['sha256'])
        else:
            result = report['browserResult']['result']
            need(result['status'] == 'passed' and not result['guestExecution'] and not result['productionNegotiation']
                 and all(row['held'] for row in result['assertions']), 'physical predicates/authority')
            records = result['records']
            need(len(records) == result['frames'] == 2302 and result['quantizationBudget'] == 1, 'physical frame count/budget')
            need([job['delay'] for job in result['jobs']] == [0, 1, 3] and all(job['gpuComplete'] and job['fences'] == 2 for job in result['jobs']), 'native varied fences')
            for cache in result['pressure']['caches'].values():
                need(cache['requests'] == cache['hits'] + cache['misses'] and cache['entries'] <= cache['limits']['entries']
                     and cache['bytes'] <= cache['limits']['bytes'], 'bounded cache denominator/residency')
            need(result['pressure']['caches']['program']['evictions'] > 0 and result['pressure']['caches']['state']['evictions'] > 0, 'variant/state eviction not exercised')
            raw = record(name + '/' + report['physicalPixels']['path'], report['physicalPixels']['sha256'])
            need(sha(raw) == result['rawSha256'], 'browser/raw custody')
            expected_names = [f'{stage}-{fn}-{sf}-{df}' for stage in ['rgb', 'alpha'] for fn in range(5) for sf in SRC for df in DST]
            need([row['name'] for row in records[:2100]] == expected_names, 'exhaustive independent RGB/alpha matrix')
        need(len(raw) == len(records) * 1024, 'raw physical extent')
        bad_frames = []
        for index, row in enumerate(records):
            words = packet_check(row)
            expected = prediction(row)
            need(row['expected'] == expected, 'independent oracle disagrees: ' + row['name'])
            observed = pixels(raw[index * 1024:(index + 1) * 1024], row)
            if any(abs(value - expected[lane]) > 1 for pixel in observed for lane, value in enumerate(pixel)):
                bad_frames.append(row['name'])
            if not fault:
                native_check(row, words)
        need(bad_frames == ([FAULT_NAMES[fault]] if fault else []), 'physical raw sensitivity mismatch: ' + str(bad_frames))
        return len(records)

    frames = physical('hardware')
    fault_frames = {fault: physical('fault-' + fault, fault) for fault in FAULT_NAMES}
    held = json.loads(record('regression/receipt.json'))
    need(held['task'] == 'E6-T12i' and held['status'] == 'passed' and held['gitHead'] == head, 'affected renderer gates')
    for name, digest in held['sources'].items():
        source(name, digest)
    for name, digest in held['generated'].items():
        source(name, digest)
    for name, digest in held['files'].items():
        record('regression/' + name, digest)
    promoted = json.loads(record('promoted-cache/report.json'))
    need(promoted['status'] == 'passed' and promoted['sourceHead'] == head
         and promoted['repositoryHead'] == head, 'promoted cache result')
    need(promoted['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'promoted cache browser errors')
    for item in promoted['sources']:
        source(item['path'], item['sha256'])
    for item in promoted['pixelRecords']:
        record('promoted-cache/' + item['path'], item['sha256'])
    record('promoted-cache/browser-coverage.json', promoted['coverageSha256'])
    record('promoted-cache/browser.png', promoted['screenshotSha256'])
    # Includes every checked/pinned compiler source, not just its bridge entry point.
    names = subprocess.check_output(['git', 'ls-files', 'renderer/virgl-shader'], cwd=ROOT, text=True).splitlines()
    names += ['Makefile', 'renderer/virgl-command/README.md', 'renderer/virgl-command/blend-README.md',
              'renderer/virgl-command/tests/blend-equations.mjs', 'tools/verify-virgl-blend-equations.sh',
              'tools/verify-virgl-blend-equations.mjs', 'tools/virgl-command/blend-enums.c',
              *['tools/virgl-command/blend-' + suffix + '.py' for suffix in ['receipt', 'cold', 'seal']]]
    for name in names:
        source(name)
    for path in sorted(directory.rglob('*')):
        if path.is_file() and path.name not in {'acceptance.log', 'receipt.json'}:
            record(path.relative_to(directory).as_posix())
    receipt = {'schema': 1, 'task': 'E6-T11d2', 'status': 'passed', 'gitHead': head,
               'sources': sources, 'generated': generated, 'files': files, 'guestExecution': False,
               'productionNegotiation': False, 'authority': 'isolated-single-target-normalized-blend',
               'frames': frames, 'checkedPhysicalPixels': frames * 256, 'faultFrames': fault_frames,
               'quantizationBudget': 1}
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'Authenticated {frames} physical blend frames, {len(files)} records, {len(sources)} exact-head sources')


if __name__ == '__main__':
    main(sys.argv[1])
