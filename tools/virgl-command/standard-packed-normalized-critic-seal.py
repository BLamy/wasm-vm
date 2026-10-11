#!/usr/bin/env python3
"""Seal every critic capture and test source, then reopen every indexed byte."""
import argparse
import gzip
import hashlib
import json
import shutil
import tarfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
sha = lambda raw: hashlib.sha256(raw).hexdigest()
def require(condition, point):
    if not condition:
        raise ValueError(point)


def main(root, output):
    root, output = root.resolve(), output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    source_root = root / 'source'
    paths = set()
    # These copies are independent evidence; the worker/predecessor bulk seals
    # remain authenticated by custody.json rather than duplicated here.
    for report_file in root.rglob('report.json'):
        if report_file.relative_to(root).parts[0] in ('worker-reopened', 'source'):
            continue
        report = json.loads(report_file.read_text())
        for row in report.get('sources', []):
            name = row['path']
            raw = (ROOT / name).read_bytes()
            if sha(raw) != row['sha256']:
                versions = [root / 'iterations' / ('standard-packed-normalized-critic-' + version + '.mjs') for version in ('v0', 'v1')]
                require(name == 'renderer/virgl-command/tests/standard-packed-normalized-critic.mjs' and any(p.exists() and sha(p.read_bytes()) == row['sha256'] for p in versions), 'exact earlier harness source ' + name)
            paths.add(name)
    paths.update(p.relative_to(ROOT).as_posix() for p in (ROOT / 'tools/virgl-command').glob('standard-packed-normalized-critic-*') if p.is_file())
    paths.update(['Makefile', 'AGENTS.md', 'tools/verify-virgl-standard-packed-normalized-critic.mjs',
                  'renderer/virgl-command/tests/standard-packed-normalized-critic.mjs',
                  'evidence/virgl-production-readiness/standard-packed-normalized-image-gap.json',
                  'evidence/virgl-production-readiness/standard-packed-normalized-image-gap.mjs',
                  'evidence/virgl-production-readiness/standard-packed-normalized-primary-pins.json'])
    for name in sorted(paths):
        target = source_root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, target)
    for name in ('predictions.json', 'verdict.json'):
        shutil.copyfile(output / name, root / name)
    files = sorted((p for p in root.rglob('*') if p.is_file() and p.relative_to(root).parts[0] != 'worker-reopened'), key=lambda p: p.relative_to(root).as_posix())
    records = [dict(path=p.relative_to(root).as_posix(), bytes=p.stat().st_size, sha256=sha(p.read_bytes())) for p in files]
    index = dict(schema='d35-fresh-critic-full-record-index-v1', runtimeSourceHead='1398a86992e0575a29c56a9a93bd5e9d11d80e11', records=records)
    index_file = output / 'records.json'
    index_file.write_text(json.dumps(index, indent=2) + '\n')
    archive_file = output / 'recording.tar.gz'
    with archive_file.open('wb') as file:
        with gzip.GzipFile(fileobj=file, mode='wb', filename='', mtime=0, compresslevel=6) as zipped:
            with tarfile.open(fileobj=zipped, mode='w|', format=tarfile.PAX_FORMAT) as archive:
                for path, record in zip(files, records):
                    info = tarfile.TarInfo(record['path'])
                    info.size, info.mtime, info.mode = record['bytes'], 0, 0o644
                    with path.open('rb') as data:
                        archive.addfile(info, data)
    expected = {row['path']: row for row in records}
    seen, total = set(), 0
    with tarfile.open(archive_file, 'r|gz') as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            require(member.isfile() and not path.is_absolute() and '..' not in path.parts and member.name in expected and member.name not in seen, 'safe unique critic member')
            data = archive.extractfile(member).read()
            row = expected[member.name]
            require(len(data) == row['bytes'] and sha(data) == row['sha256'], 'full reopened critic bytes ' + member.name)
            total += len(data)
            seen.add(member.name)
    require(seen == set(expected), 'complete critic archive')
    custody = json.loads((root / 'custody.json').read_text())
    manifest = dict(schema='d35-fresh-adversarial-critic-seal-v1', task='E6-T11d35', verdict='verified',
                    runtimeSourceHead=index['runtimeSourceHead'], recordedWorkerHead=custody['recordedHead'], runtimeFreeze=custody['runtimeHead'],
                    records=len(records), reopenedMembers=len(seen), uncompressedBytes=total,
                    archiveBytes=archive_file.stat().st_size, archiveSha256=sha(archive_file.read_bytes()),
                    recordIndexSha256=sha(index_file.read_bytes()), predictionsSha256=sha((output / 'predictions.json').read_bytes()),
                    verdictSha256=sha((output / 'verdict.json').read_bytes()), carriedWorkerSeal=custody['worker'],
                    carriedPredecessors=custody['predecessors'], scope='private packed normalized storage/transfer ownership only',
                    noGuestOrProductionAuthority=True, rawEarlierHarnessFailurePreserved='novel-harness-v0/report.json',
                    finalPromotedAcceptance='novel-promoted/report.json', promotedTestSources=sorted(paths))
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({k: manifest[k] for k in ('verdict', 'records', 'reopenedMembers', 'uncompressedBytes', 'archiveBytes', 'archiveSha256', 'recordIndexSha256')}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    main(args.root, args.output)
