"""Independent repaired-head seal/source/carry-forward authentication."""
from pathlib import Path
import hashlib
import json
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[3]
V = Path(__file__).resolve().parent
SCRATCH = ROOT / 'target/evidence/virgl-standard-state-reflection-verifier'
HEAD = 'adcbe81bcd091c3d411a8f96ac8746e1a17290fb'
PRIOR = '365b3cf3d076637c347c7e9802420f847d09fbed'
sha = lambda raw: hashlib.sha256(raw).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT)


def need(condition, label):
    if not condition:
        raise AssertionError(label)


def unpack(name, expected_archive, expected_index, count, head):
    source = V.parent / name
    manifest = json.loads((source / 'manifest.json').read_bytes())
    raw = (source / 'records.json').read_bytes()
    index = json.loads(raw)
    archive = (source / 'recording.tar.gz').read_bytes()
    need(manifest['archiveSha256'] == sha(archive) == expected_archive, name + ' archive digest')
    need(manifest['recordIndexSha256'] == sha(raw) == expected_index, name + ' index digest')
    need(manifest['archiveBytes'] == len(archive), name + ' archive extent')
    need(manifest['sourceHead'] == head and (isinstance(index, list) or index['sourceHead'] == head), name + ' frozen source head')
    rows = index if isinstance(index, list) else index['records']
    records = {row['path']: row for row in rows}
    need(len(records) == len(rows) == manifest['records'] == count, name + ' indexed count')
    target = SCRATCH / ('unpacked-' + name)
    target.mkdir(parents=True, exist_ok=True)
    seen = set()
    with tarfile.open(source / 'recording.tar.gz') as tar:
        members = tar.getmembers()
        need(len(members) == count, name + ' tar member count')
        for member in members:
            need(member.isfile() and member.name in records and member.name not in seen, name + ' member type/name')
            need(not Path(member.name).is_absolute() and '..' not in Path(member.name).parts, name + ' path traversal')
            seen.add(member.name)
            data = tar.extractfile(member).read()
            row = records[member.name]
            need(member.size == len(data) == row['bytes'] and sha(data) == row['sha256'], name + '/' + member.name)
            file = target / member.name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(data)
    need(seen == set(records), name + ' complete index')
    return target, manifest, records


U, manifest, records = unpack('reflection-repair',
    '9c2a187e7f192c35bcc9c06eb32d1e7fc90e8e7ca938cb37c6a124eb3bdc467e',
    'be036ae9072dbfae6ea1225572ffbe62fa84a5df4ebe345eefe25a72d62fef11', 332, HEAD)
old, old_manifest, old_records = unpack('verifier',
    '6f05eeafad2f2dcdc225957b6ee95889855c1abc3538b480ad3f9a1222257c9b',
    '09f798b43f4b9e960c97879b682ac0110089cb9f124b42108d79edd4093cbd7e', 52, PRIOR)
for name, key in [('hot/receipt.json', 'hotReceiptSha256'), ('cold/report.json', 'coldReportSha256'),
                  ('cold/receipt.json', 'coldReceiptSha256')]:
    need(records[name]['sha256'] == manifest[key], 'manifest receipt ' + name)
source_checks = file_checks = generated_checks = served_checks = 0
for prefix in ['hot', 'cold']:
    receipt = json.loads((U / prefix / 'receipt.json').read_bytes())
    need(receipt['gitHead'] == HEAD and receipt['status'] == 'passed', prefix + ' receipt status/head')
    for name, digest in receipt['sources'].items():
        need(sha(git('show', HEAD + ':' + name)) == digest, prefix + ' git source ' + name)
        source_checks += 1
    for name, digest in receipt['files'].items():
        need(sha((U / prefix / name).read_bytes()) == digest, prefix + ' receipt file ' + name)
        file_checks += 1
    for name, digest in receipt['generated'].items():
        need(sha((U / (prefix + '-generated') / name).read_bytes()) == digest, prefix + ' generated ' + name)
        generated_checks += 1
    for sub in ['wire', 'hardware', 'fault-suffix', 'fault-metadata']:
        report = json.loads((U / prefix / sub / 'report.json').read_bytes())
        fault = sub.startswith('fault-')
        need(report['gitHead'] == HEAD, prefix + '/' + sub + ' report head')
        need(report['status'] == ('failed' if fault else 'passed'), prefix + '/' + sub + ' status')
        need(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, prefix + '/' + sub + ' browser errors')
        for row in report['sources']:
            wanted = receipt['generated'] if '/build/' in row['path'] else receipt['sources']
            need(wanted[row['path']] == row['sha256'], prefix + '/' + sub + ' source ' + row['path'])
            source_checks += 1
        if sub == 'wire':
            continue
        served = {row['path']: row['sha256'] for row in report['servedFiles']}
        for row in report['sources']:
            if '/' + row['path'] not in served:
                continue
            wanted = report['mutation']['servedSha256'] if fault and row['path'] == report['mutation']['path'] else row['sha256']
            need(served['/' + row['path']] == wanted, prefix + '/' + sub + ' served ' + row['path'])
            served_checks += 1
        coverage = json.loads((U / prefix / sub / 'browser-coverage.json').read_bytes())
        for row in coverage['scripts']:
            need(row['sha256'] == served['/' + row['source']], prefix + '/' + sub + ' coverage identity')
            served_checks += 1
        if sub == 'hardware':
            for row in report['inputs']:
                data = (U / prefix / row['path']).read_bytes() if row['path'] in ['geometry.bin', 'c580.bin'] else git('show', HEAD + ':' + row['path'])
                need(len(data) == row['bytes'] and sha(data) == row['sha256'], prefix + ' input ' + row['path'])
        else:
            mutation = report['mutation']
            original = git('show', HEAD + ':' + mutation['path'])
            changed = (U / prefix / sub / 'mutation-source.mjs').read_bytes()
            need(sha(original) == mutation['originalSha256'] and original.count(mutation['needle'].encode()) == 1,
                 prefix + '/' + sub + ' single frozen mutation')
            need(original.replace(mutation['needle'].encode(), mutation['replacement'].encode()) == changed and
                 sha(changed) == mutation['servedSha256'], prefix + '/' + sub + ' exact served mutation')

