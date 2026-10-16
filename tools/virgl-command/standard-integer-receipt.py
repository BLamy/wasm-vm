#!/usr/bin/env python3
"""Authenticate frozen pure integer inputs, original hardware custody and retained gates."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
PREDECESSOR = '8037ede91b4c8450e696811d33ac7d34235388ba'
TASK = 'E6-T11d14'

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
        raw = (directory/name).read_bytes()
        need(digest is None or sha(raw) == digest, 'record drift ' + name)
        files[name] = sha(raw)
        return raw
    def source(name, digest=None):
        raw = (ROOT/name).read_bytes()
        need(digest is None or sha(raw) == digest, 'source drift ' + name)
        if '/build/' in name or name.startswith('target/'):
            generated[name] = sha(raw)
        else:
            need(raw == subprocess.check_output(['git', 'show', head+':'+name], cwd=ROOT), 'unfrozen source '+name)
            sources[name] = sha(raw)
    for _ in range(500):
        if b'\nSTANDARD_INTEGER_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():
            break
        time.sleep(.01)
    else:
        raise ValueError('recording log incomplete')
    def physical(name, task, frames, fault=False, typed=False):
        report = json.loads(record(name+'/report.json'))
        need(report['gitHead'] == head and report['task'] == task, 'physical head/task '+name)
        need(report['status'] == ('failed' if fault else 'passed'), 'physical status '+name)
        memory = dict(bytes=16777216, stageExport='function', pairExport='function')
        if typed:
            memory['typedPairExport'] = 'function'
        need(report['fixedMemory'] == memory, 'fixed actual compiler '+name)
        need(report['browserErrors'] == dict(console=[], page=[], requests=[]), 'browser errors '+name)
        browser = report['browser']
        need(not browser['headless'] and browser['gpu']['featureStatus'].get('webgl2', browser['gpu']['featureStatus'].get('webgl')) == 'enabled', 'hardware headed WebGL2 '+name)
        need(not any(any(w in a.lower() for w in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe']) or a.startswith('--disable-gpu') for a in browser['commandLine']), 'software flags')
        served = {r['path']: r['sha256'] for r in report['servedFiles']}
        mutation = report.get('mutation')
        for row in report['sources']:
            source(row['path'], row['sha256'])
            if '/'+row['path'] in served:
                digest = mutation['servedSha256'] if mutation and row['path'] == mutation['path'] else row['sha256']
                need(served['/'+row['path']] == digest, 'served custody '+row['path'])
        for key in ['screenshot', 'browserCoverage']:
            record(name+'/'+report[key]['path'], report[key]['sha256'])
        result = report['partial'] if fault else report['browserResult']['result']
        need(len(result['frames']) == frames, 'complete native frames '+name)
        need(not result['guestExecution'] and not result['productionNegotiation'], 'isolated authority '+name)
        for blob in result['blobs']:
            packed = record(name+'/'+blob['path'], blob['gzipSha256'])
            raw = gzip.decompress(packed)
            need(len(raw) == blob['bytes'] and sha(raw) == blob['sha256'], 'native blob custody')
        for frame in result['frames']:
            need(frame['history'][-1]['result']['gpuComplete'] and frame['native']['calls'], 'native draw/fence')
            need(frame['audit']['held'] != fault, 'original full pixel verdict')
        if fault:
            need(mutation and mutation['path'] in ['renderer/virgl-command/state.mjs', 'renderer/virgl-command/decoder.mjs'], 'actual source sabotage')
            raw = record(name+'/mutation-source.mjs', mutation['servedSha256'])
            original = (ROOT/mutation['path']).read_bytes()
            needle, replacement = mutation['needle'].encode(), mutation['replacement'].encode()
            need(original.count(needle) == 1 and raw == original.replace(needle, replacement), 'exact source fault')
            need('independent original compact pixels' in report['browserResult']['error']['message'], 'fault failed pixels after native completion')
        return result
    wire = json.loads(record('wire/report.json'))
    need(wire['status'] == 'passed' and wire['gitHead'] == head and wire['task'] == TASK, 'wire source head')
    need(wire['wire']['status'] == 'passed' and len(wire['wire']['records']) == 300 and wire['wire']['legacy']['status'] == 'passed', 'literal wire/extents matrix')
    for row in wire['sources']:
        source(row['path'], row['sha256'])
    own = physical('hardware', TASK, 348, typed=True)
    for fault in ['native-signedness', 'constant-word', 'shader-conversion']:
        physical('fault-'+fault, TASK, 1, True, True)
    need(len(own['suspensions']) == 6 and len(own['ownership']) == 3 and len(own['rejections']) == 14, 'lifetime/types/bounds matrix')
    for run in own['runs']:
        need(all(run['inspection']['jobs'][k] == 0 for k in ['reads', 'stagingBytes', 'normalizedBuffers', 'normalizedBytes', 'normalizationScratchBytes']), 'released native ownership')
    for name, task, count, faults in [('scalar','E6-T11d13',391,['native-signedness','constant-scaled']), ('compact','E6-T11d12',225,['native-normalize','constant-unpack'])]:
        physical('retained-'+name+'/hardware', task, count)
        for fault in faults:
            physical('retained-'+name+'/fault-'+fault, task, 1, True)
        need(json.loads(record('retained-'+name+'/physical-audit.json'))['status'] == 'passed', 'original floating audit')
    audit = json.loads(record('physical-audit.json'))
    need(audit['status'] == 'passed' and len(audit['frames']) == audit['nativeDraws'] == 348 and len(audit['faults']) == 3 and audit['nanPixels'] == 0, 'full original exact pixels')
    need(record('abi/integer-native.json') == record('abi/integer-sanitize.json') and json.loads(record('abi/integer-native.json')) == dict(status='pinned-header', formats=list(range(177,201))), 'literal pinned header ABI')
    need(record('native/native.jsonl') == record('native/sanitize.jsonl'), 'sanitized native equality')
    node = json.loads(record('native/node.json'))
    need(node['status'] == 'passed' and node['cases'] == 48 and node['exactNativeWasm'] and node['peerIsolation'] and node['pressure']['bytes'] == 16777216 and node['pressure']['recovered'], 'typed actual C/Wasm/API/OOM')
    allocations = [json.loads(row) for row in record('native/allocations.jsonl').splitlines()]
    summary = allocations[-1]
    need(summary['faults'] == summary['recoveries'] == 40 and summary['callerMutation'] and not summary['partialResults'], 'all actual typed allocation faults')
    retained = json.loads(record('compiler-retained/receipt.json'))
    need(retained['status'] == 'passed' and retained['gitHead'] == head and retained['cases'] == 669 and retained['frames'] == 129 and retained['legacyBoundary']['unchanged'], 'full prescribed changed compiler gate')
    for name, digest in retained['sources'].items():
        source(name, digest)
    for name, digest in retained['generated'].items():
        source(name, digest)
    # The child compiler receipt's tee log may receive its final success text
    # after it hashes the log. Our outer receipt authenticates the finished log.
    for name, digest in retained['files'].items():
        if name != 'acceptance.log':
            record('compiler-retained/'+name, digest)
    coverage = json.loads(record('coverage-audit.json'))
    need(coverage['gitHead'] == head and coverage['fullRegionsRemainAuthority'] and coverage['llvm'], 'LLVM/V8 diff coverage custody')
    for mode in ['standard-integer-native/standard-integer-test', 'standard-integer-sanitize/standard-integer-test', 'standard-integer-allocation-sanitize/standard-integer-allocation-test']:
        source('renderer/virgl-shader/build/'+mode)
    carried = {}
    for family in ['shader','draw','constant','topology','restart','assembly','points','compact','scalar']:
        for name in git('ls-files', 'evidence/virgl-standard-'+family+'/worker/*', 'evidence/virgl-standard-'+family+'/verifier/*').splitlines():
            source(name)
            need((ROOT/name).read_bytes() == subprocess.check_output(['git', 'show', PREDECESSOR+':'+name], cwd=ROOT), 'historical evidence changed')
            carried[name] = sources[name]
    need(not git('diff', '--name-only', PREDECESSOR, head, '--', 'crates', 'web', 'tools/guest'), 'unqualified guest/demo changed')
    for name in git('ls-files', 'renderer/virgl-shader', 'renderer/virgl-command', 'tools/verify-virgl-standard-*', 'tools/virgl-command/standard-*', 'tools/virgl-standard-shader', 'Makefile').splitlines():
        source(name)
    for file in directory.rglob('*'):
        if file.is_file() and file != directory/'receipt.json':
            record(file.relative_to(directory).as_posix())
    receipt = dict(schema='standard-integer-fetch-receipt-v1', task=TASK, status='passed', gitHead=head,
                   frames=348, checkedPhysicalPixels=audit['pixels'], nativeDraws=audit['nativeDraws'],
                   historicalEvidenceHead=PREDECESSOR, carriedVerifiedEvidence=carried,
                   authority='isolated-standard-pure-integer-fetch', guestExecution=False,
                   productionNegotiation=False, productionDrawAuthority=False, files=files, sources=sources, generated=generated)
    (directory/'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')

if __name__ == '__main__':
    main(sys.argv[1])
