"""Independently reopen complete bodies and backward links without random gzip seeks."""
import argparse
import gzip
import hashlib
import io
import json
import pathlib
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument("--manifest", default="seal-write.json")
parser.add_argument("--receipt", default="seal-reopen.json")
args = parser.parse_args()
out = pathlib.Path(__file__).resolve().parent
manifest_raw = (out / args.manifest).read_bytes()
manifest = json.loads(manifest_raw)
index_raw = (out / "records.json").read_bytes()
sha = lambda body: hashlib.sha256(body).hexdigest()
assert sha(index_raw) == manifest["recordIndexSha256"]
rows = json.loads(index_raw)
assert len(rows) == manifest["records"]
assert [r["path"] for r in rows] == sorted({r["path"] for r in rows}, key=lambda name: pathlib.PurePosixPath(name).parts)
for row in rows:
    path = pathlib.PurePosixPath(row["path"])
    assert not path.is_absolute() and ".." not in path.parts and path.as_posix() == row["path"]
parts = manifest["archiveParts"]
digest = hashlib.sha256()
total = 0
for i, pin in enumerate(parts):
    assert pin["path"] == "recording.tar.gz.part-" + str(i).zfill(4)
    body = (out / pin["path"]).read_bytes()
    assert len(body) == pin["bytes"] and sha(body) == pin["sha256"]
    digest.update(body)
    total += len(body)
assert total == manifest["archiveBytes"] and digest.hexdigest() == manifest["archiveSha256"]


class PartReader(io.RawIOBase):
    def __init__(self):
        self.index = 0
        self.stream = None

    def readable(self):
        return True

    def readinto(self, view):
        while self.index < len(parts):
            if self.stream is None:
                self.stream = (out / parts[self.index]["path"]).open("rb")
            size = self.stream.readinto(view)
            if size:
                return size
            self.stream.close()
            self.stream = None
            self.index += 1
        return 0

    def close(self):
        if self.stream is not None:
            self.stream.close()
        super().close()


cache = {}
links = 0
logical = 0
reopened = 0
with io.BufferedReader(PartReader()) as source:
    with gzip.GzipFile(fileobj=source, mode="rb") as unzipped:
        with tarfile.open(fileobj=unzipped, mode="r|") as packed:
            for member in packed:
                assert reopened < len(rows), member.name
                row = rows[reopened]
                assert member.name == row["path"], (member.name, row)
                assert member.mode == 0o644 and member.mtime == 0
                if member.islnk():
                    assert member.size == 0 and member.linkname in cache
                    body = cache[member.linkname]
                    links += 1
                else:
                    assert member.isfile() and member.size == row["bytes"]
                    stream = packed.extractfile(member)
                    assert stream is not None
                    body = stream.read()
                    assert len(body) == member.size
                    cache[member.name] = body
                assert len(body) == row["bytes"] and sha(body) == row["sha256"], row["path"]
                assert (out / row["path"]).read_bytes() == body, ("current input changed", row["path"])
                logical += len(body)
                reopened += 1
                if reopened % 500 == 0:
                    print(json.dumps(dict(phase="reopening", members=reopened, uniqueBodies=len(cache))), flush=True)
            # Include tarfile's buffered final padding. Reaching gzip EOF through
            # this stream also validates its complete CRC/trailer.
            tail_bytes = 0
            while True:
                tail = packed.fileobj.read(1024 * 1024)
                if not tail:
                    break
                assert not any(tail), "nonzero tar trailing bytes"
                tail_bytes += len(tail)
assert reopened == manifest["records"] and logical == manifest["logicalBytes"]
assert len(cache) == manifest["uniqueCompleteBodies"] and links == manifest["deduplicatedHardlinks"]
receipt = dict(schema="dimensional-depth-view-verifier-reopen-v1", status="passed",
               inputManifest=args.manifest, inputManifestSha256=sha(manifest_raw),
               recordIndexSha256=sha(index_raw), archiveSha256=digest.hexdigest(), archiveBytes=total,
               reopenedMembers=reopened, uniqueCompleteBodies=len(cache), deduplicatedHardlinks=links,
               logicalBytes=logical, gzipTrailerValidated=True, additionalZeroPaddingBytes=tail_bytes,
               fullSourceInputsCompared=True)
(out / args.receipt).write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt), flush=True)
