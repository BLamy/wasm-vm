#!/usr/bin/env python3
"""Read-only audit of source, captures, exact payloads, and the failed input trial."""
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess

repo = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
worker = repo / "evidence/omarchy-profile/fp-memory-r1"
runtime_head = "7048847fb542d66618b836b965b94c8c9db771d5"
env = dict(os.environ, DEVELOPER_DIR="/Library/Developer/CommandLineTools")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(["git", *args], cwd=repo, env=env)


def read(name):
    return json.loads((worker / name).read_text())


head = git("rev-parse", "HEAD").decode().strip()
runtime_paths = [
    "crates/core/src/hart/mod.rs",
    "crates/core/src/hart/fregs.rs",
    "crates/core/src/jit.rs",
    "crates/jit-translate/src/lib.rs",
    "crates/jit-runtime/src/lib.rs",
    "crates/wasm/src/jit_browser.rs",
    "web/dist/pkg/wasm_vm_wasm_bg.wasm",
]
sources = {}
for name in runtime_paths:
    current = (repo / name).read_bytes()
    frozen = git("show", f"{runtime_head}:{name}")
    assert current == frozen, f"runtime changed since recorded freeze: {name}"
    sources[name] = {"sha256": sha(current), "sameAsRuntimeFreeze": True}

browser = read("browser/report.json")
assert browser["head"] == runtime_head
assert browser["passed"] and browser["errors"] == []
assert browser["wasmSha256"] == sources[runtime_paths[-1]]["sha256"]
assert browser["elfSha256"] == sha((worker / "browser/fp-memory.elf").read_bytes())
for filename, expected in [
    ("browser/suite.png", browser["suiteScreenshotSha256"]),
    ("browser/built-page.png", browser["screenshotSha256"]),
    ("browser/capability-inspection.png", browser["capabilityInspection"]["sha256"]),
]:
    assert sha((worker / filename).read_bytes()) == expected, filename
assert browser["suite"] == {"metric-pass": "127", "metric-fail": "0", "metric-done": "127"}
assert browser["capability"] == "Floating-point memory transfers2/2 passing · live in browser"
oracle, compiled = browser["runs"]
assert not oracle["jit"] and compiled["jit"]
assert oracle["registers"] == compiled["registers"]
assert oracle["stats"] == compiled["stats"]
assert oracle["digest"] == compiled["digest"]
assert compiled["stats"]["retired"] == 4000
assert int(compiled["jitStats"]["retiredViaJit"]) == 3617
assert compiled["registers"][8:13] == ["ffffffff7fa12345", "ffa67890", "ffffffff7fa12345", "9", "7"]
assert int(compiled["registers"][13], 16) & 0x8000000000006000 == 0x8000000000006000

physical = read("physical-input/desktop/report.json")
assert physical["trial"]["head"] == runtime_head
assert physical["trial"]["scopedStatus"] == ""
assert physical["errors"] == [] and physical["cleanup"]["closed"]
assert physical["result"] == "failed" and physical["classification"] == "UNPROVEN"
assert physical["trial"]["outcome"] == "nonce-readback-failed"
assert physical["keyboard"]["readbackTimeoutMs"] == 120000
assert physical["keyboard"]["deadlineMs"] == 120000
assert physical["keyboard"]["verified"] is False
assert len(physical["inputEvents"]) == 128
assert all(event["trusted"] for event in physical["inputEvents"])
assert "testHooks" not in physical["url"] and "e2eShowall" not in physical["url"]
assert physical["trial"]["presentationBaseline"]["framesReceived"] == 2
presentations = {
    row["runtime"]["label"]: row["runtime"]["presentation"]["framesReceived"]
    for row in physical["observations"]
    if "runtime" in row
}
assert presentations == {"physical-keyboard-before": 2, "input-trial-failure": 2}
deadline = datetime.fromisoformat(physical["keyboard"]["deadlineAt"].replace("Z", "+00:00"))
failed = datetime.fromisoformat(physical["keyboard"]["failedAt"].replace("Z", "+00:00"))
assert (failed - deadline).total_seconds() == 0.001
shot = next(row for row in physical["observations"] if row.get("screenshot", "").endswith("failure.png"))
assert sha((worker / "physical-input/desktop/failure.png").read_bytes()) == shot["sha256"]
for filename, expected in physical["trial"]["helpers"].items():
    assert sha((repo / filename).read_bytes()) == expected["sha256"], filename

sabotage = json.loads((out / "sabotage.json").read_text())
assert sabotage["returncode"] == 101
assert sabotage["expectedAssertionObserved"] and sabotage["failedTestObserved"]
assert sabotage["runtimeBefore"] == sabotage["runtimeAfter"]
original_seed = (repo / "tests/support/jit_fp_memory_verifier.rs").read_text().split("pub fn seeded_raw_aliases", 1)[1].split("pub fn compressed_maxima", 1)[0]
copied_seed = (out / "sabotaged-proof.rs").read_text().split("pub fn seeded_raw_aliases", 1)[1].split("pub fn compressed_maxima", 1)[0]
assert copied_seed.replace('boxed ^ 1,\n                "VERIFIER_SEEDED_RAW_PAYLOAD"', 'boxed,\n                "VERIFIER_SEEDED_RAW_PAYLOAD"') == original_seed

