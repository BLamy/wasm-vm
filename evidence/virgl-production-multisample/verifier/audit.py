#!/usr/bin/env python3
"""Authenticate D67 worker/critic recordings and carry unchanged runtime proof."""
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
BASE = ROOT / "target/evidence"
HEAD = "3bb4ba9b93f19165cf61d4c2cea82f128430e1a6"

def sha(data):
    return hashlib.sha256(data).hexdigest()

def load(path):
    return json.loads(path.read_text())

seal = load(ROOT / "evidence/virgl-production-multisample/worker/exact-head-submission-and-cold.json")
assert seal["runtimeHead"] == HEAD
archive = ROOT / seal["archive"]["path"]
assert sha(archive.read_bytes()) == seal["archive"]["sha256"]
with tarfile.open(archive) as packed:
    for entry in seal["files"]:
        data = packed.extractfile(entry["path"]).read()
        assert len(data) == entry["bytes"] and sha(data) == entry["sha256"], entry["path"]

names = ["production-multisample-frozen-03", "production-multisample-cold-02/multisample",
         "critic-production-multisample-final-10", "critic-production-multisample-failure-cleanup-final-04"]
reports, coverage = [], []
for name in names:
    directory = BASE / name
    report = load(directory / "report.json")
    assert report["status"] == "passed" and not any(report["browserErrors"].values())
    mismatches = []
    for source in report["sources"]:
        current = ROOT / source["path"]
        if current.exists() and sha(current.read_bytes()) != source["sha256"]:
            # Only the worker/test dispatcher was extended with the new negative mode.
            assert source["path"].startswith("tools/") or "/tests/" in source["path"], source["path"]
            mismatches.append(source["path"])
    runs = []
    for entry in report["runs"]:
        compressed = (directory / entry["path"]).read_bytes()
        raw = gzip.decompress(compressed)
        assert len(compressed) == entry["gzipBytes"] and sha(compressed) == entry["gzipSha256"]
        assert len(raw) == entry["bytes"] and sha(raw) == entry["sha256"]
        run = json.loads(raw)
        assert run["status"] == "passed"
        clean = run.get("cleaned", {})
        assert all(clean.get(key, 0) == 0 for key in ("liveObjects", "liveSyncs", "liveRenderbuffers"))
        assert run.get("liveRenderbuffers", run.get("liveOwners", 0)) == 0
        runs.append({"name": run["name"], "assertions": run["assertions"], "machineDigest": run.get("machineDigest"),
                     "recordCount": len(run.get("records", [])), "digest": entry["sha256"]})
    cov = report["browserCoverage"]
    assert sha((directory / cov["path"]).read_bytes()) == cov["sha256"]
    coverage.extend(load(directory / cov["path"])["scripts"])
    reports.append({"path": name + "/report.json", "sha256": sha((directory / "report.json").read_bytes()),
                    "head": report["head"], "testDispatcherChanges": mismatches, "runs": runs})

cold_dir = BASE / "production-multisample-cold-02"
cold = load(cold_dir / "report.json")
assert cold["head"] == HEAD and cold["status"] == "passed"
assert [item["name"] for item in cold["commands"]] == ["clone", "build", "acceptance"]
assert all(item["exitCode"] == 0 for item in cold["commands"])
assert "--no-local" in cold["commands"][0]["command"] and "--depth" not in cold["commands"][0]["command"]
for entry in cold["files"]:
    data = (cold_dir / entry["path"]).read_bytes()
    assert len(data) == entry["bytes"] and sha(data) == entry["sha256"], entry["path"]
for relative in ["demo/report.json", "numeric/numeric.json"]:
    report = load(cold_dir / relative)
    assert report["status"] == "passed"
    if relative.startswith("demo"):
        assert report["passed"] == 127 and report["failed"] == 0 and not report["errors"] and report["proofExportAbsent"]
    else:
        assert len(report["limits"]) == 29 and next(x["value"] for x in report["limits"] if x["name"] == "MAX_SAMPLES") == 4
        assert report["state"]["gpu"]["counters"]["failed"] == 0

