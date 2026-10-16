#!/usr/bin/env python3
"""Fresh critic authentication; worker receipts are assertions, never authority."""
from pathlib import Path
import gzip
import hashlib
import io
import json
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
FREEZE = '1b8e94b79de6ee79f72116246ce4042aa7bda815'
HEAD = '2879d9a49c5b9b4f351993f0cf75342c7743d41b'
BASE = 'b98847797f109b0a3af6171fd0a8c21983e1057b'
sha = lambda raw: hashlib.sha256(raw).hexdigest()

def git(*args, cwd=ROOT):
    return subprocess.check_output(['git', *args], cwd=cwd)

def need(value, message):
    if not value:
        raise ValueError(message)

worker = ROOT / 'evidence/virgl-standard-scalar/worker'
archive = (worker / 'recording.tar.gz').read_bytes()
index_raw = (worker / 'records.json').read_bytes()
manifest = json.loads((worker / 'manifest.json').read_bytes())
need(sha(archive) == '99c79728c82a3c7ddef092b1faa10420192df535be67da662e1724b3aab596d2' and len(archive) == 23655986, 'archive identity')
need(sha(index_raw) == '8f1c71adc3cce4358b72b8fa80c2bcf4c8e90d8c02c30cfde28c2967869c1097', 'index identity')
index = json.loads(index_raw)
need(index['sourceHead'] == manifest['sourceHead'] == FREEZE, 'source head')
need(len(index['records']) == manifest['records'] == 9578, 'record count')
for name in ['recording.tar.gz', 'records.json', 'manifest.json']:
    need((worker / name).read_bytes() == git('show', HEAD + ':evidence/virgl-standard-scalar/worker/' + name), 'committed seal ' + name)
records = {row['path']: row for row in index['records']}
need(len(records) == 9578, 'duplicate record name')
out = HERE / 'unpacked'
out.mkdir(exist_ok=True)
members = {}
with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as tar:
    for member in tar.getmembers():
        name = member.name
        need(member.isfile() and name in records and name not in members and not Path(name).is_absolute() and '..' not in Path(name).parts, 'unsafe/non-index record ' + name)
        raw = tar.extractfile(member).read()
        need(member.size == records[name]['bytes'] == len(raw) and sha(raw) == records[name]['sha256'], 'record identity ' + name)
        members[name] = raw
        dest = out / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(raw)
