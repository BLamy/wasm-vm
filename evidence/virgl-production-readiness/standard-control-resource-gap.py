#!/usr/bin/env python3
"""Original Mesa create/unref packets through the existing Machine control queue.

This is a negative transport probe, not a guest boot or native GL claim. The
complete original lifetime inputs and the sole QEMU 2D bootstrap are retained.
"""
import hashlib
import json
import pathlib
import struct
import subprocess
import sys
import tempfile


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


repo = pathlib.Path(__file__).resolve().parents[2]
head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
assert len(sys.argv) == 3 and sys.argv[1] == head, "pass the exact HEAD and output JSON"
output = pathlib.Path(sys.argv[2]).resolve()
sources = []
for relative in ["Cargo.toml", "Cargo.lock", "crates/core/Cargo.toml",
                 "crates/core/src/lib.rs", "crates/core/src/dev/virtio/gpu/mod.rs",
                 "crates/core/src/dev/virtio/gpu/control3d.rs",
                 "crates/core/src/dev/virtio/gpu/protocol.rs",
                 "crates/core/tests/virtio_gpu_control3d.rs"]:
    raw = (repo / relative).read_bytes()
    sources.append({"path": relative, "bytes": len(raw), "sha256": sha(raw)})


def packet(event):
    if event["type"] == "resource_create":
        fields = [event[k] for k in ["resourceId", "target", "format", "bind", "width",
                                    "height", "depth", "arraySize", "lastLevel",
                                    "nrSamples", "flags"]]
        # Linux v6.1 virtio_gpu_resource_create_3d, including trailing padding.
        return struct.pack("<6I12I", 0x204, 0, 0, 0, 0, 0, *fields, 0)
    return struct.pack("<8I", 0x102, 0, 0, 0, 0, 0, event["resourceId"], 0)


workloads = []
body = ["fn main() {"]
for name, failure_seq in [("compositor", 267), ("kmscube", 97), ("glmark2-es2", 276)]:
    root = repo / "evidence/virgl-corpus/captures" / name
    manifest_raw = (root / "manifest.json").read_bytes()
    manifest = json.loads(manifest_raw)
    raw = (root / manifest["events"]["path"]).read_bytes()
    assert len(raw) == manifest["events"]["bytes"]
    assert sha(raw) == manifest["events"]["sha256"]
    pending, calls = {}, []
    for event in map(json.loads, raw.splitlines()):
        if event["type"] not in ["resource_create", "resource_unref"]:
            continue
        if event["phase"] == "enter":
            assert event["seq"] not in pending
            pending[event["seq"]] = event
        else:
            entered = pending.pop(event["callSeq"])
            assert event["result"] == 0 and entered["type"] == event["type"]
            calls.append({"enter": entered, "returned": event,
                          "packetHex": packet(entered).hex()})
    assert not pending
    boot = [c for c in calls if c["enter"]["resourceId"] == 2]
    assert len(boot) == 1 and boot[0]["enter"]["seq"] == 10
    assert boot[0]["enter"]["flags"] == 1 and boot[0]["enter"]["target"] == 2
    operations = []
    body.append("{ let mut q = Queue::new(true, true);")
    for call in calls:
        event = call["enter"]
        if event["resourceId"] == 2:
            continue
        expected = 0x1205 if event["seq"] == failure_seq else 0x1100
        literal = "vec![" + ",".join(str(b) for b in bytes.fromhex(call["packetHex"])) + "]"
        label = f"{name}-original-event-{event['seq']}"
        method = "unchanged" if expected != 0x1100 else "expect"
        body.append(f'q.{method}("{label}", {literal}, {expected});')
        operations.append({"seq": event["seq"], "expectedResponse": expected,
                           "packetHex": call["packetHex"], "case": label})
        if expected != 0x1100:
            assert event["format"] == 2 and event["bind"] == 1310730
            break
    assert operations[-1]["seq"] == failure_seq
    body.append("}")
    workloads.append({"name": name, "manifestSha256": sha(manifest_raw),
                      "eventPath": str(root.relative_to(repo) / manifest["events"]["path"]),
                      "eventSha256": sha(raw), "calls": calls, "bootstrap2D": boot,
                      "predictions": operations, "firstRefusalSeq": failure_seq})
body.extend(['{ let mut q = Queue::new(true, true);',
             'for id in 1..=16 { q.expect("count-admitted", resource(id,0,64,16,8,1), 0x1100); }',
             'q.unchanged("count-17-refused", resource(17,0,64,16,8,1), 0x1201);',
             "}", "}"])

helper = (repo / "crates/core/tests/virtio_gpu_control3d.rs").read_text().split("#[test]", 1)[0]
helper = helper.replace('#![cfg(all(feature = "virgl-control-proof", not(feature = "zicsr-stub")))]', '')
helper = helper.replace('#[cfg(feature = "gpu-trace")]', '')
source = helper + "\n" + "\n".join(body) + "\n"
scratch = pathlib.Path(tempfile.mkdtemp(prefix="wasm-vm-control-resource-gap-"))
(scratch / "src").mkdir()
(scratch / "src/main.rs").write_text(source)
(scratch / "Cargo.toml").write_text(
    '[package]\nname="virgl-control-resource-gap"\nversion="0.0.0"\nedition="2024"\n'
    '[dependencies]\nwasm-vm-core={path=' + json.dumps(str(repo / "crates/core")) +
    ',features=["virgl-control-proof","gpu-trace"]}\n')
command = ["cargo", "run", "--offline", "--manifest-path", str(scratch / "Cargo.toml"),
           "--target-dir", str(repo / "target/control-resource-readiness")]
result = subprocess.run(command, cwd=repo, text=True, capture_output=True, timeout=300)
records = [json.loads(line.split(" ", 1)[1]) for line in result.stderr.splitlines()
           if line.startswith("CONTROL3D_RECORD ")]
record = {"schema": "original-control-resource-gap-v1", "sourceHead": head,
          "guestExecution": False, "productionAuthority": False,
          "sources": sources, "workloads": workloads, "rustSource": source,
          "rustSourceSha256": sha(source.encode()), "command": command,
          "exitCode": result.returncode, "stdout": result.stdout, "stderr": result.stderr,
          "nativeRecords": records}
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(record, indent=2) + "\n")
assert result.returncode == 0, result.stderr
for workload in workloads:
    for prediction in workload["predictions"]:
        observed = next(r for r in records if r["case"] == prediction["case"])
        assert observed["request"] == prediction["packetHex"]
        assert int.from_bytes(bytes.fromhex(observed["response"])[:4], "little") == prediction["expectedResponse"]
assert len([r for r in records if r["case"] == "count-admitted"]) == 16
assert next(r for r in records if r["case"] == "count-17-refused")["transportDigest"]
print(json.dumps({"head": head, "nativeRecords": len(records),
                  "firstRefusals": {w["name"]: w["firstRefusalSeq"] for w in workloads},
                  "countCeiling": 16, "output": str(output)}))
