#!/usr/bin/env python3
"""Authenticate compiler/runtime recordings and independently inspect raw pixels."""
from pathlib import Path
import hashlib
import json
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def need(condition, reason):
    if not condition:
        raise ValueError(reason)


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

    native = json.loads(record('native/report.json'))
    need(native['status'] == 'passed' and native['gitHead'] == head, 'native head/status')
    need(native['privateRegisters'] == 46 and native['privateExactWords'] == 184,
         'private capacity expanded')
    need(native['memory']['bytes'] == 16777216 and native['memory']['recovered']
         and native['memory']['exhausted']['ok'] is False, 'fixed Wasm memory failure/recovery')
    cases = json.loads(record('native/cases.json'))
    need(len(cases) == 29 and len(native['wasm']['results']) == 29, 'compiler cases incomplete')
    need(all(row['held'] for row in native['wasm']['assertions']), 'Wasm predicates failed')
    need([run['mode'] for run in native['native']] == ['native', 'sanitize', 'scratch-sanitize'], 'native modes incomplete')
    for run in native['native']:
        source(run['binary'], run['binarySha256'])
        rows = [json.loads(line) for line in record('native/' + run['mode'] + '.jsonl').decode().splitlines()]
        need(rows == run['results'] and len(rows) == len(cases), 'native result custody')
        for index, (case, row) in enumerate(zip(cases, rows)):
            result = row['result']
            need(row['case'] == index and result['ok'] == (case['ok'] and run['mode'] != 'scratch-sanitize'),
                 'native admission: ' + case['name'])
            if run['mode'] == 'scratch-sanitize' and case['ok']:
                need(result['error']['code'] == 'translation-error', 'scratch overflow not typed')
            elif case['kind'] != 3:
                need(result == native['wasm']['results'][index]['result'], 'full compiler parity')
    record('native/cases.bin', native['casesSha256'])
    for name in ['native/sanitize.profraw', 'native/scratch-sanitize.profraw']:
        need(len(record(name)) > 0, 'native coverage missing')

    colors = {'MOV': [[64, 128, 64, 128], [0, 128, 64, 64]],
              'ADD': [[128, 128, 191, 255], [128, 191, 64, 191]],
              'MUL': [[32, 64, 32, 64], [0, 32, 64, 32]],
              'MAD': [[96, 128, 128, 191], [64, 143, 64, 128]]}
    bank_values = [{120: [0x3e800000, 0, 0x3f000000, 0x3f000000],
                    124: [0x3f000000] * 4, 127: [0x3e800000, 0x3f000000, 0x3e800000, 0x3f000000]},
                   {120: [0x3f000000, 0x3e800000, 0, 0x3f000000],
                    124: [0x3f000000, 0x3e800000, 0x3f800000, 0x3f000000],
                    127: [0, 0x3f000000, 0x3e800000, 0x3e800000]}]

    def physical(name, success):
        report = json.loads(record(name + '/report.json'))
        need(report['task'] == 'E6-T11d1' and report['gitHead'] == head and
             report['status'] == ('passed' if success else 'failed'), 'physical status/head')
        need(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser errors')
        browser = report['browser']
        need(browser['headless'] is False and browser['gpu']['featureStatus'].get('webgl2', browser['gpu']['featureStatus'].get('webgl')) == 'enabled', 'physical GPU disabled')
        need(not any(any(word in arg.lower() for word in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe'])
                     or arg.startswith('--disable-gpu') for arg in browser['commandLine']), 'software GPU flags')
        for item in report['sources']:
            source(item['path'], item['sha256'])
        record(name + '/' + report['screenshot']['path'], report['screenshot']['sha256'])
        record(name + '/' + report['browserCoverage']['path'], report['browserCoverage']['sha256'])
        if not success:
            need('MOV bank 0 literal physical pixels' in report['browserResult']['error']['message'], 'unrelated failure counted as sensitivity')
            mutation = report['mutation']
            changed = record(name + '/mutation-source.mjs', mutation['servedSha256'])
            original = (ROOT / mutation['path']).read_bytes()
            need(original.count(mutation['needle'].encode()) == 1 and
                 original.replace(mutation['needle'].encode(), mutation['replacement'].encode()) == changed,
                 'wrong actual upload mutation')
            return
        result = report['browserResult']['result']
        need(result['status'] == 'passed' and not result['guestExecution'] and not result['productionNegotiation']
             and all(row['held'] for row in result['assertions']), 'physical predicates/authority')
        need(len(result['records']) == 15 and [job['delay'] for job in result['jobs']] == [0, 1, 3]
             and all(job['gpuComplete'] for job in result['jobs']), 'physical frames/fences incomplete')
        pixels = record(name + '/' + report['physicalPixels']['path'], report['physicalPixels']['sha256'])
        need(len(pixels) == 15 * 1024, 'pixel extent')
        names = [f'{op}-{phase}' for op in colors for phase in [0, 1, 0]] + ['async-0', 'async-1', 'async-3']
        for index, row in enumerate(result['records']):
            need(row['name'] == names[index], 'frame order')
            op, phase = ('MAD', 1) if row['name'].startswith('async-') else (row['name'].split('-')[0], int(row['name'].split('-')[1]))
            expected = colors[op][phase]
            block = pixels[index * 1024:(index + 1) * 1024]
            need(row['expected'] == expected and block == bytes(expected) * 256 and sha(block) == row['pixelSha256'],
                 'independent physical pixel mismatch: ' + row['name'])
            words = [0] * 512
            for slot, lanes in bank_values[phase].items():
                words[slot * 4:slot * 4 + 4] = lanes
            need(row['words'] == words, 'high bank raw word mismatch')
            packet = bytes.fromhex(row['packetHex'])
            need(len(packet) == 2112 and struct.unpack_from('<I', packet)[0] == (514 << 16) | 12
                 and list(struct.unpack_from('<512I', packet, 12)) == words, 'original high-bank packet custody')

    physical('hardware', True)
    physical('fault-upload-limit', False)
    held = json.loads(record('regression/receipt.json'))
    need(held['task'] == 'E6-T12i' and held['status'] == 'passed' and held['gitHead'] == head, 'affected cache gates')
    for name, digest in held['sources'].items():
        source(name, digest)
    for name, digest in held['generated'].items():
        source(name, digest)
    for name, digest in held['files'].items():
        record('regression/' + name, digest)
    for name in ['compiler-native/report.json', 'compiler-wasm/report.json', 'compiler-retained/report.json', 'compiler-joins.json', 'promoted-cache/report.json']:
        result = json.loads(record(name))
        need(result['status'] == 'passed', 'affected compiler/cache result: ' + name)
    # Bind every owned and pinned compiler file, including checked allocation TUs.
    names = subprocess.check_output(['git', 'ls-files', 'renderer/virgl-shader'], cwd=ROOT, text=True).splitlines()
    names += ['Makefile', 'tools/verify-virgl-vertex-constants.sh', 'tools/verify-virgl-vertex-constants.mjs',
              'renderer/virgl-command/tests/vertex-constants.mjs', 'tools/virgl-command/vertex-constant-native.mjs', 'tools/virgl-command/vertex-constant-joins.mjs',
              'tools/virgl-command/vertex-constant-receipt.py', 'tools/virgl-command/vertex-constant-cold.py',
              'tools/virgl-command/vertex-constant-seal.py', 'tools/virgl-compiler-bounds/cases.mjs',
              'tools/virgl-compiler-bounds/native.mjs', 'tools/virgl-compiler-bounds/wasm.mjs', 'tools/virgl-compiler-bounds/retained.mjs']
    for name in names:
        source(name)
    source('renderer/virgl-shader/build/native/virgl-shader')
    source('renderer/virgl-shader/build/compiler-bounds-sanitize/compiler-bounds-test')
    for path in sorted(directory.rglob('*')):
        if path.is_file() and path.name not in {'acceptance.log', 'receipt.json'}:
            record(path.relative_to(directory).as_posix())
    receipt = {'schema': 1, 'task': 'E6-T11d1', 'status': 'passed', 'gitHead': head, 'sources': sources,
               'generated': generated, 'files': files, 'guestExecution': False, 'productionNegotiation': False,
               'authority': 'ordinary-vertex128-private46-capacity-only'}
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'Authenticated ordinary vertex capacity: {len(files)} records, {len(sources)} exact-head sources')


if __name__ == '__main__':
    main(sys.argv[1])
