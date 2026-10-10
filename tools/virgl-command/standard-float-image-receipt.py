#!/usr/bin/env python3
"""Authenticate complete original float words, native planes and exact sources."""
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
BASE = '6ec464d9b9d1daecd01a0dd5ac58d31ac23910fe'
TASK = 'E6-T11d25'
CONFIRMATION = 'Frozen original floating words, native planes and retained ranges authenticated.\n'
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
        if b'\nFLOAT_IMAGE_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():
            break
        time.sleep(.01)
    else:
        raise ValueError('submission log incomplete')
    wire = json.loads(record('wire/report.json'))
    need(wire['gitHead'] == head and wire['task'] == TASK and wire['status'] == 'passed', 'original wire exact-head identity')
    need(len(wire['wire']['records']) == 240 and all(p['held'] for p in wire['wire']['predictions']), 'complete original wire/budget refusals')
    for row in wire['sources']:
        source(row['path'], row['sha256'])
    half = json.loads(record('half-representation.json'))
    audit = json.loads(record('half-audit.json'))
    need(half['gitHead'] == head and audit['gitHead'] == head and audit['status'] == 'passed', 'rounding exact-head identity')
    need(audit['inputSha256'] == files['half-representation.json'], 'complete rounding custody')
    need(audit['originalFiniteAndInf'] == 63490 and audit['originalNan'] == 2046 and audit['originalBinary32Rounding'] == 190474, 'all original half words and independent midpoint boundaries')
    for row in half['sources']:
        source(row['path'], row['sha256'])
    names = ['hardware-matrix']+['hardware-boundaries-'+s for s in ['0xa5471e03', '0x13579bdf', '0x9e3779b9']]
    faults = ['fault-'+n for n in ['upload-lane', 'storage-precision', 'copy-level']]
    for name in names+faults:
        fault = name.startswith('fault-')
        report = json.loads(record(name+'/report.json'))
        need(report['task'] == TASK and report['gitHead'] == head and report['status'] == ('failed' if fault else 'passed'), 'physical exact-head identity '+name)
        need(report['browserErrors'] == dict(console=[], page=[], requests=[]), 'browser errors '+name)
        need(not report['browser']['headless'], 'headed physical proof')
        need(not any(any(w in a.lower() for w in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe']) or a.startswith('--disable-gpu') for a in report['browser']['commandLine']), 'software browser flags')
        result = report['partial'] if fault else report['browserResult']['result']
        need('Metal' in result['gpu'] and 'M4' in result['gpu'], 'actual M4 Metal')
        need(not result['guestExecution'] and not result['productionNegotiation'] and not result['productionDrawAuthority'], 'isolated image authority')
        served = {row['path']: row['sha256'] for row in report['servedFiles']}
        for row in report['sources']:
            source(row['path'], row['sha256'])
            if '/'+row['path'] in served:
                need(served['/'+row['path']] == row['sha256'], 'served source identity')
        for key in ['browserCoverage', 'screenshot']:
            record(name+'/'+report[key]['path'], report[key]['sha256'])
        coverage = json.loads(record(name+'/'+report['browserCoverage']['path']))
        need({'renderer/virgl-command/'+n+'.mjs' for n in ['resources', 'float-images']} <= {row['source'] for row in coverage['scripts']}, 'complete changed runtime coverage')
        for row in coverage['scripts']:
            need(row['sha256'] == served['/'+row['source']], 'full-region coverage custody')
        need(len({row['key'] for row in result['blobs']}) == len(result['blobs']), 'unique full native blob keys')
        for row in result['blobs']:
            packed = record(name+'/'+row['path'], row['gzipSha256'])
            raw = gzip.decompress(packed)
            need(len(raw) == row['bytes'] and sha(raw) == row['sha256'], 'full native blob custody')
        for run in result['runs']:
            need(all(value == 0 for value in run['final']['budgets'].values()), 'bounded resource cleanup')
            need(all(row['deleted'] == 1 for row in run['nativeObjects']), 'each physical image/FBO/buffer retires once')
        if fault:
            need(result['sabotage']['fenceCompleted'] and not result['sabotage']['held'], 'sabotage original oracle failure after completed native fence')
            need(any(run['faultEvents'] for run in result['runs']), 'actual native selection fault executes')
            need('original' in report['browserResult']['error']['message'], 'unchanged original oracle detects native fault')
        else:
            need(all(row['held'] for row in result['predictions']), 'all worker predictions held')
            need(len(result['runs']) == (96 if name == 'hardware-matrix' else 16), 'full format/schedule/native-failure matrix')
            if name != 'hardware-matrix':
                need(result['seed'] == int(name.rsplit('-', 1)[1], 16), 'native schedule seed')
                need(result['hostRefusal']['result']['error']['code'] == 'unsupported-host' and result['hostRefusal']['nativeAllocations'] == 0, 'extension refusal before native allocation')
    values = json.loads(record('independent-values.json'))
    need(values['status'] == 'passed' and values['runs'] == 144 and len(values['faults']) == 3, 'independent complete original plane/representation inverse')
    need(values['nativeComponents'] > 10000 and values['publicComponents'] > 30000 and values['footprintChecks'] > 1000, 'independent values/physical byte footprints')
    need(all(r['status'] == 'refuted' and r['fenceCompleted'] for r in values['faults']), 'all physical faults independently refuted')
    coverage = json.loads(record('coverage-audit.json'))
    need(coverage['gitHead'] == head and coverage['predecessor'] == BASE and coverage['fullRegionsRemainAuthority'], 'affected diff coverage')
    for name, task in [('retained-async-jobs', 'E6-T11b1'), ('retained-uniform-bindings', 'E6-T11d17'), ('retained-byte-colors', 'E6-T11d22'), ('retained-texture-consumer', 'E6-T11d24')]:
        report = json.loads(record(name+'/report.json'))
        need(report['status'] == 'passed' and report['gitHead'] == head and report['task'] == task, 'affected historical native gate '+name)
        for row in report['sources']:
            source(row['path'], row['sha256'])
    boundaries = {}
    inverse = json.loads((ROOT/'tools/virgl-command/standard-float-image-boundary.json').read_text())
    need(inverse['predecessor'] == BASE and len(inverse['changes']) == 27, 'complete explicit product/dependency inverse')
    for name, rows in inverse['changes'].items():
        current = (ROOT/name).read_text()
        for row in reversed(rows):
            need(current.count(row['after']) == 1, 'unambiguous original float migration '+name)
            current = current.replace(row['after'], row['before'], 1)
        original = subprocess.check_output(['git', 'show', BASE+':'+name], cwd=ROOT)
        need(current.encode() == original, 'diff escapes explicit resource/HTTP boundary '+name)
        boundaries[name] = sha(original)
    for name in ['renderer/virgl-command/'+n+'.mjs' for n in ['decoder', 'state', 'cache', 'constant-domain', 'color-images']]:
        source(name)
        need((ROOT/name).read_bytes() == subprocess.check_output(['git', 'show', BASE+':'+name], cwd=ROOT), 'unchanged consumer/wire/cache boundary')
        boundaries[name] = sources[name]
    need(not git('diff', '--name-only', BASE, head, '--', 'renderer/virgl-shader', 'crates', 'web', 'tools/guest'), 'unqualified compiler/guest/production surfaces unchanged')
    carried = {}
    for prefix in ['evidence/virgl-standard-texture-operations', 'evidence/virgl-standard-byte-color-images']:
        for name in git('ls-files', prefix).splitlines():
            source(name)
            need((ROOT/name).read_bytes() == subprocess.check_output(['git', 'show', BASE+':'+name], cwd=ROOT), 'verified inherited evidence changed')
            carried[name] = sources[name]
        for suffix in ['worker', 'verifier']:
            folder = prefix+'/'+suffix+'/'
            manifest = json.loads((ROOT/(folder+'manifest.json')).read_text())
            need(carried[folder+'recording.tar.gz'] == manifest['archiveSha256'] and carried[folder+'records.json'] == manifest['recordIndexSha256'], 'authenticated exact predecessor archive/index')
    descriptors = json.loads((ROOT/'tools/virgl-command/standard-float-image-formats.json').read_text())
    header = (ROOT/'renderer/virgl-shader/vendor/src/virgl_hw.h').read_bytes()
    need(sha(header) == descriptors['headerSha256'], 'original enum header pin')
    original_table = (ROOT/descriptors['sourceFile']).read_bytes()
    need(sha(original_table) == descriptors['yamlSha256'], 'complete original Mesa format table pin')
    original_lines = original_table.decode().splitlines(keepends=True)
    for row in descriptors['records']:
        need(sha(row['descriptor'].encode()) == row['descriptorSha256'], 'original Mesa descriptor pin')
        line = row['sourceLine']-1
        need(''.join(original_lines[line:line+len(row['descriptor'].splitlines())]) == row['descriptor'], 'descriptor is the complete original source record')
        need(int(re.search(r'VIRGL_FORMAT_'+row['name']+r'\s*=\s*(\d+)', header.decode())[1]) == row['format'], 'original public format ID')
    paths = git('ls-files', 'renderer/virgl-command', 'renderer/virgl-shader', 'tools/verify-virgl-standard-float-images*', 'tools/virgl-command/standard-float-image*', 'Makefile', 'tasks/epic-6-transcendence/E6-T11d25-standard-float-images.md').splitlines()
    for name in set(paths)|set(inverse['changes']):
        source(name)
    for file in directory.rglob('*'):
        if file.is_file() and file.name != 'receipt.json':
            record(file.relative_to(directory).as_posix())
    receipt = dict(schema='original-float-image-receipt-v1', task=TASK, status='passed', gitHead=head,
                   nativeRuns=144, nativeSchedules=3, halfPatterns=65536, roundingPatterns=190474,
                   valueAudit=values, historicalEvidenceHead=BASE, carriedVerifiedEvidence=carried,
                   carriedUnchangedBoundaries=boundaries, sources=sources, generated=generated, files=files,
                   guestExecution=False, productionNegotiation=False, authority='isolated-original-float-images', productionDrawAuthority=False)
    (directory/'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
    print(CONFIRMATION, end='')


if __name__ == '__main__':
    main(sys.argv[1])
