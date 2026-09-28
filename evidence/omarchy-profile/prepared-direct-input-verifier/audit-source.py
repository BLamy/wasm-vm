"""Frozen AK source/evidence check. No build, browser, guest, or network."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
HEAD = "9cc377180921be98f904c3689a1d7c48b9df3947"
ENV = {**os.environ, "DEVELOPER_DIR": "/Library/Developer/CommandLineTools"}
sha = lambda b: hashlib.sha256(b).hexdigest()
def git(*args): return subprocess.check_output(["git", *args], cwd=ROOT, env=ENV)
def read(rel): return (ROOT / rel).read_bytes()

gates = "evidence/omarchy-profile/prepared-direct-input-gates/"
freeze = json.loads(read(gates + "frozen.json"))
assert freeze["head"] == HEAD
assert git("diff", "--name-only", "27eab37c", HEAD, "--", "crates", "web", "Cargo.toml", "Cargo.lock") == b""
assert git("diff", "--name-only", HEAD, "--", "crates", "web", "Cargo.toml", "Cargo.lock") == b""
seen = set()
def visit(rel):
    if rel in seen: return
    seen.add(rel)
    data = read(rel)
    assert data == git("show", HEAD + ":" + rel), rel
    specs = re.findall(r'(?:from\s*|import\s*)[\'\"]([^\'\"]+)[\'\"]', data.decode())
    dynamic = re.findall(r'import\(\s*[\'\"]([^\'\"]+)[\'\"]', data.decode())
    for spec in dynamic:
        if rel == "tools/verify/omarchy-failure-checkpoint.mjs" and spec == "./pkg/wasm_vm_wasm.js":
            # This literal occurs inside a CDP Runtime.evaluate expression,
            # relative to the browser page, not this Node module. Failure
            # checkpoint is disabled; served runtime bytes are audited separately.
            continue
        specs.append(spec)
    for spec in specs:
        if not spec.startswith('.') or 'node_modules' in spec: continue
        visit(str(((ROOT / rel).parent / spec).resolve().relative_to(ROOT)))
for entry in ["tools/verify/omarchy-prepared-direct-input.mjs", "tools/verify/omarchy-desktop-live.mjs"]:
    visit(entry)
assert seen == {row["path"] for row in freeze["files"]}, (seen, freeze["files"])
for row in freeze["files"]: assert sha(read(row["path"])) == row["sha256"], row

carried = []
for rel in ["tools/verify/omarchy-latency-receipt.mjs", "web/guest-rpc.js", "web/src/input/keymap.js",
            "tools/verify/omarchy-worker-cost-capture.mjs", "tools/verify/omarchy-owned-trial.mjs",
            "tools/verify/omarchy-input-trial.mjs", "tools/verify/omarchy-browser-session.mjs"]:
    data = read(rel)
    assert data == git("show", "141bdd5a:" + rel)
    carried.append({"path": rel, "sha256": sha(data)})
old_audit = git("show", "141bdd5a:tools/verify/omarchy-input-audit.mjs").decode()
new_audit = old_audit.replace('import { physicalStroke } from "./omarchy-browser-session.mjs";',
    'import { physicalStroke } from "./omarchy-browser-session.mjs";\nimport { assertPreparedDirectSource } from "./omarchy-prepared-direct-state.mjs";')
new_audit = new_audit.replace('startupCommands = [] }) {', 'startupCommands = [], preparedDirect = false }) {\n  assert.equal(typeof preparedDirect, "boolean");\n  assert.equal(report.preparedDirectRequested === true, preparedDirect);')
new_audit = new_audit.replace('  assertInputTrialSource(report.candidate.source);',
    '  if (preparedDirect) assertPreparedDirectSource(report.candidate.source);\n  else assertInputTrialSource(report.candidate.source);')
assert read("tools/verify/omarchy-input-audit.mjs").decode() == new_audit

seal_path = gates + "sha256.txt"
assert sha(read(seal_path)) == "0713fe766d9d9b9aa6baeaa859c4e574b27b1b861e79f4c32cf3f7f234154c37"
sealed = []
for line in read(seal_path).decode().splitlines():
    want, rel = line.split("  ", 1)
    assert sha(read(rel)) == want, rel
    sealed.append({"path": rel, "sha256": want})
assert len(sealed) == 16
commands = json.loads(read(gates + "commands.json"))
assert commands["head"] == HEAD and commands["allPassed"] is True
assert all(row["code"] == 0 for row in commands["commands"])
log = read(gates + "affected-harness.log").decode()
for text in ["tests 73", "pass 73", "fail 0", "skipped 0"]: assert text in log
for rel in [gates + "freeze.py", gates + "record.py"]:
    assert read(rel) == git("show", HEAD + ":" + rel)
run = json.loads(read("evidence/omarchy-profile/prepared-direct-input-r1/run.json"))
assert freeze["frozenAt"] < run["startedAt"]
assert commands["commands"][-1]["finishedAt"] <= freeze["frozenAt"]
result = {"head": HEAD, "sourceFilesChecked": len(seen), "files": freeze["files"],
          "freezeSha256": sha(read(gates + "frozen.json")), "frozenAt": freeze["frozenAt"],
          "actualRunStartedAt": run["startedAt"], "frozenBeforeLaunch": True,
          "runtimeUnchangedFromAL": True, "unchangedAIHelpers": carried,
          "inputAuditorChange": "Exactly one added import, trusted prepared flag validation, and fixed source-validator branch; all existing physical/nonce/deadline audit statements are byte-for-byte carried.",
          "sourceEnvironment": "Actual source creates a new ephemeral browser context, blocks service workers, supplies no saved storage state, and serves the pinned local prepared pair. CPU profiler helper is in the checked closure; profiling was not requested.",
          "workerSealSha256": sha(read(seal_path)), "sealedFiles": sealed,
          "affectedTests": 73, "syntaxChecks": 2}
(OUT / "source-audit.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({"sourceFiles": len(seen), "workerSealFiles": len(sealed), "unchangedAIHelpers": len(carried),
                  "runtimeUnchanged": True, "inputAuditorDeltaExact": True, "frozenBeforeLaunch": True}))
