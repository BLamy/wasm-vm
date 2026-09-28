#!/usr/bin/env python3
"""Independently re-decode sealed worker bytes and bind the recorded artifacts."""
import hashlib
import json
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[3]
WORKER = ROOT / "evidence/omarchy-profile/evdev-buffer-r3"
OUT = Path(__file__).resolve().parent / "worker-audit.json"


def identity(path):
    data = path.read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


seal = WORKER / "sha256.txt"
assert identity(seal)["sha256"] == "2beac5de05aefc0d6e5d4ea4b62a332264b41dcb4d03acf2c3cc14a09064f541"
sealed = []
for line in seal.read_text().splitlines():
    expected, name = line.split(maxsplit=1)
    path = ROOT / name
    assert identity(path)["sha256"] == expected, path
    sealed.append(name)
assert len(sealed) == 36
guest = WORKER / "guest"
receipt = json.loads((guest / "result.json").read_text())
assert receipt["passed"] is True
assert receipt["head"] == "97743da727ee51eb7326b112c18653ff02941da1"
for name, expected in receipt["files"].items():
    assert identity(ROOT / name) == expected, name
pair = [(1, 30, 1), (0, 0, 0), (1, 30, 0), (0, 0, 0)]
predictions = {
    "baseline-legacy": pair,
    "baseline-burst": [(0, 3, 0), (0, 0, 0), (1, 30, 0), (0, 0, 0),
                       (1, 30, 1), (0, 0, 0), (1, 30, 0), (0, 0, 0), (1, 48, 1), (0, 0, 0)],
    "candidate-legacy": pair,
    "candidate-burst": pair * 64 + [(1, 48, 1), (0, 0, 0)],
    "candidate-overflow": [(0, 3, 0), (0, 0, 0), (1, 48, 1), (0, 0, 0)],
}
assert [row["name"] for row in receipt["runs"]] == list(predictions)
rows = []
for run in receipt["runs"]:
    name = run["name"]
    command = run["command"]
    assert command[0] == str(ROOT / "target/release/wasm-vm") and command[1] == "boot"
    assert command[command.index("--initrd") + 1] == str(guest / "initramfs.cpio.gz")
    kernel = Path(command[command.index("--kernel") + 1])
    assert identity(kernel) == run["kernel"]
    assert run["kernel"]["sha256"] == (
        "af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce" if name.startswith("baseline")
        else "3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d")
    assert run["returncode"] == 0 and run["passed"] is True and run["elapsedSeconds"] < 300
    source = guest / (name + ".stdout.log")
    text = source.read_text()
    assert "WVB_ERROR" not in text and "Kernel panic" not in text
    assert "WVB_DEVICE name=wasm-vm virtio keyboard measured=3 state=4 major=13 minor=64" in text
    assert ("legacy" in name) == ("WVB_SENTINEL B_DOWN separate_client=1" not in text)
    records = []
    citations = []
    for number, line in enumerate(text.splitlines(), 1):
        match = re.fullmatch(r"WVB_EVENT (\d+) ([0-9a-f]{48})", line)
        if match:
            assert int(match.group(1)) == len(records)
            records.append(bytes.fromhex(match.group(2)))
            citations.append(number)
    assert len(records) == len(predictions[name])
    raw = b"".join(records)
    assert raw == (guest / (name + ".events.bin")).read_bytes()
    actual = [struct.unpack_from("<HHi", event, 16) for event in records]
    assert actual == predictions[name]
    assert actual == [tuple(event) for event in run["events"]]
    assert identity(guest / (name + ".events.bin")) == run["eventBytes"]
    assert f"WVB_DONE count={len(records)} eagain=1" in text
    stderr = (guest / (name + ".stderr.log")).read_text()
    assert "pending events=0" in stderr and "guest exited 0" in stderr
    evidence = (guest / (name + ".evidence.txt")).read_text()
    assert "trace mode=retirement-records" in evidence and "outcome=Exited(0)" in evidence
    retired = int(re.search(r"trace retired=(\d+)", evidence)[1])
    assert retired > 0
    rows.append({"name": name, "prediction": "HELD", "events": len(records),
                 "streamFirstLine": citations[0], "streamLastLine": citations[-1],
                 "stdout": identity(source), "eventBytes": identity(guest / (name + ".events.bin")),
                 "guestEvidence": identity(guest / (name + ".evidence.txt")), "retired": retired})
report = {"passed": True, "workerSeal": identity(seal), "sealedFilesChecked": len(sealed),
          "receipt": identity(guest / "result.json"), "reader": identity(guest / "init"),
          "initrd": identity(guest / "initramfs.cpio.gz"), "runs": rows}
OUT.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"passed": True, "sealedFiles": len(sealed),
                  "events": {r["name"]: r["events"] for r in rows}}))
