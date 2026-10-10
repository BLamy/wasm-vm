#!/usr/bin/env python3
"""Authenticate frozen original point shaders/wire, native storage and pixels."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
PREDECESSOR = 'c810cbef23caa7a19b090491ccc30c093d432518'
TASK = 'E6-T11d11'


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
        raw = (directory / name).read_bytes()
        need(digest is None or sha(raw) == digest, 'record drift ' + name)
        files[name] = sha(raw)
        return raw
    def source(name, digest=None):
        raw = (ROOT / name).read_bytes()
        need(digest is None or sha(raw) == digest, 'source drift ' + name)
        if '/build/' in name or name.startswith('target/'):
            generated[name] = sha(raw)
        else:
            frozen = subprocess.check_output(['git', 'show', head + ':' + name], cwd=ROOT)
            need(raw == frozen, 'source not frozen ' + name)
            sources[name] = sha(raw)
    def evidence_head(recorded):
        if recorded == head:
            return
        correction = json.loads(record('harness-correction.json'))
        need(correction.get('physicalHead') == recorded and correction['sourceHead'] == head,
             'explicit carried physical head')
        subprocess.check_call(['git', 'merge-base', '--is-ancestor', recorded, head], cwd=ROOT)
        need(set(git('diff', '--name-only', recorded, head).splitlines()) ==
             {'tools/virgl-command/standard-point-receipt.py'}, 'physical carry requires receipt-only correction')
        failed = record('harness-receipt-failure.log', correction['receiptFailureSha256'])
        need(b'STANDARD_POINTS_RECORDING_COMPLETE\n' in failed and
             b'ValueError: record drift retained-compiler/acceptance.log' in failed,
             'preserve completed original physical run and receipt failure')
    for _ in range(500):
        if b'\nSTANDARD_POINTS_RECORDING_COMPLETE\n' in (directory / 'acceptance.log').read_bytes():
            break
        time.sleep(.01)
    else:
        raise ValueError('incomplete acceptance log')

    def physical(name, task, frames, fault=False):
        report = json.loads(record(name + '/report.json'))
        evidence_head(report['gitHead'])
        need(report['task'] == task and report['status'] == ('failed' if fault else 'passed'), 'physical task/head/status ' + name)
        need(report['fixedMemory'] == {'bytes': 16777216, 'stageExport': 'function', 'pairExport': 'function'}, 'fixed actual compiler')
        need(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser errors ' + name)
        browser = report['browser']
        need(not browser['headless'] and browser['gpu']['featureStatus'].get('webgl2', browser['gpu']['featureStatus'].get('webgl')) == 'enabled', 'headed WebGL2 ' + name)
        need(not any(any(word in arg.lower() for word in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe']) or arg.startswith('--disable-gpu') for arg in browser['commandLine']), 'software GPU flags')
        served = {row['path']: row['sha256'] for row in report['servedFiles']}
        mutation = report.get('mutation')
        for row in report['sources']:
            source(row['path'], row['sha256'])
            if '/' + row['path'] in served:
                expected = mutation['servedSha256'] if mutation and row['path'] == mutation['path'] else row['sha256']
                need(served['/' + row['path']] == expected, 'served source drift ' + row['path'])
        record(name + '/' + report['screenshot']['path'], report['screenshot']['sha256'])
        coverage = json.loads(record(name + '/' + report['browserCoverage']['path'], report['browserCoverage']['sha256']))
        need({'renderer/virgl-command/' + n + '.mjs' for n in ['state', 'decoder', 'resources', 'cache', 'constant-domain']} <= {row['source'] for row in coverage['scripts']}, 'runtime coverage closure')
        for row in coverage['scripts']:
            need(row['sha256'] == served['/' + row['source']], 'coverage source drift')
        result = report['partial'] if fault else report['browserResult']['result']
        need(not result['guestExecution'] and not result['productionNegotiation'] and len(result['frames']) == frames, 'isolated physical frames ' + name)
        for blob in result['blobs']:
            packed = record(name + '/' + blob['path'], blob['gzipSha256'])
            raw = gzip.decompress(packed)
            need(len(raw) == blob['bytes'] and sha(raw) == blob['sha256'], 'original/GPU/pixel custody')
        if fault:
            original = (ROOT / mutation['path']).read_bytes()
            changed = record(name + '/mutation-source.mjs', mutation['servedSha256'])
            need(sha(original) == mutation['originalSha256'] and original.count(mutation['needle'].encode()) == 1 and original.replace(mutation['needle'].encode(), mutation['replacement'].encode()) == changed, 'actual served native mutation')
            frame = result['frames'][0]
            need(frame['native']['calls'] and frame['history'][-1]['result']['gpuComplete'] and not frame['audit']['held'], 'completed wrong native draw and final fence')
            if task == TASK:
                need(frame['native']['calls'][0]['args'][0] == 0 and frame['label'] == 'per-vertex-input-0' and frame['label'] + ' independent strict point-square pixels' in report['browserResult']['error']['message'], 'original point pixel oracle')
        else:
            need(result['status'] == 'passed' and all(row['held'] for row in result['predictions']), 'positive physical predictions')
            for run in result['runs']:
                need(all(run['inspection']['jobs'][key] == 0 for key in ['reads', 'stagingBytes', 'normalizedBuffers', 'normalizedBytes', 'normalizationScratchBytes']), 'owned point/source storage released')
        return result

    wire = json.loads(record('wire/report.json'))
    evidence_head(wire['gitHead'])
    need(wire['status'] == 'passed' and len(wire['wire']['records']) == 38 and all(row['held'] for row in wire['wire']['predictions']), 'literal standard/legacy point state')
    need(wire['metadata']['status'] == 'passed' and len(wire['metadata']['records']) == 24 and all(not row['observed']['ok'] for row in wire['metadata']['records']), 'typed point metadata attacks')
    for row in wire['sources']:
        source(row['path'], row['sha256'])
    result = physical('hardware', TASK, 128)
    need(len(result['rejections']) == 4 and all(not row['record']['result']['ok'] for row in result['rejections']), 'point fetch and total-work limits')
    need([(row['phase'], row['action']) for row in result['suspensions']] == [(phase, action) for phase in ['waiting-index', 'waiting-attributes'] for action in ['stale-index', 'cancel', 'reuse']], 'both original read ownership paths')
    for row in result['suspensions']:
        outcome = row['record']['result']
        need(row['point']['inspection']['jobs']['reads'] == (1 if row['phase'] == 'waiting-index' else 2), 'actual point read batch')
        if row['action'] == 'reuse':
            need(outcome['ok'] and outcome['gpuComplete'] and row['newGeneration'] > row['oldGeneration'] and outcome['draws'][0]['indexResourceGeneration'] == row['oldGeneration'], 'original retained point generation')
        else:
            need(not outcome['ok'] and not outcome['draws'] and outcome['gpuComplete'] and outcome['error']['code'] == ('cancelled' if row['action'] == 'cancel' else 'stale-storage'), 'point revision/cancellation drain')
    need([row['phase'] for row in result['ownership']] == ['waiting-index', 'finishing', 'dispose'], 'point native storage lifetime')
    for fault in ['size-selection', 'coord-y']:
        physical('fault-' + fault, TASK, 1, True)
    audit = json.loads(record('physical-audit.json'))
    need(audit['status'] == 'passed' and len(audit['frames']) == 128 and audit['pixels'] == 38400 and audit['nativeDraws'] == 128 and audit['normalizedBuffers'] == 25 and all(row['held'] for row in audit['frames']) and len(audit['faults']) == 2 and all(not row['held'] for row in audit['faults']), 'independent strict point pixels and native bytes')
    for family, task, frames, faults in [('assembly', 'E6-T11d10', 304, ['list-order', 'provoking']), ('restart', 'E6-T11d9', 189, ['restart'])]:
        physical('retained-' + family + '/hardware', task, frames)
        for fault in faults:
            physical('retained-' + family + '/fault-' + fault, task, 1, True)
        old_audit = json.loads(record('retained-' + family + '/physical-audit.json'))
        need(old_audit['status'] == 'passed' and len(old_audit['frames']) == frames and all(row['held'] for row in old_audit['frames']), 'retained physical ' + family)

    compiler = json.loads(record('retained-compiler/receipt.json'))
    if compiler['gitHead'] != head:
        subprocess.check_call(['git', 'merge-base', '--is-ancestor', compiler['gitHead'], head], cwd=ROOT)
        allowed = {'tools/verify-virgl-standard-points.sh', 'tools/virgl-command/standard-point-receipt.py'}
        need(set(git('diff', '--name-only', compiler['gitHead'], head).splitlines()) <= allowed, 'compiler carry requires a harness-only correction')
        correction = json.loads(record('harness-correction.json'))
        need(correction['sourceHead'] == head and correction['retainedCompilerHead'] == compiler['gitHead'] and correction['originalMakePassed'] is False and correction['originalExitCode'] == 2, 'honest original wrapper failure')
        original = record('harness-original-acceptance.log', correction['originalAcceptanceSha256'])
        need(b'flags[@]: unbound variable' in original and b'CARRY_PASSED_COMPILER_AFTER_RECORDED_HARNESS_FAILURE' in (directory / 'acceptance.log').read_bytes(), 'original Bash failure and explicit resumed command')
    need(compiler['status'] == 'passed' and compiler['cases'] == 669 and compiler['frames'] == 129 and compiler['legacyBoundary']['unchanged'], 'directly affected compiler and legacy boundary')
    for name, digest in compiler['files'].items():
        if name == 'acceptance.log':
            raw = record('retained-compiler/' + name)
            # The retained compiler receipt prints this one fixed success line
            # after hashing its own log. Authenticate that exact append without
            # changing the historical receipt or accepting arbitrary drift.
            suffix = b'Frozen standard compiler, 669 cases, 129 physical frames, coverage and legacy boundaries authenticated.\n'
            need(sha(raw) == digest or (raw.endswith(suffix) and sha(raw[:-len(suffix)]) == digest),
                 'retained compiler log prefix or exact success append')
        else:
            record('retained-compiler/' + name, digest)
    for name, digest in compiler['sources'].items():
        source(name, digest)
    for name, digest in compiler['generated'].items():
        source(name, digest)
    native = record('native/native.jsonl')
    need(native == record('native/sanitize.jsonl'), 'point native/sanitizer results disagree')
    metadata = json.loads(record('native/metadata.json'))
    node = json.loads(record('native/node.json'))
    need(metadata['status'] == node['status'] == 'passed' and metadata['cases'] == node['cases'] == 118 and node['exactNativeWasm'] and node['fixedMemory']['bytes'] == 16777216 and node['fixedMemory']['recovered'], 'point original TGSI metadata/native/Wasm/OOM')
    allocations = [json.loads(line) for line in (directory / 'retained-compiler/native/allocations.jsonl').read_text().splitlines()]
    need(allocations[-1]['faults'] == allocations[-1]['recoveries'] == 78 and {row['mode'] for row in allocations if row['kind'] == 'baseline'} == set(range(6)), 'old and point allocation sites')
    need(any(row['kind'] == 'calloc-fault' and row['mode'] == 4 and row['site'] == 3 and 'Point-coordinate validation allocation failed.' in row['result']['error']['message'] for row in allocations), 'actual bounded private TGSI scratch OOM')
    coverage = json.loads(record('coverage/points.json'))
    need(any(row['name'].endswith(':standard_point_tokens') and row['count'] > 0 for row in coverage['data'][0]['functions']), 'new native adapter coverage')
    abi = json.loads(record('abi/points-native.json'))
    need(record('abi/points-native.json') == record('abi/points-sanitize.json') and abi == {'status': 'pinned-header', 'points': 0, 'rasterizerWords': 9, 'pointSizeWord': 3, 'perVertexMask': 16777216}, 'original point/rasterizer ABI')
    need(not git('diff', '--name-only', PREDECESSOR, head, '--', 'renderer/virgl-shader/vendor', 'crates', 'web', 'tools/guest'), 'vendor/guest/production boundary changed')
    carried = {}
    for family in ['draw', 'constant', 'topology', 'restart', 'assembly']:
        for name in git('ls-files', 'evidence/virgl-standard-' + family + '/worker/manifest.json', 'evidence/virgl-standard-' + family + '/worker/records.json', 'evidence/virgl-standard-' + family + '/worker/recording.tar.gz', 'evidence/virgl-standard-' + family + '/verifier/manifest.json', 'evidence/virgl-standard-' + family + '/verifier/records.json', 'evidence/virgl-standard-' + family + '/verifier/verdict.json', 'evidence/virgl-standard-' + family + '/verifier/recording.tar.gz').splitlines():
            source(name)
            need((ROOT / name).read_bytes() == subprocess.check_output(['git', 'show', PREDECESSOR + ':' + name], cwd=ROOT), 'historical HELD evidence changed')
            carried[name] = sources[name]
    for name in git('ls-files', 'renderer/virgl-shader', 'renderer/virgl-command', 'tools/verify-virgl-standard-points*', 'tools/virgl-command/standard-point-*', 'tools/virgl-standard-shader', 'Makefile').splitlines():
        source(name)
    for path in directory.rglob('*'):
        if path.is_file() and path.name != 'receipt.json':
            record(path.relative_to(directory).as_posix())
    receipt = dict(schema='standard-native-points-receipt-v1', task=TASK, status='passed', gitHead=head, cases=118, frames=128, checkedPhysicalPixels=audit['pixels'], nativeDraws=audit['nativeDraws'], normalizedBuffers=audit['normalizedBuffers'],
                   guestExecution=False, productionNegotiation=False, authority='isolated-standard-native-points', productionDrawAuthority=False, historicalEvidenceHead=PREDECESSOR, carriedVerifiedEvidence=carried, files=files, sources=sources, generated=generated)
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main(sys.argv[1])
