#!/usr/bin/env python3
"""Fresh-critic full-body authentication; no worker audit is trusted as a result."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
BASE = '5a0d9fc9655f1e0956154763bda420aec721865a'
FREEZE = 'de736cd109a092b59c82a83dd9520ee5928b8c2a'
PINS = {
    'evidence/virgl-stencil/worker': (
        '386cdb8880bcf72d20a9bf5d6c2bb1eef58023da64974448b42ef7edab445055',
        'e590aee23a07f06a68542a118dea90eb9823d31a3669dbfad17294566c8f9271',
        '46beab4bf23c06c2b8f826e41db8b0969cfd380b2a9bdcf750a4cc12322a848c'),
    'evidence/virgl-packed-depth-consumer/worker': (
        '50d98b1a99ec9ffc0dce2567126a59fa7785536140275c2c62951d47378dfbdb',
        '012d2a73e5d3d61db1b98a399ebda30d2d0f8592ec54df06e15a0f9cc6be11cf',
        'cee5f6525922a02a14885affebcf763df18468b6434267a251f1a1f5b3e313a4'),
    'evidence/virgl-packed-depth-consumer/verifier': (
        'b200fc0e6f8c1adfb11fef59182c1a236002813289d2a16668dd189a86c0f8f1',
        'f5397d5d120a13072a44bef5fb2437457532465ef3a272821fbbd871f43b0964',
        'b4dd7626c6f74f145515c810c12d17416dfefd7ae527cee524c1e9265fee9d56'),
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def need(value, message):
    if not value:
        raise ValueError(message)


def git_body(head, name):
    return subprocess.check_output(['git', 'show', head+':'+name], cwd=ROOT)


def reopen(folder, retain=False):
    base = ROOT/folder
    manifest_raw, index_raw = (base/'manifest.json').read_bytes(), (base/'records.json').read_bytes()
    manifest, index = json.loads(manifest_raw), json.loads(index_raw)
    pins = PINS[folder]
    need((sha(manifest_raw), sha(index_raw)) == pins[:2], 'manifest/index pin '+folder)
    parts = manifest.get('archiveParts', [manifest.get('archive')])
    raw_parts = []
    for part in parts:
        raw = (base/part['path']).read_bytes()
        need(len(raw) == part['bytes'] and sha(raw) == part['sha256'], 'whole archive part '+folder)
        raw_parts.append(raw)
    zipped = b''.join(raw_parts)
    need(sha(zipped) == pins[2], 'whole joined archive '+folder)
    if folder != 'evidence/virgl-stencil/worker':
        for name in ['manifest.json', 'records.json']+[p['path'] for p in parts]:
            need((base/name).read_bytes() == git_body(BASE, folder+'/'+name), 'held Git seal drift '+folder+'/'+name)
    expected = {r['path']: r for r in index['records']}
    need(len(expected) == len(index['records']), 'duplicate index member')
    members, records, seen, logical_bytes, physical_bytes = {}, [], set(), 0, 0
    with tarfile.open(fileobj=io.BytesIO(gzip.decompress(zipped)), mode='r:') as tar:
        physical = {}
        for item in tar.getmembers():
            need(item.name in expected and item.name not in seen, 'unexpected/duplicate member '+item.name)
            need(item.isfile() or item.islnk(), 'non-file archive member')
            need(not item.name.startswith('/') and '..' not in Path(item.name).parts, 'unsafe member name')
            seen.add(item.name)
            if item.islnk():
                need(item.linkname in physical, 'hardlink not to earlier physical regular member '+item.name)
                body, body_digest, target_offset = physical[item.linkname]
                need(target_offset < item.offset, 'hardlink ordering')
                target = item.linkname
            else:
                body = tar.extractfile(item).read()
                body_digest = sha(body)
                physical[item.name] = (body, body_digest, item.offset)
                physical_bytes += len(body)
                target = item.name
            row = expected[item.name]
            need(len(body) == row['bytes'] and body_digest == row['sha256'], 'complete logical body '+item.name)
            logical_bytes += len(body)
            records.append(dict(path=item.name, bytes=len(body), sha256=body_digest, physical=target, offset=item.offset))
            if retain:
                members[item.name] = body
    need(seen == set(expected), 'missing logical members')
    return dict(path=folder, manifestSha256=pins[0], indexSha256=pins[1], archiveSha256=pins[2],
                sourceHead=manifest['sourceHead'], logicalMembers=len(records), physicalMembers=len(physical),
                logicalBytes=logical_bytes, physicalBytes=physical_bytes, records=records), members


def main(output):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    audits, worker = [], None
    for folder in PINS:
        audit, members = reopen(folder, folder == 'evidence/virgl-stencil/worker')
        audits.append(audit)
        if members:
            worker = members
    need(audits[0]['sourceHead'] == FREEZE, 'worker source freeze')
    need(sum(a['logicalMembers'] for a in audits[1:]) == 74113, 'held D43 member count')
    hot = json.loads(worker['hot/receipt.json'])
    cold = json.loads(worker['cold/receipt.json'])
    cold_report = json.loads(worker['cold/report.json'])
    need(sha(worker['hot/receipt.json']) == 'f91bfe2d9b9216a287bd7e5c393e046a1419cfbe974fc8aeae1b7b6f22d4bd8a', 'hot receipt')
    need(sha(worker['cold/receipt.json']) == 'ae6cfce6fecc7c902a8a75c635d21ee27fa3f7f9efc229cef1c595255056c033', 'cold receipt')
    need(sha(worker['cold/report.json']) == '07431ec30af71c0bc20b5b43da6d6e822c667fdac4dc1aa9dc341a4f9b149d80', 'cold report')
    need(cold_report['cloneHead'] == FREEZE and cold_report['exitCode'] == 0 and
         not cold_report['statusBefore'] and not cold_report['statusAfter'], 'one final pristine cold')
    for name in cold_report['removedEnvironmentNames']:
        need(isinstance(name, str), 'scrubbed environment key')
    source_checks = {}
    for prefix, receipt in [('hot', hot), ('cold', cold)]:
        need(receipt['gitHead'] == FREEZE and receipt['status'] == 'passed', 'receipt exact freeze')
        need(not receipt['guestExecution'] and not receipt['productionNegotiation'] and
             not receipt['productionDrawAuthority'], 'isolated claim')
        for name, digest in receipt['files'].items():
            need(sha(worker[prefix+'/'+name]) == digest, 'complete receipt body '+prefix+'/'+name)
        for name, digest in receipt['sources'].items():
            key = FREEZE+':'+name
            if key not in source_checks:
                body = git_body(FREEZE, name)
                need(sha(body) == digest, 'complete Git source '+name)
                source_checks[key] = digest
            need(source_checks[key] == digest, 'receipt source disagreement')
            if not name.startswith('evidence/'):
                need(sha(worker['source/'+name]) == digest, 'sealed full source closure '+name)
        for name, digest in receipt['generated'].items():
            need(sha(worker[prefix+'-generated/'+name]) == digest, 'complete generated compiler '+name)
        for name, digest in receipt['dependency']['unchangedBoundaries'].items():
            need(git_body(BASE, name) == git_body(FREEZE, name) and
                 sha(git_body(BASE, name)) == digest, 'unchanged storage boundary '+name)
        for name in subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', BASE, 'renderer/virgl-shader'], cwd=ROOT, text=True).splitlines():
            need(git_body(BASE, name) == git_body(FREEZE, name), 'unchanged compiler boundary '+name)
    # Extract authenticated complete bodies into a critic-owned tree. Independent
    # audits may write their own outputs here without touching the worker recording.
    extract = output/'worker-reopened'
    for name, body in worker.items():
        if name.startswith(('hot/', 'cold/')):
            path = extract/name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
    result = dict(schema='stencil-fresh-critic-full-custody-v1', status='passed', base=BASE, freeze=FREEZE,
                  reopenedLogicalMembers=sum(a['logicalMembers'] for a in audits), seals=audits,
                  sourceIdentities=source_checks, hotReceiptSources=len(hot['sources']),
                  coldReceiptSources=len(cold['sources']), hotRecordedFiles=len(hot['files']),
                  coldRecordedFiles=len(cold['files']), coldReport=cold_report,
                  extraction=str(extract), completeLogicalBodies=True, earlierPhysicalHardlinksOnly=True)
    (output/'custody-audit.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({k: result[k] for k in ['status', 'reopenedLogicalMembers', 'hotReceiptSources', 'hotRecordedFiles']}))


if __name__ == '__main__':
    main(sys.argv[1])
