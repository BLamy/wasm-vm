#!/usr/bin/env python3
"""Verify the original factory GPU runtime without relabeling or recompiling its bytes."""
import hashlib
import json
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
manifest = json.loads((ROOT / "web/gpu-runtime/manifest.json").read_text())
build = "222950026e3e01edc32462dc531795d49c262c4780d24ac9cebbb01c2d22cea0"
assert manifest["version"] == 1 and manifest["build_id"] == build
assert manifest["directory"] == "gpu-runtime/" + build
directory = ROOT / "web" / manifest["directory"]
identity = hashlib.sha256(b"wasm-vm-production-gpu-worker-v1\0")
names = []
for entry in manifest["files"]:
    name = entry["path"]
    path = PurePosixPath(name)
    assert not path.is_absolute() and ".." not in path.parts
    assert name not in names
    names.append(name)
    body = (directory / name).read_bytes()
    assert len(body) == entry["bytes"]
    assert hashlib.sha256(body).hexdigest() == entry["sha256"], name
    assert (ROOT / "web/dist" / manifest["directory"] / name).read_bytes() == body
    if name != "gpu-checkpoint-build.js":
        identity.update(name.encode() + b"\0" + len(body).to_bytes(8, "little") + body)
assert names == sorted(names) and len(names) == 47
assert {str(p.relative_to(directory)) for p in directory.rglob("*") if p.is_file()} == set(names)
assert identity.hexdigest() == build
assert build in (directory / "gpu-checkpoint-build.js").read_text()
assert build in (ROOT / "web/gpu-runtime-worker.js").read_text()
assert (ROOT / "web/gpu-runtime-worker.js").read_bytes() == (ROOT / "web/dist/gpu-runtime-worker.js").read_bytes()
print(json.dumps({"status": "passed", "retained_build": build, "runtime_files": len(names),
                  "manifest_sha256": hashlib.sha256((ROOT / "web/gpu-runtime/manifest.json").read_bytes()).hexdigest()}))
