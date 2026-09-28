#!/usr/bin/env python3
"""Bind the frozen browser run to independent byte oracle, exact source, and local gates."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

here = Path(__file__).resolve().parent
repo = here.parents[2]
prefix = repo / "evidence/omarchy-profile"
run = prefix / "snapshot-allocation-r1"
gates = prefix / "snapshot-allocation-gates"
head = "512ba6acc9b0293d04d96115372ddef2b1cccfab"
env = dict(os.environ, DEVELOPER_DIR="/Library/Developer/CommandLineTools")
seen = {}

def read(path):
    data = path.read_bytes()
    seen[str(path.relative_to(repo))] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    return data

report = json.loads(read(run / "report.json"))
oracle = json.loads(read(here / "r3-byte-oracle.json"))
assert report["head"] == head and report["passed"] and report["errors"] == []
assert oracle["createdAt"] < report["startedAt"]
snapshot = report["snapshot"]
assert snapshot["ramMiB"] == 1024 and snapshot["snapshotBytes"] == oracle["rawBytes"] == 899181735
hashes = oracle["expectedFullBlobSha256ByRestoreCount"]
for key, count in [("firstHash", "1"), ("secondHash", "2"), ("storedHash", "2"), ("thirdHash", "3")]:
    assert snapshot[key] == hashes[count], key
assert snapshot["decision"] == snapshot["storedDecision"] == "resume"
assert snapshot["stale"] == "stale" and snapshot["foreign"] == "foreign_image"
assert snapshot["generation"] == 0 and snapshot["guestInstructionsExecuted"] == 0
assert report["suite"] == {"metric-pass": "127", "metric-fail": "0", "metric-done": "127"}
assert "responsiveness remains unresolved" in report["capabilityEvidence"]
assert "E5.5-T03al" in report["capabilityEvidence"]
image = read(run / "suite.png")
assert hashlib.sha256(image).hexdigest() == report["suiteScreenshot"]
for path, claimed in report["source"].items():
    data = subprocess.check_output(["git", "show", f"{head}:{path}"], cwd=repo, env=env)
    assert claimed == {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}, path
    assert (repo / path).read_bytes() == data, f"runtime/evidence source changed: {path}"
wasm_hash = report["source"]["web/dist/pkg/wasm_vm_wasm_bg.wasm"]["sha256"]
affected = json.loads(read(gates / "affected-commands.json"))
browser = json.loads(read(gates / "browser-commands.json"))
for receipt in [affected, browser]:
    assert receipt["head"] == head and receipt["wasmSha256"] == wasm_hash
for row in affected["commands"]:
    assert row["code"] == (101 if row["label"] == "core-clippy" else 0)
    read(gates / (row["label"] + ".log"))
assert browser["allPassed"] and browser["commands"][0]["code"] == 0
read(gates / "browser.log")
scoped = json.loads(read(gates / "affected-clippy.json"))
assert scoped["head"] == head and scoped["code"] == 0
read(gates / "affected-clippy.log")
counts = {}
for name in ["resume-format", "resume-machines", "wasm-native-lib"]:
    text = (gates / (name + ".log")).read_text()
    rows = re.findall(r"test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored", text)
    assert rows and all(failed == ignored == "0" for _, failed, ignored in rows)
    counts[name] = sum(int(passed) for passed, _, _ in rows)
assert counts == {"resume-format": 17, "resume-machines": 49, "wasm-native-lib": 33}
unchanged = ["crates/core/tests/plic_sparse.rs", "crates/core/src/trace.rs", "crates/core/Cargo.toml"]
assert subprocess.check_output(["git", "diff", "d52e8eaa", head, "--", *unchanged], cwd=repo, env=env) == b""
for name in ["predictions.md", "serialization_attack.rs", "run_attack.py", "run_sabotage.py",
             "derive_r3_oracle.py", "candidate-byte-attack/report.json", "candidate-byte-attack/attack.log",
             "reservation-removed-sabotage/report.json", "reservation-removed-sabotage/attack.log",
             "reservation-removed-sabotage/mutation.diff"]:
    read(here / name)
baseline = json.loads(read(prefix / "snapshot-allocation-baseline/report.json"))
stack = json.loads(read(prefix / "snapshot-allocation-baseline/allocation-stack.json"))
assert not baseline["result"]["saved"] and "RuntimeError: unreachable" in baseline["result"]["error"]
assert "SnapshotWriter::section" in stack["symbols"]["945"]
out = {"auditedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "head": head,
       "wasmSha256": wasm_hash, "counts": counts,
       "independentExpectedHashesMatch": True, "originalAllocationFailureConfirmed": True,
       "allAffectedChecksPass": True, "broadClippyKnownFailure": "unchanged plic_sparse VecSink feature import",
       "suiteVisuallyInspected": True, "pending": ["broad gauntlet classification", "deployment", "final pristine clone"],
       "files": seen}
(here / "available-proof-audit.json").write_text(json.dumps(out, indent=2) + "\n")
print(json.dumps({key: value for key, value in out.items() if key != "files"}, indent=2))
