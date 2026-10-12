#!/usr/bin/env python3
"""Independent original fields, native replies, rings and transport-state model."""
import hashlib
import json
import pathlib
import struct
import sys


def state(hex_text, digest):
    raw = bytes.fromhex(hex_text)
    assert hashlib.sha256(raw).hexdigest() == digest
    assert raw[:8] == b"WV3DCTL2"
    offset = 8

    def take(fmt):
        nonlocal offset
        values = struct.unpack_from("<" + fmt, raw, offset)
        offset += struct.calcsize("<" + fmt)
        return values[0] if len(values) == 1 else values

    epoch, generation, backing_generation, logical, gpu, backing = take("6Q")
    poisoned = take("B")
    contexts = []
    for _ in range(take("I")):
        identity = take("IQ")
        length = take("I")
        name = raw[offset:offset + length].hex()
        offset += length
        members = [take("IQ") for _ in range(take("I"))]
        contexts.append({"identity": identity, "name": name, "members": members})
    resources = {}
    for _ in range(take("I")):
        identity = take("IQ")
        metadata = take("11I")
        entries = None
        if take("B"):
            bg = take("Q")
            entries = {"generation": bg, "ranges": [take("QI") for _ in range(take("I"))]}
        resources[identity[0]] = {"generation": identity[1], "metadata": list(metadata), "backing": entries}
    assert offset == len(raw)
    return {"epoch": epoch, "nextGeneration": generation, "nextBackingGeneration": backing_generation,
            "logical": logical, "gpu": gpu, "backing": backing, "poisoned": poisoned,
            "contexts": contexts, "resources": resources}


def records(log):
    rows = []
    for line in log.read_text().splitlines():
        if line.startswith(("CONTROL3D_RECORD ", "CONTROL3D_PORTABLE_RECORD ")):
            rows.append(json.loads(line.split(" ", 1)[1]))
    return rows


