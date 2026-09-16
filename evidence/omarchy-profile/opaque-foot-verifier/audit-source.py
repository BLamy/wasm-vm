"""Read-only exact-head/unchanged-runtime audit; no builds or guest launches."""
import hashlib
import json
import pathlib
import subprocess
import sys

repo = pathlib.Path(__file__).resolve().parents[3]
out = pathlib.Path(__file__).resolve().parent
head = sys.argv[1] if len(sys.argv) > 1 else "94647c4993b062961b26e82bc2c8484431fe8c05"
gates = sys.argv[2] if len(sys.argv) > 2 else "opaque-foot-gates"
parent = "53103e762c6c4003a5976bfa90131a03702fd2e7"
sha = lambda b: hashlib.sha256(b).hexdigest()

def git(*args):
    return subprocess.check_output(["git", *args], cwd=repo)

assert git("diff", "--name-only", f"{parent}..{head}", "--", "crates", "web") == b""
freeze_path = repo / "evidence/omarchy-profile" / gates / "frozen.json"
freeze = json.loads(freeze_path.read_bytes())
assert freeze["head"] == head
checked = []
for row in freeze["files"]:
    rel = row["path"]
    data = (repo / rel).read_bytes()
    expected = git("show", f"{head}:{rel}")
    assert data == expected, rel
    assert sha(data) == row["sha256"], rel
    checked.append({"path": rel, "bytes": len(data), "sha256": sha(data)})

dependencies = []
for rel in ["tools/verify/omarchy-latency-receipt.mjs", "web/guest-rpc.js", "web/src/input/keymap.js"]:
    data = (repo / rel).read_bytes()
    assert data == git("show", f"{head}:{rel}"), rel
    assert data == git("show", f"40fdbe91:{rel}"), rel
    dependencies.append({"path": rel, "bytes": len(data), "sha256": sha(data)})

prior = repo / "evidence/omarchy-profile/fp-division-r1"
index = (prior / "sha256.txt").read_bytes()
assert sha(index) == "da8b6685880651034ec46f81a030ba2dcb516d8c1eb5fba551bb7158829e902a"
entries = []
for line in index.decode().splitlines():
    digest, rel = line.split("  ", 1)
    assert sha((prior / rel).read_bytes()) == digest, rel
    entries.append(rel)
assert len(entries) == 69

result = {"head": head, "verifiedParent": parent, "cratesAndWebTreeUnchanged": True,
          "freezeSha256": sha(freeze_path.read_bytes()), "files": checked,
          "unchangedAuditDependencies": dependencies,
          "carriedPriorEvidence": {"indexSha256": sha(index), "verifiedFiles": len(entries)},
          "note": "Carries unchanged verified runtime, cold-clone and deployment evidence; no new deployment claim."}
(out / "source-audit.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({"sourceFilesVerified": len(checked), "auditDependenciesVerified": len(dependencies),
                  "runtimeTreeUnchanged": True, "priorEvidenceFilesRehashed": len(entries)}))
