#!/usr/bin/env python3
"""Authenticate frozen GPU constant reads, batch lifetimes and independent physical pixels."""
from pathlib import Path
import gzip
import hashlib
import json
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
TASK = 'E6-T11d7'
PREDECESSOR = '67220bb5ed0dfab2e06563b6353fd6975f9696b9'


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
        if (directory / 'acceptance.log').read_bytes().endswith(b'STANDARD_CONSTANT_RECORDING_COMPLETE\n'):
            break
        time.sleep(.01)
    else:
        raise ValueError('acceptance log has no closed recording marker')

    def physical(name, fault=False):
        report = json.loads(record(name + '/report.json'))
        need(report['gitHead'] == head and report['task'] == TASK and report['status'] == ('failed' if fault else 'passed'), 'physical head/status ' + name)
        need(report['fixedMemory'] == {'bytes': 16777216, 'stageExport': 'function', 'pairExport': 'function'}, 'actual fixed compiler')
        need(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser errors ' + name)
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
            need(mutation['mode'] == 'generic' and len(result['frames']) == 1
                 and result['frames'][0]['label'] == 'all-widths-0'
                 and 'all-widths-0 independent constant pixel oracle' in report['browserResult']['error']['message'], 'qualified native generic sabotage')
            original = (ROOT / mutation['path']).read_bytes()
            changed = record(name + '/mutation-source.mjs', mutation['servedSha256'])
            need(sha(original) == mutation['originalSha256'] and original.count(mutation['needle'].encode()) == 1
                 and original.replace(mutation['needle'].encode(), mutation['replacement'].encode()) == changed, 'real native mutation custody')
            frame = result['frames'][0]
            need(frame['native']['calls'][0]['name'] == 'drawElementsInstanced'
                 and frame['history'][-1]['result']['gpuComplete'] and not frame['audit']['held'], 'completed real wrong draw')
        else:
            need(result['status'] == 'passed' and len(result['frames']) == 31 and all(row['held'] for row in result['predictions']), 'physical acceptance matrix')
            need(len(result['rejections']) == 7 and all(not row['record']['result']['ok'] and not row['draws'] for row in result['rejections']), 'bounds/aggregate/partial/legacy rejection')
            need([row['action'] for row in result['suspensions']] == ['cancel', 'collected-revision', 'reuse', 'cpu-backing', 'reset-cancel', 'store-dispose'], 'all pending batch attacks')
            for row in result['suspensions']:
                need(row['point']['inspection']['jobs']['reads'] == 5 and row['async']['reads'] == 0 and row['async']['stagingBytes'] == 0, 'entire retained batch released')
                outcome = row['record']['result']
                if row['action'] in ['reuse', 'cpu-backing']:
                    need(outcome['ok'] and outcome['gpuComplete'] and all(f['resourceGeneration'] == row['oldGeneration'] for f in outcome['draws'][0]['vertexFetches']), 'original GPU generation/contents retained')
                    if row['action'] == 'reuse':
                        need(row['newGeneration'] > row['oldGeneration'], 'public name reuse generation')
                else:
                    need(not outcome['ok'] and not outcome['draws'] and outcome['gpuComplete'] == (row['action'] != 'store-dispose'), 'cancel/revision/invalidation outcome')
                if row['action'] == 'collected-revision':
                    need(len(row['point']['collected']) == 1 and outcome['error']['code'] == 'stale-storage', 'earlier collected source revalidated while later reads wait')
            need(len(result['invalidations']) == 1 and result['invalidations'][0]['before']['jobs']['reads'] == 5
                 and result['invalidations'][0]['after']['reads'] == 0 and result['invalidations'][0]['after']['stagingBytes'] == 0
                 and not result['invalidations'][0]['nativeDraws'], 'renderer disposal invalidates every ticket')
            for run in result['runs']:
                need(run['inspection']['jobs']['reads'] == 0 and run['inspection']['jobs']['stagingBytes'] == 0, 'final read/staging cleanup')
                for event in run['events']:
                    if event['name'] == 'clientWaitSync':
                        need(event['turn'] > 0 and event['actual'] in [37146, 37147, 37148], 'real later-task zero-timeout poll')
            all_sixteen = [f for f in result['frames'] if f['label'].startswith('all-sixteen-')]
            need(len(all_sixteen) == 3 and all(len(f['native']['calls'][0]['attributes']) == 16
                 and all(not a['enabled'] and a['divisor'] == 0 for a in f['native']['calls'][0]['attributes']) for f in all_sixteen), 'all sixteen generic attributes/native disabled arrays')

    physical('hardware')
    physical('fault-generic', True)
    audit = json.loads(record('physical-audit.json'))
    need(audit['status'] == 'passed' and len(audit['frames']) == 31 and audit['pixels'] == 12500
         and all(row['held'] for row in audit['frames']) and [row['label'] for row in audit['faults'] if not row['held']] == ['all-widths-0'], 'offline independent original-byte/generic/pixel oracle')
    retained = json.loads(record('retained-standard-draw/receipt.json'))
    need(retained['status'] == 'passed' and retained['gitHead'] == head and retained['frames'] == 37
         and retained['checkedPhysicalPixels'] == 10296, 'retained full D6/legacy acceptance')
    for name, digest in retained['files'].items():
        record('retained-standard-draw/' + name, digest)
    for name, digest in {**retained['sources'], **retained['generated']}.items():
        source(name, digest)
    for name in git('ls-files', 'renderer/virgl-shader', 'renderer/virgl-command/decoder.mjs',
                    'renderer/virgl-command/constant-domain.mjs', 'renderer/virgl-command/resources.mjs', 'renderer/virgl-command/cache.mjs').splitlines():
        source(name)
        need((ROOT / name).read_bytes() == subprocess.check_output(['git', 'show', PREDECESSOR + ':' + name], cwd=ROOT), 'carried boundary changed: ' + name)
    state = (ROOT / 'renderer/virgl-command/state.mjs').read_bytes()
    prior = subprocess.check_output(['git', 'show', PREDECESSOR + ':renderer/virgl-command/state.mjs'], cwd=ROOT)
    start, end = b'    function link(', b'    const selectedProgram ='
    need(state[state.index(start):state.index(end)] == prior[prior.index(start):prior.index(end)], 'carried native link/uniform ownership changed')
    for name in git('ls-files', 'tools/verify-virgl-standard-constant.sh', 'tools/verify-virgl-standard-constant.mjs',
                    'tools/virgl-command/standard-constant-*', 'tools/setup-virgl-emsdk.sh', 'Makefile').splitlines():
        source(name)
    for item in directory.rglob('*'):
        if item.is_file() and item.name != 'receipt.json':
            record(item.relative_to(directory).as_posix())
    receipt = dict(schema='standard-constant-attributes-receipt-v1', task=TASK, status='passed', gitHead=head,
                   frames=31, checkedPhysicalPixels=12500, guestExecution=False, productionNegotiation=False,
                   authority='isolated-standard-constant-attributes', productionDrawAuthority=False,
                   carriedCompilerOwnershipAndDecoderHead=PREDECESSOR, files=files, sources=sources, generated=generated)
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main(sys.argv[1])