index = (worker / "sha256.txt").read_bytes()
assert sha(index) == "1edaa4b1b6d39474962e082ff4255f68b407e5cf55fa52194c28886027e4b822"
indexed = []
for line in index.decode().splitlines():
    expected, name = line.split("  ", 1)
    assert sha((worker / name).read_bytes()) == expected, name
    indexed.append(name)
assert len(indexed) == 54
submission = read("submission.json")
assert submission["runtimeHead"] == runtime_head
assert submission["runtimeWasmSha256"] == browser["wasmSha256"]
assert submission["focusedAcceptancePassed"] and submission["coldClonePassed"]
assert submission["publicBytesMatched"] and submission["desktopResponsive"] is False
assert submission["broadCiPassed"] is False and submission["affectedCommandsPassed"] is False
affected = read("affected-commands.json")
assert [(row["label"], row["code"]) for row in affected["commands"] if row["code"]] == [("hazards", 1)]
assert affected["head"] == "a593f942a004ee43c1bf5b4c84eeb22522eeeb16"
cold = read("cold/report.json")
assert cold["passed"] and cold["pristineBeforeBuild"]
assert all(row["code"] == 0 for row in cold["commands"])
assert cold["head"] == affected["head"]
assert cold["committedWasmSha256"] == cold["rebuiltWasmSha256"] == browser["wasmSha256"]
assert git("-C", cold["clone"], "rev-parse", "HEAD").decode().strip() == cold["head"]
for name in runtime_paths + ["tests/support/jit_fp_memory_verifier.rs"]:
    assert (Path(cold["clone"]) / name).read_bytes() == (repo / name).read_bytes(), name
for directory in ["acceptance-browser", "cold/browser"]:
    report = read(f"{directory}/report.json")
    assert report["head"] == affected["head"]
    assert report["passed"] and report["errors"] == []
    assert report["suite"] == browser["suite"]
    assert report["wasmSha256"] == browser["wasmSha256"]
    assert report["elfSha256"] == browser["elfSha256"]
    assert report["runs"][0]["digest"] == report["runs"][1]["digest"] == compiled["digest"]
    assert report["runs"][0]["registers"] == report["runs"][1]["registers"] == compiled["registers"]
    for filename, expected in [
        ("suite.png", report["suiteScreenshotSha256"]),
        ("built-page.png", report["screenshotSha256"]),
        ("capability-inspection.png", report["capabilityInspection"]["sha256"]),
    ]:
        assert sha((worker / directory / filename).read_bytes()) == expected
public = read("cloudflare-public.json")
assert len(public) == 8
for row in public:
    name = row["url"].split(".pages.dev/", 1)[1]
    assert row["status"] == 200 and row["code"] == 0
    assert row["sha256"] == row["expectedSha256"] == sha((repo / "web/dist" / name).read_bytes())
for row in read("unchanged-gate-files.json"):
    assert sha((repo / row["path"]).read_bytes()) == row["currentSha256"] == row["baseSha256"]
    assert sha(git("show", f'{row["base"]}:{row["path"]}')) == row["baseSha256"]

files = [
    worker / "browser/report.json",
    worker / "physical-input/desktop/report.json",
    out / "native.log",
    out / "wasm.log",
    out / "sabotage.json",
    out / "sabotage.log",
    repo / "tests/support/jit_fp_memory_verifier.rs",
    repo / "crates/wasm/tests/jit_fp_memory_growth_critic.rs",
]
receipt = {
    "head": head,
    "runtimeFreeze": runtime_head,
    "workerSubmissionHead": "f95c9dac59cd489a6e3e0663bcbe15280bd30f8e",
    "workerIndexSha256": sha(index),
    "workerFilesRehashed": len(indexed),
    "finalAcceptanceHead": affected["head"],
    "coldCloneAcceptancePassed": True,
    "coldRuntimeAndCorrectedFixtureMatch": True,
    "publicArtifactsMatched": len(public),
    "unchangedGauntletExceptionsRehashed": True,
    "sources": sources,
    "files": {str(p.relative_to(repo)): sha(p.read_bytes()) for p in files},
    "browser": {
        "passed": True,
        "isaPassed": 127,
        "capabilityLive": "2/2",
        "ramSha256": compiled["digest"],
        "jitRetired": 3617,
        "totalRetired": 4000,
        "screenshotHashesMatch": True,
    },
    "physical": {
        "result": "failed",
        "trustedEvents": 128,
        "deadlineMs": 120000,
        "failedAfterDeadlineMs": 1,
        "nonceVerified": False,
        "framesBefore": 2,
        "framesAfter": 2,
        "screenshotHashMatches": True,
        "helpersUnchanged": True,
    },
    "sabotage": {
        "namedAssertionFailed": True,
        "testedSeedFunctionUnchangedInFinalFixture": True,
        "runtimeUnchanged": True,
    },
}
(out / "recordings-audit.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt, indent=2))
