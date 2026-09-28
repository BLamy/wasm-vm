#!/usr/bin/env python3
"""Bounded receipt corruption; original report/RAM are never modified."""
import hashlib
import json
import os
import pathlib
import subprocess
import tempfile


source = pathlib.Path("evidence/omarchy-profile/input-wait-r3/desktop/report.json")
raw = source.read_bytes()
report = json.loads(raw)
expected = json.loads(pathlib.Path("evidence/omarchy-profile/input-wait-inspected-r3/checkpoint.json").read_text())
digest = report["failureCheckpoint"]["snapshot"]["stateDigestAfter"]
report["failureCheckpoint"]["snapshot"]["stateDigestAfter"] = ("0" if digest[0] != "0" else "1") + digest[1:]
env = dict(os.environ, DEVELOPER_DIR="/Library/Developer/CommandLineTools")
results = []
with tempfile.TemporaryDirectory(prefix="omarchy-t03o-critic-") as directory:
    scratch = pathlib.Path(directory)
    trial = scratch / "trial"
    (trial / "desktop").mkdir(parents=True)
    (trial / "desktop/report.json").write_text(json.dumps(report))
    for run in range(2):
        output = scratch / f"rejected-{run}"
        attempt = subprocess.run(["node", "tools/verify/omarchy-input-wait-inspect.mjs", str(trial), str(output)], env=env, text=True, capture_output=True)
        assert attempt.returncode != 0 and "AssertionError" in attempt.stderr
        assert not output.exists()
        results.append({"attempt": run + 1, "exit": attempt.returncode, "outputCreated": False,
                        "stderr": attempt.stderr})
    (trial / "desktop/report.json").write_bytes(raw)
    output = scratch / "restored"
    attempt = subprocess.run(["node", "tools/verify/omarchy-input-wait-inspect.mjs", str(trial), str(output)], env=env, text=True, capture_output=True)
    assert attempt.returncode == 0, attempt.stderr
    restored = json.loads((output / "checkpoint.json").read_text())
    for key in ("ram", "layoutSha256", "kernelSha256", "comparisons", "result"):
        assert restored[key] == expected[key]
assert source.read_bytes() == raw
print(json.dumps({"prediction": "A changed post-export RAM digest must reject before decoded output is written.",
                  "result": "HELD", "originalReportSha256": hashlib.sha256(raw).hexdigest(),
                  "mutation": {"field": "failureCheckpoint.snapshot.stateDigestAfter", "before": digest,
                               "after": report["failureCheckpoint"]["snapshot"]["stateDigestAfter"]},
                  "attacks": results, "restoredReceiptAccepted": True, "originalReportUnchanged": True}, indent=2))
