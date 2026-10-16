#!/usr/bin/env python3
"""Authenticate original image words, physical GPU observations and custody."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
BASE = 'c0488902039a5fb5f9efc8c62101798668b2ce4a'
TASK = 'E6-T11d21'
CONFIRMATION = 'Frozen original image ranges, native planes/pixels and verified dependencies authenticated.\n'
sha = lambda raw: hashlib.sha256(raw).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def need(value, message):
    if not value:
        raise ValueError(message)


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
        if b'\nIMAGE_SUBRESOURCES_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():
            break
        time.sleep(.01)
    else:
        raise ValueError('submission log incomplete')
    wire = json.loads(record('wire/report.json'))
    need(wire['gitHead'] == head and wire['task'] == TASK and wire['status'] == 'passed', 'original wire exact-head identity')
    need(len(wire['wire']['records']) == 750 and all(p['held'] for p in wire['wire']['predictions']), 'original bounded image wire corpus')
    for row in wire['sources']:
        source(row['path'], row['sha256'])
    healthy = {}
    names = ['hardware-matrix']+['hardware-boundaries-'+s for s in ['0xa5471e03', '0x13579bdf', '0x9e3779b9']]
    for name in names+['fault-copy-level', 'fault-surface-level']:
        fault = name.startswith('fault-')
        report = json.loads(record(name+'/report.json'))
        need(report['task'] == TASK and report['gitHead'] == head and report['status'] == ('failed' if fault else 'passed'), 'physical exact-head identity '+name)
        need(report['fixedMemory']['bytes'] == 16777216 and all(report['fixedMemory'][k] == 'function' for k in ['stageExport', 'pairExport', 'typedPairExport', 'vertexFormatsExport', 'uniformExport', 'uniformPairExport']), 'actual unchanged fixed-memory compiler exports')
        need(report['browserErrors'] == dict(console=[], page=[], requests=[]), 'browser errors '+name)
        need(not report['browser']['headless'], 'headed physical proof')
        need(not any(any(w in a.lower() for w in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe']) or a.startswith('--disable-gpu') for a in report['browser']['commandLine']), 'software browser flags')
        result = report['partial'] if fault else report['browserResult']['result']
        need('Metal' in result['gpu'] and 'M4' in result['gpu'], 'actual M4 Metal')
        need(not result['guestExecution'] and not result['productionNegotiation'], 'authority boundary')
        served = {row['path']: row['sha256'] for row in report['servedFiles']}
        for row in report['sources']:
            source(row['path'], row['sha256'])
            if '/'+row['path'] in served:
                need(served['/'+row['path']] == row['sha256'], 'served source identity')
        for key in ['browserCoverage', 'screenshot']:
            record(name+'/'+report[key]['path'], report[key]['sha256'])
        coverage = json.loads(record(name+'/'+report['browserCoverage']['path']))
        need({'renderer/virgl-command/'+n+'.mjs' for n in ['resources', 'decoder', 'state']} <= {row['source'] for row in coverage['scripts']}, 'complete changed runtime coverage')
        for row in coverage['scripts']:
            need(row['sha256'] == served['/'+row['source']], 'full-region coverage custody')
        need(len({row['key'] for row in result['blobs']}) == len(result['blobs']), 'unique full native blob keys')
        for row in result['blobs']:
            packed = record(name+'/'+row['path'], row['gzipSha256'])
            raw = gzip.decompress(packed)
            need(len(raw) == row['bytes'] and sha(raw) == row['sha256'], 'full native blob custody')
        for run in result['runs']:
            need(all(value == 0 for value in run['final']['resources']['budgets'].values()), 'final bounded resource cleanup')
            need(all(value == 0 for value in run['final']['renderer']['budgets'].values()), 'final bounded renderer cleanup')
            need(all(row['deleted'] == 1 for row in run['nativeObjects']), 'each native image/FBO/buffer/program retires once')
        if fault:
            need(result['sabotage']['fenceCompleted'] and not result['sabotage']['held'], 'sabotage requires original oracle failure after completed native fence')
            expected = ('independent original image boundary pixels after completed native fence' if name.endswith('copy-level') else 'independent original selected plane after completed native fence')
            need(expected in report['browserResult']['error']['message'], 'sabotage must fail the unchanged original full oracle')
            need(any(run['faultEvents'] for run in result['runs']), 'actual native selection sabotage executes')
        else:
            healthy[name] = result
            need(all(row['held'] for row in result['predictions']), 'all worker predictions held')
            if name == 'hardware-matrix':
                need(len(result['runs']) == 24 and len(result['frames']) == 936, 'complete admitted full/truncated format/range/filter matrix')
            else:
                need(result['seed'] == int(name.rsplit('-', 1)[1], 16), 'independent native schedule seed')
                need(len(result['runs']) == 33 and len(result['predictions']) >= 100000, 'complete format/level/identity/lifetime/budget/native-error boundaries')
    audit = json.loads(record('physical-audit.json'))
    need(audit['status'] == 'passed' and audit['pixels'] == 936*64 and audit['draws'] >= 1000 and len(audit['faults']) == 2, 'independent complete original image/plane/pixel audit')
    need(all(r['status'] == 'held' for r in audit['rows'] if not r['record'].startswith('fault-')), 'all independent healthy original inverse predictions held')
    need(all(r['fenceCompleted'] for r in audit['faults']), 'both independent native faults have completed physical fences')
    coverage = json.loads(record('coverage-audit.json'))
    need(coverage['gitHead'] == head and coverage['predecessor'] == BASE and coverage['fullRegionsRemainAuthority'], 'affected diff coverage')
    for name, task in [('retained-command-decoder', 'E6-T12a'), ('retained-resource-transfers', 'E6-T12b'), ('retained-color-formats', 'E6-T12g2'), ('retained-async-jobs', 'E6-T11b1'), ('retained-standard-sampler', 'E6-T11d19')]:
        report = json.loads(record(name+'/report.json'))
        need(report['status'] == 'passed' and report['gitHead'] == head and report['task'] == task, 'affected old boundary gate '+name)
        for row in report['sources']:
            source(row['path'], row['sha256'])
    boundaries = {}
    inverse = json.loads((ROOT/'tools/virgl-command/standard-image-boundary.json').read_text())
    need(sum(len(rows) for rows in inverse['changes'].values()) == 48, 'complete explicit product boundary inverse')
    for name, rows in inverse['changes'].items():
        current = (ROOT/name).read_text()
        for row in reversed(rows):
            need(current.count(row['after']) == 1, 'unambiguous original image migration '+name)
            current = current.replace(row['after'], row['before'], 1)
        original = subprocess.check_output(['git', 'show', BASE+':'+name], cwd=ROOT)
        need(current.encode() == original, 'runtime diff escapes explicit image selection/lifetime/native copy boundary '+name)
        boundaries[name] = sha(original)
    for name in ['renderer/virgl-command/cache.mjs', 'renderer/virgl-command/constant-domain.mjs']:
        source(name)
        need((ROOT/name).read_bytes() == subprocess.check_output(['git', 'show', BASE+':'+name], cwd=ROOT), 'unchanged compiler/cache/constant boundary')
        boundaries[name] = sources[name]
    need(not git('diff', '--name-only', BASE, head, '--', 'renderer/virgl-shader', 'crates', 'web', 'tools/guest'), 'compiler and unqualified production boundaries unchanged')
    carried = {}
    for name in git('ls-files', 'evidence/virgl-standard-texture-storage').splitlines():
        source(name)
        need((ROOT/name).read_bytes() == subprocess.check_output(['git', 'show', BASE+':'+name], cwd=ROOT), 'verified inherited mip evidence changed')
        carried[name] = sources[name]
    for suffix in ['worker', 'verifier']:
        prefix = 'evidence/virgl-standard-texture-storage/'+suffix+'/'
        manifest = json.loads((ROOT/(prefix+'manifest.json')).read_text())
        need(carried[prefix+'recording.tar.gz'] == manifest['archiveSha256'] and carried[prefix+'records.json'] == manifest['recordIndexSha256'], 'authenticated predecessor evidence digests')
    for name in git('ls-files', 'renderer/virgl-shader', 'renderer/virgl-command', 'tools/verify-virgl-standard-image-subresources*', 'tools/virgl-command/standard-image*', 'Makefile', 'tasks/epic-6-transcendence/E6-T11d21-standard-image-subresources.md').splitlines():
        source(name)
    for file in directory.rglob('*'):
        if file.is_file() and file.name != 'receipt.json':
            record(file.relative_to(directory).as_posix())
    receipt = dict(schema='original-image-subresources-receipt-v1', task=TASK, status='passed', gitHead=head,
                   frames=len(healthy['hardware-matrix']['frames']), nativeDraws=audit['draws'], pixels=audit['pixels'], texels=audit['texels'], nativeSchedules=3,
                   historicalEvidenceHead=BASE, carriedVerifiedEvidence=carried, carriedUnchangedBoundaries=boundaries,
                   sources=sources, generated=generated, files=files, guestExecution=False, productionNegotiation=False,
                   authority='isolated-original-image-ranges-surfaces', productionDrawAuthority=False)
    (directory/'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
    print(CONFIRMATION, end='')


if __name__ == '__main__':
    main(sys.argv[1])
