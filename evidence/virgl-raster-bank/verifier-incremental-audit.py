#!/usr/bin/env python3
"""Reopen the unchanged physical evidence for the sole claim correction."""
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "evidence/virgl-raster-bank"
RECORDS = ROOT / "target/evidence/virgl-raster-bank-verifier"
TASK = "tasks/epic-6-transcendence/E6-T12f4b-owned-bank-output-authority.md"
PREVIOUS = "2e9e90b8ea185ea754309f761a205b76c29bce67"
CORRECTION = "10cac3c8d813f959659c57bcd26cfbed1e4788be"
FROZEN = "4999a81ad93496fc25e78cbb0aeb7adec66006e3"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT).decode()


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1048576), b""):
            h.update(chunk)
    return h.hexdigest()


def binding(path):
    return {"path": str(path.relative_to(ROOT)), "bytes": path.stat().st_size,
            "sha256": digest(path)}


def read_json(path):
    return json.loads(path.read_text())


changes = git("diff", "--name-only", PREVIOUS, CORRECTION).splitlines()
assert changes == [TASK], changes
assert git("diff", "--numstat", PREVIOUS, CORRECTION).split()[0:2] == ["26", "1"]
correction_diff = git("diff", PREVIOUS, CORRECTION, "--", TASK)
before = git("show", PREVIOUS + ":" + TASK)
corrected = git("show", CORRECTION + ":" + TASK)
heading = "### 2026-10-03 — worker — scoped claim correction"
claim = corrected.split(heading, 1)[1].strip()
assert corrected.split(heading, 1)[0].rstrip() == before.replace(
    "status: evidence-needed", "status: implemented", 1).rstrip()
for phrase in ("**draw-triggered linking**", "GPU effects that consume bank words",
               "Explicit `LINK_SHADER`, program creation", "program-cache growth remain bank independent",
               "skips\nits constant upload", "subsequent draw preflight rejects it before constant\nuploads and draw calls"):
    assert phrase in claim, phrase
assert FROZEN in claim

historical = read_json(EVIDENCE / "verifier-verdict.json")
manifest = read_json(EVIDENCE / "verifier-manifest.json")
assert historical["verdict"] == manifest["verdict"] == "needs-evidence"
assert historical["frozenHead"] == FROZEN
assert historical["runtimeRefuted"] is False
assert historical["scopeOverclaimRefuted"] is True
assert digest(EVIDENCE / "verifier-verdict.json") == manifest["verdictFile"]["sha256"]
archive = EVIDENCE / manifest["archive"]["path"]
assert archive.stat().st_size == manifest["archive"]["bytes"]
assert digest(archive) == manifest["archive"]["sha256"]
assert manifest["recordedFileCount"] == len(manifest["members"]) == 67

checked_members = []
for member in manifest["members"]:
    path = RECORDS / member["path"]
    assert path.stat().st_size == member["bytes"], str(path)
    assert digest(path) == member["sha256"], str(path)
    checked_members.append(member)
for prediction in historical["predictions"]:
    assert digest(RECORDS / prediction["record"]) == prediction["sha256"]
promoted = ROOT / historical["promotedTest"]["path"]
assert digest(promoted) == historical["promotedTest"]["sha256"]

