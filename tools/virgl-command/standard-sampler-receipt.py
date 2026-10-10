#!/usr/bin/env python3
"""Authenticate original sampler/native parameter/texel/pixel custody and carry."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
BASE = 'bdad14aff93ba70c09d60ab308df4d2024dce4ba'
TASK = 'E6-T11d19'
CONFIRMATION = 'Frozen original sampler state, native texels/parameters/pixels and verified dependencies authenticated.\n'
sha = lambda raw: hashlib.sha256(raw).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def need(value, message):
    if not value:
        raise ValueError(message)


def excluded_sampler(name, raw):
    """Carry exact unchanged code outside the sole changed sampler branch."""
    if name.endswith('/decoder.mjs'):
        start, end = raw.index(b'function decodeSamplerState('), raw.index(b'function decodeObject(')
    else:
        start = raw.index(b'        if (type === 7) {')
        end = raw.index(b'        check();', start)
    return raw[:start]+raw[end:]


def main(directory):
    directory = Path(directory).resolve()
    head, files, sources, generated = git('rev-parse', 'HEAD'), {}, {}, {}
    need(not git('diff', '--name-only', 'HEAD'), 'freeze tracked source before recording')

    def record(name, digest=None):
        raw = (directory/name).read_bytes()
        need(digest is None or sha(raw) == digest, 'record drift '+name)
        files[name] = sha(raw)
        return raw

    def source(name, digest=None):
        raw = (ROOT/name).read_bytes()
        need(digest is None or sha(raw) == digest, 'source drift '+name)
        if '/build/' in name:
            generated[name] = sha(raw)
        else:
            need(raw == subprocess.check_output(['git', 'show', head+':'+name], cwd=ROOT), 'unfrozen source '+name)
            sources[name] = sha(raw)

    for _ in range(500):
        if b'\nSAMPLER_STATE_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():
            break
        time.sleep(.01)
    else:
        raise ValueError('submission log incomplete')
    wire = json.loads(record('wire/report.json'))
    need(wire['gitHead'] == head and wire['task'] == TASK and wire['status'] == 'passed', 'original wire exact-head identity')
    need(len(wire['wire']['records']) == 8192 and len(wire['wire']['extra']) == 288, 'original core sampler wire corpus')
    for row in wire['sources']:
        source(row['path'], row['sha256'])
    physical = None
    for name in ['hardware', 'fault-wrap', 'fault-filter']:
        fault = name != 'hardware'
        report = json.loads(record(name+'/report.json'))
        need(report['task'] == TASK and report['gitHead'] == head and report['status'] == ('failed' if fault else 'passed'), 'physical exact-head identity '+name)
        need(report['fixedMemory'] == dict(bytes=16777216, stageExport='function', pairExport='function', typedPairExport='function', vertexFormatsExport='function', uniformExport='function', uniformPairExport='function'), 'actual fixed-memory compiler exports')
        need(report['browserErrors'] == dict(console=[], page=[], requests=[]), 'browser errors '+name)
        need(not report['browser']['headless'], 'headed physical proof')
        need(not any(any(w in a.lower() for w in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe']) or a.startswith('--disable-gpu') for a in report['browser']['commandLine']), 'software browser flags')
        result = report['partial'] if fault else report['browserResult']['result']
        need('Metal' in result['gpu']['renderer'] and 'M4' in result['gpu']['renderer'], 'actual M4 Metal')
        need(not result['guestExecution'] and not result['productionNegotiation'], 'authority boundary')
        served = {row['path']: row['sha256'] for row in report['servedFiles']}
        for row in report['sources']:
            source(row['path'], row['sha256'])
            if '/'+row['path'] in served:
                need(served['/'+row['path']] == row['sha256'], 'served source identity')
        for key in ['browserCoverage', 'screenshot']:
            record(name+'/'+report[key]['path'], report[key]['sha256'])
        coverage = json.loads(record(name+'/'+report['browserCoverage']['path']))
        need({'renderer/virgl-command/'+n+'.mjs' for n in ['state', 'decoder', 'resources', 'cache', 'constant-domain']} <= {row['source'] for row in coverage['scripts']}, 'complete runtime coverage closure')
        for row in coverage['scripts']:
            need(row['sha256'] == served['/'+row['source']], 'full-region coverage custody')
        need(len({row['key'] for row in result['blobs']}) == len(result['blobs']), 'unique full native blob keys')
        for row in result['blobs']:
            packed = record(name+'/'+row['path'], row['gzipSha256'])
            raw = gzip.decompress(packed)
            need(len(raw) == row['bytes'] and sha(raw) == row['sha256'], 'full native blob custody')
        for frame in result['frames']:
            need(result['runs'][frame['run']]['history'][frame['submission']]['result']['gpuComplete'] and frame['native'], 'actual native draw/fence')
            need(frame['audit']['held'] != fault, 'original completed-fence full pixels')
        for run in result['runs']:
            for owner in ['renderer', 'resources']:
                need(all(value == 0 for value in run['final'][owner]['budgets'].values()), 'final bounded cleanup')
            need(all(row['deleted'] == 1 for row in run['nativeSamplers']), 'native sampler retirement once')
        if fault:
            need(len(result['frames']) == 1 and 'independent original sampler pixels after completed fence' in report['browserResult']['error']['message'], 'sabotage fails original pixels after completed fence')
        else:
            physical = result
            need(len(result['frames']) >= 832, 'complete core sampler matrix')
            need(all(row['held'] for row in result['predictions']), 'all worker predictions held')
            need(len([row for row in result['ownership'] if row['kind'] == 'parameter-only']) == 72, 'finite/reversed native parameter round-trips')
            need(len(result['rejections']) == 3, 'allocation/parameter/delete failure controls')
    audit = json.loads(record('physical-audit.json'))
    need(audit['status'] == 'passed' and len(audit['frames']) == len(physical['frames']) and audit['nativeDraws'] == sum(len(frame['native']) for frame in physical['frames']) and len(audit['faults']) == 2, 'independent original packet/texel/full-pixel audit')
    coverage = json.loads(record('coverage-audit.json'))
    need(coverage['gitHead'] == head and coverage['predecessor'] == BASE and coverage['fullRegionsRemainAuthority'], 'affected diff coverage')
    for name, task in [('retained-command-decoder', 'E6-T12a'), ('retained-object-state', 'E6-T12c'), ('retained-standard-state', 'E6-T11d5')]:
        report = json.loads(record(name+'/report.json'))
        need(report['status'] == 'passed' and report['gitHead'] == head and report['task'] == task, 'affected old sampler/state gate '+name)
        for row in report['sources']:
            source(row['path'], row['sha256'])
    boundaries = {}
    for name in ['renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/state.mjs']:
        original = subprocess.check_output(['git', 'show', BASE+':'+name], cwd=ROOT)
        current = (ROOT/name).read_bytes()
        need(excluded_sampler(name, original) == excluded_sampler(name, current), 'runtime diff escapes sole original sampler boundary')
        boundaries[name] = sha(excluded_sampler(name, current))
    for name in ['renderer/virgl-command/resources.mjs', 'renderer/virgl-command/cache.mjs', 'renderer/virgl-command/constant-domain.mjs']:
        source(name)
        need((ROOT/name).read_bytes() == subprocess.check_output(['git', 'show', BASE+':'+name], cwd=ROOT), 'unchanged buffer/ownership dependency')
        boundaries[name] = sources[name]
    need(not git('diff', '--name-only', BASE, head, '--', 'renderer/virgl-shader', 'crates', 'web', 'tools/guest'), 'compiler and unqualified production boundaries unchanged')
    carried = {}
    for name in git('ls-files', 'evidence/virgl-standard-buffer-roles/worker', 'evidence/virgl-standard-buffer-roles/verifier/manifest.json', 'evidence/virgl-standard-buffer-roles/verifier/records.json', 'evidence/virgl-standard-buffer-roles/verifier/recording.tar.gz', 'evidence/virgl-standard-uniform/worker-offset-repair', 'evidence/virgl-standard-uniform/verifier-offset-repair', 'evidence/virgl-standard-uniform-bindings/worker', 'evidence/virgl-standard-uniform-bindings/verifier/manifest.json', 'evidence/virgl-standard-uniform-bindings/verifier/records.json', 'evidence/virgl-standard-uniform-bindings/verifier/recording.tar.gz').splitlines():
        source(name)
        need((ROOT/name).read_bytes() == subprocess.check_output(['git', 'show', BASE+':'+name], cwd=ROOT), 'verified inherited evidence changed')
        carried[name] = sources[name]
    for prefix in ['virgl-standard-buffer-roles/worker', 'virgl-standard-buffer-roles/verifier', 'virgl-standard-uniform/worker-offset-repair', 'virgl-standard-uniform/verifier-offset-repair', 'virgl-standard-uniform-bindings/worker', 'virgl-standard-uniform-bindings/verifier']:
        prefix = 'evidence/'+prefix+'/'
        manifest = json.loads((ROOT/(prefix+'manifest.json')).read_text())
        need(carried[prefix+'recording.tar.gz'] == manifest['archiveSha256'] and carried[prefix+'records.json'] == manifest['recordIndexSha256'], 'authenticated predecessor evidence digests')
    for name in git('ls-files', 'renderer/virgl-shader', 'renderer/virgl-command', 'tools/verify-virgl-standard-sampler-state*', 'tools/virgl-command/standard-sampler*', 'Makefile', 'tasks/epic-6-transcendence/E6-T11d19-standard-sampler-state.md').splitlines():
        source(name)
    for file in directory.rglob('*'):
        if file.is_file() and file.name != 'receipt.json':
            record(file.relative_to(directory).as_posix())
    receipt = dict(schema='original-core-sampler-receipt-v1', task=TASK, status='passed', gitHead=head,
                   frames=len(physical['frames']), pixels=audit['pixels'], nativeDraws=audit['nativeDraws'],
                   historicalEvidenceHead=BASE, carriedVerifiedEvidence=carried, carriedUnchangedBoundaries=boundaries,
                   sources=sources, generated=generated, files=files, guestExecution=False, productionNegotiation=False,
                   authority='isolated-original-core-sampler-state', productionDrawAuthority=False)
    (directory/'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
    print(CONFIRMATION, end='')


if __name__ == '__main__':
    main(sys.argv[1])
