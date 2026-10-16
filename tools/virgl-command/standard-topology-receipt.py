#!/usr/bin/env python3
"""Authenticate frozen primitive calls, original GPU inputs and independent physical pixels."""
from pathlib import Path
import gzip
import hashlib
import json
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
TASK = 'E6-T11d8'
PREDECESSOR = '64b246220bbf3ed5e1a6f1ed7371535ed5ec5c56'


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
        if b'\nSTANDARD_TOPOLOGY_RECORDING_COMPLETE\n' in (directory / 'acceptance.log').read_bytes():
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
            need(len(raw) == blob['bytes'] and sha(raw) == blob['sha256'], 'input/native/pixel custody')
        if fault:
            original = (ROOT / mutation['path']).read_bytes()
            changed = record(name + '/mutation-source.mjs', mutation['servedSha256'])
            need(sha(original) == mutation['originalSha256'] and original.count(mutation['needle'].encode()) == 1
                 and original.replace(mutation['needle'].encode(), mutation['replacement'].encode()) == changed, 'real native mutation custody')
            frame = result['frames'][0]
            need(frame['native']['calls'][0]['name'] == 'drawElementsInstanced' and frame['history'][-1]['result']['gpuComplete']
                 and not frame['audit']['held'], 'completed wrong native draw and final fence')
            label = 'mode-2-wide-instanced-0' if task == TASK else 'all-widths-0'
            phrase = ' independent topology pixel oracle' if task == TASK else ' independent constant pixel oracle'
            need(frame['label'] == label and label + phrase in report['browserResult']['error']['message'], 'named physical pixel oracle')
            need(mutation['mode'] == ('mode' if task == TASK else 'generic'), 'actual mutation kind')
        else:
            need(result['status'] == 'passed' and all(row['held'] for row in result['predictions']), 'positive predictions')
            for run in result['runs']:
                need(run['inspection']['jobs']['reads'] == 0 and run['inspection']['jobs']['stagingBytes'] == 0, 'read/staging cleanup')
        return result

    wire = json.loads(record('wire/report.json'))
    need(wire['status'] == 'passed' and wire['gitHead'] == head and len(wire['wire']['records']) == 79
         and all(row['held'] for row in wire['wire']['predictions']), 'literal Node mode/legacy/hostile packets')
    for row in wire['sources']:
        source(row['path'], row['sha256'])
    result = physical('hardware', TASK, 87)
    need(len(result['wire']['records']) == 79 and all(row['held'] for row in result['wire']['predictions']), 'literal browser mode/legacy/hostile packets')
    need(len(result['rejections']) == 12 and all(not row['record']['result']['ok'] and not row['draws'] for row in result['rejections']), 'short tail/index and work limit cases')
    need([row['action'] for row in result['suspensions']] == ['stale-index', 'cancel', 'reuse'], 'pending topology attacks')
    for row in result['suspensions']:
        need(row['point']['inspection']['jobs']['reads'] == 2 and row['async']['reads'] == 0 and row['async']['stagingBytes'] == 0, 'whole pending batch released')
        outcome = row['record']['result']
        if row['action'] == 'reuse':
            need(outcome['ok'] and outcome['gpuComplete'] and row['newGeneration'] > row['oldGeneration']
                 and outcome['draws'][0]['vertexFetches'][1]['resourceGeneration'] == row['oldGeneration'], 'retained constant source generation')
        else:
            need(not outcome['ok'] and not outcome['draws'] and outcome['gpuComplete']
                 and outcome['error']['code'] == ('cancelled' if row['action'] == 'cancel' else 'stale-storage'), 'pending stale/cancel behavior')
    physical('fault-mode', TASK, 1, True)
    audit = json.loads(record('physical-audit.json'))
    need(audit['status'] == 'passed' and len(audit['frames']) == 87 and audit['pixels'] == 50176
         and all(row['held'] for row in audit['frames']) and [row['label'] for row in audit['faults'] if not row['held']] == ['mode-2-wide-instanced-0'], 'independent topology physical audit')
    physical('retained-constant/hardware', 'E6-T11d7', 31)
    physical('retained-constant/fault-generic', 'E6-T11d7', 1, True)
    old_audit = json.loads(record('retained-constant/physical-audit.json'))
    need(old_audit['status'] == 'passed' and len(old_audit['frames']) == 31 and old_audit['pixels'] == 12500, 'retained D7 physical/generic audit')
    retained = json.loads(record('retained-standard-draw/receipt.json'))
    need(retained['status'] == 'passed' and retained['gitHead'] == head and retained['frames'] == 37
         and retained['checkedPhysicalPixels'] == 10296, 'retained full D6/legacy receipt')
    for name, digest in retained['files'].items():
        record('retained-standard-draw/' + name, digest)
    for name, digest in {**retained['sources'], **retained['generated']}.items():
        source(name, digest)
    for name in git('ls-files', 'renderer/virgl-shader', 'renderer/virgl-command/constant-domain.mjs',
                    'renderer/virgl-command/resources.mjs', 'renderer/virgl-command/cache.mjs').splitlines():
        source(name)
        need((ROOT / name).read_bytes() == subprocess.check_output(['git', 'show', PREDECESSOR + ':' + name], cwd=ROOT), 'carried compiler/ownership boundary changed')
    carried = {}
    for name in ['evidence/virgl-standard-constant/worker/manifest.json', 'evidence/virgl-standard-constant/worker/records.json',
                 'evidence/virgl-standard-constant/worker/recording.tar.gz', 'evidence/virgl-standard-constant/verifier/manifest.json',
                 'evidence/virgl-standard-constant/verifier/verdict.json', 'evidence/virgl-standard-constant/verifier/records.json',
                 'evidence/virgl-standard-constant/verifier/recording.tar.gz']:
        source(name)
        need((ROOT / name).read_bytes() == subprocess.check_output(['git', 'show', PREDECESSOR + ':' + name], cwd=ROOT), 'D7 historical evidence changed')
        carried[name] = sources[name]
    for name in git('ls-files', 'tools/verify-virgl-standard-topology.sh', 'tools/verify-virgl-standard-topology.mjs',
                    'tools/virgl-command/standard-topology-*', 'tools/setup-virgl-emsdk.sh', 'Makefile').splitlines():
        source(name)
    for item in directory.rglob('*'):
        if item.is_file() and item.name != 'receipt.json':
            record(item.relative_to(directory).as_posix())
    receipt = dict(schema='standard-core-topology-receipt-v1', task=TASK, status='passed', gitHead=head,
                   frames=87, checkedPhysicalPixels=50176, guestExecution=False, productionNegotiation=False,
                   authority='isolated-standard-core-topologies', productionDrawAuthority=False,
                   carriedCompilerAndOwnershipHead=PREDECESSOR, carriedD7Evidence=carried,
                   files=files, sources=sources, generated=generated)
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main(sys.argv[1])