need(set(members) == set(records), 'archive/index closure')
summary = {'schema': 'scalar-critic-authentication-v1', 'status': 'running', 'predictions': 'predictions.json', 'workerHead': HEAD, 'freezeHead': FREEZE, 'archiveSha256': sha(archive), 'recordIndexSha256': sha(index_raw), 'records': len(members), 'receipts': {}, 'physicalReports': []}
pins = json.loads((ROOT / 'evidence/virgl-standard-compact/verifier/manifest.json').read_bytes())['sources']
need(not git('diff', '--name-only', BASE, HEAD, '--', 'renderer/virgl-shader', 'crates', 'web', 'tools/guest').strip(), 'unchanged compiler/guest/production source boundary')
need(not git('diff', '--name-only', FREEZE, HEAD, '--', 'renderer', 'tools', 'Makefile').strip(), 'runtime/harness freeze drift')
need(not git('diff', '--name-only', 'HEAD').strip(), 'tracked worktree drift')
for prefix, expected_receipt in [('hot', '33dbe88bfa942657c87255d8a65937fac6509e8bdf038919ffd21d7a476cbfc3'), ('cold', 'c7b25cad9a3f308f66b9b58130d61db7db30dd7f893a5fe6005969c5f1d89dfb')]:
    raw = members[prefix + '/receipt.json']
    need(sha(raw) == expected_receipt, prefix + ' receipt hash')
    receipt = json.loads(raw)
    need(receipt['gitHead'] == FREEZE and receipt['status'] == 'passed', prefix + ' head/status')
    need(len(receipt['sources']) == 531 and len(receipt['generated']) == 2 and len(receipt['carriedVerifiedEvidence']) == 154, prefix + ' closure counts')
    for name, digest in receipt['files'].items():
        need(sha(members[prefix + '/' + name]) == digest, prefix + ' file receipt ' + name)
    for name, digest in receipt['sources'].items():
        need(sha(git('show', FREEZE + ':' + name)) == digest and sha(git('show', HEAD + ':' + name)) == digest, prefix + ' source ' + name)
        need(sha((ROOT / name).read_bytes()) == digest, prefix + ' worktree source ' + name)
    for name, digest in receipt['carriedVerifiedEvidence'].items():
        need(sha(git('show', BASE + ':' + name)) == digest == receipt['sources'][name], prefix + ' carried HELD ' + name)
    for name, digest in receipt['generated'].items():
        need(sha(members[prefix + '-generated/' + name]) == digest == pins[name] and sha((ROOT / name).read_bytes()) == digest, prefix + ' actual generated D12 pin ' + name)
    need(b'\nSTANDARD_SCALAR_RECORDING_COMPLETE\n' in members[prefix + '/acceptance.log'], 'incomplete acceptance')
    summary['receipts'][prefix] = {'sha256': sha(raw), 'files': len(receipt['files']), 'sources': len(receipt['sources']), 'generated': receipt['generated'], 'carried': len(receipt['carriedVerifiedEvidence'])}
    for suffix in ['hardware', 'fault-native-signedness', 'fault-constant-scaled', 'retained-compact/hardware', 'retained-compact/fault-native-normalize', 'retained-compact/fault-constant-unpack', 'retained-compact/critic-hardware']:
        name = prefix + '/' + suffix
        report = json.loads(members[name + '/report.json'])
        fault = '/fault-' in name
        need(report['gitHead'] == FREEZE and report['status'] == ('failed' if fault else 'passed'), name + ' state')
        need(report['fixedMemory'] == {'bytes': 16777216, 'stageExport': 'function', 'pairExport': 'function'}, name + ' fixed compiler')
        need(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, name + ' browser errors')
        need(report['browser']['headless'] is False and report['browser']['gpu']['featureStatus'].get('webgl2', report['browser']['gpu']['featureStatus'].get('webgl')) == 'enabled', name + ' headed enabled GPU')
        need(not any(any(word in arg.lower() for word in ['swiftshader','llvmpipe','softpipe','lavapipe']) or arg.startswith('--disable-gpu') for arg in report['browser']['commandLine']), name + ' hardware flags')
        result = report['partial'] if fault else report['browserResult']['result']
        need('Apple M4' in result['gpu']['renderer'] and not result['guestExecution'] and not result['productionNegotiation'], name + ' bounded hardware authority')
        served = {row['path']: row for row in report['servedFiles']}
        source = {row['path']: row for row in report['sources']}
        mutation = report.get('mutation')
        for file, row in source.items():
            need(row['sha256'] == (receipt['generated'] if '/build/' in file else receipt['sources'])[file], name + ' report source ' + file)
            if '/' + file in served:
                expected = mutation['servedSha256'] if mutation and mutation['path'] == file else row['sha256']
                need(served['/' + file]['sha256'] == expected, name + ' served ' + file)
        for key in ['browserCoverage','screenshot']:
            row = report[key]
            need(sha(members[name + '/' + row['path']]) == row['sha256'], name + ' ' + key)
        coverage = json.loads(members[name + '/' + report['browserCoverage']['path']])
        for script in coverage['scripts']:
            need(script['sha256'] == served['/' + script['source']]['sha256'], name + ' coverage custody')
        for blob in result['blobs']:
            raw = members[name + '/' + blob['path']]
            need(sha(raw) == blob['gzipSha256'], name + ' gzip blob')
            uncompressed = gzip.decompress(raw)
            need(len(uncompressed) == blob['bytes'] and sha(uncompressed) == blob['sha256'], name + ' original raw blob')
        if mutation:
            original = git('show', FREEZE + ':' + mutation['path'])
            altered = members[name + '/mutation-source.mjs']
            needle, replacement = mutation['needle'].encode(), mutation['replacement'].encode()
            need(original.count(needle) == 1 and original.replace(needle, replacement) == altered and sha(altered) == mutation['servedSha256'], name + ' exact actual source sabotage')
        summary['physicalReports'].append({'path': name + '/report.json', 'sha256': sha(members[name + '/report.json']), 'frames': len(result['frames']), 'status': report['status'], 'renderer': result['gpu']['renderer'], 'blobs': len(result['blobs'])})
cold_raw = members['cold/report.json']
need(sha(cold_raw) == '6651b7e44098ae7d9f40a81fb789e5f19b63a29dd2e28c091e96f7a37926316e', 'cold report identity')
cold = json.loads(cold_raw)
need(cold['gitHead'] == cold['cloneHead'] == FREEZE and cold['status'] == 'passed' and cold['exitCode'] == 0 and cold['statusBefore'] == cold['statusAfter'] == '', 'pristine exact-head default acceptance')
need(cold['command'] == ['make','verify-E6-T11d13'] and sha(members['cold/cold.log']) == cold['logSha256'] and sha(members['cold/receipt.json']) == cold['receiptSha256'], 'cold command/log closure')
clone = Path(cold['clone'])
need(clone.is_dir() and git('rev-parse','HEAD',cwd=clone).decode().strip() == FREEZE and not git('status','--porcelain','--untracked-files=all',cwd=clone).strip(), 'present cold clone head/status')
summary['cold'] = {'reportSha256': sha(cold_raw), 'cloneHead': FREEZE, 'presentCloneClean': True, 'removedEnvironmentNames': cold['removedEnvironmentNames'], 'command': cold['command']}
summary['status'] = 'passed'
(HERE / 'authentication.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({k:summary[k] for k in ['status','records','receipts','cold']}))