scope_reports = []
for relative, expected_digest in (
    ("link-scope-gpu/report.json", "b7c66f5753ccc27b274634aa36c066204fabef4b21267aa949e24c43c5450cd3"),
    ("link-scope-repeat-gpu/report.json", "e38cd3217f791caf949b9ad5ccb344534ff98f397e04998329034908f946f372"),
):
    path = RECORDS / relative
    assert digest(path) == expected_digest
    rig = read_json(path)["acceptance"]["rigs"][0]
    scope = rig["linkScope"]
    assert (scope["invalidWord"], scope["register"], scope["lane"]) == (1, 0, 3)
    assert scope["explicit"]["ok"] is True
    assert scope["explicit"]["appliedCommands"] == 1
    assert scope["before"]["budgets"]["programs"] == 1
    assert scope["afterLink"]["budgets"]["programs"] == 2
    before_sub = scope["before"]["contexts"][0]["subContexts"][0]
    after_sub = scope["afterLink"]["contexts"][0]["subContexts"][0]
    assert before_sub["bindings"]["constants"] == after_sub["bindings"]["constants"]
    assert before_sub["bindings"]["constants"][0][3] == 1
    assert [(o["handle"], o["generation"]) for o in before_sub["objects"]] == [
        (o["handle"], o["generation"]) for o in after_sub["objects"]]
    assert scope["before"]["contexts"][0]["generation"] == scope["afterLink"]["contexts"][0]["generation"]
    assert before_sub["generation"] == after_sub["generation"]
    create, link = rig["glEvents"][209], rig["glEvents"][212]
    assert (create["call"], create["id"]) == ("createProgram", "Program:22")
    assert (link["call"], link["id"], link["status"]) == ("linkProgram", "Program:22", True)
    assert scope["restored"]["ok"] is True
    restore_calls = [e["call"] for e in scope["restorationEvents"]]
    assert restore_calls == ["bindVertexArray", "bindFramebuffer", "useProgram"]
    rejected = [s for s in rig["submissions"] if s["label"] == "probe invalid copied bank after new link"]
    assert len(rejected) == 1
    rejected = rejected[0]
    assert rejected["result"]["ok"] is False
    assert rejected["result"]["error"]["code"] == "constant-raster-domain-error"
    assert rejected["result"]["appliedCommands"] == 0
    assert rejected["eventsStart"] == rejected["eventsEnd"] == 234
    assert scope["pixelsBefore"] == scope["pixelsAfter"]
    assert len(scope["pixelsBefore"]) == 16384
    assert not rig["oracleStops"]
    assert not [e for e in rig["glEvents"] if e["call"] == "domainOracleStop"]
    scope_reports.append({**binding(path), "copiedWord": "0x00000001", "register": 0,
                          "lane": 3, "explicitLinkAppliedCommands": 1,
                          "programCounts": [1, 2], "createEvent": 209, "linkEvent": 212,
                          "program": "Program:22", "restorationCalls": restore_calls,
                          "copiedBankUploadsDuringRestoration": 0,
                          "drawRejection": rejected["result"], "drawEvents": [234, 234],
                          "pixelsCompared": 16384, "pixelsUnchanged": True,
                          "heldGenerationsUnchanged": True, "unsafeGpuCalled": False,
                          "scopeLine": 184124, "linkLine": 14747,
                          "explicitLine": 185745, "restorationLine": 185955})

frozen_runtime_changes = git("diff", "--name-only", FROZEN, CORRECTION,
                             "--", "renderer", "tools", "Makefile", "package.json", "package-lock.json").splitlines()
assert frozen_runtime_changes == [historical["promotedTest"]["path"]], frozen_runtime_changes
pins = []
for name in ("manifest.json", "worker.tar.gz", "cold.tar.gz", "worker-receipt.json", "cold-receipt.json",
             "cold-report.json", "verifier.tar.gz", "verifier-manifest.json", "verifier-verdict.json"):
    path = EVIDENCE / name
    assert path.read_bytes() == subprocess.check_output(
        ["git", "show", PREVIOUS + ":evidence/virgl-raster-bank/" + name], cwd=ROOT)
    pins.append(binding(path))

result = {
    "schema": "raster-bank-verifier-incremental-audit-v1", "task": "E6-T12f4b",
    "verdict": "verified", "previousVerifierHead": PREVIOUS,
    "correctionHead": CORRECTION, "frozenHead": FROZEN,
    "changedFiles": changes, "correctionDiff": correction_diff,
    "correctedClaim": claim,
    "incrementalPredictions": [{"id": k, "outcome": "HELD"} for k in ("C1", "C2", "C3", "C4")],
    "scopeReports": scope_reports, "historicalMemberCount": len(checked_members),
    "historicalMemberDigestsUnchanged": True, "evidencePins": pins,
    "priorHeldCarriedForward": [p["id"] for p in historical["predictions"] if p["outcome"] == "HELD"],
    "P3Correction": "HELD: exact written demand satisfied; guarded domain/upload/draw observations carried unchanged",
    "historicalOverclaimPreserved": True,
    "coverageHunksCarriedForward": 54, "runtimeOrHarnessChanged": False,
    "runtimeReruns": 0, "newColdClone": False,
    "promotedTest": binding(promoted),
}
print(json.dumps(result, indent=2) + "\n", end="")
