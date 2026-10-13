"""Portable critic recording, deduplicated by authenticated bytes and reopened to EOF."""
import gzip
import hashlib
import io
import json
import shutil
import tarfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
sha = lambda b: hashlib.sha256(b).hexdigest()

# Publication itself has already been independently reopened. Preserve it verbatim.
source = REPO / 'target/evidence/d64-deployment-sealed'
destination = OUT.parent / 'deployment'
assert sha((source / 'manifest.json').read_bytes()) == '44347fcebf978b74fe2d78b18b8257e18c53bf72595b26984e4d04cf4b3ef789'
destination.mkdir(exist_ok=True)
for path in source.iterdir():
    if path.is_file():
        target = destination / path.name
        if target.exists():
            assert target.read_bytes() == path.read_bytes()
        else:
            shutil.copyfile(path, target)
assert sorted(p.name for p in source.iterdir()) == sorted(p.name for p in destination.iterdir())

exclude = {'manifest.json', 'records.json'}
files = [p for p in sorted(OUT.rglob('*')) if p.is_file() and p.name not in exclude and not p.name.startswith('recording.tar.gz.part-') and '__pycache__' not in p.parts]
rows, saved = [], {}
archive_bytes = io.BytesIO()
with gzip.GzipFile(fileobj=archive_bytes, mode='wb', compresslevel=9, mtime=0, filename='') as compressed:
    with tarfile.open(fileobj=compressed, mode='w|', format=tarfile.PAX_FORMAT) as archive:
        for path in files:
            body = path.read_bytes()
            digest = sha(body)
            name = 'verifier/' + path.relative_to(OUT).as_posix()
            identity = len(body), digest
            entry = tarfile.TarInfo(name)
            entry.mtime = 0
            entry.mode = 0o644
            row = dict(path=name, bytes=len(body), sha256=digest)
            if identity in saved:
                entry.type = tarfile.LNKTYPE
                entry.linkname = saved[identity]
                row.update(kind='hardlink', target=entry.linkname)
                archive.addfile(entry)
            else:
                saved[identity] = name
                entry.size = len(body)
                row['kind'] = 'file'
                archive.addfile(entry, io.BytesIO(body))
            rows.append(row)
raw = archive_bytes.getvalue()
parts = []
for i, start in enumerate(range(0, len(raw), 16 * 1024 * 1024)):
    name = 'recording.tar.gz.part-' + str(i).zfill(4)
    body = raw[start:start + 16 * 1024 * 1024]
    (OUT / name).write_bytes(body)
    parts.append(dict(path=name, bytes=len(body), sha256=sha(body)))
index = json.dumps(dict(schema='dimensional-depth-surfaces-critic-record-index-v1', records=rows), indent=2).encode() + b'\n'
(OUT / 'records.json').write_bytes(index)
manifest = dict(schema='dimensional-depth-surfaces-independent-verifier-seal-v1', task='E6-T11d64',
                submission='fb8c9241678a46f1cf5f5a220add98e0ae010012',
                runtimeSource='cb04190a0fd8d989fb54fb7b2caf39cc86a8a0e7',
                harnessSource='2f1e09f52ef3529b591887a08721fb234e77e500',
                verdict='verified', records=len(rows), storedBodies=len(saved),
                recordIndexSha256=sha(index), archiveSha256=sha(raw), archiveBytes=len(raw), archiveParts=parts,
                workerManifestSha256='71593ab497a192777ed4970ed58537157f217f9de901b9a91f470754d28e7f74',
                deploymentManifestSha256='44347fcebf978b74fe2d78b18b8257e18c53bf72595b26984e4d04cf4b3ef789',
                carriedHeld=['P1', 'P2', 'P3', 'P4', 'P5', 'P6'], addedHeld=['P7', 'P8', 'N1', 'S1'])
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
seen = {}
with gzip.GzipFile(fileobj=io.BytesIO(raw)) as decoded:
    with tarfile.open(fileobj=decoded, mode='r|') as archive:
        for i, entry in enumerate(archive):
            row = rows[i]
            assert entry.name == row['path'] and entry.name not in seen
            identity = row['bytes'], row['sha256']
            if entry.islnk():
                assert entry.linkname in seen and seen[entry.linkname] == identity and row['target'] == entry.linkname
            else:
                assert entry.isfile()
                body = archive.extractfile(entry).read()
                assert (len(body), sha(body)) == identity
            seen[entry.name] = identity
    while True:
        tail = decoded.read(1024 * 1024)
        if not tail:
            break
        assert not any(tail)
assert len(seen) == len(rows)
print(json.dumps(dict(status='passed', reopenedMembers=len(rows), storedBodies=len(saved),
                      archiveBytes=len(raw), manifestSha256=sha((OUT / 'manifest.json').read_bytes()),
                      indexSha256=sha(index), archiveSha256=sha(raw), gzipEofChecked=True)))
