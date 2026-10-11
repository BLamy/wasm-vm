#!/usr/bin/env python3
"""Seal every fresh critic body and the complete sources actually consumed."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
from critic_custody import BASE, FREEZE, WORKER, reopen

ROOT = Path(__file__).resolve().parents[2]
sha = lambda raw: hashlib.sha256(raw).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def main(run, output):
    run, output = Path(run).resolve(), Path(output).resolve()
    head = git('rev-parse', 'HEAD')
    assert not git('diff', '--name-only', 'HEAD'), 'freeze all tracked proof sources'
    log = (run/'acceptance.log').read_bytes()
    assert head.encode() in log and log.endswith(b'INSTANCE_BASE_CRITIC_RECORDING_COMPLETE\n')
    members = {}

    def add(name, raw):
        assert not Path(name).is_absolute() and '..' not in Path(name).parts
        if name in members:
            assert members[name] == raw, ('source collision', name)
        members[name] = raw

    def tree(directory, prefix):
        for p in sorted(directory.rglob('*')):
            if p.is_file():
                assert not p.is_symlink()
                add(prefix+'/'+p.relative_to(directory).as_posix(), p.read_bytes())

    tree(run, 'fresh')
    audit_root = ROOT/'target/evidence/virgl-instance-base-critic'
    custody = json.loads((audit_root/'custody-audit.json').read_text())
    assert custody['status'] == 'passed' and custody['totalReopenedMembers'] == 93973
    add('audit/custody-audit.json', (audit_root/'custody-audit.json').read_bytes())
    for name in ['primary-pages.json', 'failure-original-instruction-count.log']:
        add('audit/'+name, (audit_root/name).read_bytes())
    # Complete held hot/cold records remain authority, including full counters,
    # tokens, native bytes, corruption and the exact pristine-clone receipt.
    held = audit_root/'worker-reopened'
    for role in ['hot', 'cold']:
        tree(held/role, 'held/'+role)
    tree(held/'source', 'held-source')
    tree(audit_root/'actual-old', 'generated/actual-old')
    carried = {}
    for leaf in ['manifest.json', 'records.json']:
        raw = (ROOT/'evidence/virgl-instance-base/worker'/leaf).read_bytes()
        add('carried/worker/'+leaf, raw)
        carried[leaf] = sha(raw)

    sources, generated = {}, {}
    roots = ['renderer/virgl-shader', 'tools/virgl-instance-base',
             'tools/verify-virgl-instance-base-critic.sh', 'tools/lib/virgl-browser-runner.mjs',
             'tools/virgl-original-corpus/toolchain.py', 'tools/setup-virgl-emsdk.sh',
             'tools/virgl-floating-depth/primary/es-3.0.6.pdf', 'web/package.json',
             'web/package-lock.json', 'Makefile', 'AGENTS.md',
             'tools/check_task_policy.py', 'tools/build_queue.py',
             'evidence/virgl-instance-base/verifier/PREDICTIONS.md',
             'tasks/epic-6-transcendence/E6-T11d46-instance-base-compiler.md']
    for name in git('ls-files', *roots).splitlines():
        raw = (ROOT/name).read_bytes()
        assert raw == subprocess.check_output(['git', 'show', head+':'+name], cwd=ROOT), name
        add('source/'+name, raw)
        sources[name] = dict(bytes=len(raw), sha256=sha(raw))
    for name, pin in custody['actualCurrentCompilers'].items():
        raw = (ROOT/name).read_bytes()
        assert len(raw) == pin['bytes'] and sha(raw) == pin['sha256']
        add('generated/'+name, raw)
        generated[name] = pin
    fresh_reports = []
    for directory in ['schedule-0x32a913f7', 'schedule-0x96d1c02b', 'schedule-0xd009c68f', 'fault-completed-offset']:
        p = run/directory
        report_raw = (p/'report.json').read_bytes()
        report = json.loads(report_raw)
        fault = directory.startswith('fault-')
        assert report['gitHead'] == head and not report['trackedChanges']
        assert report['status'] == ('failed' if fault else 'passed')
        assert report['browserErrors'] == dict(console=[], page=[], requests=[])
        checked = json.loads((p/'critic-original-pixels.json').read_text())
        assert checked['reportSha256'] == sha(report_raw)
        assert checked['status'] == ('refuted' if fault else 'passed')
        assert len(checked['frames']) == (1 if fault else 6)
        assert len(checked['mismatches']) == (36 if fault else 0)
        assert checked['physicalSyncs'] == (2 if fault else 6)
        for item in report['sources']+report['servedFiles']:
            name = item['path']; raw = (ROOT/name).read_bytes()
            assert len(raw) == item['size'] and sha(raw) == item['sha256'], name
            if '/build/' in name or name.startswith('target/'):
                add('generated/'+name, raw)
                generated[name] = dict(bytes=len(raw), sha256=sha(raw))
            else:
                assert name in sources and sources[name]['sha256'] == sha(raw), name
        for item in report['acceptance']['blobs']:
            zipped = (p/item['path']).read_bytes(); raw = gzip.decompress(zipped)
            assert sha(zipped) == item['gzipSha256']
            assert len(raw) == item['bytes'] and sha(raw) == item['sha256']
        screenshot = report.get('screenshot', report.get('failureScreenshot'))
        assert screenshot and sha((p/screenshot['path']).read_bytes()) == screenshot['sha256']
        assert sha((p/report['browserCoverage']['path']).read_bytes()) == report['browserCoverage']['sha256']
        fresh_reports.append(dict(path='fresh/'+directory+'/report.json', sha256=sha(report_raw),
                                  independent='fresh/'+directory+'/critic-original-pixels.json',
                                  expectedCorruption=fault, frames=len(checked['frames']),
                                  words=sum(f['words'] for f in checked['frames']), physicalSyncs=checked['physicalSyncs']))
    memory = json.loads((run/'compiler/strict-and-memory.json').read_text())
    assert memory['status'] == 'passed' and memory['cases'] == 4313 and memory['historical'] == 2586
    assert len(memory['strictRefusals']) == 97 and memory['getters'] == 0 and memory['distinctFixedMemories'] == 5
    allocation = [json.loads(line) for line in (run/'allocations.jsonl').read_text().splitlines()]
    assert allocation[-1]['faults'] == allocation[-1]['recoveries'] == 165
    assert allocation[-1]['callerMutation'] and not allocation[-1]['partialResults']
    assert (run/'original-native/native.jsonl').read_bytes() == (run/'original-native/sanitize.jsonl').read_bytes()
    output.mkdir(parents=True, exist_ok=True)
    index = (json.dumps(dict(schema='fresh-instance-base-critic-records-v1', task='E6-T11d46',
                              sourceHead=head, records=[dict(path=n, bytes=len(b), sha256=sha(b))
                                                      for n, b in sorted(members.items())]), indent=2)+'\n').encode()
    (output/'records.json').write_bytes(index)
    packed = io.BytesIO()
    with gzip.GzipFile(fileobj=packed, mode='wb', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as tar:
            physical = {}
            for name, raw in sorted(members.items()):
                info = tarfile.TarInfo(name); info.size = len(raw); info.mtime = 0; info.mode = 0o644
                key = (len(raw), sha(raw)); earlier = physical.get(key)
                if earlier is not None:
                    assert members[earlier] == raw
                    info.type = tarfile.LNKTYPE; info.linkname = earlier; info.size = 0
                    tar.addfile(info)
                else:
                    tar.addfile(info, io.BytesIO(raw)); physical[key] = name
    archive = packed.getvalue(); parts = []
    for i, at in enumerate(range(0, len(archive), 16*1024*1024)):
        name = 'recording.tar.gz.part-'+str(i).zfill(4)
        raw = archive[at:at+16*1024*1024]; (output/name).write_bytes(raw)
        parts.append(dict(path=name, bytes=len(raw), sha256=sha(raw)))
    restored = []
    for part in parts:
        raw = (output/part['path']).read_bytes()
        assert len(raw) == part['bytes'] and sha(raw) == part['sha256']
        restored.append(raw)
    assert b''.join(restored) == archive
    bodies, reopened = reopen(b''.join(restored), (output/'records.json').read_bytes())
    assert bodies == members
    reopening_raw = (json.dumps(reopened, indent=2)+'\n').encode()
    (output/'REOPENED.json').write_bytes(reopening_raw)
    manifest = dict(schema='fresh-instance-base-critic-seal-v1', task='E6-T11d46', status='passed',
                    sourceHead=head, runtimeHead=FREEZE, workerSubmission=WORKER, predecessor=BASE,
                    archiveParts=parts, archiveSha256=sha(archive), archiveBytes=len(archive),
                    recordIndexSha256=sha(index), reopeningSha256=sha(reopening_raw),
                    records=len(members), reopenedMembers=reopened['members'],
                    logicalBytes=reopened['logicalBytes'], physicalBodies=reopened['physicalBodies'],
                    sourceClosure=sources, generatedClosure=generated, freshReports=fresh_reports,
                    carriedWorkerSeal=carried, carriedWorkerArchiveSha256='f746e58d61505392aa5b7f23fe919e2585187be0925e86f3158282052076df0e',
                    carriedWorkerArchivePath='evidence/virgl-instance-base/worker',
                    completelyReopenedWorkerAndPredecessorMembers=93973,
                    pristineColdCarriedByDigest='c0a9217a198080474b3beb9a6f024c139684c29026e4905036a525148ef9236e',
                    authority='isolated-original-instance-base-compiler', guestExecution=False,
                    productionNegotiation=False, productionDrawAuthority=False)
    raw = (json.dumps(manifest, indent=2)+'\n').encode()
    (output/'manifest.json').write_bytes(raw)
    print(json.dumps(dict(status='passed', sourceHead=head, records=len(members),
                         logicalBytes=reopened['logicalBytes'], archiveBytes=len(archive),
                         archiveSha256=sha(archive), indexSha256=sha(index), manifestSha256=sha(raw))))


if __name__ == '__main__':
    main(*sys.argv[1:3])