cold = json.loads((U / 'cold/report.json').read_bytes())
need(cold['gitHead'] == cold['cloneHead'] == HEAD and cold['status'] == 'passed' and cold['exitCode'] == 0,
     'pristine clone exact-head successful command')
need(cold['statusBefore'] == cold['statusAfter'] == '', 'pristine clone cleanliness')
need(cold['command'] == ['make', 'verify-E6-T11d5'], 'pristine clone prescribed command')
need(cold['receiptSha256'] == records['cold/receipt.json']['sha256'] and
     cold['logSha256'] == records['cold/cold.log']['sha256'], 'pristine clone receipt/log custody')
compiler = '9323b44519710dfb2c8a324fe115872b79d274f0'
need(not git('diff', '--name-only', compiler, HEAD, '--', 'renderer/virgl-shader', 'crates').strip(),
     'unchanged compiler/Rust/device/transport boundary')
legacy = git('show', compiler + ':renderer/virgl-command/constant-domain.mjs')
need(git('show', HEAD + ':renderer/virgl-command/constant-domain.mjs').startswith(legacy), 'unchanged legacy prefix')
need(sha(legacy) == 'bfd25f78876cb1b60c7d04de81245c5d9e3938fb4d34f6b0e723961d896afdd2', 'legacy digest')
runtime_delta = git('diff', '--name-only', PRIOR, HEAD, '--', 'renderer/virgl-command', ':!renderer/virgl-command/tests', ':!renderer/virgl-command/*README.md').decode().splitlines()
need(runtime_delta == ['renderer/virgl-command/state.mjs'], 'runtime change closure')
before = git('show', PRIOR + ':renderer/virgl-command/state.mjs')
after = git('show', HEAD + ':renderer/virgl-command/state.mjs')
start = after.index(b'        if (standard) for (let index = 0; index < gl.getProgramParameter(program.native, gl.ACTIVE_UNIFORMS); index++) {')
end = after.index(b'        for (const output of fs.outputs)', start)
need(after[:start] + after[end:] == before, 'only 14-line runtime addition')
need(len(after[start:end].splitlines()) == 14, 'repair extent')
fixture = 'renderer/virgl-command/tests/standard-state-boundaries.mjs'
original_fixture = git('show', '01c4dc73:' + fixture)
current_fixture = (ROOT / fixture).read_bytes()
marker = b'export function metadataAttacks'
need(original_fixture.split(marker)[0] == current_fixture.split(marker)[0], 'unchanged original shader/images/banks/CPU predictions')
name = 'evidence/virgl-standard-state/verifier/omission-probe-addition.mjs'
need(git('show', '01c4dc73:' + name) == (ROOT / name).read_bytes(), 'original omission reproduction fixture')
claim = 'b1263f6e60d68239288309218b3e8cc4590363ad'
head_delta = git('diff', '--name-only', HEAD, claim).decode().splitlines()
need(set(head_delta) == {
    'evidence/virgl-standard-state/reflection-repair/manifest.json',
    'evidence/virgl-standard-state/reflection-repair/records.json',
    'evidence/virgl-standard-state/reflection-repair/recording.tar.gz',
    'tasks/QUEUE.md', 'tasks/epic-6-transcendence/E6-T11d5-standard-shader-state-binding.md'},
    'worker claim documentary-only delta')
audit = {'schema': 1, 'status': 'passed', 'head': HEAD, 'archiveSha256': manifest['archiveSha256'],
         'recordIndexSha256': manifest['recordIndexSha256'], 'records': len(records), 'sourceChecks': source_checks,
         'fileChecks': file_checks, 'generatedChecks': generated_checks, 'servedCoverageChecks': served_checks,
         'coldPristine': True, 'cold': cold, 'compilerDeviceCarryHead': compiler, 'legacyPrefixSha256': sha(legacy),
         'originalRuntimeBeforeRepairSha256': sha(before), 'runtimeSha256': sha(after),
         'repairHunkSha256': sha(after[start:end]), 'priorCriticArchiveSha256': old_manifest['archiveSha256'],
         'priorCriticRecords': len(old_records), 'runtimeDelta': runtime_delta, 'workerClaimDelta': head_delta,
         'unpackedWorker': str(U), 'unpackedCritic': str(old),
         'originalShaderOracleSectionSha256': sha(original_fixture.split(marker)[0]),
         'promotedShaderOracleSectionSha256': sha(current_fixture.split(marker)[0]),
         'workerClaimHead': claim}
(V / 'authentication.json').write_text(json.dumps(audit, indent=2) + '\n')
print(json.dumps({key: audit[key] for key in ['status', 'head', 'records', 'sourceChecks', 'fileChecks', 'generatedChecks', 'servedCoverageChecks', 'coldPristine', 'repairHunkSha256']}))
