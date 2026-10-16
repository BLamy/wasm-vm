#!/usr/bin/env python3
"""Seal only authoritative final critic recordings, then reopen every member."""
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
FREEZE = '90dd309b800762309df6fa2431ba25e76d44a3f5'
WORKER = '7e88b69a565d0042297e3001c8c4044efdf4cca9'
sha = lambda b: hashlib.sha256(b).hexdigest()
git = lambda *a: subprocess.check_output(['git', *a], cwd=ROOT)


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2)+'\n')


def main():
    verdict = json.loads((OUT/'verdict.json').read_bytes())
    assert verdict['verdict'] == 'verified' and verdict['criticFreeze'] == FREEZE
    for name, digest in verdict['audits'].items():
        assert sha((OUT/name).read_bytes()) == digest, name
    selected = ['predictions.json', 'authentication.json', 'plane-audit.json',
                'plane-citations.jsonl', 'fresh-audit.json', 'fresh-plane-citations.jsonl',
                'coverage-audit.json', 'source-boundary-audit.json', 'critic-freeze.json',
                'selected-citations.json', 'novel-plan.json', 'novel-fixture-repairs.json',
                'verdict.json', 'EXT_texture_shared_exponent.txt', 'initial-untracked.nul',
                'task.diff', 'authenticate.py', 'audit_planes.py', 'audit_coverage.py',
                'write_verdict.py', 'seal.py']
    files = {name: (OUT/name).read_bytes() for name in selected}
    for path in sorted((OUT/'final').rglob('*')):
        if path.is_file():
            assert not path.is_symlink(), path
            files[path.relative_to(OUT).as_posix()] = path.read_bytes()
    source_rows = {}
    for path in sorted((OUT/'final').glob('*/report.json')):
        report = json.loads(path.read_bytes())
        assert report['gitHead'] == FREEZE
        assert report['browserErrors'] == dict(console=[], page=[], requests=[])
        for row in report['sources']:
            if row['path'] in source_rows:
                assert source_rows[row['path']] == row
            source_rows[row['path']] = row
        pinned = {r['path']: r['sha256'] for r in report['sources']}
        for row in report['servedFiles']:
            if row['path'] == '/':
                driver = 'tools/verify-virgl-standard-shared-exponent-' + ('critic.mjs' if path.parent.name in ('novel-native', 'sabotage-blue-field') else 'images.mjs')
                text = git('show', FREEZE+':'+driver).decode()
                html = re.search(r"const html = Buffer.from\('([^']+)'\);", text).group(1).encode()
                assert len(html) == row['bytes'] and sha(html) == row['sha256']
                files['served-documents/'+path.parent.name+'.html'] = html
            else:
                assert pinned[row['path'].lstrip('/')] == row['sha256']
        for key in ('browserCoverage', 'screenshot'):
            row = report[key]
            assert sha((path.parent/row['path']).read_bytes()) == row['sha256']
        for row in json.loads((path.parent/report['browserCoverage']['path']).read_bytes())['scripts']:
            assert row['sha256'] == pinned[row['source']]
    promoted = json.loads((OUT/'critic-freeze.json').read_bytes())['sources']
    for name, digest in promoted.items():
        raw = git('show', FREEZE+':'+name)
        assert sha(raw) == digest
        row = dict(path=name, bytes=len(raw), sha256=digest)
        if name in source_rows:
            assert source_rows[name] == row
        source_rows[name] = row
    for name, row in sorted(source_rows.items()):
        raw = (ROOT/name).read_bytes()
        assert len(raw) == row['bytes'] and sha(raw) == row['sha256'], name
        if '/build/wasm/' not in name:
            assert git('show', FREEZE+':'+name) == raw, name
        files['sources/'+name] = raw
    files['sources.json'] = (json.dumps(dict(sourceHead=FREEZE,
                                           records=list(source_rows.values())), indent=2)+'\n').encode()
    authentication = json.loads((OUT/'authentication.json').read_bytes())
    inputs = []
    for seal in [authentication['worker'], *authentication['carried']]:
        folder = ROOT/seal['folder']
        assert sha((folder/'recording.tar.gz').read_bytes()) == seal['archiveSha256']
        assert sha((folder/'records.json').read_bytes()) == seal['indexSha256']
        for name in ('manifest.json', 'records.json'):
            files['input-seals/'+seal['folder']+'/'+name] = (folder/name).read_bytes()
        inputs.append({**seal, 'manifestSha256': sha((folder/'manifest.json').read_bytes())})
    files['input-seals.json'] = (json.dumps(dict(records=inputs,
                                               custody='All input members independently reopened by authenticate.py; original sealed archives remain tracked at the listed paths.'), indent=2)+'\n').encode()
    records = [dict(path=name, bytes=len(raw), sha256=sha(raw)) for name, raw in sorted(files.items())]
    index = dict(schema='original-shared-exponent-critic-records-v1', task='E6-T11d29',
                 sourceHead=FREEZE, workerRuntimeHead=WORKER, records=records)
    write_json(OUT/'records.json', index)
    with (OUT/'recording.tar.gz').open('wb') as stream:
        with gzip.GzipFile(filename='', fileobj=stream, mode='wb', mtime=0) as zipped:
            with tarfile.open(fileobj=zipped, mode='w', format=tarfile.USTAR_FORMAT) as archive:
                for row in records:
                    info = tarfile.TarInfo(row['path'])
                    info.size = row['bytes']
                    info.mode = 0o644
                    info.mtime = 0
                    archive.addfile(info, io.BytesIO(files[row['path']]))
    manifest = dict(schema='original-shared-exponent-critic-seal-v1', task='E6-T11d29',
                    verdict='verified', sourceHead=FREEZE, workerRuntimeHead=WORKER,
                    workerSubmission=verdict['workerSubmission'], records=len(records),
                    sourceRecords=len(source_rows), archiveBytes=(OUT/'recording.tar.gz').stat().st_size,
                    archiveSha256=sha((OUT/'recording.tar.gz').read_bytes()),
                    recordIndexSha256=sha((OUT/'records.json').read_bytes()),
                    verdictSha256=sha((OUT/'verdict.json').read_bytes()),
                    predictionSha256=sha((OUT/'predictions.json').read_bytes()),
                    auditSha256=verdict['audits'], workerInput=authentication['worker'],
                    carriedInputs=authentication['carried'],
                    guestExecution=False, productionNegotiation=False, productionDrawAuthority=False,
                    authority='isolated-original-format125-image-owner-and-transfers',
                    excluded='Unpacked worker input, preliminary runs and preliminary line/coverage reports are not critic authority. Final/ contains all frozen native runs and the required physically completed negative control.')
    write_json(OUT/'manifest.json', manifest)
    # Reopen the actual on-disk index and archive, checking all bytes independently.
    disk_manifest = json.loads((OUT/'manifest.json').read_bytes())
    disk_index = (OUT/'records.json').read_bytes()
    assert sha(disk_index) == disk_manifest['recordIndexSha256']
    assert sha((OUT/'recording.tar.gz').read_bytes()) == disk_manifest['archiveSha256']
    rows = json.loads(disk_index)['records']
    expected = {row['path']: row for row in rows}
    assert len(expected) == len(rows) == disk_manifest['records']
    opened, total = set(), 0
    with tarfile.open(OUT/'recording.tar.gz', 'r:gz') as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            assert member.isfile() and not member.issym() and not member.islnk()
            assert not path.is_absolute() and '..' not in path.parts
            assert member.name not in opened and member.name in expected
            row = expected[member.name]
            raw = archive.extractfile(member).read()
            assert len(raw) == member.size == row['bytes']
            assert sha(raw) == row['sha256'], member.name
            opened.add(member.name)
            total += len(raw)
    assert opened == set(expected)
    reopened = dict(status='HELD', archiveSha256=disk_manifest['archiveSha256'],
                    indexSha256=disk_manifest['recordIndexSha256'],
                    manifestSha256=sha((OUT/'manifest.json').read_bytes()),
                    members=len(opened), bytes=total, everyMemberReopened=True,
                    everyMemberSizeAndDigestMatched=True, regularUniqueSafeMembers=True)
    write_json(OUT/'seal-reopen.json', reopened)
    print(json.dumps({**reopened, 'sourceRecords': len(source_rows),
                      'archiveBytes': disk_manifest['archiveBytes']}))


if __name__ == '__main__':
    main()
