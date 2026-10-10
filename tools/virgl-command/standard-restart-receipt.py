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
TASK = 'E6-T11d9'
PREDECESSOR = 'bef7040804a1c71ad37112e35adcfebefbc4be21'


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
        if b'\nSTANDARD_RESTART_RECORDING_COMPLETE\n' in (directory / 'acceptance.log').read_bytes():
            break
        time.sleep(.01)
    else:
        raise ValueError('acceptance log has no completed runtime block')

    def physical(name, task, frames, fault=False):
        report = json.loads(record(name + '/report.json'))
        need(report['task'] == task and report['status'] == ('failed' if fault else 'passed') and report['gitHead'] == recorded_head,
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
            labels = {'E6-T11d7': ('all-widths-0', 'constant', 'generic'),
                      'E6-T11d8': ('mode-2-wide-instanced-0', 'topology', 'mode'),
                      'E6-T11d9': ('mode-2-custom-0', 'restart', 'restart')}
            label, oracle, kind = labels[task]
            need(frame['label'] == label and label + ' independent ' + oracle + ' pixel oracle'
                 in report['browserResult']['error']['message'], 'named physical pixel oracle')
            need(mutation['mode'] == kind, 'actual mutation kind')
        else:
            need(result['status'] == 'passed' and all(row['held'] for row in result['predictions']), 'positive predictions')
            for run in result['runs']:
                need(run['inspection']['jobs']['reads'] == 0 and run['inspection']['jobs']['stagingBytes'] == 0, 'read/staging cleanup')
        return result

    wire = json.loads(record('wire/report.json'))
    recorded_head = wire['gitHead']
    if recorded_head != head:
        subprocess.check_call(['git', 'merge-base', '--is-ancestor', recorded_head, head], cwd=ROOT)
        changed = set(git('diff', '--name-only', recorded_head, head).splitlines())
        need(changed <= {'tools/virgl-command/standard-restart-receipt.py'}, 'historical physical carry permits only this receipt correction')
    need(wire['status'] == 'passed' and wire['gitHead'] == recorded_head and len(wire['wire']['records']) == 292
         and all(row['held'] for row in wire['wire']['predictions']), 'literal Node restart/legacy/hostile packets')
    for row in wire['sources']:
        source(row['path'], row['sha256'])
    result = physical('hardware', TASK, 189)
    need(len(result['wire']['records']) == 292 and all(row['held'] for row in result['wire']['predictions']), 'literal browser restart packets')
    need(len(result['rejections']) == 8 and all(not row['record']['result']['ok'] for row in result['rejections']), 'original bounds/read/work/native-limit cases')
    need([row['action'] for row in result['suspensions']] == ['stale-index', 'collected-index', 'cancel', 'reuse'], 'pending index lifetime attacks')
    for row in result['suspensions']:
        outcome = row['record']['result']
        need(row['point']['inspection']['jobs']['reads'] == 2, 'whole pending batch retained')
        if row['action'] == 'reuse':
            need(outcome['ok'] and outcome['gpuComplete'] and row['newGeneration'] > row['oldGeneration']
                 and outcome['draws'][0]['indexResourceGeneration'] == row['oldGeneration'], 'retained original index generation')
        else:
            need(not outcome['ok'] and not outcome['draws'] and outcome['gpuComplete']
                 and outcome['error']['code'] == ('cancelled' if row['action'] == 'cancel' else 'stale-storage'), 'pending source rejection/drain')
    expected_ownership = ['scratch-exact-one', 'scratch-exact-64', 'scratch-minus-one', 'scratch-draw-65',
                          'read-exact', 'read-minus-one', 'native-create-fails', 'native-upload-fails',
                          'owned-cancel-waiting-attributes', 'owned-cancel-finishing', 'owned-dispose']
    need([row['label'] for row in result['ownership']] == expected_ownership, 'complete private index ownership attacks')
    for run in result['runs']:
        jobs = run['inspection']['jobs']
        need(all(jobs[key] == 0 for key in ['reads', 'stagingBytes', 'normalizedBuffers', 'normalizedBytes', 'normalizationScratchBytes']), 'all owned budgets released')
        for row in run['normalizationEvents']:
            if row['name'] == 'forced-createBuffer-null':
                need(row['allocation'] == 2, 'explicit second native allocation sabotage')
                continue
            need(row['bytes'] <= 262144 and row['inspection']['normalizedBytes'] <= 262144
                 and row['inspection']['normalizedBuffers'] <= 64, 'derived GPU bounds')
            if row['name'] == 'normalized-upload':
                need(row['inspection']['normalizationScratchBytes'] == row['bytes'], 'CPU scratch explicitly accounted at native upload')
    physical('fault-restart', TASK, 1, True)
    audit = json.loads(record('physical-audit.json'))
    need(audit['status'] == 'passed' and len(audit['frames']) == 189 and audit['pixels'] == 139008
         and audit['nativeDraws'] == 377 and audit['normalizedBuffers'] == 318
         and all(row['held'] for row in audit['frames']) and [row['label'] for row in audit['faults'] if not row['held']] == ['mode-2-custom-0'], 'independent original/normalized GPU byte and pixel audit')
    for name, task, frames, kind, pixels in [('constant', 'E6-T11d7', 31, 'generic', 12500),
                                           ('topology', 'E6-T11d8', 87, 'mode', 50176)]:
        physical('retained-' + name + '/hardware', task, frames)
        physical('retained-' + name + '/fault-' + kind, task, 1, True)
        old_audit = json.loads(record('retained-' + name + '/physical-audit.json'))
        need(old_audit['status'] == 'passed' and len(old_audit['frames']) == frames and old_audit['pixels'] == pixels, 'retained physical boundary ' + name)
    retained = json.loads(record('retained-standard-draw/receipt.json'))
    need(retained['status'] == 'passed' and retained['gitHead'] == recorded_head and retained['frames'] == 37
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
    for facet in ['draw', 'constant', 'topology']:
        prefix = 'evidence/virgl-standard-' + facet
        names = git('ls-files', prefix + '/worker/manifest.json', prefix + '/worker/records.json',
                    prefix + '/worker/recording.tar.gz', prefix + '/verifier/manifest.json',
                    prefix + '/verifier/verdict.json', prefix + '/verifier/records.json',
                    prefix + '/verifier/recording.tar.gz').splitlines()
        need(len(names) >= 6, 'missing historical worker/fresh-critic carry ' + facet)
        for name in names:
            source(name)
            need((ROOT / name).read_bytes() == subprocess.check_output(['git', 'show', PREDECESSOR + ':' + name], cwd=ROOT), 'historical carry evidence changed')
            carried[name] = sources[name]
    for name in git('ls-files', 'tools/verify-virgl-standard-restart.sh', 'tools/verify-virgl-standard-restart.mjs',
                    'tools/virgl-command/standard-restart-*', 'tools/setup-virgl-emsdk.sh', 'Makefile').splitlines():
        source(name)
    for item in directory.rglob('*'):
        if item.is_file() and item.name != 'receipt.json':
            record(item.relative_to(directory).as_posix())
    receipt = dict(schema='standard-primitive-restart-receipt-v1', task=TASK, status='passed', gitHead=head, physicalSourceHead=recorded_head,
                   frames=189, checkedPhysicalPixels=139008, guestExecution=False, productionNegotiation=False,
                   authority='isolated-standard-primitive-restart', productionDrawAuthority=False,
                   carriedCompilerAndOwnershipHead=PREDECESSOR, carriedVerifiedEvidence=carried,
                   files=files, sources=sources, generated=generated)
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main(sys.argv[1])
