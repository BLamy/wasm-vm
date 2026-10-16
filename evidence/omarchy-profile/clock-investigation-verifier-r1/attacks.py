#!/usr/bin/env python3
"""Bounded isolated admission attack and meaningful control-test sabotage."""
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
HARNESS = ROOT / "tools/verify/clock-fast-path-benchmark.mjs"
TEST = ROOT / "tools/verify/clock-fast-path-benchmark.test.mjs"
BASE = Path("/tmp/wasm-vm-clock-current-baseline")


def sha(data):
    return hashlib.sha256(data).hexdigest()


records = []
with tempfile.TemporaryDirectory(prefix="clock-verifier-attacks-") as directory:
    scratch = Path(directory)
    base = scratch / "tampered-baseline"
    base.mkdir()
    shutil.copyfile(BASE / "baseline.json", base / "baseline.json")
    altered = (BASE / "libwasm_vm_core.rlib").read_bytes() + b"verifier-identity-attack"
    (base / "libwasm_vm_core.rlib").write_bytes(altered)
    expected = json.loads((base / "baseline.json").read_text())["rlibSha256"]
    result = subprocess.run(["node", str(HARNESS), str(scratch / "rejected-output"), str(base)],
                            cwd=ROOT, text=True, capture_output=True, timeout=60)
    log = result.stdout + result.stderr
    (OUT / "baseline-tamper.log").write_text(log)
    assert result.returncode == 1 and "ERR_ASSERTION" in log and expected in log and sha(altered) in log
    assert not (scratch / "rejected-output/report.json").exists()
    records.append({"attack": "preserved rlib altered before timing", "prediction": "exit 1 at library SHA admission before native/compiler/browser receipts", "held": True,
                    "command": ["node", str(HARNESS), "NEW_OUTPUT", "TAMPERED_BASELINE"],
                    "sourceSha256": sha(HARNESS.read_bytes()), "expectedLibrarySha256": expected,
                    "alteredLibrarySha256": sha(altered), "exitCode": result.returncode, "log": "baseline-tamper.log"})

    isolated = scratch / "sabotage"
    (isolated / "tools/verify").mkdir(parents=True)
    fixture_dir = isolated / "evidence/omarchy-profile/clock-investigation-r1/final/control"
    fixture_dir.mkdir(parents=True)
    shutil.copyfile(ROOT / "evidence/omarchy-profile/clock-investigation-r1/final/control/report.json", fixture_dir / "report.json")
    original = HARNESS.read_text()
    condition = "acceptanceHeld: !report.identicalBrowserBinary && speedup > 1"
    assert original.count(condition) == 1
    saboteur = original.replace(condition, "acceptanceHeld: speedup > 1")
    (isolated / "tools/verify/clock-fast-path-benchmark.mjs").write_text(saboteur)
    shutil.copyfile(TEST, isolated / "tools/verify/clock-fast-path-benchmark.test.mjs")
    result = subprocess.run(["node", "--test", "tools/verify/clock-fast-path-benchmark.test.mjs"],
                            cwd=isolated, text=True, capture_output=True, timeout=60)
    log = result.stdout + result.stderr
    (OUT / "control-sabotage.log").write_text(log)
    assert result.returncode == 1 and "pass 2" in log and "fail 1" in log
    assert "acceptanceHeld: true" in log and "acceptanceHeld: false" in log
    records.append({"attack": "isolated copy loses identical-byte acceptance guard", "prediction": "noise test fails, two independent receipt attacks still pass", "held": True,
                    "command": ["node", "--test", "tools/verify/clock-fast-path-benchmark.test.mjs"],
                    "sourceSha256": sha(HARNESS.read_bytes()), "testSha256": sha(TEST.read_bytes()),
                    "alteredSourceSha256": sha(saboteur.encode()), "exitCode": result.returncode, "passedTests": 2, "failedTests": 1,
                    "log": "control-sabotage.log"})
(OUT / "attacks.json").write_text(json.dumps(records, indent=2) + "\n")
print(json.dumps({"held": len(records), "attacks": [r["attack"] for r in records]}, indent=2))
