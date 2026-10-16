#!/usr/bin/env python3
"""Seal full independently interrogated worker, fresh acceptance, and critic bodies."""
import gzip
import hashlib
import io
import json
import pathlib
import subprocess
import sys
import tarfile

ROOT = pathlib.Path(__file__).resolve().parents[3]
LOCAL = pathlib.Path(__file__).resolve().parent
FROZEN_RUNTIME = '3cbb041b43928701026b5ca2ddfb3dcf9a799c2b'
CRITIC_HEAD = 'ea48669715abe39b966627a6ed7606d901aa2263'
sha = lambda raw: hashlib.sha256(raw).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT)


def main():
    fresh, critic = [pathlib.Path(value).resolve() for value in sys.argv[1:3]]
    assert git('rev-parse', 'HEAD').decode().strip() == CRITIC_HEAD
    assert not git('diff', '--name-only', 'HEAD')
    for leaf in ['authentication.json', 'gap-and-carry.json', 'interrogation.json',
                 'closure-and-coverage.json', 'corruption-audit.json', 'fresh-submission-result.json',
                 'novel-interrogation.json']:
        assert json.loads((LOCAL/leaf).read_text())['status'] == 'passed'
    auth = json.loads((LOCAL/'authentication.json').read_text())
    assert auth['sourceHead'] == FROZEN_RUNTIME
    members = {}
    cache = {}

    def add(name, value):
        raw = value.read_bytes() if isinstance(value, pathlib.Path) else value
        if name in members:
            assert members[name] == raw, 'duplicate logical body drift: ' + name
        members[name] = raw

    def original(head, name):
        key = (head, name)
        if key not in cache:
            cache[key] = git('show', head + ':' + name)
        return cache[key]

    # These are the previously independently authenticated exact published bodies.
    worker_index = json.loads((ROOT/'evidence/virgl-instanced-stencil/worker/records.json').read_text())
    assert worker_index['sourceHead'] == FROZEN_RUNTIME
    for ref in worker_index['records']:
        raw = (LOCAL/'unpacked'/ref['path']).read_bytes()
        assert len(raw) == ref['bytes'] and sha(raw) == ref['sha256']
        add('worker/' + ref['path'], raw)
    assert len(worker_index['records']) == 41944
    for leaf in ['manifest.json', 'records.json']:
        add('worker-seal/' + leaf, ROOT/'evidence/virgl-instanced-stencil/worker'/leaf)

    receipts = {}
    for prefix, directory, head, confirmation in [
        ('fresh-acceptance', fresh, 'd88235ea7d16b2475ff9d6c7d96cc361d5589c3e',
         b'Frozen original instanced draws, bindings and native planes authenticated.\n'),
        ('critic', critic, CRITIC_HEAD,
         b'Frozen fresh instanced-stencil critic bodies authenticated.\n')]:
        receipt_raw = (directory/'receipt.json').read_bytes()
        receipt = json.loads(receipt_raw)
        assert receipt['status'] == 'passed' and receipt['gitHead'] == head
        for name, digest in receipt['files'].items():
            raw = (directory/name).read_bytes()
            if sha(raw) != digest:
                assert name == 'acceptance.log' and raw.endswith(confirmation)
                assert sha(raw[:-len(confirmation)]) == digest
                add(prefix + '/' + name + '.final', raw)
                raw = raw[:-len(confirmation)]
            assert sha(raw) == digest
            add(prefix + '/' + name, raw)
        for name, digest in receipt['sources'].items():
            raw = original(head, name)
            assert sha(raw) == digest
            add(prefix + '-source/' + name, raw)
        for name, digest in receipt['generated'].items():
            raw = (ROOT/name).read_bytes()
            assert sha(raw) == digest
            add(prefix + '-generated/' + name, raw)
        add(prefix + '/receipt.json', receipt_raw)
        receipts[prefix] = {'sourceHead': head, 'sha256': sha(receipt_raw),
                            'counts': receipt['counts'], 'completeReceiptFiles': len(receipt['files'])}
    for name in ['renderer/virgl-command/state.mjs', 'renderer/virgl-command/constant-domain.mjs']:
        assert original(CRITIC_HEAD, name) == original(FROZEN_RUNTIME, name)

    # Freeze every audit output/script and the original predecessor refusal recording.
    audit_names = [p.name for p in sorted(LOCAL.iterdir()) if p.is_file()
                   and p.name not in ['records.json', 'manifest.json']
                   and not p.name.startswith('recording.tar.gz')
                   and not p.name.endswith('.tar.gz')]
    for leaf in audit_names:
        add('audit/' + leaf, LOCAL/leaf)
    for p in sorted((LOCAL/'predecessor-gap').rglob('*')):
        if p.is_file():
            add('predecessor-gap/' + p.relative_to(LOCAL/'predecessor-gap').as_posix(), p)
    for family in ['virgl-ordered-stencil', 'virgl-instance-base']:
        for role in ['worker', 'verifier']:
            for leaf in ['manifest.json', 'records.json']:
                add('published-predecessor-index/' + family + '/' + role + '/' + leaf,
                    ROOT/'evidence'/family/role/leaf)

    index = (json.dumps({'schema': 'fresh-instanced-stencil-verifier-records-v1', 'task': 'E6-T11d47',
                         'sourceHead': CRITIC_HEAD, 'runtimeHead': FROZEN_RUNTIME,
                         'records': [{'path': name, 'bytes': len(raw), 'sha256': sha(raw)}
                                     for name, raw in sorted(members.items())]}, indent=2) + '\n').encode()
    (LOCAL/'records.json').write_bytes(index)
    packed = io.BytesIO()
    with gzip.GzipFile(fileobj=packed, mode='wb', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as tar:
            physical = {}
            for name, raw in sorted(members.items()):
                info = tarfile.TarInfo(name)
                info.size, info.mtime, info.mode = len(raw), 0, 0o644
                key = (len(raw), sha(raw))
                earlier = physical.get(key)
                if earlier is not None:
                    assert members[earlier] == raw
                    info.type, info.linkname, info.size = tarfile.LNKTYPE, earlier, 0
                    tar.addfile(info)
                else:
                    tar.addfile(info, io.BytesIO(raw))
                    physical[key] = name
    archive = packed.getvalue()
    parts = []
    width = 16*1024*1024
    for ordinal, at in enumerate(range(0, len(archive), width)):
        leaf = 'recording.tar.gz.part-' + str(ordinal).zfill(4)
        raw = archive[at:at+width]
        (LOCAL/leaf).write_bytes(raw)
        parts.append({'path': leaf, 'bytes': len(raw), 'sha256': sha(raw)})
    stored = b''.join((LOCAL/p['path']).read_bytes() for p in parts)
    assert sha(stored) == sha(archive)
    for p in parts:
        raw = (LOCAL/p['path']).read_bytes()
        assert len(raw) == p['bytes'] and sha(raw) == p['sha256']
    indexed = {r['path']: r for r in json.loads((LOCAL/'records.json').read_text())['records']}
    with tarfile.open(fileobj=io.BytesIO(gzip.decompress(stored)), mode='r:') as reopened:
        entries = reopened.getmembers()
        catalog = {e.name: e for e in entries}
        assert len(entries) == len(catalog) == len(indexed)
        for entry in entries:
            assert entry.isfile() or entry.islnk()
            actual = entry
            if entry.islnk():
                actual = catalog[entry.linkname]
                assert actual.isfile() and actual.offset < entry.offset
            body = reopened.extractfile(actual).read()
            assert len(body) == indexed[entry.name]['bytes']
            assert sha(body) == indexed[entry.name]['sha256']
    result = {'schema': 'fresh-instanced-stencil-verifier-seal-v1', 'task': 'E6-T11d47',
              'sourceHead': CRITIC_HEAD, 'runtimeHead': FROZEN_RUNTIME,
              'archiveParts': parts, 'archiveSha256': sha(archive), 'archiveBytes': len(archive),
              'recordIndexSha256': sha(index), 'records': len(members), 'reopenedMembers': len(members),
              'actualPhysicalBodies': len(physical), 'completeWorkerBodiesReopened': 41944,
              'completePredecessorBodiesReopened': 97179, 'originalGapMembersReopened': 1357,
              'sourceClosureIncluded': True, 'receipts': receipts,
              'predictionsSha256': sha((LOCAL/'predictions.json').read_bytes()),
              'novelPredictionsSha256': sha((LOCAL/'novel-predictions.json').read_bytes()),
              'publishedPredecessorArchivesRemainByteIdentical': True,
              'guestExecution': False, 'productionNegotiation': False, 'productionDrawAuthority': False,
              'authority': 'isolated-original-instanced-stencil-consumer'}
    (LOCAL/'manifest.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
