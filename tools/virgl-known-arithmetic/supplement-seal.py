#!/usr/bin/env python3
"""Seal supplemental original-binary proof while carrying immutable earlier claims."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = 'cba5ae02ba16dc15b7b51d5dcdd808f88fcaf1ee'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    assert not subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=ROOT), 'freeze harness sources'
    assert not args.output.exists(), 'preserve all earlier seals'
    worker = ROOT / 'evidence/virgl-known-arithmetic/worker'
    critic = ROOT / 'evidence/virgl-known-arithmetic/verifier'
    old_seals = []
    for base, expected in [(worker, 'e211633f326cd8e43e37a1585d9c892f84fa8d1eea5f13ac00bcf98d4104d15f'),
                           (critic, 'c9b4adfe834ac13e6f343ab8048ee059fc67b2d3a6405335d8ed6d6a7aa1502f')]:
        manifest_raw = (base / 'manifest.json').read_bytes()
        assert sha(manifest_raw) == expected, 'earlier manifest drift'
        manifest = json.loads(manifest_raw)
        for entry in [manifest['archive'], manifest['recordIndex']]:
            raw = (base / entry['path']).read_bytes()
            assert len(raw) == entry['bytes'] and sha(raw) == entry['sha256']
        old_seals.append(dict(path=str(base.relative_to(ROOT)), manifestSha256=expected,
                              archiveSha256=manifest['archive']['sha256'], indexSha256=manifest['recordIndex']['sha256']))
    verdict = json.loads((critic / 'verdict.json').read_bytes())
    members, reports, source_rows = {}, [], []
    with tarfile.open(worker / 'recording.tar.gz') as original:
        for kind, generated in [('hot', 'generated'), ('cold', 'cold-generated')]:
            directory = args.input / kind
            report = json.loads((directory / 'report.json').read_bytes())
            assert report['status'] == 'passed' and report['gitHead'] == head and report['task'] == 'E6-T12g6m1'
            assert report['arithmeticPredictions'] == 2 and report['publicSinglesPairs'] == 4
            assert report['hostRoundingModes'] == 4 and report['layout'][:2] == [111744, 112]
            assert len(report['nativeRegions']) == 5 and all(row['region'][4] > 0 for row in report['nativeRegions'])
            assert len(report['v8Regions']) == 2 and all(row['count'] > 0 for row in report['v8Regions'])
            binaries = [('original/known-test', generated + '/known-arithmetic-sanitize/known-test', report['binary'])]
            binaries += [('original/' + name, generated + '/wasm/' + name, binding)
                         for name, binding in zip(['virgl-shader.mjs', 'virgl-shader.wasm'], report['wasm'])]
            for local, archived, binding in binaries:
                raw = (directory / local).read_bytes()
                assert raw == original.extractfile(archived).read(), 'corresponding original artifact changed'
                assert len(raw) == binding['bytes'] and sha(raw) == binding['sha256']
            for binding in report['runtimeSources']:
                name = str(Path(binding['path']).relative_to(ROOT))
                raw = (ROOT / name).read_bytes()
                assert sha(raw) == binding['sha256'] and len(raw) == binding['bytes']
                assert raw == subprocess.check_output(['git', 'show', RUNTIME + ':' + name], cwd=ROOT)
            assert report['v8Source']['sha256'] == verdict['unchangedBoundarySources'][-1]['sha256']
            assert not (directory / 'native.stderr').read_bytes() and not (directory / 'consumer.stderr').read_bytes()
            consumer = json.loads((directory / 'consumer.json').read_bytes())
            assert consumer['status'] == 'passed' and consumer['getterInvocations'] == 0
            assert consumer['nativeSha256'] == sha((directory / 'native.json').read_bytes())
            assert len(consumer['results']) == 4 and len(consumer['attacks']) == 4
            for file in sorted(directory.rglob('*')):
                if file.is_file():
                    members[kind + '/' + str(file.relative_to(directory))] = file.read_bytes()
            reports.append(dict(kind=kind, reportSha256=sha((directory / 'report.json').read_bytes()),
                                binarySha256=report['binary']['sha256'], nativeRegions=report['nativeRegions'], v8Regions=report['v8Regions']))
    for name in ['tools/virgl-known-arithmetic/supplement.mjs', 'tools/virgl-known-arithmetic/supplement-cases.json',
                 'tools/virgl-known-arithmetic/supplement-seal.py', 'tools/virgl-known-arithmetic/receipt.py',
                 'tools/verify-virgl-known-arithmetic.sh', 'tools/virgl-known-arithmetic/README.md']:
        raw = (ROOT / name).read_bytes()
        assert raw == subprocess.check_output(['git', 'show', head + ':' + name], cwd=ROOT)
        source_rows.append(dict(path=name, bytes=len(raw), sha256=sha(raw)))
        members['source/' + name] = raw
    for name in ['checks.log', 'commands.json']:
        members[name] = (args.input / name).read_bytes()
    index = dict(schema='virgl-known-arithmetic-supplement-records-v1', task='E6-T12g6m1', harnessHead=head,
                 runtimeHead=RUNTIME, records=[dict(path=name, bytes=len(raw), sha256=sha(raw)) for name, raw in sorted(members.items())])
    index_raw = (json.dumps(index, indent=2) + '\n').encode()
    archive_buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=archive_buffer, mode='wb', mtime=0) as zipped:
        with tarfile.open(fileobj=zipped, mode='w') as archive:
            for name, raw in sorted(members.items()):
                info = tarfile.TarInfo(name); info.size = len(raw); info.mtime = 0
                info.mode = 0o755 if name.endswith('/known-test') else 0o644
                archive.addfile(info, io.BytesIO(raw))
    archive_raw = archive_buffer.getvalue()
    manifest = dict(schema='virgl-known-arithmetic-supplement-seal-v1', task='E6-T12g6m1', status='passed',
                    runtimeHead=RUNTIME, harnessHead=head, records=len(members), preservedSeals=old_seals,
                    sources=source_rows, runtimeSources=verdict['unchangedBoundarySources'], recordings=reports,
                    archive=dict(path='recording.tar.gz', bytes=len(archive_raw), sha256=sha(archive_raw)),
                    recordIndex=dict(path='records.json', bytes=len(index_raw), sha256=sha(index_raw)),
                    carriedHeld=[p['id'] for p in verdict['predictionResults'] if p['status'] == 'HELD'],
                    productionNegotiation=False, guestExecution=False)
    args.output.mkdir(parents=True)
    (args.output / 'recording.tar.gz').write_bytes(archive_raw)
    (args.output / 'records.json').write_bytes(index_raw)
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(dict(status='sealed', members=len(members), archiveBytes=len(archive_raw),
                         manifestSha256=sha((args.output / 'manifest.json').read_bytes()),
                         archiveSha256=sha(archive_raw), indexSha256=sha(index_raw))))


if __name__ == '__main__':
    main()
