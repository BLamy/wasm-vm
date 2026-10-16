"""Read complete sealed bodies, backward hardlinks and the actual gzip trailer."""
import gzip
import hashlib
import io
import json
import tarfile


def sha(body):
    return hashlib.sha256(body).hexdigest()


def reopen(directory, manifest_digest, select=lambda name: False):
    manifest_body = (directory / 'manifest.json').read_bytes()
    assert sha(manifest_body) == manifest_digest, directory
    manifest = json.loads(manifest_body)
    index_body = (directory / 'records.json').read_bytes()
    assert sha(index_body) == manifest['recordIndexSha256']
    index = json.loads(index_body)
    rows = index['records'] if isinstance(index, dict) else index
    assert len(rows) == len({row['path'] for row in rows})
    if 'archiveParts' in manifest:
        pieces = []
        for part in manifest['archiveParts']:
            body = (directory / part['path']).read_bytes()
            assert len(body) == part['bytes'] and sha(body) == part['sha256']
            pieces.append(body)
        archive = b''.join(pieces)
        del pieces
    else:
        archive = (directory / 'recording.tar.gz').read_bytes()
    assert sha(archive) == manifest['archiveSha256']
    if 'archiveBytes' in manifest:
        assert len(archive) == manifest['archiveBytes']
    wanted = {row['sha256'] for row in rows if select(row['path'])}
    stored, seen, count = {}, {}, 0
    with gzip.GzipFile(fileobj=io.BytesIO(archive), mode='rb') as decoded:
        with tarfile.open(fileobj=decoded, mode='r|') as packed:
            for member in packed:
                assert count < len(rows)
                row = rows[count]
                count += 1
                assert member.name == row['path']
                pin = (row['bytes'], row['sha256'])
                if member.islnk():
                    assert member.linkname in seen and seen[member.linkname] == pin
                    if 'target' in row:
                        assert member.linkname == row['target']
                else:
                    assert member.isfile()
                    body = packed.extractfile(member).read()
                    assert len(body) == pin[0] and sha(body) == pin[1], member.name
                    if pin[1] in wanted:
                        stored[pin[1]] = body
                seen[member.name] = pin
        while decoded.read(1024 * 1024):
            pass
    assert count == len(rows)
    bodies = {row['path']: stored[row['sha256']] for row in rows if select(row['path'])}
    return dict(manifestSha256=manifest_digest, indexSha256=sha(index_body),
                archiveSha256=sha(archive), archiveBytes=len(archive),
                reopenedMembers=count, gzipEofChecked=True), bodies
