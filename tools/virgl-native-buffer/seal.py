#!/usr/bin/env python3
"""Seal complete hot/cold bodies without recursively copying held archives."""
import gzip
import hashlib
import io
import json
import pathlib
import subprocess
import sys
import tarfile

repo = pathlib.Path(__file__).resolve().parents[2]
hot, cold, output = [pathlib.Path(p).resolve() for p in sys.argv[1:]]
assert len(sys.argv) == 4 and not output.exists()
cold_report = json.loads((cold / "report.json").read_bytes())
cold_receipt = json.loads((cold / "recording/receipt.json").read_bytes())
head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
assert cold_report["head"] == cold_receipt["head"]
recording_head = cold_receipt["head"]
changed_after_recording = subprocess.check_output(["git", "diff", "--name-only", recording_head, head], cwd=repo, text=True).splitlines()
assert set(changed_after_recording) <= {"tools/virgl-native-buffer/seal.py"}
sealing_head = head
head = recording_head
assert not cold_report["cleanBefore"] and not cold_report["cleanAfter"] and cold_report["exitCode"] == 0
warm_report = json.loads((hot / "hardware/report.json").read_bytes())
assert warm_report["status"] == "passed"
warm_receipt = json.loads((hot / "receipt.json").read_bytes())
warm_changes = subprocess.check_output(["git", "diff", "--name-only", warm_receipt["head"], recording_head], cwd=repo, text=True).splitlines()
assert set(warm_changes) <= {"tools/virgl-native-buffer/coverage.py", "tools/virgl-native-buffer/seal.py"}
for relative, pin in warm_receipt["sources"].items():
    if relative.startswith(("crates/core/src/", "crates/wasm/src/", "renderer/")) and "/tests/" not in relative:
        assert hashlib.sha256((repo / relative).read_bytes()).hexdigest() == pin["sha256"]
# The exact-head cold gate is authoritative. The warm runtime is byte-identical;
# only coverage-reporting/sealing tools may change between the two submissions.
for row in warm_report["sources"]:
    if row["path"].startswith("renderer/") and "/tests/" not in row["path"]:
        assert hashlib.sha256((repo / row["path"]).read_bytes()).hexdigest() == row["sha256"]
def native_records(path):
    return [json.loads(l.removeprefix("SUBMIT3D_PORTABLE_RECORD ")) for l in path.read_text().splitlines() if l.startswith("SUBMIT3D_PORTABLE_RECORD ")]
assert native_records(hot / "native-submit.stderr") == native_records(cold / "recording/native-submit.stderr")
files = {}
for label, directory in [("hot", hot), ("cold", cold)]:
    for path in directory.rglob("*"):
        if path.is_file():
            files[f"{label}/{path.relative_to(directory)}"] = path
rows = [{"path": name, "bytes": path.stat().st_size,
         "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for name, path in sorted(files.items())]
output.mkdir(parents=True)
files["sealing/seal.py"] = pathlib.Path(__file__).resolve()
rows.append({"path":"sealing/seal.py", "bytes":files["sealing/seal.py"].stat().st_size, "sha256":hashlib.sha256(files["sealing/seal.py"].read_bytes()).hexdigest()})
index = {"schema": "native-buffer-index-v1", "task": "E6-T11d53", "head": head, "records": rows}
index_raw = (json.dumps(index, indent=2) + "\n").encode()
(output / "records.json").write_bytes(index_raw)
archive = output / "recording.tar.gz"
with archive.open("wb") as stream, gzip.GzipFile(fileobj=stream, mode="wb", mtime=0, filename="") as zipped, tarfile.open(fileobj=zipped, mode="w") as packed:
    for row in rows:
        raw = files[row["path"]].read_bytes()
        info = tarfile.TarInfo(row["path"])
        info.size, info.mode, info.mtime = len(raw), 0o644, 0
        packed.addfile(info, io.BytesIO(raw))
with tarfile.open(archive, "r:gz") as packed:
    members = packed.getmembers()
    assert len(members) == len(rows)
    for member, row in zip(members, rows):
        raw = packed.extractfile(member).read()
        assert member.name == row["path"] and len(raw) == row["bytes"]
        assert hashlib.sha256(raw).hexdigest() == row["sha256"]
manifest = {"schema": "native-buffer-seal-v1", "task": "E6-T11d53", "head": head,
            "sealingHead": sealing_head, "records": len(rows), "reopenedMembers": len(rows), "recordIndexSha256": hashlib.sha256(index_raw).hexdigest(),
            "archiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "archiveBytes": archive.stat().st_size,
            "dependencySeals": cold_receipt["dependencySeals"], "hotColdNativeRecordsEqual": True,
            "authoritativeRecording": "cold/recording", "warmHead": warm_report["gitHead"],
            "warmStatus": "25 gates passed; inline guard reporting tightened in supplemental coverage and final cold gate",
            "warmEvidenceOnlyChanges": warm_changes,
            "guestExecution": False, "productionAuthority": False}
(output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(manifest))
