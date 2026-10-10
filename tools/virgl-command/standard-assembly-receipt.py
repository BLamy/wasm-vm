#!/usr/bin/env python3
"""Authenticate original GPU sources, bounded list assembly and physical pixels."""
from pathlib import Path
import gzip
import hashlib
import json
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
PREDECESSOR = 'c378b55516f74a2da3612462104785fe6997fca1'
TASK = 'E6-T11d10'


def need(value, reason):
    if not value:
        raise ValueError(reason)


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
        need(digest is None or sha(raw) == digest, 'record drift: ' + name)
        files[name] = sha(raw)
        return raw

    def source(name, digest=None):
        raw = (ROOT / name).read_bytes()
        need(digest is None or sha(raw) == digest, 'source drift: ' + name)
        if '/build/' in name or name.startswith('target/'):
            generated[name] = sha(raw)
        else:
            frozen = subprocess.check_output(['git', 'show', head + ':' + name], cwd=ROOT)
            need(raw == frozen, 'source not frozen: ' + name)
            sources[name] = sha(raw)

    for _ in range(500):
        if b'\nSTANDARD_ASSEMBLY_RECORDING_COMPLETE\n' in (directory / 'acceptance.log').read_bytes():
            break
        time.sleep(.01)
    else:
        raise ValueError('acceptance log has no completed runtime block')

    def physical(name, task, frames, fault=False):
        report = json.loads(record(name + '/report.json'))
        need(report['task'] == task and report['status'] == ('failed' if fault else 'passed') and report['gitHead'] == head,
             'physical exact-head task/status: ' + name)
        need(report['fixedMemory'] == {'bytes': 16777216, 'stageExport': 'function', 'pairExport': 'function'}, 'fixed native compiler')
        need(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser errors: ' + name)
        browser = report['browser']
        need(not browser['headless'] and browser['gpu']['featureStatus'].get('webgl2', browser['gpu']['featureStatus'].get('webgl')) == 'enabled', 'headed hardware WebGL2')
        need(not any(any(word in arg.lower() for word in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe']) or arg.startswith('--disable-gpu')
                     for arg in browser['commandLine']), 'software GPU flag')
        served = {row['path']: row['sha256'] for row in report['servedFiles']}
        mutation = report.get('mutation')
        for row in report['sources']:
            source(row['path'], row['sha256'])
            if '/' + row['path'] in served:
                expected = mutation['servedSha256'] if mutation and row['path'] == mutation['path'] else row['sha256']
                need(served['/' + row['path']] == expected, 'served source drift')
        record(name + '/' + report['screenshot']['path'], report['screenshot']['sha256'])
        coverage = json.loads(record(name + '/' + report['browserCoverage']['path'], report['browserCoverage']['sha256']))
        need({'renderer/virgl-command/' + n + '.mjs' for n in ['state', 'decoder', 'resources', 'cache', 'constant-domain']}
             <= {row['source'] for row in coverage['scripts']}, 'runtime coverage closure')
        for row in coverage['scripts']:
            need(row['sha256'] == served['/' + row['source']], 'coverage/source drift')
        result = report['partial'] if fault else report['browserResult']['result']
        need(not result['guestExecution'] and not result['productionNegotiation'] and len(result['frames']) == frames, 'isolated physical frame count')
        for blob in result['blobs']:
            packed = record(name + '/' + blob['path'], blob['gzipSha256'])
            raw = gzip.decompress(packed)
            need(len(raw) == blob['bytes'] and sha(raw) == blob['sha256'], 'original/private/native/pixel custody')
        if fault:
            original = (ROOT / mutation['path']).read_bytes()
            changed = record(name + '/mutation-source.mjs', mutation['servedSha256'])
            need(sha(original) == mutation['originalSha256'] and original.count(mutation['needle'].encode()) == 1
                 and original.replace(mutation['needle'].encode(), mutation['replacement'].encode()) == changed, 'actual native regression custody')
            frame = result['frames'][0]
            need(frame['native']['calls'][0]['name'] == 'drawElementsInstanced' and frame['history'][-1]['result']['gpuComplete']
                 and not frame['audit']['held'], 'completed wrong native draw and real final fence')
            oracle = 'assembly' if task == TASK else 'restart'
            need(frame['label'] == 'mode-2-custom-0' and frame['label'] + ' independent ' + oracle + ' pixel oracle'
                 in report['browserResult']['error']['message'], 'named original physical pixel oracle')
        else:
            need(result['status'] == 'passed' and all(row['held'] for row in result['predictions']), 'positive predictions')
            for run in result['runs']:
                need(all(run['inspection']['jobs'][key] == 0 for key in ['reads', 'stagingBytes', 'normalizedBuffers', 'normalizedBytes', 'normalizationScratchBytes']), 'all owned counters released')
        return result

    for name in ['wire', 'retained-restart/wire']:
        wire = json.loads(record(name + '/report.json'))
        need(wire['status'] == 'passed' and wire['gitHead'] == head and len(wire['wire']['records']) == 292
             and all(row['held'] for row in wire['wire']['predictions']), 'literal standard/legacy flags')
        for row in wire['sources']:
            source(row['path'], row['sha256'])
    result = physical('hardware', TASK, 304)
    need(len(result['rejections']) == 8 and all(not row['record']['result']['ok'] for row in result['rejections']), 'bounds/read/work/native-limit cases')
    need([row['action'] for row in result['suspensions']] == ['stale-index', 'collected-index', 'cancel', 'reuse'], 'pending original source lifetime cases')
    for row in result['suspensions']:
        outcome = row['record']['result']
        need(row['point']['inspection']['jobs']['reads'] == 2, 'complete original read batch retained')
        if row['action'] == 'reuse':
            need(outcome['ok'] and outcome['gpuComplete'] and row['newGeneration'] > row['oldGeneration']
                 and outcome['draws'][0]['indexResourceGeneration'] == row['oldGeneration'], 'old retained source generation')
        else:
            need(not outcome['ok'] and not outcome['draws'] and outcome['gpuComplete']
                 and outcome['error']['code'] == ('cancelled' if row['action'] == 'cancel' else 'stale-storage'), 'pending source rejection/drain')
    gates = [row for run in result['runs'] for row in run.get('selection', [])]
    need([(row['label'], row['result']['error']['code']) for row in gates] == [('unknown', 'invalid-input'), ('missing-extension', 'unsupported-host'), ('wrong-extension', 'unsupported-host'), ('legacy', 'invalid-input')] and all(not row['result']['ok'] for row in gates), 'explicit selected factory and legacy gates')
    need(len(result['ownership']) == 11, 'complete owned private list lifetime cases')
    for run in result['runs']:
        for row in run['normalizationEvents']:
            if row['name'] == 'forced-createBuffer-null':
                need(row['allocation'] == 2, 'explicit second native allocation failure')
                continue
            need(row['bytes'] <= 786432 and row['inspection']['normalizedBytes'] <= 786432
                 and row['inspection']['normalizedBuffers'] <= 64, 'derived expanded native bounds')
            if row['name'] == 'normalized-upload':
                need(row['inspection']['normalizationScratchBytes'] == row['bytes'], 'bounded CPU output charged at actual upload')
    for fault in ['list-order', 'provoking']:
        physical('fault-' + fault, TASK, 1, True)
    audit = json.loads(record('physical-audit.json'))
    need(audit['status'] == 'passed' and len(audit['frames']) == 304 and all(row['held'] for row in audit['frames'])
         and len(audit['faults']) == 2 and all(not row['held'] for row in audit['faults']), 'independent original/native GPU bytes and pixels')
    physical('retained-restart/hardware', 'E6-T11d9', 189)
    physical('retained-restart/fault-restart', 'E6-T11d9', 1, True)
    retained = json.loads(record('retained-restart/physical-audit.json'))
    need(retained['status'] == 'passed' and len(retained['frames']) == 189 and retained['pixels'] == 139008
         and retained['nativeDraws'] == 377 and retained['normalizedBuffers'] == 318, 'unchanged default native D9 physical boundary')
    for name in git('ls-files', 'renderer/virgl-shader', 'renderer/virgl-command/decoder.mjs',
                    'renderer/virgl-command/constant-domain.mjs', 'renderer/virgl-command/resources.mjs', 'renderer/virgl-command/cache.mjs').splitlines():
        source(name)
        need((ROOT / name).read_bytes() == subprocess.check_output(['git', 'show', PREDECESSOR + ':' + name], cwd=ROOT), 'carried compiler/decoder/ownership boundary changed')
    carried = {}
    for facet in ['draw', 'constant', 'topology', 'restart']:
        prefix = 'evidence/virgl-standard-' + facet
        names = git('ls-files', prefix + '/worker/manifest.json', prefix + '/worker/records.json',
                    prefix + '/worker/recording.tar.gz', prefix + '/verifier/manifest.json',
                    prefix + '/verifier/verdict.json', prefix + '/verifier/records.json',
                    prefix + '/verifier/recording.tar.gz').splitlines()
        need(len(names) >= 6, 'missing verified historical evidence ' + facet)
        for name in names:
            source(name)
            need((ROOT / name).read_bytes() == subprocess.check_output(['git', 'show', PREDECESSOR + ':' + name], cwd=ROOT), 'historical HELD records changed')
            carried[name] = sources[name]
    for name in git('ls-files', 'tools/verify-virgl-standard-assembly.sh', 'tools/verify-virgl-standard-assembly.mjs',
                    'tools/virgl-command/standard-assembly-*', 'tools/setup-virgl-emsdk.sh', 'Makefile').splitlines():
        source(name)
    for item in directory.rglob('*'):
        if item.is_file() and item.name != 'receipt.json':
            record(item.relative_to(directory).as_posix())
    receipt = dict(schema='standard-primitive-assembly-receipt-v1', task=TASK, status='passed', gitHead=head,
                   frames=304, checkedPhysicalPixels=audit['pixels'], nativeDraws=audit['nativeDraws'], normalizedBuffers=audit['normalizedBuffers'],
                   guestExecution=False, productionNegotiation=False, authority='isolated-standard-primitive-assembly', productionDrawAuthority=False,
                   carriedCompilerAndOwnershipHead=PREDECESSOR, carriedVerifiedEvidence=carried, files=files, sources=sources, generated=generated)
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main(sys.argv[1])
