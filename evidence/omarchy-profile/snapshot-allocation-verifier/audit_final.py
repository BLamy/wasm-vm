#!/usr/bin/env python3
"""Verify submission seal and inherited gauntlet classification before the verdict."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess

here = Path(__file__).resolve().parent
repo = here.parents[2]
gates = repo / "evidence/omarchy-profile/snapshot-allocation-gates"
env = dict(os.environ, DEVELOPER_DIR="/Library/Developer/CommandLineTools")
source_head = "512ba6acc9b0293d04d96115372ddef2b1cccfab"
artifact_head = "bb3c13dd6014ca15f29fe897b3ba207d65bc67b8"
worker_head = subprocess.check_output(["git", "rev-parse", "d6cd6853"], cwd=repo, env=env, text=True).strip()
seal = gates / "sha256.txt"
seal_sha = hashlib.sha256(seal.read_bytes()).hexdigest()
assert seal_sha == "01786a6b6a15415c7977b4dc23fde07a2e1d82cb1b775340aefe8c888cb42632"
sealed = []
for line in seal.read_text().splitlines():
    digest, path = line.split("  ", 1)
    target = repo / path
    assert target.resolve().is_relative_to(repo)
    assert hashlib.sha256(target.read_bytes()).hexdigest() == digest, path
    sealed.append(path)
assert len(sealed) == 33
ci = json.loads((gates / "ci-commands.json").read_text())
classification = json.loads((gates / "gauntlet-classification.json").read_text())
assert ci["head"] == source_head and ci["commands"][0]["code"] == 2
assert ci["allPassed"] is False and classification["broadGauntletPassed"] is False
current = (gates / "ci.log").read_text()
previous_path = repo / classification["sameRecordedFailureFamiliesAs"]
previous = previous_path.read_text()
assert len(classification["families"]) == 5
for family in classification["families"]:
    for pattern in family["patterns"]:
        assert pattern in current and pattern in previous, pattern
    for item in family["unchangedFiles"]:
        data = (repo / item["path"]).read_bytes()
        assert hashlib.sha256(data).hexdigest() == item["sha256"]
        old = subprocess.check_output(["git", "show", "53103e76:" + item["path"]], cwd=repo, env=env)
        assert data == old, item["path"]
for path in ["crates/core/src/dispatch.rs", "crates/core/src/hart/mod.rs"]:
    assert subprocess.check_output(["git", "diff", "53103e76", artifact_head, "--", path], cwd=repo, env=env) == b""
assert "passing: **128 / 128**" in current
assert "perf-smoke: alu median 58.4 MIPS" in current
assert "make: Target `ci' not remade because of errors." in current
assert subprocess.check_output(["git", "diff", artifact_head, worker_head, "--", "crates", "web", "tools/verify/omarchy-snapshot-allocation.mjs"], cwd=repo, env=env) == b""
report = {"auditedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
          "sourceHead": source_head, "artifactHead": artifact_head, "workerSubmissionHead": worker_head,
          "workerSealSha256": seal_sha, "workerSealedFilesRehashed": len(sealed),
          "allFiveFailureFamiliesMatchHistoricalLog": True,
          "historicalLogSha256": hashlib.sha256(previous_path.read_bytes()).hexdigest(),
          "broadGauntletPassed": False, "affectedBoundaryPassed": True,
          "nativeRiscvPassed": 128, "perfSmokeMips": 58.4,
          "runtimeUnchangedSinceArtifactHead": True,
          "verdict": "verified", "desktopResponsive": False}
(here / "final-audit.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