# Every added executable JS line has a recorded V8 execution. This is a line
# sufficiency check; independent pixel/queue/failure assertions decide semantics.
paths = ["renderer/virgl-command/" + name for name in
         ("multisample.mjs", "production.mjs", "resources.mjs", "state.mjs", "decoder.mjs")]
line_audit = []
for path in paths:
    source = (ROOT / path).read_text()
    scripts = [s for s in coverage if s["source"] == path and s["sourceBody"] == source]
    assert scripts, path
    diff = subprocess.check_output(["git", "diff", "--unified=0", "8f502340", HEAD, "--", path], cwd=ROOT, text=True)
    added, line = [], 0
    for text in diff.splitlines():
        if text.startswith("@@"):
            line = int(re.search(r"\+(\d+)", text).group(1))
        elif text.startswith("+++"):
            pass
        elif text.startswith("+"):
            added.append(line); line += 1
        elif text.startswith(" "):
            line += 1
    lines = source.splitlines(keepends=True)
    offsets = [0]
    for text in lines:
        offsets.append(offsets[-1] + len(text.encode("utf-16-le")) // 2)
    checked = []
    for number in added:
        text = lines[number-1].strip()
        if not text or text.startswith(("//", "/**", "*", "import")):
            continue
        point = offsets[number-1] + len(lines[number-1]) - len(lines[number-1].lstrip())
        counts = []
        for script in scripts:
            ranges = [r for f in script["coverage"]["functions"] for r in f["ranges"]
                      if r["startOffset"] <= point < r["endOffset"]]
            if ranges:
                counts.append(min(ranges, key=lambda r: r["endOffset"]-r["startOffset"])["count"])
        assert counts and max(counts) > 0, (path, number, text)
        checked.append(number)
    line_audit.append({"path": path, "sha256": sha((ROOT/path).read_bytes()), "executedAddedLines": checked})

sabotage_dir = BASE / "critic-production-multisample-sabotage-01"
sabotage = load(sabotage_dir / "report.json")
assert sabotage["status"] == "failed" and sabotage["sabotage"]["kind"] == "skip-resolve"
assert "expected \"[255,0,255,255]\", got \"[0,0,0,0]\"" in str(sabotage["result"])
result = {"task": "E6-T11d67", "runtimeHead": HEAD, "status": "held", "authenticatedWorkerFiles": len(seal["files"]),
          "authenticatedColdFiles": len(cold["files"]), "reports": reports, "lineCoverage": line_audit,
          "sabotage": {"path": str(sabotage_dir.relative_to(ROOT)/"report.json"), "sha256": sha((sabotage_dir/"report.json").read_bytes()),
                       "observed": "Skipping only the native original BLIT fails first literal clear pixel: zero instead of magenta."},
          "waivers": ["Comments/imports/metadata serialize existing reviewed types; no native effects.",
                      "Generated web/renderer copies have the same source hashes as reviewed modules; built default bundle and cold demo prove dispatch.",
                      "Rust native sample cost/transfer guards, host floor and capset masks execute in cold native tests and the original-MMIO critic/C ABI oracle.",
                      "Pinned guest Mesa attachment-only change executes through all 15 required real renderbuffer allocations and the actual Mesa clear/BLIT/readPixels; texture-MS remains disabled.",
                      "CSR-stub exclusions and reserved-section enum correction are test harness fixes; default architectural tests continue in the prescribed gauntlet.",
                      "Documentation and roadmap status text are configuration; default demo127/0 and cold documentation corpus build prove generated files."]}
(OUT/"final-audit.json").write_text(json.dumps(result, indent=2)+"\n")
print(json.dumps({"status":result["status"], "workerFiles":len(seal["files"]), "coldFiles":len(cold["files"]), "recordedRuns":sum(len(r["runs"]) for r in reports), "executedAddedJsLines":sum(len(x["executedAddedLines"]) for x in line_audit)}))
