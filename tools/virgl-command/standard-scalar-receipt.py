#!/usr/bin/env python3
"""Authenticate frozen scalar fetch bytes, native pointers, pixels and custody."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
PREDECESSOR = 'b98847797f109b0a3af6171fd0a8c21983e1057b'
TASK = 'E6-T11d13'


def need(value, why):
    if not value:
        raise ValueError(why)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def main(directory):
    directory = Path(directory).resolve()
    head = git('rev-parse', 'HEAD')
    need(not git('diff', '--name-only', 'HEAD'), 'freeze tracked source before recording')
    files, sources, generated = {}, {}, {}

    def record(name, digest=None):
        raw = (directory / name).read_bytes()
        need(digest is None or sha(raw) == digest, 'record drift ' + name)
        files[name] = sha(raw)
        return raw

    def source(name, digest=None):
        raw = (ROOT / name).read_bytes()
        need(digest is None or sha(raw) == digest, 'source drift ' + name)
        if '/build/' in name or name.startswith('target/'):
            generated[name] = sha(raw)
        else:
            need(raw == subprocess.check_output(['git', 'show', head + ':' + name], cwd=ROOT), 'source not frozen ' + name)
            sources[name] = sha(raw)

    # tee may finish the final marker after the receipt process starts. It never
    # receives receipt success output after the log hash is frozen.
    for _ in range(500):
        if b'\nSTANDARD_SCALAR_RECORDING_COMPLETE\n' in (directory / 'acceptance.log').read_bytes():
            break
        time.sleep(.01)
    else:
        raise ValueError('incomplete compact acceptance log')

    def physical(name, task, frames, fault=False):
        report = json.loads(record(name + '/report.json'))
        need(report['gitHead'] == head and report['task'] == task, 'physical exact source head/task ' + name)
        need(report['status'] == ('failed' if fault else 'passed'), 'physical status ' + name)
        need(report['fixedMemory'] == {'bytes': 16777216, 'stageExport': 'function', 'pairExport': 'function'}, 'fixed original compiler')
        need(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser errors ' + name)
        browser = report['browser']
        need(not browser['headless'] and browser['gpu']['featureStatus'].get('webgl2', browser['gpu']['featureStatus'].get('webgl')) == 'enabled', 'headed WebGL2 ' + name)
        need(not any(any(word in arg.lower() for word in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe']) or arg.startswith('--disable-gpu') for arg in browser['commandLine']), 'software GPU flags')
        served = {row['path']: row['sha256'] for row in report['servedFiles']}
        mutation = report.get('mutation')
        for row in report['sources']:
            source(row['path'], row['sha256'])
            if '/' + row['path'] in served:
                expected = mutation['servedSha256'] if mutation and row['path'] == mutation['path'] else row['sha256']
                need(served['/' + row['path']] == expected, 'served source drift ' + row['path'])
        for key in ['screenshot', 'browserCoverage']:
            record(name + '/' + report[key]['path'], report[key]['sha256'])
        coverage = json.loads(record(name + '/' + report['browserCoverage']['path']))
        need({'renderer/virgl-command/' + n + '.mjs' for n in ['state', 'decoder', 'resources', 'cache', 'constant-domain']} <= {row['source'] for row in coverage['scripts']}, 'runtime coverage closure')
        for row in coverage['scripts']:
            need(row['sha256'] == served['/' + row['source']], 'coverage source custody')
        result = report['partial'] if fault else report['browserResult']['result']
        need(len(result['frames']) == frames, 'complete physical frame matrix ' + name)
        need(not result['guestExecution'], 'isolated guest authority')
        for blob in result['blobs']:
            packed = record(name + '/' + blob['path'], blob['gzipSha256'])
            raw = gzip.decompress(packed)
            need(len(raw) == blob['bytes'] and sha(raw) == blob['sha256'], 'original native blob custody')
        for frame in result['frames']:
            need(frame['history'][-1]['result']['gpuComplete'] and frame['native']['calls'], 'actual native draw/fence')
            need(frame['audit']['held'] != fault, 'original physical pixel verdict')
        if fault:
            need(mutation and mutation['path'] == 'renderer/virgl-command/state.mjs', 'actual served runtime fault')
            raw = record(name + '/mutation-source.mjs', mutation['servedSha256'])
            original = (ROOT / mutation['path']).read_bytes()
            needle, replacement = mutation['needle'].encode(), mutation['replacement'].encode()
            need(original.count(needle) == 1 and raw == original.replace(needle, replacement), 'exact native/scalar fault')
        return result

    wire = json.loads(record('wire/report.json'))
    need(wire['status'] == 'passed' and wire['gitHead'] == head and wire['task'] == TASK, 'original wire/head')
    need(wire['wire']['status'] == 'passed' and len(wire['wire']['records']) == 396 and wire['wire']['legacy']['status'] == 'passed', 'complete literal format/end/divisor wire matrix')
    for row in wire['sources']:
        source(row['path'], row['sha256'])
    own = physical('hardware', TASK, 391)
    physical('fault-native-signedness', TASK, 1, True)
    physical('fault-constant-scaled', TASK, 1, True)
    need(len(own['suspensions']) == 6 and len(own['ownership']) == 1 and len(own['rejections']) == 10, 'read/lifetime/bounds matrix')
    for run in own['runs']:
        need(all(run['inspection']['jobs'][key] == 0 for key in ['reads', 'stagingBytes', 'normalizedBuffers', 'normalizedBytes', 'normalizationScratchBytes']), 'bounded ownership retired')
    physical('retained-compact/hardware', 'E6-T11d12', 225)
    for fault in ['native-normalize', 'constant-unpack']:
        physical('retained-compact/fault-' + fault, 'E6-T11d12', 1, True)
    physical('retained-compact/critic-hardware', 'E6-T11d12', 44)
    need(json.loads(record('retained-compact/physical-audit.json'))['status'] == 'passed', 'retained original scalar pixels')
    need(json.loads(record('retained-compact/critic-audit.json'))['status'] == 'passed', 'retained independent compact critic pixels and updated wire exclusions')
    audit = json.loads(record('physical-audit.json'))
    need(audit['status'] == 'passed' and len(audit['frames']) == 391 and len(audit['faults']) == 2 and audit['nativeDraws'] == 391 and audit['nanPixels'] == 0 and not audit['portableNaNPayload'], 'full independent scalar pixel audit')
    expected = [base + k for base in [32, 40, 36, 44, 52, 60, 69, 82] for k in range(4)]
    need(record('abi/scalar-native.json') == record('abi/scalar-sanitize.json') and json.loads(record('abi/scalar-native.json')) == {'status': 'pinned-header', 'formats': expected}, 'original scalar wire ABI')
    need(not git('diff', '--name-only', PREDECESSOR, head, '--', 'renderer/virgl-shader', 'crates', 'web', 'tools/guest'), 'compiler/vendor/guest/production boundary changed')
    carried = {}
    for family in ['draw', 'constant', 'topology', 'restart', 'assembly', 'points', 'compact']:
        names = git('ls-files', 'evidence/virgl-standard-' + family + '/worker/*', 'evidence/virgl-standard-' + family + '/verifier/*').splitlines()
        for name in names:
            source(name)
            need((ROOT / name).read_bytes() == subprocess.check_output(['git', 'show', PREDECESSOR + ':' + name], cwd=ROOT), 'historical HELD evidence changed')
            carried[name] = sources[name]
    # The unchanged compact critic seal pins the actual generated compiler as well
    # as all compiler/allocator evidence. A rebuilt binary must match both pins.
    pins = json.loads((ROOT / 'evidence/virgl-standard-compact/verifier/manifest.json').read_text())['sources']
    for name in ['renderer/virgl-shader/build/wasm/virgl-shader.mjs', 'renderer/virgl-shader/build/wasm/virgl-shader.wasm']:
        source(name, pins[name])
    for name in git('ls-files', 'renderer/virgl-shader', 'renderer/virgl-command', 'tools/verify-virgl-standard-scalar*', 'tools/virgl-command/standard-scalar-*', 'tools/verify-virgl-standard-compact*', 'tools/virgl-command/standard-compact-*', 'Makefile').splitlines():
        source(name)
    for path in directory.rglob('*'):
        if path.is_file() and path.name != 'receipt.json':
            record(path.relative_to(directory).as_posix())
    receipt = dict(schema='standard-scalar-fetch-receipt-v1', task=TASK, status='passed', gitHead=head, frames=391,
                   checkedPhysicalPixels=audit['pixels'], nativeDraws=audit['nativeDraws'], normalizedBuffers=audit['normalizedBuffers'],
                   nanCategoryPixels=audit['nanPixels'], portableNaNPayload=False, guestExecution=False, productionNegotiation=False,
                   authority='isolated-standard-scalar-floating-fetch', productionDrawAuthority=False,
                   historicalEvidenceHead=PREDECESSOR, carriedVerifiedEvidence=carried, files=files, sources=sources, generated=generated)
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main(sys.argv[1])
