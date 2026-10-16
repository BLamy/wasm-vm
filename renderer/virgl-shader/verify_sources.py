#!/usr/bin/env python3
"""Verify the complete vendored/generated file inventory against the pin."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
manifest = json.loads((root / "UPSTREAM.json").read_text())
if manifest["revision"] != "ca50e008863837e094747a69974dde3ae148aeaa":
    raise SystemExit("Unexpected upstream revision in UPSTREAM.json")
expected = manifest["sha256"]
actual = {
    str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
    for directory in ["vendor", "generated"]
    for path in sorted((root / directory).rglob("*"))
    if path.is_file()
}
if actual != expected:
    changed = sorted(name for name in actual.keys() | expected.keys() if actual.get(name) != expected.get(name))
    raise SystemExit("Pinned source/generated inventory differs: " + ", ".join(changed))
print(f"Pinned virglrenderer 1.3.0: {len(actual)} source/generated SHA-256 hashes match")
