#!/usr/bin/env python3
"""Compare original guest command coverage to the pinned QEMU/VirGL capture."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import struct

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--reference", required=True, type=Path)
p.add_argument("--guest", required=True, type=Path)
p.add_argument("--output", required=True, type=Path)
a = p.parse_args()
hash_file = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
manifest = json.loads((a.reference / "manifest.json").read_text())
assert manifest["versions"]["host"]["virglrenderer"] == "1.3.0"
assert manifest["versions"]["guest"]["mesa"] == "1:26.2.2-1"
assert hash_file(a.reference / "events.jsonl") == manifest["events"]["sha256"]
reference = [json.loads(line) for line in (a.reference / "events.jsonl").read_text().splitlines()]
records = [json.loads(line) for line in (a.guest / "gpu.ndjson").read_text().splitlines()]
guest = json.loads((a.guest / "acceptance.json").read_text())
assert guest["status"] == "passed"
commands = guest["final"]["gpu"]["guestCommands"]["records"]
assert commands and all(row["response"] < 0x1200 for row in commands)
mapping = {"get_cap_set": [0x108], "fill_caps": [0x109], "context_create": [0x200],
           "context_create_with_flags": [0x200], "resource_create": [0x101, 0x204],
           "resource_attach_iov": [0x106], "ctx_attach_resource": [0x202],
           "transfer_write_iov": [0x105, 0x205], "submit_cmd": [0x207],
           "ctx_detach_resource": [0x203], "resource_detach_iov": [0x107],
           "resource_unref": [0x102], "context_destroy": [0x201]}
original_counts = Counter(row["type"] for row in reference if row.get("phase") == "enter")
guest_counts = Counter(row["type"] for row in commands)
coverage = {}
for family, types in mapping.items():
    assert original_counts[family] > 0, "reference did not exercise " + family
    matched = [row["sequence"] for row in commands if row["type"] in types]
    assert matched, "original browser queue is missing " + family
    coverage[family] = {"referenceCalls": original_counts[family], "guestResponses": len(matched), "firstGuestSequence": matched[0]}

def opcodes(data):
    assert len(data) % 4 == 0
    words = struct.unpack("<" + "I" * (len(data) // 4), data)
    at = 0
    result = Counter()
    while at < len(words):
        header = words[at]
        count = (header >> 16) + 1
        assert at + count <= len(words), "truncated original VirGL packet"
        result[header & 255] += 1
        at += count
    return result

reference_ops = Counter()
for row in reference:
    if row["type"] != "submit_cmd" or row.get("phase") != "enter": continue
    blob = next(blob for blob in row["blobs"] if blob["role"] == "command")
    file = a.reference / "blobs" / (blob["sha256"] + ".bin")
    assert file.stat().st_size == blob["bytes"] and hash_file(file) == blob["sha256"]
    reference_ops.update(opcodes(file.read_bytes()))
guest_ops = Counter()
fences = 0
for row in records:
    if row["type"] != "control": continue
    event = row["event"]
    if event["type"] == "beginJob" and event.get("kind") == "commands":
        guest_ops.update(opcodes(bytes(event["commands"])))
        fences += event["header"]["flags"] & 1
assert reference_ops[8] > 0 and guest_ops[8] >= 1000 and fences > 0
report = {"status": "passed", "scope": "original control/initialization families and correctly framed DRAW_VBO, order-independent; caps are independently qualified rather than copied from QEMU",
          "referenceManifestSha256": hash_file(a.reference / "manifest.json"), "guestAcceptanceSha256": hash_file(a.guest / "acceptance.json"),
          "guestCommandLogSha256": hash_file(a.guest / "gpu.ndjson"), "coverage": coverage,
          "referenceOpcodes": dict(reference_ops), "guestOpcodes": dict(guest_ops), "guestFencedSubmissions": fences}
a.output.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"status": report["status"], "families": len(coverage), "draws": guest_ops[8]}))
