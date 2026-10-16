#!/usr/bin/env python3
"""Reopen every sealed worker record and authenticate its frozen source boundary."""
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
WORKER = HERE.parent / 'worker'
UNPACK = HERE / 'unpacked'
PREVIOUS = 'c378b55516f74a2da3612462104785fe6997fca1'
PHYSICAL = '3ad8f8f6e817799935c66168f26518a93c65ebe4'
FINAL = 'dc28eaa0128177a5f742e8f2877fc7a6573d06fd'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def main():
    archive = WORKER / 'recording.tar.gz'
    manifest = json.loads((WORKER / 'manifest.json').read_bytes())
    index_raw = (WORKER / 'records.json').read_bytes()
    index = json.loads(index_raw)
    assert sha(archive.read_bytes()) == manifest['archiveSha256'] == '51ff1c7fa589480cdc626d715771364164aa3540086dbc9ea443986503d84177'
    assert sha(index_raw) == manifest['recordIndexSha256'] == '54312872d7bb67b194478a04e5e12039b49d582fa15b9e4c59c1ad766a5a0331'
    assert manifest['sourceHead'] == index['sourceHead'] == FINAL
    assert manifest['records'] == len(index['records']) == 10364
    assert archive.stat().st_size == manifest['archiveBytes'] == 18592102
    expected = {row['path']: row for row in index['records']}
    assert len(expected) == len(index['records'])
    UNPACK.mkdir(exist_ok=True)
    seen = set()
    with tarfile.open(archive, 'r:gz') as tar:
        for member in tar:
            assert member.isfile() and member.name in expected and member.name not in seen
            dest = UNPACK / member.name
            assert dest.resolve().is_relative_to(UNPACK.resolve())
            raw = tar.extractfile(member).read()
            row = expected[member.name]
            assert len(raw) == member.size == row['bytes'] and sha(raw) == row['sha256']
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(raw)
            seen.add(member.name)
    assert seen == set(expected)
    # The verifier independently reopens each extracted record, rather than
    # accepting a seal tool's summary of its own write.
    for name, row in expected.items():
        raw = (UNPACK / name).read_bytes()
        assert len(raw) == row['bytes'] and sha(raw) == row['sha256']

    def load(name):
        return json.loads((UNPACK / name).read_bytes())

    hot, cold = load('hot/receipt.json'), load('cold/receipt.json')
    cold_report = load('cold/report.json')
    assert sha((UNPACK / 'hot/receipt.json').read_bytes()) == manifest['hotReceiptSha256'] == '9269b5f25ad79161b3e4b422c886ae9c797da85a90dcf25e444ef85e09e3a831'
    assert sha((UNPACK / 'cold/report.json').read_bytes()) == manifest['coldReportSha256'] == '209334cc2defe2244a6d4190ac30aa71af2aa3a9ea0806c7d3326dc1afa311ac'
    assert sha((UNPACK / 'cold/receipt.json').read_bytes()) == manifest['coldReceiptSha256'] == cold_report['receiptSha256'] == 'ef7256c612aebff7fadc2a83b72f735613012df64b1e90107bae14913a8b0f1c'
    assert hot['gitHead'] == cold['gitHead'] == cold_report['gitHead'] == FINAL
    assert hot['physicalSourceHead'] == PHYSICAL and cold['physicalSourceHead'] == FINAL
    changed = git('diff', '--name-only', PHYSICAL, FINAL).decode().splitlines()
    assert set(changed) == {'tools/virgl-command/standard-assembly-pixels.mjs', 'tools/virgl-command/standard-assembly-receipt.py'}
    correction = load('hot/harness-correction.json')
    assert correction['sourceHead'] == FINAL and correction['physicalSourceHead'] == PHYSICAL
    assert correction['originalMakePassed'] is False and correction['originalExitCode'] == 2
    hot_lines = (UNPACK / 'hot/acceptance.log').read_text().splitlines()
    failure = [(i + 1, line) for i, line in enumerate(hot_lines) if "assert.ok(report.browserResult.error.message.includes(frame.label+' independent restart pixel oracle'))" in line]
    # acceptance.log is redirected inside the recipe: its parent make process's
    # exit status is in the sealed correction record, not an in-recipe Error2.
    assert failure and correction['correctedAuditExitCode'] == 0
    assert not any(line == 'STANDARD_ASSEMBLY_RECORDING_COMPLETE' for line in hot_lines)
    correction_lines = (UNPACK / 'hot/harness-correction.log').read_text().splitlines()
    assert 'STANDARD_ASSEMBLY_CORRECTED_AUDIT_COMPLETE' in correction_lines
    assert cold_report['status'] == 'passed' and cold_report['cloneHead'] == FINAL
    assert cold_report['exitCode'] == 0 and cold_report['statusBefore'] == cold_report['statusAfter'] == ''
    assert cold_report['command'] == ['make', 'verify-E6-T11d10']
    assert sha((UNPACK / 'cold/cold.log').read_bytes()) == cold_report['logSha256']
    cold_lines = (UNPACK / 'cold/acceptance.log').read_text().splitlines()
    assert 'STANDARD_ASSEMBLY_RECORDING_COMPLETE' in cold_lines

    source_rows, generated_rows, report_rows, carried_rows = [], [], [], []
    for label, receipt in [('hot', hot), ('cold', cold)]:
        for name, digest in receipt['files'].items():
            assert sha((UNPACK / label / name).read_bytes()) == digest
        for name, digest in receipt['sources'].items():
            assert sha(git('show', FINAL + ':' + name)) == digest
            assert sha((ROOT / name).read_bytes()) == digest
            source_rows.append({'run': label, 'source': name, 'sha256': digest})
        for name, digest in receipt['generated'].items():
            assert sha((UNPACK / (label + '-generated') / name).read_bytes()) == digest
            generated_rows.append({'run': label, 'source': name, 'sha256': digest})
        for name, digest in receipt['carriedVerifiedEvidence'].items():
            assert sha(git('show', PREVIOUS + ':' + name)) == sha(git('show', FINAL + ':' + name)) == digest
            carried_rows.append({'run': label, 'source': name, 'sha256': digest})
        for name in ['hardware', 'fault-list-order', 'fault-provoking', 'retained-restart/hardware', 'retained-restart/fault-restart']:
            report = load(label + '/' + name + '/report.json')
            physical = PHYSICAL if label == 'hot' else FINAL
            assert report['gitHead'] == physical
            served = {row['path']: row['sha256'] for row in report['servedFiles']}
            for row in report['sources']:
                if row['path'] in receipt['generated']:
                    assert row['sha256'] == receipt['generated'][row['path']]
                else:
                    assert row['sha256'] == sha(git('show', FINAL + ':' + row['path']))
                    assert row['sha256'] == sha(git('show', PHYSICAL + ':' + row['path']))
                if '/' + row['path'] in served:
                    mutation = report.get('mutation')
                    digest = mutation['servedSha256'] if mutation and mutation['path'] == row['path'] else row['sha256']
                    assert served['/' + row['path']] == digest
            coverage = load(label + '/' + name + '/' + report['browserCoverage']['path'])
            assert all(row['sha256'] == served['/' + row['source']] for row in coverage['scripts'])
            assert report['browserErrors'] == {'console': [], 'page': [], 'requests': []}
            assert not report['browser']['headless']
            assert report['browser']['gpu']['featureStatus'].get('webgl2', report['browser']['gpu']['featureStatus'].get('webgl')) == 'enabled'
            assert not any(any(w in arg.lower() for w in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe', '--disable-gpu']) for arg in report['browser']['commandLine'])
            assert report['fixedMemory'] == {'bytes': 16777216, 'stageExport': 'function', 'pairExport': 'function'}
            assert sha((UNPACK / label / name / report['screenshot']['path']).read_bytes()) == report['screenshot']['sha256']
            if report.get('mutation'):
                mutation = report['mutation']
                raw = git('show', FINAL + ':' + mutation['path'])
                assert raw.count(mutation['needle'].encode()) == 1
                assert sha(raw) == mutation['originalSha256']
                changed_source = raw.replace(mutation['needle'].encode(), mutation['replacement'].encode())
                assert changed_source == (UNPACK / label / name / 'mutation-source.mjs').read_bytes()
                assert sha(changed_source) == mutation['servedSha256']
            report_rows.append({'run': label, 'path': name + '/report.json', 'sha256': sha((UNPACK / label / name / 'report.json').read_bytes()), 'sourceHead': physical, 'status': report['status']})

    preserved = git('ls-files', 'renderer/virgl-shader', 'renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/constant-domain.mjs', 'renderer/virgl-command/resources.mjs', 'renderer/virgl-command/cache.mjs').decode().splitlines()
    for name in preserved:
        assert git('show', PREVIOUS + ':' + name) == git('show', FINAL + ':' + name)
    out = {'schema': 'standard-assembly-verifier-custody-v1', 'status': 'passed', 'archiveSha256': manifest['archiveSha256'], 'recordIndexSha256': manifest['recordIndexSha256'], 'recordsReopened': len(seen), 'physicalFreeze': PHYSICAL, 'finalColdSource': FINAL,
           'offlineCorrectionOnly': changed, 'hotOriginalFullMake': {'passed': False, 'exitCode': 2, 'failureLines': failure}, 'correctedNarrowAudit': True,
           'coldFullMake': {'passed': True, 'exitCode': 0, 'statusBefore': '', 'statusAfter': '', 'scrubbedNames': cold_report['removedEnvironmentNames'], 'completionLine': cold_lines.index('STANDARD_ASSEMBLY_RECORDING_COMPLETE') + 1},
           'sources': source_rows, 'generated': generated_rows, 'physicalReports': report_rows, 'carriedEvidence': carried_rows, 'unchangedBoundaryFiles': len(preserved)}
    (HERE / 'authentication.json').write_text(json.dumps(out, indent=2) + '\n')
    print(json.dumps({key: out[key] for key in ['status', 'recordsReopened', 'hotOriginalFullMake', 'coldFullMake', 'unchangedBoundaryFiles']}))


if __name__ == '__main__':
    main()
