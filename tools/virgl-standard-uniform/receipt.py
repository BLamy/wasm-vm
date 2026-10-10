#!/usr/bin/env python3
"""Authenticate exact-head original uniform compiler, hardware and retained ABIs."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
PREDECESSOR = 'e118e4c2ddf83b2641fcca267025b1a6ef8fdad9'
TASK = 'E6-T11d16'


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
    sources, generated, files, carried = {}, {}, {}, {}

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
        if b'\nSTANDARD_UNIFORM_RECORDING_COMPLETE\n' in (directory / 'acceptance.log').read_bytes():
            break
        time.sleep(.01)
    else:
        raise ValueError('incomplete recording log')

    audit = json.loads(record('physical-audit.json'))
    need(audit['status'] == 'passed' and len(audit['frames']) == 253 and audit['pixels'] == 104844 and
         audit['nativeDraws'] == 253 and len(audit['faults']) == 3 and audit['everyBankWordRead'] and
         audit['allBanksSimultaneouslyActive'] and audit['fullOriginalStorage'], 'complete offline original hardware audit')
    for name in ['hardware', 'fault-block-word', 'fault-range-offset', 'fault-slot-zero-variant']:
        fault = name != 'hardware'
        report = json.loads(record(name + '/report.json'))
        need(report['gitHead'] == head and report['task'] == TASK and not report['trackedChanges'], 'exact hardware head ' + name)
        need(report['status'] == ('failed' if fault else 'passed'), 'hardware status ' + name)
        need(report['browserErrors'] == dict(console=[], page=[], requests=[]), 'hardware errors ' + name)
        browser = report['browser']
        need(not browser['launch']['headless'] and browser['gpu']['featureStatus'][browser['webglFeature']] == 'enabled', 'headed hardware')
        need(not any(any(word in item.lower() for word in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe']) or
                     item.startswith('--disable-gpu') for item in browser['actualCommandLine']), 'software flags')
        served = {item['path']: item['sha256'] for item in report['servedFiles']}
        for item in report['sources']:
            source(item['path'], item['sha256'])
            if item['path'] in served:
                need(served[item['path']] == item['sha256'], 'served source custody')
        for item in report['servedFiles']:
            source(item['path'], item['sha256'])
        shot = report.get('screenshot', report.get('failureScreenshot'))
        need(shot is not None, 'hardware screenshot')
        record(name + '/' + shot['path'], shot['sha256'])
        coverage = report['browserCoverage']
        data = json.loads(record(name + '/' + coverage['path'], coverage['sha256']))
        need({row['source'] for row in data['scripts']} == {
            'renderer/virgl-shader/standard.mjs', 'renderer/virgl-command/constant-domain.mjs',
            'renderer/virgl-shader/tests/standard-uniform-browser.mjs'}, 'actual served runtime coverage')
        for row in data['scripts']:
            need(row['sha256'] == served[row['source']], 'V8 served source digest')
        acceptance = report['acceptance']
        need(not acceptance['guestExecution'] and not acceptance['productionNegotiation'], 'isolated authority')
        need(len(acceptance['frames']) == (1 if fault else 253), 'all native draws')
        if not fault:
            need(len(acceptance['compiles']) == 397, 'all original physical compiles')
            limits = acceptance['limits']
            need(limits['vertexBlocks'] >= 14 and limits['fragmentBlocks'] >= 13 and limits['combinedBlocks'] >= 27 and
                 limits['bindings'] >= 27 and limits['blockBytes'] >= 16384, 'actual full uniform hardware limits')
        for blob in acceptance['blobs']:
            raw = gzip.decompress(record(name + '/' + blob['path'], blob['gzipSha256']))
            need(len(raw) == blob['bytes'] and sha(raw) == blob['sha256'], 'full native blob custody')
        for frame in acceptance['frames']:
            need(frame['gpuComplete']['submitted'] and frame['gpuComplete']['fenced'] and frame['cleaned'] and
                 frame['audit']['held'] != fault and frame['calls'][0]['name'] == 'drawArrays', 'native completed pixels/cleanup')
        if fault:
            need('independent original uniform pixels after completed GPU fence' in report['failure']['message'], 'fault reached hardware pixels')

    node = json.loads(record('native/node.json'))
    need(node['status'] == 'passed' and node['cases'] == 508 and node['exactNativeWasm'] and node['getters'] == 0 and
         node['peerIsolation'] and node['ownedSnapshots'] and len(node['rejections']) == 61 and
         node['pressure']['bytes'] == 16777216 and node['pressure']['recovered'] and
         node['pressure']['scratchFailure']['error']['message'] == 'Checked upstream TGSI parsing failed.', 'native/Wasm/facade/genuine scratch OOM')
    metadata = json.loads(record('native/metadata-attacks.json'))
    need(metadata['status'] == 'passed' and len(metadata['records']) >= 90 and metadata['getters'] == 0 and
         metadata['ownedCopies'] and metadata['proxyTrapsRejected'], 'strict selected metadata admission')
    need(record('native/native.jsonl') == record('native/sanitize.jsonl'), 'native sanitized complete equality')
    allocations = [json.loads(row) for row in record('native/allocations.jsonl').splitlines()]
    summary = allocations[-1]
    need(summary['faults'] == summary['recoveries'] == 93 and summary['callerMutation'] and not summary['partialResults'], 'all genuine allocation failures')
    need(sum(row['kind'] in ['upstream-fault', 'calloc-fault'] for row in allocations) == 93 and
         sum(row['kind'] == 'caller-custody' for row in allocations) == 5, 'stage/pair/selectors allocation/source custody')

    retained = json.loads(record('compiler-retained/receipt.json'))
    need(retained['status'] == 'passed' and retained['gitHead'] == head and retained['cases'] == 669 and
         retained['frames'] == 129 and retained['legacyBoundary']['unchanged'], 'affected full compiler gate')
    for name, digest in retained['sources'].items():
        source(name, digest)
    for name, digest in retained['generated'].items():
        source(name, digest)
    for name, digest in retained['files'].items():
        if name != 'acceptance.log':
            record('compiler-retained/' + name, digest)
    for family, count, frames in [('packed', 59, 214), ('integer', 48, 348)]:
        prefix = 'retained-' + family
        need(record(prefix + '/native.jsonl') == record(prefix + '/sanitize.jsonl'), 'old ABI sanitized bytes')
        data = json.loads(record(prefix + '/node.json'))
        need(data['status'] == 'passed' and data['cases'] == count and data['exactNativeWasm'] and data['peerIsolation'] and
             data['getters'] == 0 and data['pressure']['recovered'] and data['pressure']['bytes'] == 16777216, 'old ABI complete C/Wasm recovery')
        rows = [json.loads(row) for row in record(prefix + '/allocations.jsonl').splitlines()]
        need(rows[-1]['faults'] == rows[-1]['recoveries'] == 40 and rows[-1]['callerMutation'], 'old ABI allocation faults')
        physical = json.loads(record(prefix + '/hardware/report.json'))
        need(physical['status'] == 'passed' and physical['gitHead'] == head and
             len(physical['browserResult']['result']['frames']) == frames and
             all(row['audit']['held'] and row['history'][-1]['result']['gpuComplete'] for row in physical['browserResult']['result']['frames']), 'old ABI original hardware pixels')
        for row in physical['sources']:
            source(row['path'], row['sha256'])
        for row in physical['browserResult']['result']['blobs']:
            raw = gzip.decompress(record(prefix + '/hardware/' + row['path'], row['gzipSha256']))
            need(len(raw) == row['bytes'] and sha(raw) == row['sha256'], 'old ABI full hardware storage')
        for mode in ['native', 'sanitize', 'allocation-sanitize']:
            binary = 'standard-' + family + ('-allocation-test' if mode == 'allocation-sanitize' else '-test')
            source('renderer/virgl-shader/build/standard-' + family + '-' + mode + '/' + binary)

    stack_frames = {}
    for file in (directory / 'compiler-retained/stack').glob('*.su'):
        for line in file.read_text().splitlines():
            fields = line.split('\t')
            stack_frames[fields[0].rsplit(':', 1)[-1]] = int(fields[1])
    stack = {}
    for mode, names in [('pair', ['bridge_translate_standard_uniform_pair', 'standard_pair']),
                        ('stage', ['bridge_translate_standard_uniform', 'standard_stage'])]:
        names += ['standard_convert', 'vrend_convert_shader', 'standard_emit']
        need(all(name in stack_frames for name in names), 'optimized actual uniform stack frames')
        observed = {name: stack_frames[name] for name in names}
        observed['conservativeBytes'] = sum(observed.values())
        need(observed['conservativeBytes'] < 262144, 'uniform compiler fits fixed stack')
        stack[mode] = observed
    need(not git('diff', '--name-only', PREDECESSOR, head, '--', 'crates', 'web', 'tools/guest'), 'unqualified guest/demo path unchanged')
    for name in git('ls-files', 'evidence/virgl-standard-*/worker/*', 'evidence/virgl-standard-*/verifier/*').splitlines():
        if name.startswith('evidence/virgl-standard-uniform/'):
            continue
        source(name)
        need((ROOT / name).read_bytes() == subprocess.check_output(['git', 'show', PREDECESSOR + ':' + name], cwd=ROOT), 'carried evidence drift')
        carried[name] = sources[name]
    coverage = json.loads(record('coverage-audit.json'))
    need(coverage['gitHead'] == head and coverage['predecessor'] == PREDECESSOR and coverage['fullRegionsRemainAuthority'] and coverage['llvm'], 'full native/served V8 counters')
    for name in git('ls-files', 'renderer/virgl-shader', 'renderer/virgl-command', 'tools/virgl-standard-uniform',
                    'tools/verify-virgl-standard-uniform.sh', 'tools/lib/virgl-browser-runner.mjs', 'Makefile',
                    'tasks/epic-6-transcendence/E6-T11d16-standard-uniform-shader.md').splitlines():
        source(name)
    for mode in ['native', 'sanitize', 'allocation-sanitize']:
        binary = 'standard-uniform' + ('-allocation-test' if mode == 'allocation-sanitize' else '-test')
        source('renderer/virgl-shader/build/standard-uniform-' + mode + '/' + binary)
    for file in directory.rglob('*'):
        if file.is_file() and file.name != 'receipt.json':
            record(file.relative_to(directory).as_posix())
    result = dict(schema='standard-uniform-shader-receipt-v1', task=TASK, status='passed', gitHead=head,
                  cases=508, compiles=397, frames=253, pixels=104844, checkedRawWords=audit['checkedWords'],
                  stack=stack, fixedMemoryBytes=16777216, scratchBytes=2097152,
                  authority='isolated-standard-uniform-shader', guestExecution=False, productionNegotiation=False,
                  productionDrawAuthority=False, historicalEvidenceHead=PREDECESSOR, carriedVerifiedEvidence=carried,
                  files=files, sources=sources, generated=generated)
    (directory / 'receipt.json').write_text(json.dumps(result, indent=2) + '\n')
    print('Frozen original uniform shaders, native hardware words/pixels, old ABIs and complete custody authenticated.')


if __name__ == '__main__':
    main(sys.argv[1])
