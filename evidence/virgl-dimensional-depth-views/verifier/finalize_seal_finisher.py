"""Bind the successful independent reopening and peer custody to the final manifest."""
import hashlib
import json
import pathlib

out = pathlib.Path(__file__).resolve().parent
sha = lambda body: hashlib.sha256(body).hexdigest()
written = json.loads((out / "seal-write.json").read_bytes())
reopened = json.loads((out / "seal-reopen.json").read_bytes())
assert reopened["status"] == "passed" and reopened["gzipTrailerValidated"]
assert reopened["inputManifestSha256"] == sha((out / "seal-write.json").read_bytes())
for key in ["recordIndexSha256", "archiveSha256", "archiveBytes", "uniqueCompleteBodies", "deduplicatedHardlinks", "logicalBytes"]:
    assert reopened[key] == written[key]
assert reopened["reopenedMembers"] == written["records"]
verdict_raw = (out / "verdict.json").read_bytes()
verdict = json.loads(verdict_raw)
assert verdict["verdict"] == "verified" and not verdict["findings"]
for name, pin in verdict["proofPins"].items():
    body = (out / name).read_bytes()
    assert sha(body) == pin["sha256"] and len(body) == pin["bytes"]
peers = {}
for name in ["seal_verifier.py", "reopen_verifier.py", "finalize_seal.py", "reopen_verifier_finisher.py", "finalize_seal_finisher.py", "sealing-adjustment.json", "seal-write.json", "seal-write.log", "seal-reopen.json", "seal-reopen.log", "seal-reopen-finish.log"]:
    body = (out / name).read_bytes()
    peers[name] = dict(bytes=len(body), sha256=sha(body))
authentication = json.loads((out / "authentication.json").read_bytes())
manifest = dict(written)
manifest.update(schema="dimensional-depth-view-verifier-seal-v1", role="fresh-adversarial-verifier",
                runtimeFreeze=verdict["runtimeFreeze"], pristineHarnessHead=verdict["pristineHarnessHead"],
                base="bc2fb1e49575b8b1a399ca7729fcec4853a48287", verdict="verified",
                reopenedMembers=reopened["reopenedMembers"], gzipTrailerValidated=True,
                sealingPeers=peers, verdictSha256=sha(verdict_raw), proofPins=verdict["proofPins"],
                authenticationSha256=sha((out / "authentication.json").read_bytes()),
                completeFreshOriginalQueueRuns=verdict["completeFreshOriginalQueueRuns"],
                novelAndPromotedCases=verdict["novelAndPromotedCases"],
                finestCoverage=verdict["finestCoverage"], productionAuthority=False,
                actualLinuxGuest=False, performanceClaim=False)
raw = (json.dumps(manifest, indent=2) + "\n").encode()
(out / "manifest.json").write_bytes(raw)
print(json.dumps(dict(manifestSha256=sha(raw), indexSha256=written["recordIndexSha256"],
                      archiveSha256=written["archiveSha256"], members=written["records"],
                      archiveBytes=written["archiveBytes"], parts=len(written["archiveParts"]))))