def audit(root, repo):
    rows = records(root / "native-control.stderr")
    assert rows
    for row in rows:
        request, response = bytes.fromhex(row["request"]), bytes.fromhex(row["response"])
        assert len(response) == 24 and response[16:21] == request[16:21]
        assert response[21:24] == b"\0" * 3
        fence = struct.unpack_from("<I", request, 4)[0] & 1
        assert struct.unpack_from("<I", response, 4)[0] == fence
        assert response[8:16] == (request[8:16] if fence else b"\0" * 8)
        assert response[12:16] == (request[12:16] if fence else b"\0" * 4)
        assert row["responseGuard"] == "a5" * 40
        assert len(row["machineDigest"]) == 64
        used = bytes.fromhex(row["ring"]["used"])
        assert struct.unpack_from("<H", used, 2)[0] == row["usedIndex"]
        slot = (row["usedIndex"] - 1) % 16
        assert struct.unpack_from("<II", used, 4 + slot * 8) == (0, 24)
        if row["transportCanonical"]:
            row["decoded"] = state(row["transportCanonical"], row["transportDigest"])
    original = []
    for name, expected_peak, refusal in [("compositor", 24, None), ("kmscube", 4, None), ("glmark2-es2", 25, 3025)]:
        capture = repo / "evidence/virgl-corpus/captures" / name
        manifest_raw = (capture / "manifest.json").read_bytes()
        manifest = json.loads(manifest_raw)
        raw = (capture / manifest["events"]["path"]).read_bytes()
        assert len(raw) == manifest["events"]["bytes"]
        assert hashlib.sha256(raw).hexdigest() == manifest["events"]["sha256"]
        pending, calls = {}, []
        for event in map(json.loads, raw.splitlines()):
            if event["type"] not in ["resource_create", "resource_unref"]:
                continue
            if event["phase"] == "enter":
                pending[event["seq"]] = event
            else:
                entered = pending.pop(event["callSeq"])
                assert event["result"] == 0 and entered["type"] == event["type"]
                calls.append({"enter": entered, "returned": event})
        assert not pending
        boot = [c for c in calls if c["enter"]["resourceId"] == 2]
        assert len(boot) == 1 and boot[0]["enter"]["seq"] == 10 and boot[0]["enter"]["flags"] == 1
        model, generation, peak, count = {}, 1, 0, 0
        for call in calls:
            event = call["enter"]
            if event["resourceId"] == 2:
                continue
            matching = [r for r in rows if r["case"] == f"desktop-{name}-original-{event['seq']}"]
            assert len(matching) == 1
            observed = matching[0]
            if event["type"] == "resource_create":
                meta = [event[k] for k in ["resourceId", "target", "format", "bind", "width", "height",
                                           "depth", "arraySize", "lastLevel", "nrSamples", "flags"]]
                expected_request = struct.pack("<18I", 0x204, 0, 0, 0, 0, 0, *meta, 0)
            else:
                expected_request = struct.pack("<8I", 0x102, 0, 0, 0, 0, 0, event["resourceId"], 0)
            assert observed["request"] == expected_request.hex()
            if event["seq"] == refusal:
                assert event["format"] == 17
                assert int.from_bytes(bytes.fromhex(observed["response"])[:4], "little") == 0x1205
                assert observed["sinkEvents"] == count
            else:
                assert int.from_bytes(bytes.fromhex(observed["response"])[:4], "little") == 0x1100
                count += 1
                if event["type"] == "resource_create":
                    assert event["resourceId"] not in model
                    assert meta[1:4] in [[0, 64, 16], [0, 64, 32], [0, 64, 524288]] or (meta[1] == 2 and meta[2] in [1, 2, 20, 67])
                    model[event["resourceId"]] = {"generation": generation, "metadata": meta, "backing": None}
                    generation += 1
                else:
                    del model[event["resourceId"]]
                assert observed["sinkEvents"] == count
            actual = observed["decoded"]
            assert actual["resources"] == model and not actual["contexts"]
            logical = sum(v["metadata"][4] * (v["metadata"][5] * 4 if v["metadata"][1] == 2 else 1) for v in model.values())
            gpu = sum(v["metadata"][4] * (v["metadata"][5] * 4 if v["metadata"][1] == 2 else 1) for v in model.values() if v["metadata"][3] != 524288)
            assert (actual["nextGeneration"], actual["logical"], actual["gpu"], actual["backing"], actual["poisoned"]) == (generation, logical, gpu, 0, 0)
            peak = max(peak, len(model))
            if event["seq"] == refusal:
                break
        assert peak == expected_peak
        if refusal is None:
            assert not model and count == len(calls) - 1
        original.append({"workload": name, "calls": count, "peak": peak, "firstRefusal": refusal,
                         "manifestSha256": hashlib.sha256(manifest_raw).hexdigest(),
                         "eventsSha256": hashlib.sha256(raw).hexdigest(), "completeCalls": calls})
    count_rows = [r for r in rows if r["case"] == "desktop-count-admitted"]
    assert len(count_rows) == 64
    for index, row in enumerate(count_rows, 1):
        assert len(row["decoded"]["resources"]) == index and row["sinkEvents"] == index
        assert row["decoded"]["gpu"] == index * 8
    refused = next(r for r in rows if r["case"] == "desktop-count-65-refused")
    assert refused["decoded"] == count_rows[-1]["decoded"] and refused["sinkEvents"] == 64
    rollback = next(r for r in rows if r["case"] == "desktop-host-refusal-no-publication")
    before = next(r for r in rows if r["case"] == "desktop-count-release")
    assert rollback["decoded"] == before["decoded"] and rollback["sinkEvents"] == before["sinkEvents"]
    traces = [l for l in (root / "native-control.stderr").read_text().splitlines() if l.startswith("CONTROL3D_GUEST_TRACE ")]
    assert len(traces) >= len(rows)
    assert all(l.endswith("core 0: 0x0000000080200000 (0x0000006f)") for l in traces)
    return {"schema": "desktop-control-native-audit-v1", "nativeRecords": len(rows), "guestInstructions": len(traces),
            "original": original, "countBoundary": 64, "hostFailureAtomic": True, "guestExecution": False,
            "productionAuthority": False}


if __name__ == "__main__":
    root = pathlib.Path(sys.argv[1])
    repo = pathlib.Path(__file__).resolve().parents[2]
    report = audit(root, repo)
    (root / "native-audit.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: report[k] for k in ["nativeRecords", "guestInstructions", "countBoundary", "hostFailureAtomic"]}))
