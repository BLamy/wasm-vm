#!/usr/bin/env python3
"""Seal and reopen complete fresh stencil-critic recordings and source bodies."""
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
WORKER = 'e8a36fe6c0a582cb86605a370f5fefc945a8f552'
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def main(directory, audits, output):
    directory, audits, output = [Path(p).resolve() for p in [directory, audits, output]]
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    assert not subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=ROOT, text=True).strip()
    assert not subprocess.check_output(['git', 'diff', FREEZE, 'HEAD', '--', 'renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/state.mjs'], cwd=ROOT, text=True).strip()
    assert b'CRITIC_STENCIL_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes()
    names = ['schedule-'+s for s in ['0x70119abd', '0x4aa534b7', '0xf0097321']]+['ordered', 'switch', 'fault-completed-stencil']
    members, source_names = {}, set()
    for name in names:
        folder = directory/name
        report = json.loads((folder/'report.json').read_text())
        assert report['gitHead'] == head and report['status'] == ('failed' if name.startswith('fault-') else 'passed')
        assert report['browserErrors'] == dict(console=[], page=[], requests=[])
        assert not report['browser']['headless'] and not any('swiftshader' in a.lower() or a.startswith('--disable-gpu') for a in report['browser']['commandLine'])
        assert sha(Path(report['browser']['executable']).read_bytes()) == report['browser']['sha256']
        e = report.get('partial') or report['browserResult']['result']
        assert not e['guestExecution'] and not e['productionNegotiation']
        for row in report['sources']:
            body = (folder/'source'/row['path']).read_bytes()
            assert len(body) == row['bytes'] and sha(body) == row['sha256']
            if '/build/wasm/' not in row['path']:
                assert body == subprocess.check_output(['git', 'show', head+':'+row['path']], cwd=ROOT)
                source_names.add(row['path'])
        for row in e['blobs']:
            zipped = (folder/row['path']).read_bytes()
            body = gzip.decompress(zipped)
            assert sha(zipped) == row['gzipSha256'] and len(body) == row['bytes'] and sha(body) == row['sha256']
        for ref in e['runs']:
            if 'path' in ref:
                body = (folder/ref['path']).read_bytes()
                assert len(body) == ref['bytes'] and sha(body) == ref['sha256']
        for path in sorted(folder.rglob('*')):
            if path.is_file():
                members['fresh/'+name+'/'+path.relative_to(folder).as_posix()] = path.read_bytes()
    members['fresh/acceptance.log'] = (directory/'acceptance.log').read_bytes()
    audit_names = ['custody-audit.json', 'worker-reopened/hot/critic-original-wire-coverage.json',
                   'worker-reopened/cold/critic-original-wire-coverage.json', 'failure-original-count.log',
                   'worker-inverses.log', 'primary-pages.json', 'decision-points.json']
    for name in audit_names:
        members['audit/'+name] = (audits/name).read_bytes()
    custody = json.loads(members['audit/custody-audit.json'])
    assert custody['status'] == 'passed' and custody['reopenedLogicalMembers'] == 116648
    for role in ['hot', 'cold']:
        parent = audits/'worker-reopened'/role
        for path in sorted(parent.glob('*/independent-values.json'))+sorted(parent.glob('*/value-audit.json')):
            members['audit/worker-reopened/'+role+'/'+path.relative_to(parent).as_posix()] = path.read_bytes()
    source_names.update(subprocess.check_output(['git', 'ls-files', 'tools/virgl-stencil', 'tools/verify-virgl-standard-stencil.mjs', 'tools/verify-virgl-standard-stencil.sh', 'tools/verify-virgl-standard-stencil-critic.sh', 'Makefile', 'evidence/virgl-stencil/verifier/PREDICTIONS.md'], cwd=ROOT, text=True).splitlines())
    for name in source_names:
        members['source/'+name] = subprocess.check_output(['git', 'show', head+':'+name], cwd=ROOT)
    output.mkdir(parents=True, exist_ok=True)
    records = [dict(path=name, bytes=len(body), sha256=sha(body)) for name, body in sorted(members.items())]
    index = (json.dumps(dict(schema='stencil-fresh-critic-records-v1', sourceHead=head, records=records), indent=2)+'\n').encode()
    (output/'records.json').write_bytes(index)
    archive = io.BytesIO()
    with gzip.GzipFile(fileobj=archive, mode='wb', mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode='w') as tar:
            seen = {}
            for row in records:
                name, body = row['path'], members[row['path']]
                info = tarfile.TarInfo(name)
                info.mode, info.mtime = 0o644, 0
                prior = seen.get((len(body), row['sha256']))
                if prior is not None:
                    assert members[prior] == body
                    info.type, info.linkname = tarfile.LNKTYPE, prior
                else:
                    info.size = len(body)
                    seen[len(body), row['sha256']] = name
                tar.addfile(info, None if prior is not None else io.BytesIO(body))
    zipped = archive.getvalue()
    (output/'recording.tar.gz').write_bytes(zipped)
    reopened, physical, logical_bytes, physical_bytes = [], {}, 0, 0
    expected = {r['path']: r for r in records}
    with tarfile.open(fileobj=io.BytesIO(gzip.decompress((output/'recording.tar.gz').read_bytes())), mode='r:') as tar:
        for item in tar.getmembers():
            assert item.name in expected and (item.isfile() or item.islnk())
            if item.islnk():
                body, offset = physical[item.linkname]
                assert offset < item.offset
                target = item.linkname
            else:
                body, target = tar.extractfile(item).read(), item.name
                physical[item.name] = body, item.offset
                physical_bytes += len(body)
            assert len(body) == expected[item.name]['bytes'] and sha(body) == expected[item.name]['sha256']
            logical_bytes += len(body)
            reopened.append(dict(**expected[item.name], physical=target, offset=item.offset))
    assert len(reopened) == len(records) and len({r['path'] for r in reopened}) == len(records)
    audit = (json.dumps(dict(status='passed', completeLogicalBodies=True, logicalMembers=len(records), physicalMembers=len(physical), logicalBytes=logical_bytes, physicalBytes=physical_bytes, records=reopened), indent=2)+'\n').encode()
    (output/'reopening-audit.json').write_bytes(audit)
    manifest = dict(schema='stencil-fresh-critic-seal-v1', task='E6-T11d44', sourceHead=head,
                    frozenWorkerRuntime=FREEZE, workerSubmission=WORKER, independentlyVerifiedBase=BASE,
                    workerSeal=custody['seals'][0], heldD43LogicalMembers=74113,
                    archive=dict(path='recording.tar.gz', bytes=len(zipped), sha256=sha(zipped)),
                    index=dict(path='records.json', bytes=len(index), sha256=sha(index)),
                    reopening=dict(path='reopening-audit.json', bytes=len(audit), sha256=sha(audit), logicalMembers=len(records), physicalMembers=len(physical), logicalBytes=logical_bytes, physicalBytes=physical_bytes),
                    wholeFreshRecordings=len(names), sourceClosureBodies=len(source_names),
                    guestExecution=False, productionNegotiation=False, productionDrawAuthority=False,
                    authority='isolated original native stencil; exact unchanged predecessor boundaries')
    # The complete worker seal metadata is in the sealed custody audit; keep the
    # public manifest compact without dropping any audited member from the archive.
    manifest['workerSeal'] = {k: v for k, v in manifest['workerSeal'].items() if k != 'records'}
    (output/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps(manifest))


if __name__ == '__main__':
    main(*sys.argv[1:4])
