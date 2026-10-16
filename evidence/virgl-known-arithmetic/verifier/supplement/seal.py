#!/usr/bin/env python3
"""Seal the incremental critic separately; preserve every previous seal."""
from pathlib import Path
import gzip, hashlib, io, json, tarfile

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
RAW = ROOT / 'target/evidence/virgl-known-arithmetic-critic-supplement'

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def main():
    assert not any((OUT / name).exists() for name in ['manifest.json', 'records.json', 'recording.tar.gz'])
    verdict = json.loads((OUT / 'verdict.json').read_bytes())
    assert verdict['verdict'] == 'verified'
    for seal in verdict['preservedSeals']:
        base = ROOT / seal['path']
        for name, key in [('manifest.json', 'manifestSha256'), ('records.json', 'indexSha256'),
                          ('recording.tar.gz', 'archiveSha256')]:
            assert sha((base / name).read_bytes()) == seal[key]
    members = {}
    for p in sorted(OUT.iterdir()):
        if p.is_file():
            members['critic/' + p.name] = p.read_bytes()
    for p in sorted(RAW.rglob('*')):
        if p.is_file() and 'unpacked' not in p.relative_to(RAW).parts:
            members['raw/' + str(p.relative_to(RAW))] = p.read_bytes()
    for kind in ['hot', 'cold']:
        directory = RAW / 'unpacked' / kind
        for p in sorted(directory.rglob('*')):
            if p.is_file() and p.name != 'coverage.json':
                members['original-supplement/' + kind + '/' + str(p.relative_to(directory))] = p.read_bytes()
    for s in verdict['suite']['sources']:
        raw = (ROOT / s['path']).read_bytes()
        assert sha(raw) == s['sha256']
        members['promoted-source/' + s['path']] = raw
    records = [dict(path=name, bytes=len(raw), sha256=sha(raw)) for name, raw in sorted(members.items())]
    index = dict(schema='virgl-known-arithmetic-incremental-critic-records-v1', task='E6-T12g6m1',
                 runtimeHead=verdict['runtimeHead'], harnessHead=verdict['harnessHead'], records=records)
    index_raw = (json.dumps(index, indent=2) + '\n').encode()
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode='wb', mtime=0) as zipped:
        with tarfile.open(fileobj=zipped, mode='w') as archive:
            for name, raw in sorted(members.items()):
                info = tarfile.TarInfo(name)
                info.size, info.mtime = len(raw), 0
                info.mode = 0o755 if name.endswith('/known-test') else 0o644
                archive.addfile(info, io.BytesIO(raw))
    archive_raw = buffer.getvalue()
    # Read back every indexed member before accepting the seal.
    with tarfile.open(fileobj=io.BytesIO(archive_raw), mode='r:gz') as archive:
        assert sorted(m.name for m in archive.getmembers()) == sorted(members)
        for r in records:
            raw = archive.extractfile(r['path']).read()
            assert len(raw) == r['bytes'] and sha(raw) == r['sha256']
    manifest = dict(schema='virgl-known-arithmetic-incremental-critic-seal-v1', task='E6-T12g6m1',
                    verdict='verified', runtimeHead=verdict['runtimeHead'], harnessHead=verdict['harnessHead'],
                    submissionHead=verdict['submissionHead'], records=len(records),
                    predictionsSha256=verdict['predictionsSha256'], verdictSha256=sha((OUT / 'verdict.json').read_bytes()),
                    preservedSeals=verdict['preservedSeals'], promotedSources=verdict['suite']['sources'],
                    unchangedBoundarySources=verdict['unchangedBoundarySources'],
                    carriedHeld=[p['id'] for p in verdict['predictionResults'] if p.get('carriedUnchanged')],
                    resolvedFindings=['C1', 'C2', 'J1'],
                    archive=dict(path='recording.tar.gz', bytes=len(archive_raw), sha256=sha(archive_raw)),
                    recordIndex=dict(path='records.json', bytes=len(index_raw), sha256=sha(index_raw)),
                    historicalUntracked=verdict['historicalUntracked'], productionNegotiation=False, guestExecution=False)
    (OUT / 'recording.tar.gz').write_bytes(archive_raw)
    (OUT / 'records.json').write_bytes(index_raw)
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(dict(records=len(records), archiveBytes=len(archive_raw),
                         manifestSha256=sha((OUT / 'manifest.json').read_bytes()),
                         archiveSha256=sha(archive_raw), indexSha256=sha(index_raw),
                         verdictSha256=manifest['verdictSha256'])))

if __name__ == '__main__':
    main()
