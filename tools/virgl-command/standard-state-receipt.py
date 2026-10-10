#!/usr/bin/env python3
"""Authenticate a frozen standard binding run and carried unchanged boundaries."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
TASK = 'E6-T11d5'
PREDECESSOR = '9323b44519710dfb2c8a324fe115872b79d274f0'
GATES = ['command-decoder', 'resource-transfers', 'object-state', 'draw-replay',
         'async-jobs', 'raster-depth', 'render-cache', 'blend-equations', 'float-vertex-fetch']


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

    # Tee runs independently of the shell; wait for its final explicit marker.
    for _ in range(500):
        if (directory / 'acceptance.log').read_bytes().endswith(b'STANDARD_STATE_RECORDING_COMPLETE\n'):
            break
        time.sleep(.01)
    else:
        raise ValueError('acceptance log has no closed recording marker')

    wire = json.loads(record('wire/report.json'))
    need(wire['status'] == 'passed' and wire['gitHead'] == head and wire['task'] == TASK, 'wire head/status')
    need(wire['fixedMemory'] == {'bytes': 16777216, 'stageExport': 'function', 'pairExport': 'function'}, 'actual fixed compiler memory/exports')
    need(len(wire['wire']['records']) == 216 and len(wire['wire']['predictions']) == 542
         and all(row['held'] for row in wire['wire']['predictions']), 'literal word boundary matrix')
    need(len(wire['metadata']['predictions']) == 32 and all(row['held'] for row in wire['metadata']['predictions']), 'metadata attack matrix')

    def physical(name, fault=False):
        report = json.loads(record(name + '/report.json'))
        need(report['gitHead'] == head and report['task'] == TASK and report['status'] == ('failed' if fault else 'passed'), 'physical head/status ' + name)
        need(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser errors ' + name)
        need(report['wire'] == wire['wire'] and report['metadata'] == wire['metadata']
             and report['fixedMemory'] == wire['fixedMemory'], 'same independent wire/actual compiler checks')
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
             <= {row['source'] for row in coverage['scripts']}, 'missing served runtime coverage')
        for row in coverage['scripts']:
            need(row['sha256'] == served['/' + row['source']], 'coverage/source custody')
        result = report['partial'] if fault else report['browserResult']['result']
        if fault:
            if name == 'fault-suffix':
                need(mutation['mode'] == 'suffix' and report['partial']['frames'][-1]['label'] == 'short-bank-0'
                     and 'short-bank-0 independent physical pixel oracle' in report['browserResult']['error']['message'],
                     'unrelated failure cannot count as upload sabotage')
            else:
                need(name == 'fault-metadata' and mutation['mode'] == 'metadata' and
                     'omitted-active-vertex-uniforms coherently spoofed stage/pair metadata rejects' in report['browserResult']['error']['message'],
                     'unrelated failure cannot count as admission sabotage')
                omissions = result['nativeBindingRejections']
                need(len(omissions) == 1 and omissions[0]['label'] == 'omitted-active-vertex-uniforms' and
                     omissions[0]['result']['ok'] and omissions[0]['result']['gpuComplete'] and
                     len(omissions[0]['nativeDraws']) == 1 and omissions[0]['nativeDraws'][0]['name'] == 'drawArrays',
                     'real incomplete-metadata native draw must contradict the rejection prediction')
            original = (ROOT / mutation['path']).read_bytes()
            changed = record(name + '/mutation-source.mjs', mutation['servedSha256'])
            need(sha(original) == mutation['originalSha256'] and original.count(mutation['needle'].encode()) == 1
                 and original.replace(mutation['needle'].encode(), mutation['replacement'].encode()) == changed, 'actual upload mutation custody')
        else:
            need(result['status'] == 'passed' and len(result['frames']) == 56
                 and all(row['held'] for row in result['predictions']), 'physical acceptance matrix')
            omissions = result['nativeBindingRejections']
            need(len(omissions) == 4 and
                 {row['label'] for row in omissions} ==
                 {f'omitted-active-{stage}-{field}' for stage in ['vertex', 'fragment'] for field in ['uniforms', 'samplers']} and
                 all(not row['result']['ok'] and row['result']['error']['code'] == 'shader-reflection-error' and
                     row['name'] in row['result']['error']['message'] and
                     row['nativeDraws'] == [] and
                     any(event['result'] and event['result']['name'] == row['name'] for event in row['native']) for row in omissions),
                 'complete active native constant/sampler metadata admission')
            need(not result['guestExecution'] and not result['productionNegotiation'], 'isolated authority')
            need([row['delay'] for row in result['cancelledJobs']] == [2, 5]
                 and all(row['result']['gpuComplete'] and row['result']['error']['code'] == 'cancelled' for row in result['cancelledJobs']), 'actual cancellation/drain')
            originals = [row for row in result['frames'] if row['label'].startswith('full-original-')]
            need(len(originals) == 9 and sum(row['fixture']['kind'] == 'original92' for row in originals) == 3, 'complete original compositor coverage')
            for item in report['inputs']:
                if item['path'] in ['geometry.bin', 'c580.bin']:
                    record(item['path'], item['sha256'])
                    need(served['/inputs/' + item['path']] == item['sha256'], 'original input serving')
                else:
                    source(item['path'], item['sha256'])
            for run in result['runs']:
                for event in run.get('events', []):
                    if event['name'] == 'clientWaitSync':
                        need(event['turn'] > 0 and event['actual'] in [37146, 37147, 37148], 'physical fence result')
        for frame in result['frames']:
            record(name + '/' + frame['pixels']['path'], frame['pixels']['gzipSha256'])
            need(frame['pixels']['bytes'] == frame['width'] * frame['height'] * 4, 'physical pixel extent')
        return result

    physical('hardware')
    physical('fault-suffix', True)
    physical('fault-metadata', True)
    audit = json.loads(record('physical-audit.json'))
    need(audit['status'] == 'passed' and len(audit['frames']) == 56 and audit['pixels'] == 2371424
         and all(row['held'] for row in audit['frames'])
         and [row['label'] for row in audit['faults'] if not row['held']] == ['short-bank-0'], 'offline physical oracle')
    for gate in GATES + ['blend', 'float']:
        name = 'promoted-' + gate if gate in ['blend', 'float'] else 'retained-' + gate
        report = json.loads(record(name + '/report.json'))
        need(report['status'] == 'passed' and report['gitHead'] == head, 'retained gate ' + gate)
        need(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'retained browser errors ' + gate)
        for row in report['sources']:
            source(row['path'], row['sha256'])

    shader_paths = git('ls-files', 'renderer/virgl-shader').splitlines()
    for name in shader_paths:
        source(name)
        need((ROOT / name).read_bytes() == subprocess.check_output(['git', 'show', PREDECESSOR + ':' + name], cwd=ROOT),
             'carried compiler boundary changed: ' + name)
    legacy = subprocess.check_output(['git', 'show', PREDECESSOR + ':renderer/virgl-command/constant-domain.mjs'], cwd=ROOT)
    need((ROOT / 'renderer/virgl-command/constant-domain.mjs').read_bytes().startswith(legacy), 'old metadata/numerical contracts changed')
    paths = git('ls-files', 'renderer/virgl-command', 'tools/virgl-command', 'tools/verify-virgl-standard-state.sh',
                'tools/verify-virgl-standard-state.mjs', 'tools/virgl-92cb-geometry', 'tools/virgl-original-c580/capture-pairs.py',
                'tools/virgl-capture/validate.py', 'tools/virgl-original-programs/oracle.mjs', 'tools/setup-virgl-emsdk.sh',
                'evidence/virgl-workload-inventory/captures/es2gears', 'evidence/virgl-workload-inventory/es2gears-inventory.json',
                'evidence/virgl-standard-shader/declaration-repair', 'evidence/virgl-standard-shader/completion-verifier', 'Makefile').splitlines()
    for name in paths:
        source(name)
    for item in directory.rglob('*'):
        if item.is_file() and item.name != 'receipt.json':
            record(item.relative_to(directory).as_posix())
    receipt = dict(schema='standard-state-binding-receipt-v1', task=TASK, status='passed', gitHead=head,
                   frames=55, checkedPhysicalPixels=2371168, guestExecution=False, productionNegotiation=False,
                   authority='isolated-standard-state-binding', productionDrawAuthority=False,
                   carriedCompilerHead=PREDECESSOR, legacyMetadataSha256=sha(legacy), files=files, sources=sources, generated=generated)
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main(sys.argv[1])
