#!/usr/bin/env python3
"""Authenticate frozen literal packets, real native bindings and independent pixels."""
from pathlib import Path
import gzip
import hashlib
import json
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
TASK = 'E6-T11d6'
PREDECESSOR = '761a912a88823954e3424f7b003c15887e7c9034'
GATES = ['command-decoder', 'draw-replay', 'async-jobs', 'float-vertex-fetch']


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
            need(raw == frozen, 'source is not frozen: ' + name)
            sources[name] = sha(raw)

    for _ in range(500):
        if (directory / 'acceptance.log').read_bytes().endswith(b'STANDARD_DRAW_RECORDING_COMPLETE\n'):
            break
        time.sleep(.01)
    else:
        raise ValueError('acceptance log has no closed recording marker')

    wire = json.loads(record('wire/report.json'))
    need(wire['status'] == 'passed' and wire['gitHead'] == head and wire['task'] == TASK, 'wire head/status')
    need(wire['fixedMemory'] == {'bytes': 16777216, 'stageExport': 'function', 'pairExport': 'function'}, 'actual fixed compiler memory/exports')
    need(len(wire['wire']['records']) == 80 and len(wire['wire']['predictions']) == 160
         and all(row['held'] for row in wire['wire']['predictions']), 'literal packet boundary matrix')

    def physical(name, fault=False):
        report = json.loads(record(name + '/report.json'))
        need(report['gitHead'] == head and report['task'] == TASK and report['status'] == ('failed' if fault else 'passed'), 'physical head/status ' + name)
        need(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser errors ' + name)
        need(report['wire'] == wire['wire'] and report['fixedMemory'] == wire['fixedMemory'], 'same wire/compiler predictions')
        browser = report['browser']
        need(not browser['headless'] and browser['gpu']['featureStatus'].get('webgl2', browser['gpu']['featureStatus'].get('webgl')) == 'enabled', 'hardware WebGL2 ' + name)
        need(not any(any(word in arg.lower() for word in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe']) or arg.startswith('--disable-gpu')
                     for arg in browser['commandLine']), 'software GPU flag ' + name)
        served = {row['path']: row['sha256'] for row in report['servedFiles']}
        mutation = report.get('mutation')
        for row in report['sources']:
            source(row['path'], row['sha256'])
            if '/' + row['path'] in served:
                expected = mutation['servedSha256'] if mutation and row['path'] == mutation['path'] else row['sha256']
                need(served['/' + row['path']] == expected, 'served source mismatch')
        record(name + '/' + report['screenshot']['path'], report['screenshot']['sha256'])
        coverage = json.loads(record(name + '/' + report['browserCoverage']['path'], report['browserCoverage']['sha256']))
        need({'renderer/virgl-command/' + n + '.mjs' for n in ['state', 'decoder', 'cache', 'resources', 'constant-domain']}
             <= {row['source'] for row in coverage['scripts']}, 'missing runtime coverage')
        for row in coverage['scripts']:
            need(row['sha256'] == served['/' + row['source']], 'coverage/source custody')
        result = report['partial'] if fault else report['browserResult']['result']
        need(not result['guestExecution'] and not result['productionNegotiation'], 'isolated authority')
        for blob in result['blobs']:
            packed = record(name + '/' + blob['path'], blob['gzipSha256'])
            raw = gzip.decompress(packed)
            need(len(raw) == blob['bytes'] and sha(raw) == blob['sha256'], 'original/native/pixel blob custody')
        if fault:
            need(mutation['mode'] == 'divisor' and len(result['frames']) == 1
                 and result['frames'][0]['label'] == 'mixed-wide-0'
                 and 'mixed-wide-0 independent physical pixel oracle' in report['browserResult']['error']['message'],
                 'unrelated failure cannot count as native divisor sabotage')
            original = (ROOT / mutation['path']).read_bytes()
            changed = record(name + '/mutation-source.mjs', mutation['servedSha256'])
            need(sha(original) == mutation['originalSha256'] and original.count(mutation['needle'].encode()) == 1
                 and original.replace(mutation['needle'].encode(), mutation['replacement'].encode()) == changed,
                 'real native mutation custody')
            frame = result['frames'][0]
            need(frame['native']['calls'][0]['name'] == 'drawElementsInstanced'
                 and frame['history'][-1]['result']['gpuComplete'] and not frame['audit']['held'],
                 'completed real draw contradicts physical prediction')
        else:
            need(result['status'] == 'passed' and len(result['frames']) == 37
                 and all(row['held'] for row in result['predictions']), 'physical acceptance matrix')
            need(len(result['rejections']) == 11 and all(not row['result']['ok'] and not row['nativeDraws']
                 for row in result['rejections']), 'rejected bounds/sentinels precede draw')
            need(len(result['hostFaults']) == 3 and all(not row['result']['ok'] and
                 row['result']['error']['code'] == 'unsupported-host' for row in result['hostFaults']), 'native host limit validation')
            need([row['action'] for row in result['suspensions']] == ['cancel', 'revision', 'reuse'], 'all pending-read attacks')
            for row in result['suspensions']:
                need(row['async']['reads'] == 0 and row['async']['stagingBytes'] == 0
                     and row['record']['result']['gpuComplete'], 'pending read drained')
                if row['action'] == 'reuse':
                    need(row['newGeneration'] > row['oldGeneration'] and
                         row['record']['result']['draws'][0]['indexResourceGeneration'] == row['oldGeneration'], 'retained generation')
                else:
                    need(row['record']['result']['error']['code'] == ('cancelled' if row['action'] == 'cancel' else 'stale-storage')
                         and not row['nativeDraws'], 'pending cancellation/revision fails before draw')
            for run in result['runs']:
                for event in run['events']:
                    if event['name'] == 'clientWaitSync':
                        need(event['turn'] > 0 and event['actual'] in [37146, 37147, 37148], 'actual later-task zero-timeout fence')

    physical('hardware')
    physical('fault-divisor', True)
    audit = json.loads(record('physical-audit.json'))
    need(audit['status'] == 'passed' and len(audit['frames']) == 37 and audit['pixels'] == 10296
         and all(row['held'] for row in audit['frames'])
         and [row['label'] for row in audit['faults'] if not row['held']] == ['mixed-wide-0'], 'offline independent packet/byte/pixel oracle')
    for gate in GATES:
        report = json.loads(record('retained-' + gate + '/report.json'))
        need(report['status'] == 'passed' and report['gitHead'] == head, 'retained gate ' + gate)
        need(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'retained browser errors ' + gate)
        for row in report['sources'] + report.get('inputs', []):
            source(row['path'], row['sha256'])
    # These independently verified boundaries did not change in this task.
    for name in git('ls-files', 'renderer/virgl-shader', 'renderer/virgl-command/constant-domain.mjs',
                    'renderer/virgl-command/resources.mjs', 'renderer/virgl-command/cache.mjs').splitlines():
        source(name)
        need((ROOT / name).read_bytes() == subprocess.check_output(['git', 'show', PREDECESSOR + ':' + name], cwd=ROOT),
             'carried boundary changed: ' + name)
    for name in git('ls-files', 'tools/verify-virgl-standard-draw.sh', 'tools/verify-virgl-standard-draw.mjs',
                    'tools/virgl-command/standard-draw-*', 'tools/setup-virgl-emsdk.sh', 'Makefile').splitlines():
        source(name)
    for item in directory.rglob('*'):
        if item.is_file() and item.name != 'receipt.json':
            record(item.relative_to(directory).as_posix())
    receipt = dict(schema='standard-instanced-draws-receipt-v1', task=TASK, status='passed', gitHead=head,
                   frames=37, checkedPhysicalPixels=10296, guestExecution=False, productionNegotiation=False,
                   authority='isolated-standard-instanced-draws', productionDrawAuthority=False,
                   carriedCompilerAndOwnershipHead=PREDECESSOR, files=files, sources=sources, generated=generated)
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main(sys.argv[1])
