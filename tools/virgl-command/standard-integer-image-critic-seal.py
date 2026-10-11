#!/usr/bin/env python3
"""Seal and reopen every full D31 critic record, source, and native byte plane."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
sha = lambda raw: hashlib.sha256(raw).hexdigest()
git = lambda *args: subprocess.check_output(['git',*args],cwd=ROOT)
FROZEN = 'ba735c389ca9db84de76f5ee042035edbccf0a99'


def main():
    capture, output = [Path(s).resolve() for s in sys.argv[1:3]]
    audit = json.loads((capture/'audit.json').read_bytes())
    coverage = json.loads((capture/'coverage.json').read_bytes())
    assert audit['status'] == coverage['status'] == 'passed' and audit['taskCorrectness'] == 'HELD'
    assert len(audit['novel']) == 2 and all(row['held'] or row['waiver'] for a in coverage['audits'] for row in a['intervals'])
    assert not git('diff','--name-only','HEAD')
    head = git('rev-parse','HEAD').decode().strip()
    names = ['fresh/wire','fresh/hardware-matrix','novel-native','sabotage-post-fence']
    names += ['fresh/hardware-boundaries-'+seed for seed in ['0x6a09e667','0xbb67ae85','0x3c6ef372']]
    names += ['fresh/fault-'+fault for fault in ['upload-lane','copy-level']]
    generated = json.loads((capture/'worker/hot/receipt.json').read_bytes())['generated']
    native_heads = set()
    native_sources = {}
    for name in names:
        report = json.loads((capture/name/'report.json').read_bytes())
        native_heads.add(report['gitHead'])
        assert report['status'] == ('failed' if 'fault-' in name or name == 'sabotage-post-fence' else 'passed')
        # A proof-only Python audit repair cannot rewrite the actual native run head.
        # Authenticate every recorded source at that head, and every native loaded
        # module/runner byte against the current head before carrying its result.
        for row in report['sources']:
            if row['path'] in generated:
                raw = (capture/'worker/hot-generated'/row['path']).read_bytes()
                assert sha(raw) == generated[row['path']]
            else:
                raw = git('show',report['gitHead']+':'+row['path'])
            assert len(raw) == row['bytes'] and sha(raw) == row['sha256']
            if row['path'].endswith('.mjs'):
                assert raw == (ROOT/row['path']).read_bytes()
                native_sources[row['path']] = row['sha256']
    assert len(native_heads) == 1
    native_head = native_heads.pop()
    assert git('diff','--name-only',native_head,head).decode().splitlines() in (
        [], ['tools/virgl-command/standard-integer-image-critic-seal.py',
             'tools/virgl-command/standard-integer-image-critic.py'])
    assert 'INTEGER_IMAGE_CRITIC_COMPLETE' in (capture/'critic.log').read_text()
    members = {}
    for path in sorted(capture.rglob('*')):
        if path.is_file():
            members['capture/'+path.relative_to(capture).as_posix()] = path.read_bytes()
    for path in ['predictions.json','novel-input-declaration.json','verdict.md']:
        members['verdict/'+path] = (capture/path).read_bytes()
    files = ['AGENTS.md','renderer/virgl-command/tests/standard-integer-image-critic.mjs',
             'tools/verify-virgl-standard-integer-images-adversarial.mjs',
             'tools/verify-virgl-standard-integer-images-adversarial.sh',
             'tools/virgl-command/standard-integer-image-critic.py',
             'tools/virgl-command/standard-integer-image-critic-seal.py']
    for name in files:
        raw = (ROOT/name).read_bytes(); assert raw == git('show',head+':'+name)
        members['source-critic/'+name] = raw
    output.mkdir(parents=True,exist_ok=True)
    index = (json.dumps(dict(schema='d31-full-critic-records-v1',task='E6-T11d31',nativeHead=native_head,criticHead=head,runtimeHead=FROZEN,
                            records=[dict(path=name,bytes=len(raw),sha256=sha(raw)) for name,raw in sorted(members.items())]),indent=2)+'\n').encode()
    (output/'records.json').write_bytes(index)
    memory = io.BytesIO()
    with gzip.GzipFile(fileobj=memory,mode='wb',mtime=0) as compressed:
        with tarfile.open(fileobj=compressed,mode='w') as tar:
            for name,raw in sorted(members.items()):
                info = tarfile.TarInfo(name); info.size,info.mtime,info.mode = len(raw),0,0o644
                tar.addfile(info,io.BytesIO(raw))
    archive = memory.getvalue(); (output/'recording.tar.gz').write_bytes(archive)
    expected = {r['path']:r for r in json.loads((output/'records.json').read_bytes())['records']}
    seen = set()
    with tarfile.open(output/'recording.tar.gz','r:gz') as tar:
        for member in tar:
            assert member.isfile() and member.name in expected and member.name not in seen
            raw = tar.extractfile(member).read(); row = expected[member.name]
            assert len(raw) == row['bytes'] and sha(raw) == row['sha256'] and raw == members[member.name]
            seen.add(member.name)
    assert seen == expected.keys()
    predictions = json.loads((capture/'predictions.json').read_bytes())
    assert all(row['status'] == 'HELD' or row['status'] == 'FAILED' and row.get('scopeCorrection') and row.get('acceptanceStatus') == 'HELD' for row in predictions['predictions'])
    manifest = dict(schema='d31-full-independent-critic-seal-v1',task='E6-T11d31',verdict='verified',nativeHead=native_head,criticHead=head,runtimeHead=FROZEN,
                    workerSubmission=audit['workerSubmission'],records=len(members),reopenedMembers=len(seen),archiveBytes=len(archive),unpackedBytes=sum(map(len,members.values())),
                    archiveSha256=sha(archive),recordIndexSha256=sha(index),auditSha256=sha((capture/'audit.json').read_bytes()),coverageSha256=sha((capture/'coverage.json').read_bytes()),
                    workerArchiveSha256=audit['custody']['archiveSha256'],workerIndexSha256=audit['custody']['indexSha256'],allAcceptanceCriteriaHeld=True,
                    predictionCorrections=[row['id'] for row in predictions['predictions'] if row.get('scopeCorrection')],nativeSourcePins=native_sources,
                    guestExecution=False,productionNegotiation=False,productionDrawAuthority=False,authority='isolated-original-integer-storage')
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    for name in ['predictions.json','novel-input-declaration.json','verdict.md']:
        (output/name).write_bytes((capture/name).read_bytes())
    print(json.dumps(manifest))


if __name__ == '__main__':
    main()
