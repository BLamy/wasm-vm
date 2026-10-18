#!/usr/bin/env python3
"""Read-only authentication of sealed E9-T11 corrected submissions."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

HEAD = "e14e4312b9ee8df73b93646c944bf64a2f0db875"


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(4 << 20):
            h.update(chunk)
    return h.hexdigest()


def authenticate(path, expected_sha):
    assert digest(path) == expected_sha, (path, "report SHA")
    report = json.loads(path.read_text())
    assert report["status"] == "passed" and report["head"] == HEAD
    seen = set()
    total = 0
    for row in report["files"]:
        relative = Path(row["path"])
        assert not relative.is_absolute() and ".." not in relative.parts
        assert row["path"] not in seen
        seen.add(row["path"])
        artifact = path.parent / relative
        assert artifact.is_file() and not artifact.is_symlink(), artifact
        assert artifact.stat().st_size == row["bytes"], artifact
        assert digest(artifact) == row["sha256"], artifact
        total += row["bytes"]
    actual = {str(p.relative_to(path.parent)) for p in path.parent.rglob("*") if p.is_file()}
    assert actual == seen | {path.name}, ("unindexed or absent", sorted(actual - seen - {path.name}), sorted(seen - actual))
    sources = report.get("source_sha256", {})
    for name, expected in sources.items():
        frozen = subprocess.check_output(["git", "show", f"{HEAD}:{name}"])
        assert hashlib.sha256(frozen).hexdigest() == expected, (name, "frozen source")
        assert digest(Path(name)) == expected, (name, "current source")
    assert all(c["exit_code"] == 0 for c in report["commands"])
    return {"report": str(path), "sha256": expected_sha, "status": report["status"],
            "head": report["head"], "files_authenticated": len(seen), "bytes_authenticated": total,
            "sources_authenticated": len(sources), "gates": len(report["commands"])}


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--report", type=Path, required=True)
    p.add_argument("--sha256", required=True)
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    result = authenticate(a.report, a.sha256)
    a.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
