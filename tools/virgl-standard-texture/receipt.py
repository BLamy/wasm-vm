#!/usr/bin/env python3
"""Bind final original texture compiler, physical records and carried dependencies."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
PREDECESSOR = 'ac2b1ed7a77e82afb21321d6dfdabe0b2da12d4c'
TASK = 'E6-T11d23'


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
    need(not git('diff', '--name-only', 'HEAD'), 'freeze source before recording')
    sources, generated, files = {}, {}, {}

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
            need(raw == subprocess.check_output(['git', 'show', head + ':' + name], cwd=ROOT), 'unfrozen source ' + name)
            sources[name] = sha(raw)

    for _ in range(500):
        if b'\nSTANDARD_TEXTURE_RECORDING_COMPLETE\n' in (directory / 'acceptance.log').read_bytes():
            break
        time.sleep(.01)
    else:
        raise ValueError('incomplete recording log')
    audit = json.loads(record('physical-audit.json'))
    need(audit['status'] == 'passed' and len(audit['frames']) == 246 and audit['pixels'] == 15744 and
         audit['checkedWords'] == 62976 and len(audit['faults']) == 3 and audit['originalInputReconstruction'] and
         audit['noUndefinedQueryDimensions'], 'complete defined original pixel reconstruction')
    for name in ['hardware', 'fault-lod-selection', 'fault-gradient-state', 'fault-query-levels']:
        fault = name != 'hardware'
        report = json.loads(record(name + '/report.json'))
        need(report['gitHead'] == head and report['task'] == TASK and not report['trackedChanges'], 'exact browser head')
        need(report['status'] == ('failed' if fault else 'passed'), 'physical status')
        need(report['browserErrors'] == dict(console=[], page=[], requests=[]), 'zero browser errors')
        browser = report['browser']
        need(not browser['launch']['headless'] and browser['gpu']['featureStatus'][browser['webglFeature']] == 'enabled', 'headed hardware')
        need(not any(any(word in item.lower() for word in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe']) or
                     item.startswith('--disable-gpu') for item in browser['actualCommandLine']), 'hardware flags')
        served = {item['path']: item['sha256'] for item in report['servedFiles']}
        for item in report['sources'] + report['servedFiles']:
            source(item['path'], item['sha256'])
        shot = report.get('screenshot', report.get('failureScreenshot'))
        need(shot is not None, 'physical screenshot')
        record(name + '/' + shot['path'], shot['sha256'])
        coverage = report['browserCoverage']
        data = json.loads(record(name + '/' + coverage['path'], coverage['sha256']))
        need({row['source'] for row in data['scripts']} == {
            'renderer/virgl-shader/standard.mjs', 'renderer/virgl-shader/tests/standard-texture-browser.mjs'}, 'full served V8 scripts')
        for row in data['scripts']:
            need(row['sha256'] == served[row['source']], 'nested V8 source identity')
        acceptance = report['acceptance']
        need(not acceptance['guestExecution'] and not acceptance['productionNegotiation'], 'isolated compiler authority')
        need('Apple M4 Max' in acceptance['gl']['renderer'] and 'Metal' in acceptance['gl']['renderer'], 'physical native identity')
        need(len(acceptance['frames']) == (1 if fault else 246), 'complete physical fixtures')
        if not fault:
            need(len(acceptance['compiles']) >= 903 and all(row['okay'] for row in acceptance['compiles']), 'all admitted original native compiles')
            need(acceptance['limits']['vertexUnits'] >= 16 and acceptance['limits']['fragmentUnits'] >= 16 and
                 acceptance['limits']['units'] >= 32, 'stage sampler floor')
        for blob in acceptance['blobs']:
            raw = gzip.decompress(record(name + '/' + blob['path'], blob['gzipSha256']))
            need(len(raw) == blob['bytes'] and sha(raw) == blob['sha256'], 'complete physical blob')
        for frame in acceptance['frames']:
            need(frame['gpuComplete']['submitted'] and frame['gpuComplete']['fenced'] and frame['cleaned'] and
                 frame['audit']['held'] != fault, 'consumed fences and full outputs')
    native = json.loads(record('native/audit.json'))
    need(native['status'] == 'passed' and native['cases'] == 932 and native['exactNativeWasm'] and
         native['fixedMemoryBytes'] == 16777216 and native['queryBindings'] >= 69, 'literal C/Wasm matrix')
    facade = json.loads(record('native/facade.json'))
    need(facade['status'] == 'passed' and facade['getters'] == 0 and facade['ownedSnapshots'] and facade['peerIsolation'] and
         len(facade['rejections']) == 61 and facade['pressure']['recovered'] and facade['pressure']['bytes'] == 16777216 and
         facade['historical']['allResponseBytesIdentical'] and facade['historical']['cases'] == native['cases'], 'owned historical ABI/fixed-memory checks')
    need(record('native/native.jsonl') == record('native/sanitize.jsonl'), 'full sanitized C equality')
    allocations = [json.loads(row) for row in record('native/allocations.jsonl').splitlines()]
    need(allocations[-1]['faults'] == allocations[-1]['recoveries'] == 165 and allocations[-1]['callerMutation'] and
         not allocations[-1]['partialResults'], 'genuine allocation failure/source-copy recovery')
    for family, count in [('uniform', 508), ('packed', 59), ('integer', 48)]:
        need(record('retained-' + family + '/native.jsonl') == record('retained-' + family + '/sanitize.jsonl'), 'historical sanitized ABI')
        result = json.loads(record('retained-' + family + '/node.json'))
        need(result['status'] == 'passed' and result['cases'] == count and result['exactNativeWasm'], 'historical selected gate')
    authentication = json.loads(record('native/predecessor/authentication.json'))
    need(authentication['status'] == 'passed' and authentication['predecessor'] == PREDECESSOR and
         authentication['unchangedResourceTransportGuest'], 'authenticated unchanged D22 dependency')
    stack_frames = {}
    for file in (directory / 'stack').glob('*.su'):
        for line in file.read_text().splitlines():
            fields = line.split('\t')
            stack_frames[fields[0].rsplit(':', 1)[-1]] = int(fields[1])
    stack = {}
    for mode, names in [('stage', ['bridge_translate_standard_texture', 'standard_stage']),
                        ('pair', ['bridge_translate_standard_texture_pair', 'standard_pair'])]:
        names += ['standard_convert', 'vrend_convert_shader', 'standard_emit']
        need(all(name in stack_frames for name in names), 'optimized new compiler stack')
        observed = {name: stack_frames[name] for name in names}
        observed['conservativeBytes'] = sum(observed.values())
        need(observed['conservativeBytes'] < 262144, 'unchanged fixed stack bound')
        stack[mode] = observed
    need(not git('diff', '--name-only', PREDECESSOR, head, '--', 'renderer/virgl-command', 'crates', 'web', 'tools/guest'), 'resource/guest boundary unchanged')
    for name in git('ls-files', 'renderer/virgl-shader', 'renderer/virgl-command', 'tools/virgl-standard-texture',
                    'tools/verify-virgl-standard-texture.sh', 'tools/virgl-standard-uniform',
                    'tools/virgl-command/standard-packed-compiler.mjs', 'tools/virgl-command/standard-integer-compiler.mjs',
                    'tools/lib/virgl-browser-runner.mjs', 'tools/virgl-original-corpus/toolchain.py', 'tools/setup-virgl-emsdk.sh',
                    'Makefile', 'evidence/virgl-production-readiness/standard-texture-operation-gap.json',
                    'tasks/epic-6-transcendence/E6-T11d23-standard-texture-operations.md').splitlines():
        source(name)
    for name in git('ls-files', 'evidence/virgl-standard-byte-color-images/worker', 'evidence/virgl-standard-byte-color-images/verifier').splitlines():
        source(name)
        need((ROOT / name).read_bytes() == subprocess.check_output(['git', 'show', PREDECESSOR + ':' + name], cwd=ROOT), 'D22 sealed dependency unchanged')
    for family in ['texture', 'uniform', 'packed', 'integer']:
        for mode in ['native', 'sanitize'] + (['allocation-sanitize'] if family == 'texture' else []):
            binary = 'standard-' + family + ('-allocation-test' if mode == 'allocation-sanitize' else '-test')
            source('renderer/virgl-shader/build/standard-' + family + '-' + mode + '/' + binary)
    coverage = json.loads(record('coverage-audit.json'))
    need(coverage['gitHead'] == head and coverage['predecessor'] == PREDECESSOR and coverage['fullRegionsRemainAuthority'] and
         coverage['llvm'], 'full counters and exact changed-region source custody')
    for file in directory.rglob('*'):
        if file.is_file() and file.name != 'receipt.json':
            record(file.relative_to(directory).as_posix())
    result = dict(schema='standard-texture-shader-receipt-v1', task=TASK, status='passed', gitHead=head,
                  cases=native['cases'], frames=246, pixels=audit['pixels'], nativeTexels=audit['nativeTexels'],
                  fixedMemoryBytes=16777216, stack=stack, authority='isolated-standard-texture-shader',
                  guestExecution=False, productionNegotiation=False, productionDrawAuthority=False,
                  historicalEvidenceHead=PREDECESSOR, carriedVerifiedEvidence=authentication['carried'],
                  files=files, sources=sources, generated=generated)
    (directory / 'receipt.json').write_text(json.dumps(result, indent=2) + '\n')
    print('Frozen original texture operations, physical pixels, retained ABIs and complete custody authenticated.')


if __name__ == '__main__':
    main(sys.argv[1])
