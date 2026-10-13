"""Seal complete exact-head cold evidence, including earlier failed inner loops."""
import gzip
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
from custody import reopen, sha

repo = Path(__file__).resolve().parents[2]
assert len(sys.argv) >= 3, 'usage: seal.py COLD OUTPUT [EARLIER_FAILED_BROWSER ...]'
cold, output = [Path(v).resolve() for v in sys.argv[1:3]]
assert not output.exists()
report = json.loads((cold / 'report.json').read_bytes())
receipt = json.loads((cold / 'recording/receipt.json').read_bytes())
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
assert report['head'] == receipt['head'] == head
assert report['exitCode'] == 0 and not report['cleanBefore'] and not report['cleanAfter']
assert report['receiptSha256'] == sha((cold / 'recording/receipt.json').read_bytes())
assert all(v['exitCode'] == v['expected'] for v in receipt['commands'])
for name in ['hardware-27467', 'hardware-82021', 'hardware-164033',
             'boundaries-27467', 'boundaries-82021', 'boundaries-164033',
             'attacks', 'controls', 'bindings', 'inherited', 'fault-compare', 'fault-mask']:
    actual = json.loads((cold / 'recording' / name / 'report.json').read_bytes())
    assert actual['head'] == head and not actual['trackedChanges']
    assert actual['status'] == ('failed' if name.startswith('fault-') else 'passed')
assert not json.loads((cold / 'recording/coverage-audit.json').read_bytes())['needsEvidence']
assert json.loads((cold / 'recording/physical-audit.json').read_bytes())['completedPhysicalRefutations'] == 2
files = {'cold/' + str(p.relative_to(cold)): p for p in cold.rglob('*') if p.is_file()}
earlier = []
for i, value in enumerate(sys.argv[3:]):
    directory = Path(value).resolve()
    actual = json.loads((directory / 'report.json').read_bytes())
    assert actual['status'] == 'failed'
    prefix = 'earlier-failed-inner-' + str(i).zfill(4)
    files.update({prefix + '/' + str(p.relative_to(directory)): p for p in directory.rglob('*') if p.is_file()})
    earlier.append(dict(prefix=prefix, original=str(directory), head=actual['head'], failure=actual.get('failure'),
                        authority='Earlier failed inner-loop custody; no positive final claim follows from this run.'))
files['sealing/seal.py'] = Path(__file__).resolve()
files['sealing/custody.py'] = repo / 'tools/virgl-dimensional-shadow-samplers/custody.py'
rows, first = [], {}
for name, file in sorted(files.items()):
    body = file.read_bytes()
    pin = len(body), sha(body)
    row = dict(path=name, bytes=pin[0], sha256=pin[1], kind='hardlink' if pin in first else 'file')
    if pin in first:
        row['target'] = first[pin]
    else:
        first[pin] = name
    rows.append(row)
output.mkdir(parents=True)
index = dict(schema='dimensional-shadow-sampler-index-v1', task='E6-T11d62', head=head, records=rows)
raw = (json.dumps(index, indent=2) + '\n').encode()
(output / 'records.json').write_bytes(raw)
archive = output / 'recording.tar.gz'
with archive.open('wb') as stream, gzip.GzipFile(fileobj=stream, mode='wb', mtime=0, filename='') as decoded, tarfile.open(fileobj=decoded, mode='w') as packed:
    for row in rows:
        info = tarfile.TarInfo(row['path'])
        info.mode, info.mtime = 0o644, 0
        if row['kind'] == 'hardlink':
            info.type, info.linkname = tarfile.LNKTYPE, row['target']
            packed.addfile(info)
        else:
            body = files[row['path']].read_bytes()
            assert len(body) == row['bytes'] and sha(body) == row['sha256']
            info.size = len(body)
            packed.addfile(info, io.BytesIO(body))
manifest = dict(schema='dimensional-shadow-sampler-seal-v1', task='E6-T11d62', head=head,
                records=len(rows), uniqueBodies=len(first), backwardLinks=len(rows) - len(first),
                recordIndexSha256=sha(raw), archiveSha256=sha(archive.read_bytes()), archiveBytes=archive.stat().st_size,
                logicalBytes=sum(r['bytes'] for r in rows), predecessors=receipt['predecessors'],
                authoritativeRecording='cold/recording', commands=len(receipt['commands']), earlierFailedInner=earlier,
                guestInstructionEvidence=True, actualLinuxGuest=False, productionAuthority=False)
if archive.stat().st_size >= 50 * 1024 * 1024:
    parts = []
    with archive.open('rb') as stream:
        while True:
            body = stream.read(16 * 1024 * 1024)
            if not body:
                break
            name = 'recording.tar.gz.part-' + str(len(parts)).zfill(4)
            (output / name).write_bytes(body)
            parts.append(dict(path=name, bytes=len(body), sha256=sha(body)))
    assert sha(b''.join((output / p['path']).read_bytes() for p in parts)) == manifest['archiveSha256']
    manifest['archiveParts'] = parts
    archive.unlink()
(output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
authentication, _ = reopen(output, sha((output / 'manifest.json').read_bytes()))
assert authentication['reopenedMembers'] == len(rows) and authentication['gzipEofChecked']
print(json.dumps(dict(manifestSha256=sha((output / 'manifest.json').read_bytes()), **manifest, authentication=authentication)))
