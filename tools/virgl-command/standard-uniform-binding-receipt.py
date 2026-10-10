#!/usr/bin/env python3
"""Authenticate original uniform packet/native word/pixel custody and D16 carry."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
BASE = '3ec060c46a9743a62306ae409d0bf1a548d4a616'
TASK = 'E6-T11d17'
CONFIRMATION = 'Frozen original uniform bindings, full native storage/pixels and compiler carry authenticated.\n'
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
        if b'\nUNIFORM_BINDINGS_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():
            break
        time.sleep(.01)
    else:
        raise ValueError('submission log incomplete')
    wire = json.loads(record('wire/report.json'))
    need(wire['task'] == TASK and wire['gitHead'] == head and wire['status'] == 'passed', 'original wire identity')
    need(len(wire['wire']['records']) == 67 and wire['wire']['status'] == 'passed', 'original wire bounds')
    for row in wire['sources']:
        source(row['path'], row['sha256'])
    physical = None
    for name in ['hardware', 'fault-block-word', 'fault-range-offset', 'fault-slot-zero-variant']:
        fault = name != 'hardware'
        report = json.loads(record(name+'/report.json'))
        need(report['task'] == TASK and report['gitHead'] == head and report['status'] == ('failed' if fault else 'passed'), 'physical identity '+name)
        need(report['fixedMemory'] == dict(bytes=16777216, stageExport='function', pairExport='function', typedPairExport='function', vertexFormatsExport='function', uniformExport='function', uniformPairExport='function'), 'actual fixed-memory compiler')
        need(report['browserErrors'] == dict(console=[], page=[], requests=[]), 'browser errors '+name)
        need(not report['browser']['headless'], 'headed physical proof')
        need(not any(any(w in a.lower() for w in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe']) or a.startswith('--disable-gpu') for a in report['browser']['commandLine']), 'software flags')
        served = {row['path']: row['sha256'] for row in report['servedFiles']}
        mutation = report.get('mutation')
        for row in report['sources']:
            source(row['path'], row['sha256'])
            if '/'+row['path'] in served:
                need(served['/'+row['path']] == (mutation['servedSha256'] if mutation and row['path'] == mutation['path'] else row['sha256']), 'served source identity')
        for key in ['browserCoverage', 'screenshot']:
            record(name+'/'+report[key]['path'], report[key]['sha256'])
        coverage = json.loads(record(name+'/'+report['browserCoverage']['path']))
        need({'renderer/virgl-command/'+n+'.mjs' for n in ['state', 'decoder', 'resources', 'cache', 'constant-domain']} <= {row['source'] for row in coverage['scripts']}, 'complete runtime coverage closure')
        for row in coverage['scripts']:
            need(row['sha256'] == served['/'+row['source']], 'coverage custody')
        result = report['partial'] if fault else report['browserResult']['result']
        need(not result['guestExecution'] and not result['productionNegotiation'], 'authority boundary')
        for row in result['blobs']:
            packed = record(name+'/'+row['path'], row['gzipSha256'])
            raw = gzip.decompress(packed)
            need(len(raw) == row['bytes'] and sha(raw) == row['sha256'], 'full native blob custody')
        for frame in result['frames']:
            need(frame['history'][-1]['result']['gpuComplete'] and frame['native'], 'actual native draw/fence')
            need(frame['audit']['held'] != fault, 'original completed-fence pixels')
        if fault:
            need(len(result['frames']) == 1, 'one completed sabotage frame')
            need('independent original uniform pixels after completed fence' in report['browserResult']['error']['message'], 'sabotage must fail pixels')
            if mutation:
                original = (ROOT/mutation['path']).read_bytes()
                need(original.count(mutation['needle'].encode()) == 1, 'one source sabotage site')
                need(record(name+'/mutation-source.mjs', mutation['servedSha256']) == original.replace(mutation['needle'].encode(), mutation['replacement'].encode()), 'exact native variant fault')
        else:
            physical = result
            need(len(result['frames']) >= 151 and len(result['suspensions']) == 18, 'complete original boundary matrix')
            need(all(row['held'] for row in result['predictions']), 'all worker predictions held')
            for run in result['runs']:
                for owner in ['renderer', 'resources']:
                    need(all(value == 0 for value in run['final'][owner]['budgets'].values()), 'final bounded cleanup')
                need(run['final']['uniformAccess']['pending'] == run['final']['uniformAccess']['submitted'] == 0, 'uniform snapshots retired')
    audit = json.loads(record('physical-audit.json'))
    need(audit['status'] == 'passed' and len(audit['frames']) == len(physical['frames']) and audit['nativeDraws'] == sum(len(frame['native']) for frame in physical['frames']) and len(audit['faults']) == 3, 'independent original packet/word/full-pixel audit')
    coverage = json.loads(record('coverage-audit.json'))
    need(coverage['gitHead'] == head and coverage['predecessor'] == BASE and coverage['fullRegionsRemainAuthority'], 'affected diff coverage')
    resources = json.loads(record('retained-resources/receipt.json'))
    need(resources['status'] == 'passed' and resources['gitHead'] == head, 'affected old resource gate')
    for name in ['retained-standard-wire', 'retained-standard-hardware']:
        report = json.loads(record(name+'/report.json'))
        need(report['status'] == 'passed' and report['gitHead'] == head and report['task'] == 'E6-T11d15', 'affected old standard renderer gate')
        for row in report['sources']:
            source(row['path'], row['sha256'])
    need(not git('diff', '--name-only', BASE, head, '--', 'renderer/virgl-shader', 'crates', 'web', 'tools/guest'), 'compiler and unqualified production boundaries unchanged')
    carried = {}
    for name in git('ls-files', 'evidence/virgl-standard-uniform/worker-offset-repair', 'evidence/virgl-standard-uniform/verifier-offset-repair').splitlines():
        source(name)
        need((ROOT/name).read_bytes() == subprocess.check_output(['git', 'show', BASE+':'+name], cwd=ROOT), 'verified compiler carry changed')
        carried[name] = sources[name]
    for seal in ['worker-offset-repair', 'verifier-offset-repair']:
        prefix = 'evidence/virgl-standard-uniform/'+seal+'/'
        manifest = json.loads((ROOT/(prefix+'manifest.json')).read_text())
        need(carried[prefix+'recording.tar.gz'] == manifest['archiveSha256'] and carried[prefix+'records.json'] == manifest['recordIndexSha256'], 'authenticated predecessor evidence digest')
    for name in git('ls-files', 'renderer/virgl-shader', 'renderer/virgl-command', 'tools/verify-virgl-standard-uniform-bindings*', 'tools/virgl-command/standard-uniform-binding*', 'Makefile', 'tasks/epic-6-transcendence/E6-T11d17-standard-uniform-buffer-bindings.md').splitlines():
        source(name)
    for file in directory.rglob('*'):
        if file.is_file() and file.name != 'receipt.json':
            record(file.relative_to(directory).as_posix())
    receipt = dict(schema='original-uniform-binding-receipt-v1', task=TASK, status='passed', gitHead=head,
                   frames=len(physical['frames']), pixels=audit['pixels'], guestBlocks=audit['guestBlocks'],
                   historicalEvidenceHead=BASE, carriedVerifiedEvidence=carried, sources=sources,
                   generated=generated, files=files, guestExecution=False, productionNegotiation=False,
                   authority='isolated-original-uniform-buffer-bindings', productionDrawAuthority=False)
    (directory/'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
    print(CONFIRMATION, end='')


if __name__ == '__main__':
    main(sys.argv[1])
