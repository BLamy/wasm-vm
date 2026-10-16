#!/usr/bin/env python3
"""Independently seal the complete fresh critic recording and all scratch diagnostics."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
WORKER = '8d3e5ff481d2ecdf9930c44c3d1894bdcdb3e180'
SUBMISSION = '08936a154a18740b927ef683d006d8c2a75904c6'
sha = lambda b: hashlib.sha256(b).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT)


def main():
    fresh, output = [Path(n).resolve() for n in sys.argv[1:]]
    head = git('rev-parse', 'HEAD').decode().strip()
    assert not git('diff', '--name-only', 'HEAD').strip(), 'freeze all tracked source before sealing'
    audit_raw = (fresh/'audit/audit.json').read_bytes()
    coverage_raw = (fresh/'audit/coverage.json').read_bytes()
    audit, coverage = json.loads(audit_raw), json.loads(coverage_raw)
    assert audit['status'] == coverage['status'] == 'passed' and audit['taskCorrectness'] == 'HELD'
    assert all(row['held'] or row['waiver'] for row in coverage['intervals'])
    assert audit['runtimeHead'] == WORKER and audit['failedCriticPrecisionAssumptions'] == 8
    for name in ['historical','boundaries','precision','novel','sabotage']:
        report = json.loads((fresh/name/'report.json').read_text())
        assert report['gitHead'] == head
        assert report['status'] == ('failed' if name == 'sabotage' else 'passed')
        assert report['browserErrors'] == dict(console=[],page=[],requests=[])
        for source in report['sources']:
            raw = (fresh/name/source['archivePath']).read_bytes()
            assert sha(raw) == source['sha256'] and len(raw) == source['bytes']
            if '/build/' not in source['path']:
                assert raw == git('show', head+':'+source['path'])
    members = {}
    for path in sorted(fresh.rglob('*')):
        if path.is_file():
            assert not path.is_symlink()
            members['fresh/'+str(path.relative_to(fresh))] = path.read_bytes()
    excluded = {'manifest.json','records.json','recording.tar.gz','seal-reopened.json','seal.log'}
    for path in sorted(output.rglob('*')):
        if path.is_file() and str(path.relative_to(output)) not in excluded:
            assert not path.is_symlink()
            members['diagnostics/'+str(path.relative_to(output))] = path.read_bytes()
    for path in git('ls-files','tools/virgl-command/standard-packed-float-consumer-critic.py','tools/virgl-command/standard-packed-float-consumer-critic-coverage.py','tools/virgl-command/standard-packed-float-consumer-critic-seal.py','tools/verify-virgl-standard-packed-float-consumer-adversarial.mjs','tools/verify-virgl-standard-packed-float-consumer-adversarial.sh','renderer/virgl-command/tests/standard-packed-float-consumer-critic.mjs','Makefile','AGENTS.md','tasks/epic-6-transcendence/E6-T11d28-standard-packed-float-consumer.md').decode().splitlines():
        members['frozen-source/'+path] = git('show', head+':'+path)
    index = (json.dumps(dict(schema='d28-full-critic-index-v1',task='E6-T11d28',nativeHead=head,records=[dict(path=path,bytes=len(raw),sha256=sha(raw)) for path,raw in sorted(members.items())]),indent=2)+'\n').encode()
    output.mkdir(parents=True,exist_ok=True)
    (output/'records.json').write_bytes(index)
    stream = io.BytesIO()
    with gzip.GzipFile(fileobj=stream,mode='wb',mtime=0) as compressed:
        with tarfile.open(fileobj=compressed,mode='w') as archive:
            for path,raw in sorted(members.items()):
                info = tarfile.TarInfo(path); info.size=len(raw); info.mtime=0; info.mode=0o644
                archive.addfile(info,io.BytesIO(raw))
    raw = stream.getvalue(); (output/'recording.tar.gz').write_bytes(raw)
    manifest = dict(schema='d28-full-independent-critic-seal-v1',task='E6-T11d28',verdict='verified',nativeHead=head,runtimeHead=WORKER,workerSubmission=SUBMISSION,records=len(members),unpackedBytes=sum(len(n) for n in members.values()),archiveBytes=len(raw),archiveSha256=sha(raw),recordIndexSha256=sha(index),auditSha256=sha(audit_raw),coverageSha256=sha(coverage_raw),verdictSha256=sha((output/'verdict.md').read_bytes()),failedCriticPrecisionAssumptions=8,allTaskPredictionsHeld=True,workerArchiveSha256=audit['workerManifest']['archiveSha256'],workerIndexSha256=audit['workerManifest']['recordIndexSha256'],guestExecution=False,productionNegotiation=False,productionDrawAuthority=False,authority='isolated-original-R11G11B10-native-consumers')
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    # Re-open the WRITTEN archive independently, compare each member with the written index and source bytes.
    expected = {row['path']:row for row in json.loads((output/'records.json').read_bytes())['records']}
    actual = set(); unpacked = 0
    with tarfile.open(output/'recording.tar.gz') as archive:
        for member in archive:
            assert member.isfile() and member.name in expected and member.name not in actual
            value=archive.extractfile(member).read(); row=expected[member.name]
            assert len(value)==row['bytes'] and sha(value)==row['sha256'] and value==members[member.name]
            actual.add(member.name); unpacked+=len(value)
    assert actual==expected.keys() and unpacked==manifest['unpackedBytes']
    assert sha((output/'recording.tar.gz').read_bytes())==manifest['archiveSha256']
    assert sha((output/'records.json').read_bytes())==manifest['recordIndexSha256']
    reopened = dict(status='passed',archiveSha256=manifest['archiveSha256'],recordIndexSha256=manifest['recordIndexSha256'],members=len(actual),unpackedBytes=unpacked,uniqueCompleteIndex=True,allWrittenMembersRehashed=True)
    (output/'seal-reopened.json').write_text(json.dumps(reopened,indent=2)+'\n')
    print(json.dumps(manifest,indent=2))


if __name__ == '__main__':
    main()
