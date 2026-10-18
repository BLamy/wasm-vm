#!/usr/bin/env python3
"""Preserve the completed incremental verifier audit without changing runtime code."""
import hashlib
import json
import shutil
from pathlib import Path

source = Path("target/evidence/e9-t11-verifier/corrected")
destination = Path("evidence/e9-t11/verifier-corrected-final")
assert not destination.exists()
destination.mkdir()
files = [
    "predictions.md", "orientation.json", "incremental-ledger.json",
    "incremental-coverage-ledger.md", "authenticate.py", "jit-frame-critic.py",
    "boundary-cadence.rs", "boundary-cadence-receipt.json", "boundary-build.log",
    "boundary-cadence.log", "boundary-frame-audit.json", "boundary-audit-receipt.json",
    "worker-identity.json", "cold-outer-identity.json", "cold-acceptance-identity.json",
    "cold-origin-audit.json", "cold-origin-final-audit.json", "public-identity.json",
    "worker-jit-frame-audit.json", "cold-jit-frame-audit.json", "jit-cross-origin-audit.json",
    "armed.observations.jsonl", "disarmed-read.observations.jsonl", "matrix-points-receipt.json",
    "gates-audit.json", "source-oracle-reruns.json", "public-oracle-reruns.json",
    "worker-native-source-oracle.json", "worker-browser-source-oracle.json",
    "cold-native-source-oracle.json", "cold-browser-source-oracle.json",
    "public-source-oracle.json", "public-clock-oracle.json",
    "public-assets-and-state-audit.json", "full-deployment-audit.json",
    "production-rtc-worker.json", "production-rtc-cold.json", "production-rtc-public.json",
    "capsule-and-head-audit.json", "seal-verifier-packet.py",
]
for name in files:
    shutil.copyfile(source / name, destination / name)
shutil.copyfile(source / "final-README.md", destination / "README.md")
shutil.copyfile("evidence/e9-t11/verifier-refutation/held-ledger.json", destination / "held-ledger.json")
shutil.copyfile("target/evidence/e9-t11-verifier/production-rtc-critic.py", destination / "production-rtc-critic.py")
shutil.copytree(source / "boundary-cadence", destination / "boundary-cadence")
oracles = destination / "oracle-reruns"
oracles.mkdir()
for label in ["worker-native", "worker-browser", "cold-native", "cold-browser", "public-source", "public-clock"]:
    for suffix in ["-oracle.py", "-oracle.log"]:
        shutil.copyfile(source / (label + suffix), oracles / (label + suffix))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


receipt = {
    "task": "E9-T11",
    "role": "fresh adversarial verifier",
    "verdict": "verified",
    "runtime_head": "e14e4312b9ee8df73b93646c944bf64a2f0db875",
    "worker_submission": "9abe576db62c7a8f691cc2224fb507df4a384b58",
    "prediction_sha256": digest(destination / "predictions.md"),
    "carried_held_ledger_sha256": digest(destination / "held-ledger.json"),
    "historical_refutation_receipt_sha256": digest(Path("evidence/e9-t11/verifier-refutation/receipt.json")),
    "source": str(source),
    "retained": "Original recordings and independent Git metadata are retained; only named RAM cold source/compiler directories are disposable after verdict.",
    "files": [
        {"path": str(p.relative_to(destination)), "bytes": p.stat().st_size, "sha256": digest(p)}
        for p in sorted(destination.rglob("*")) if p.is_file()
    ],
}
assert receipt["prediction_sha256"] == "95ebc85daee2c9e935e0ff7d960da06ec0f2beba1b85e91a933f12a52420769a"
assert receipt["carried_held_ledger_sha256"] == "cb0ce9a29a651d535a05f69152690ab0e4c3508d39c50604db59253a42f6da29"
assert receipt["historical_refutation_receipt_sha256"] == "db98fba97e7d3eeb21050db282510d3132c7e856884ef573b211cf2ded9fad6e"
(destination / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps({"packet": str(destination), "indexed_files": len(receipt["files"]), "receipt_sha256": digest(destination / "receipt.json")}))
