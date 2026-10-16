"""Freeze and stream this verifier's complete corpus directly into split gzip parts."""
import gzip
import hashlib
import io
import json
import pathlib
import subprocess
import tarfile

OUT = pathlib.Path(__file__).resolve().parent
REPO = OUT.parents[2]
HEAD = "eb534b587d5b919e4673c537a521b21aa9b48800"
PART_BYTES = 16 * 1024 * 1024
PEERS = {"records.json", "manifest.json", "seal-write.json", "seal-write.log",
         "seal-reopen.json", "seal-reopen.log", "post-verdict-checks.json",
         "post-verdict-checks.log"}


def sha(body):
    return hashlib.sha256(body).hexdigest()


class SplitWriter:
    def __init__(self):
        self.stream = None
        self.parts = []
        self.total = 0
        self.digest = hashlib.sha256()
        self.part_digest = None
        self.part_size = 0

    def writable(self):
        return True

    def finish_part(self):
        if self.stream is not None:
            self.stream.flush()
            self.stream.close()
            self.parts.append(dict(path=self.part_path.name, bytes=self.part_size,
                                   sha256=self.part_digest.hexdigest()))
            self.stream = None

    def write(self, data):
        view = memoryview(data)
        count = len(view)
        while view:
            if self.stream is None:
                self.part_path = OUT / ("recording.tar.gz.part-" + str(len(self.parts)).zfill(4))
                self.stream = self.part_path.open("xb")
                self.part_digest = hashlib.sha256()
                self.part_size = 0
            size = min(len(view), PART_BYTES - self.part_size)
            chunk = view[:size]
            written = self.stream.write(chunk)
            assert written == size
            self.part_digest.update(chunk)
            self.digest.update(chunk)
            self.part_size += size
            self.total += size
            view = view[size:]
            if self.part_size == PART_BYTES:
                self.finish_part()
        return count

    def flush(self):
        if self.stream is not None:
            self.stream.flush()


assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO).decode().strip() == HEAD
assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=REPO)
assert not (OUT / "records.json").exists()
verdict = json.loads((OUT / "verdict.json").read_bytes())
assert verdict["verdict"] == "verified" and not verdict["findings"]
for name, pin in verdict["proofPins"].items():
    body = (OUT / name).read_bytes()
    assert len(body) == pin["bytes"] and sha(body) == pin["sha256"]
for path in (OUT / "promoted-sources").rglob("*"):
    if path.is_file():
        assert path.read_bytes() == (REPO / path.relative_to(OUT / "promoted-sources")).read_bytes()
files = {}
for path in sorted(OUT.rglob("*")):
    assert not path.is_symlink(), path
    excluded = path.parent == OUT and (path.name in PEERS or path.name.startswith("recording.tar.gz.part-"))
    if path.is_file() and not excluded:
        files[path.relative_to(OUT).as_posix()] = path
rows = []
fingerprints = {}
for name, path in files.items():
    stat = path.stat()
    body = path.read_bytes()
    assert len(body) == stat.st_size and path.stat().st_mtime_ns == stat.st_mtime_ns
    rows.append(dict(path=name, bytes=len(body), sha256=sha(body)))
    fingerprints[name] = (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns)
index_raw = (json.dumps(rows, indent=2) + "\n").encode()
(OUT / "records.json").write_bytes(index_raw)
print(json.dumps(dict(phase="frozen", members=len(rows), logicalBytes=sum(r["bytes"] for r in rows))), flush=True)
unique = {}
links = 0
sink = SplitWriter()
with gzip.GzipFile(fileobj=sink, mode="wb", filename="", mtime=0, compresslevel=9) as zipped:
    with tarfile.open(fileobj=zipped, mode="w|", format=tarfile.PAX_FORMAT) as packed:
        for i, row in enumerate(rows):
            path = files[row["path"]]
            stat = path.stat()
            assert (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns) == fingerprints[row["path"]]
            body = path.read_bytes()
            assert len(body) == row["bytes"] and sha(body) == row["sha256"]
            info = tarfile.TarInfo(row["path"])
            info.size, info.mode, info.mtime = len(body), 0o644, 0
            key = (len(body), row["sha256"])
            if key in unique:
                info.type, info.linkname, info.size = tarfile.LNKTYPE, unique[key], 0
                packed.addfile(info)
                links += 1
            else:
                unique[key] = row["path"]
                packed.addfile(info, io.BytesIO(body))
            if (i + 1) % 500 == 0:
                print(json.dumps(dict(phase="packing", members=i + 1, compressedBytes=sink.total)), flush=True)
sink.finish_part()
receipt = dict(schema="dimensional-depth-view-verifier-transport-v1", task="E6-T11d60", head=HEAD,
               records=len(rows), recordIndexSha256=sha(index_raw), archiveSha256=sink.digest.hexdigest(),
               archiveBytes=sink.total, archiveParts=sink.parts, logicalBytes=sum(r["bytes"] for r in rows),
               uniqueCompleteBodies=len(unique), deduplicatedHardlinks=links)
(OUT / "seal-write.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(dict(phase="written", **receipt)), flush=True)
