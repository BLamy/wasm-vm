#!/usr/bin/env python3
"""Authenticate original mip transfers/native texels and inherited boundaries."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
BASE = '52d3cc4e2f0f28d82a2900ff33ab855ae118e66e'
TASK = 'E6-T11d20'
CONFIRMATION = 'Frozen original mip storage, native texels/transfers and verified dependencies authenticated.\n'
sha = lambda raw: hashlib.sha256(raw).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def need(value, message):
    if not value:
        raise ValueError(message)


def outside_storage(name, raw):
    s = raw.decode()
    if name.endswith('/decoder.mjs'):
        s = s.replace('export const STANDARD_TEXTURE_PROFILE = "virgl-standard-texture-commands-v1";\n', '')
        s = s.replace(', textures = false', '').replace('; this.textures = textures', '')
        s = s.replace(', textures);', ');')
        s = s.replace('textures ? STANDARD_TEXTURE_PROFILE : ', '')
        for line in s.splitlines(keepends=True):
            if 'Transfer level exceeds the selected storage profile.' in line or 'Only level zero transfers are supported.' in line:
                s = s.replace(line, '  // selected transfer-level admission\n')
        marker = '/** Host-owned facet; a guest provenance/options property cannot enable levels. */'
        if marker in s:
            a, b = s.index(marker), s.index('function decode(', s.index(marker))
            s = s[:a]+s[b:]
        s = s.replace('true, true, true);', 'true, true);')
    else:
        for start, end in [('function normalizeMetadata(', 'function inlineWords('),
                           ('function layoutFor(', 'const scratchCharge')]:
            a, b = s.index(start), s.index(end)
            s = s[:a]+'// selected checked storage metadata/layout\n'+s[b:]
        marker = '/** Host-selected original multilevel 2D storage; view/draw consumers stay gated. */'
        if marker in s:
            a, b = s.index(marker), s.index('function createStore(', s.index(marker))
            s = s[:a]+s[b:]
        s = s.replace(', mipmaps = false', '').replace('uniform, bufferRoles, mipmaps)', 'uniform, bufferRoles)')
        s = s.replace('["texture", "mip-texture"].includes(res.meta.kind)', 'res.meta.kind === "texture"')
        s = s.replace('const initializeXAlpha = (texture, level = 0)', 'const initializeXAlpha = (texture)')
        s = s.replace('gl.TEXTURE_2D, texture, level);', 'gl.TEXTURE_2D, texture, 0);')
        s = s.replace(' || meta.kind === "mip-texture"', '')
        s = s.replace('gl.texStorage2D(gl.TEXTURE_2D, meta.lastLevel + 1,', 'gl.texStorage2D(gl.TEXTURE_2D, 1,')
        s = s.replace('if (meta.format === 233) for (let level = 0; level <= meta.lastLevel; level++) initializeXAlpha(texture, level);', 'if (meta.format === 233) initializeXAlpha(texture);')
        s = s.replace('converted ? 0 : layout.level ?? 0', '0').replace('layout.level ?? 0', '0')
    return s.encode()


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
        if b'\nTEXTURE_STORAGE_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():
            break
        time.sleep(.01)
    else:
        raise ValueError('submission log incomplete')
    wire = json.loads(record('wire/report.json'))
    need(wire['gitHead'] == head and wire['task'] == TASK and wire['status'] == 'passed', 'original wire exact-head identity')
    need(len(wire['wire']['records']) == 1062 and all(p['held'] for p in wire['wire']['predictions']), 'original bounded mip wire corpus')
    for row in wire['sources']:
        source(row['path'], row['sha256'])
    physical = None
    for name in ['hardware', 'fault-upload-level', 'fault-read-level']:
        fault = name != 'hardware'
        report = json.loads(record(name+'/report.json'))
        need(report['task'] == TASK and report['gitHead'] == head and report['status'] == ('failed' if fault else 'passed'), 'physical exact-head identity '+name)
        need(report['fixedMemory']['bytes'] == 16777216 and all(report['fixedMemory'][k] == 'function' for k in ['stageExport','pairExport','typedPairExport','vertexFormatsExport','uniformExport','uniformPairExport']), 'actual unchanged fixed-memory compiler exports')
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
        need({'renderer/virgl-command/'+n+'.mjs' for n in ['resources', 'decoder']} <= {row['source'] for row in coverage['scripts']}, 'complete changed runtime coverage')
        for row in coverage['scripts']:
            need(row['sha256'] == served['/'+row['source']], 'full-region coverage custody')
        need(len({row['key'] for row in result['blobs']}) == len(result['blobs']), 'unique full native blob keys')
        for row in result['blobs']:
            packed = record(name+'/'+row['path'], row['gzipSha256'])
            raw = gzip.decompress(packed)
            need(len(raw) == row['bytes'] and sha(raw) == row['sha256'], 'full native blob custody')
        for run in result['runs']:
            need(all(value == 0 for value in run['final']['budgets'].values()), 'final bounded cleanup')
            need(all(row['deleted'] == 1 for row in run['objects']), 'each native image/PBO/fence retires once')
        if fault:
            need(result['sabotage']['fenceCompleted'] and not result['sabotage']['held'] and 'independent original level oracle after completed native fence' in report['browserResult']['error']['message'], 'sabotage fails original inverse after completed native fence')
        else:
            physical = result
            need(len(result['levels']) >= 1192 and len(result['runs']) == 72, 'complete color/NPOT/level/transfer matrix')
            need(all(row['held'] for row in result['predictions']), 'all worker predictions held')
    audit = json.loads(record('physical-audit.json'))
    need(audit['status'] == 'passed' and len(audit['rows']) == len(physical['levels']) and len(audit['faults']) == 2, 'independent complete original mip/transfer/native audit')
    coverage = json.loads(record('coverage-audit.json'))
    need(coverage['gitHead'] == head and coverage['predecessor'] == BASE and coverage['fullRegionsRemainAuthority'], 'affected diff coverage')
    for name, task in [('retained-command-decoder', 'E6-T12a'), ('retained-resource-transfers', 'E6-T12b'), ('retained-color-formats', 'E6-T12g2')]:
        report = json.loads(record(name+'/report.json'))
        need(report['status'] == 'passed' and report['gitHead'] == head and report['task'] == task, 'affected old resource/decoder/color gate '+name)
        for row in report['sources']:
            source(row['path'], row['sha256'])
    boundaries = {}
    for name in ['renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/resources.mjs']:
        original = subprocess.check_output(['git', 'show', BASE+':'+name], cwd=ROOT)
        current = (ROOT/name).read_bytes()
        need(outside_storage(name, original) == outside_storage(name, current), 'runtime diff escapes original metadata/level storage boundary '+name)
        boundaries[name] = sha(outside_storage(name, current))
    for name in ['renderer/virgl-command/state.mjs', 'renderer/virgl-command/cache.mjs', 'renderer/virgl-command/constant-domain.mjs']:
        source(name)
        need((ROOT/name).read_bytes() == subprocess.check_output(['git', 'show', BASE+':'+name], cwd=ROOT), 'unchanged sampler/draw/buffer dependency')
        boundaries[name] = sources[name]
    need(not git('diff', '--name-only', BASE, head, '--', 'renderer/virgl-shader', 'crates', 'web', 'tools/guest'), 'compiler and unqualified production boundaries unchanged')
    carried = {}
    for name in git('ls-files', 'evidence/virgl-standard-sampler-state').splitlines():
        source(name)
        need((ROOT/name).read_bytes() == subprocess.check_output(['git', 'show', BASE+':'+name], cwd=ROOT), 'verified inherited sampler evidence changed')
        carried[name] = sources[name]
    for suffix in ['worker', 'verifier']:
        prefix = 'evidence/virgl-standard-sampler-state/'+suffix+'/'
        manifest = json.loads((ROOT/(prefix+'manifest.json')).read_text())
        need(carried[prefix+'recording.tar.gz'] == manifest['archiveSha256'] and carried[prefix+'records.json'] == manifest['recordIndexSha256'], 'authenticated predecessor evidence digests')
    for name in git('ls-files', 'renderer/virgl-shader', 'renderer/virgl-command', 'tools/verify-virgl-standard-texture-storage*', 'tools/virgl-command/standard-texture*', 'Makefile', 'tasks/epic-6-transcendence/E6-T11d20-standard-texture-storage.md').splitlines():
        source(name)
    for file in directory.rglob('*'):
        if file.is_file() and file.name != 'receipt.json':
            record(file.relative_to(directory).as_posix())
    receipt = dict(schema='original-mip-storage-receipt-v1', task=TASK, status='passed', gitHead=head,
                   levels=len(physical['levels']), texels=audit['texels'], nativeFenceReads=audit['nativeFenceReads'],
                   historicalEvidenceHead=BASE, carriedVerifiedEvidence=carried, carriedUnchangedBoundaries=boundaries,
                   sources=sources, generated=generated, files=files, guestExecution=False, productionNegotiation=False,
                   authority='isolated-original-mip-storage-transfers', productionDrawAuthority=False)
    (directory/'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
    print(CONFIRMATION, end='')


if __name__ == '__main__':
    main(sys.argv[1])
