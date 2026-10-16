#!/usr/bin/env python3
"""Seal complete fresh critic records, retaining the immutable worker dependency."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
FROZEN = '2ef416185b8b4ddd85e39efd0913c8eb8eeb71e3'
WORKER = {
    'recording.tar.gz': '43ae2cd2d362ba708121e9d3d23789eae24c738324b43a2261f29e3bf5ebdc16',
    'records.json': 'b853257bc25b5e71da6854ed8c35fb55ffe61b3e3c0cffc34942ed4e1f797891',
    'manifest.json': 'fbee164ddf5646594c79aeaf5237a3a0465bcc75cc73cd1dcff9b7e8a2cc9f4a',
}
GENERATED = {
    'renderer/virgl-shader/build/wasm/virgl-shader.mjs': '6bb07a0b2a056d21ae52b22d7700ce10577854c1cdcf0877dd80be938e30e0fa',
    'renderer/virgl-shader/build/wasm/virgl-shader.wasm': 'acbe036afcdc4f1d8aa8cfb0fb107f48ba27759a6af4a7b9d6c83e3aa679d6cc',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        while chunk := source.read(1 << 20):
            result.update(chunk)
    return result.hexdigest()


def git_bodies(keys):
    raw = subprocess.check_output(['git', 'cat-file', '--batch'], input=('\n'.join(keys)+'\n').encode(), cwd=ROOT)
    cursor, bodies = 0, {}
    for key in keys:
        stop = raw.index(b'\n', cursor)
        header = raw[cursor:stop].decode()
        cursor = stop+1
        if header.endswith(' missing'):
            bodies[key] = None
        else:
            _, kind, size = header.split()
            require(kind == 'blob', 'full source identity must refer to a Git blob')
            size = int(size)
            bodies[key] = raw[cursor:cursor+size]
            require(raw[cursor+size:cursor+size+1] == b'\n', 'git source framing')
            cursor += size+1
    require(cursor == len(raw), 'git source closure framing')
    return bodies


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fresh', type=Path, required=True)
    parser.add_argument('--scratch', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    require(not subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=ROOT, text=True).strip(), 'freeze tracked sources before sealing')
    changed = subprocess.check_output(['git', 'diff', '--name-only', FROZEN, head], cwd=ROOT, text=True).splitlines()
    require(all(name == 'Makefile' or name.startswith(('renderer/virgl-command/tests/', 'tools/', 'tasks/', 'evidence/')) for name in changed),
            'fresh critic must not modify production runtime or compiler')
    worker_dir = ROOT/'evidence/virgl-standard-floating-depth-images/worker'
    for name, expected in WORKER.items():
        require(digest(worker_dir/name) == expected, 'immutable authenticated worker dependency '+name)
    manifests, reports, keys = [], [], set()
    for path in sorted(args.fresh.rglob('report.json')):
        report = json.loads(path.read_bytes())
        require(report['task'] == 'E6-T11d39', 'only selected-boundary browser records')
        data = report.get('partial') or report['browserResult']['result']
        require(not data['guestExecution'] and not data['productionNegotiation'] and not data['productionDrawAuthority'], 'selected storage authority only')
        reports.append((path, report))
        for source in report['sources']:
            if source['path'] not in GENERATED:
                keys.update((report['gitHead']+':'+source['path'], FROZEN+':'+source['path']))
        manifests.append(dict(path='fresh/'+path.relative_to(args.fresh).as_posix(), sha256=digest(path),
                              sourceHead=report['gitHead'], status=report['status'], schema=data['schema']))
    require(reports, 'full fresh browser records required')
    bodies = git_bodies(sorted(keys))
    for path, report in reports:
        for source in report['sources']:
            saved = path.parent/'source'/source['path']
            actual = saved.read_bytes()
            require(len(actual) == source['bytes'] and digest(saved) == source['sha256'], 'full recorded immutable source body')
            if source['path'] in GENERATED:
                require(source['sha256'] == GENERATED[source['path']], 'same actual worker generated compiler')
                continue
            require(bodies[report['gitHead']+':'+source['path']] == actual, 'record source equals its exact Git head')
            if not source['path'].startswith(('renderer/virgl-command/tests/', 'tools/')):
                require(bodies[FROZEN+':'+source['path']] == actual, 'every runtime, primary and compiler body equals frozen worker')
    members = {}
    for prefix, directory, recursive in [('fresh', args.fresh, True), ('critic', args.scratch, False)]:
        entries = directory.rglob('*') if recursive else directory.iterdir()
        for path in sorted(entries):
            if path.is_file():
                require(not path.is_symlink(), 'no external file indirection')
                members[prefix+'/'+path.relative_to(directory).as_posix()] = path
    for name in ('records.json', 'manifest.json'):
        members['worker-dependency/'+name] = worker_dir/name
    members['source/tools/virgl-floating-depth/critic-seal.py'] = Path(__file__)
    entries = [dict(path=name, bytes=path.stat().st_size, sha256=digest(path)) for name, path in sorted(members.items())]
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    index = (json.dumps(dict(schema='fresh-d39-critic-record-index-v1', task='E6-T11d39', frozenRuntimeHead=FROZEN,
                             verifierHarnessHead=head, records=entries), indent=2)+'\n').encode()
    (output/'records.json').write_bytes(index)
    archive = output/'recording.tar.gz'
    with archive.open('wb') as target:
        with gzip.GzipFile(fileobj=target, mode='wb', mtime=0, filename='') as compressed:
            with tarfile.open(fileobj=compressed, mode='w|') as tar:
                for name, path in sorted(members.items()):
                    info = tarfile.TarInfo(name)
                    info.size, info.mtime, info.mode = path.stat().st_size, 0, 0o644
                    with path.open('rb') as source:
                        tar.addfile(info, source)
    indexed = {row['path']: row for row in entries}
    reopened, total = set(), 0
    with tarfile.open(archive, 'r|gz') as tar:
        for member in tar:
            require(member.isfile() and member.name in indexed and member.name not in reopened, 'full unique archive member custody')
            result, count = hashlib.sha256(), 0
            source = tar.extractfile(member)
            while chunk := source.read(1 << 20):
                result.update(chunk)
                count += len(chunk)
            row = indexed[member.name]
            require(count == row['bytes'] and result.hexdigest() == row['sha256'], 'reopened full native/source/coverage member identity')
            reopened.add(member.name)
            total += count
    require(reopened == set(indexed), 'complete reopened archive')
    manifest = dict(schema='fresh-d39-critic-seal-v1', task='E6-T11d39', frozenRuntimeHead=FROZEN, verifierHarnessHead=head,
                    archiveSha256=digest(archive), archiveBytes=archive.stat().st_size, recordIndexSha256=hashlib.sha256(index).hexdigest(),
                    members=len(entries), reopenedMembers=len(reopened), fullUncompressedBytes=total,
                    workerDependency=WORKER, records=manifests, sourceClosureIncluded=True, guestExecution=False,
                    productionNegotiation=False, productionDrawAuthority=False, authority='selected-original-floating-depth-storage-transfer-range')
    (output/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps({key: value for key, value in manifest.items() if key != 'records'}))


if __name__ == '__main__':
    main()
