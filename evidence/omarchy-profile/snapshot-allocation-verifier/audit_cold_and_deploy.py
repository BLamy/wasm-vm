#!/usr/bin/env python3
"""Audit final-head cold-build and deployment receipts without rerunning either."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
from urllib.parse import urlparse

here = Path(__file__).resolve().parent
repo = here.parents[2]
gates = repo / "evidence/omarchy-profile/snapshot-allocation-gates"
env = dict(os.environ, DEVELOPER_DIR="/Library/Developer/CommandLineTools")
head = "bb3c13dd6014ca15f29fe897b3ba207d65bc67b8"
source_head = "512ba6acc9b0293d04d96115372ddef2b1cccfab"
files = {}

def read(path):
    data = path.read_bytes()
    files[str(path.relative_to(repo))] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    return data

def at_head(path, revision=head):
    return subprocess.check_output(["git", "show", f"{revision}:{path}"], cwd=repo, env=env)

closure = json.loads(read(gates / "source-closure.json"))
assert closure["sourceHead"] == source_head and closure["artifactHead"] == head
assert not closure["desktopResponsive"]
for item in closure["files"]:
    path = item["path"]
    data = at_head(path)
    assert data == at_head(path, source_head) == (repo / path).read_bytes()
    assert hashlib.sha256(data).hexdigest() == item["sha256"]
changed = subprocess.check_output(["git", "diff", "--name-only", source_head, head], cwd=repo, env=env, text=True).splitlines()
assert set(changed) == {"web/dist/artifacts.json", "web/dist/artifacts-alpine.json", "web/dist/artifacts-node-alpine.json", "web/dist/artifacts-omarchy.json"}
for name in changed:
    before, after = json.loads(at_head(name, source_head)), json.loads(at_head(name))
    for key in before["artifacts"]:
        assert before["artifacts"][key]["sha256"] == after["artifacts"][key]["sha256"]
        assert before["artifacts"][key]["size"] == after["artifacts"][key]["size"]
        before["artifacts"][key]["url"] = after["artifacts"][key]["url"]
    assert before == after
cold = json.loads(read(gates / "cold/report.json"))
browser = json.loads(read(gates / "cold/browser/report.json"))
oracle = json.loads(read(here / "r3-byte-oracle.json"))
assert cold["passed"] and cold["pristineBeforeBuild"] and cold["head"] == browser["head"] == head
assert cold["committedWasm"] == cold["rebuiltWasm"] == "8230800b2ed4fe92ed0647d871d6c548fe824f3a550b09ca4a9b4941bc220ca4"
for command in cold["commands"]:
    assert command["code"] == 0
    read(gates / "cold" / (command["label"] + ".log"))
assert browser["passed"] and browser["errors"] == []
for name, count in [("firstHash", "1"), ("secondHash", "2"), ("storedHash", "2"), ("thirdHash", "3")]:
    assert browser["snapshot"][name] == oracle["expectedFullBlobSha256ByRestoreCount"][count]
for name, expected in browser["source"].items():
    data = at_head(name)
    assert expected == {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
assert browser["suite"] == {"metric-pass": "127", "metric-fail": "0", "metric-done": "127"}
assert hashlib.sha256(read(gates / "cold/browser/suite.png")).hexdigest() == browser["suiteScreenshot"]
public = json.loads(read(gates / "public.json"))
assert public["head"] == head and public["passed"]
assert set(public["origins"]) == {"https://46ecc765.wasm-vm.pages.dev", "https://wasm-vm.pages.dev"}
assert len(public["files"]) == 8
for item in public["files"]:
    parsed = urlparse(item["url"])
    assert "https://" + parsed.netloc in public["origins"]
    data = at_head("web/dist" + parsed.path)
    assert len(data) == item["bytes"] and hashlib.sha256(data).hexdigest() == item["sha256"]
deploy = read(gates / "deploy.log").decode()
assert "https://46ecc765.wasm-vm.pages.dev" in deploy
report = {"auditedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
          "sourceHead": source_head, "artifactHead": head, "unchangedRuntimeClosure": True,
          "metadataOnlyChanges": changed, "coldClonePassed": True,
          "coldSuiteVisuallyInspected": True, "bothDeploymentOriginsMatchFinalHead": True,
          "desktopResponsive": False, "pending": ["broad gauntlet classification", "worker submission seal"], "files": files}
(here / "cold-deploy-audit.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({k: v for k, v in report.items() if k != "files"}, indent=2))
