#!/usr/bin/env python3
"""Verifier mutations of authentic captures; originals remain untouched."""
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("capture_under_attack", ROOT / "tools/virgl-capture/validate.py")
capture = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = capture
spec.loader.exec_module(capture)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def artifact_update(directory, role, transform):
    manifest = json.loads((directory / "manifest.json").read_bytes())
    ref = next(ref for ref in manifest["artifacts"] if ref["role"] == role)
    path = directory / ref["path"]
    data = transform(path.read_bytes())
    path.write_bytes(data)
    ref.update(bytes=len(data), sha256=digest(data))
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def split_actual_shader(directory, offset_delta):
    events = [json.loads(line) for line in (directory / "events.jsonl").read_bytes().splitlines()]
    summary = json.loads((directory / "summary.json").read_bytes())
    occurrence = next(iter(summary["shaders"].values()))["occurrences"][0]
    location = occurrence["packets"][0]
    event = events[location["event"] - 1]
    ref = next(ref for ref in event["blobs"] if ref["role"] == "command")
    old_digest = ref["sha256"]
    old_path = directory / "blobs" / (old_digest + ".bin.gz")
    data = gzip.decompress(old_path.read_bytes())
    start = location["byteOffset"]
    header = struct.unpack_from("<I", data, start)[0]
    end = start + ((header >> 16) + 1) * 4
    words = struct.unpack("<6I", data[start:start + 24])
    assert words[0] & 0xffff == 0x401 and words[5] == 0
    text = data[start + 24:end]
    assert len(text) > 16 and not words[3] & 0x80000000
    cut = 16
    first = struct.pack("<6I", 0x401 | ((5 + cut // 4) << 16), *words[1:]) + text[:cut]
    second = struct.pack("<6I", 0x401 | ((5 + (len(text) - cut) // 4) << 16),
                         words[1], words[2], 0x80000000 | (cut + offset_delta), words[4], 0) + text[cut:]
    replacement = data[:start] + first + second + data[end:]
    new_digest = digest(replacement)
    (directory / "blobs" / (new_digest + ".bin.gz")).write_bytes(gzip.compress(replacement, mtime=0))
    for item in events:
        for reference in item["blobs"]:
            if reference["sha256"] == old_digest:
                assert reference["role"] == "command"
                reference.update(sha256=new_digest, bytes=len(replacement))
                item["ndw"] = len(replacement) // 4
    old_path.unlink()
    unique = {r["sha256"]: r["bytes"] for e in events for r in e["blobs"]}
    events[-1]["blobBytes"] = sum(unique.values())
    event_data = b"".join((json.dumps(e, separators=(",", ":")) + "\n").encode() for e in events)
    (directory / "events.jsonl").write_bytes(event_data)
    manifest = json.loads((directory / "manifest.json").read_bytes())
    manifest["events"].update(bytes=len(event_data), sha256=digest(event_data))
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return {"event": event["seq"], "originalByteOffset": start,
            "originalCommandDigest": old_digest, "mutatedCommandDigest": new_digest,
            "continuationOffset": cut + offset_delta}


def main():
    report = {"source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "prediction": "Valid real-body continuation splitting is accepted; an overlapping continuation, a changed pinned executable, and a software glmark2 client under a VirGL compositor are rejected even after outer hashes are repaired.",
              "results": []}
    with tempfile.TemporaryDirectory(prefix="virgl-verifier-attack-") as temporary:
        temp = Path(temporary)
        for name, workload, error in [
            ("valid-real-shader-continuation", "textured-scene", None),
            ("overlapping-real-shader-continuation", "textured-scene", "offset gap/overlap"),
            ("changed-pinned-workload-executable", "textured-scene", "executable differs"),
            ("software-client-with-virgl-compositor", "glmark2-es2", "renderer is not VirGL"),
        ]:
            directory = temp / name
            shutil.copytree(ROOT / "evidence/virgl-corpus/captures" / workload, directory)
            detail = {}
            if "continuation" in name:
                detail = split_actual_shader(directory, -4 if error else 0)
            elif "executable" in name:
                artifact_update(directory, "virgl-textured-scene", lambda data: data[:-1] + bytes([data[-1] ^ 1]))
            else:
                def fallback(data):
                    result, count = re.subn(rb"(GL_RENDERER\s*[:=]\s*)virgl[^\r\n]*", rb"\1llvmpipe (verifier mutation)", data)
                    assert count == 1, count
                    return result
                artifact_update(directory, "workload.log", fallback)
            try:
                summary, _ = capture.validate_capture(directory)
            except capture.CaptureError as observed:
                assert error and error in str(observed), (name, str(observed))
                report["results"].append({"name": name, "result": "HELD", "observed": str(observed), **detail})
            else:
                assert error is None, (name, "mutation was accepted")
                assert summary["opcodes"]["DRAW_VBO"] == 3
                assert len(summary["shaders"]) == 2
                report["results"].append({"name": name, "result": "HELD", "observed": "accepted with 3 draws and 2 unchanged shader bodies", **detail})
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
