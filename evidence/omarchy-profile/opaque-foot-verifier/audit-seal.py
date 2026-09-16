"""Verify both worker seals and the scoped offline audit correction."""
import hashlib
import json
import pathlib
import subprocess

repo = pathlib.Path(__file__).resolve().parents[3]
out = pathlib.Path(__file__).resolve().parent
sha = lambda b: hashlib.sha256(b).hexdigest()
results = []
for directory, expected, count in [
    ("opaque-foot-gates", "09dde7caab1023dfe531cce991e6fe873e587d5413bee6dec98b97821b5cc432", 14),
    ("opaque-foot-gates-r2", "4d5bc22a99cf407a23ce30da34cdae4ec2033982437461d56ef4677fbb139a0a", 24),
]:
    root = repo / "evidence/omarchy-profile" / directory
    index = (root / "sha256.txt").read_bytes()
    assert sha(index) == expected
    rows = index.decode().splitlines()
    assert len(rows) == count
    for line in rows:
        digest, rel = line.split("  ", 1)
        assert sha((root / rel).read_bytes()) == digest, rel
    results.append({"directory": directory, "indexSha256": expected, "filesVerified": count})

claim_path = repo / "evidence/omarchy-profile/opaque-foot-gates-r2/worker-claim.json"
claim = json.loads(claim_path.read_bytes())
assert claim["desktopSolved"] is False and claim["releaseEligible"] is False
correction = "ed7edad7e1bdfa627809c93dc11a4838311180b5"
changed = subprocess.check_output(["git", "diff", "--name-only", f"20737fb7..{correction}"], cwd=repo).decode().splitlines()
assert changed == ["tools/verify/omarchy-input-audit.mjs", "tools/verify/omarchy-opaque-foot.test.mjs"]
for rel, digest in claim["auditCorrectionFiles"].items():
    data = (repo / rel).read_bytes()
    assert sha(data) == digest
    assert data == subprocess.check_output(["git", "show", f"{correction}:{rel}"], cwd=repo)
assert json.loads((out / "input-audit-test.json").read_bytes())["missingPhysicalAttack"]["acceptedAsMachine"] is True
assert json.loads((out / "input-audit-fixed.json").read_bytes())["missingPhysicalAttack"]["acceptedAsMachine"] is False
assert (out / "input-audit-test.json").read_bytes() == (out / "input-audit-test-before-correction.json").read_bytes()
assert (out / "input-audit-recheck.log").read_bytes() == (out / "input-audit-recheck-before-correction.log").read_bytes()
result = {"workerSeals": results, "workerClaimSha256": sha(claim_path.read_bytes()),
          "auditCorrectionHead": correction, "onlyAuditorAndTestsChanged": True,
          "originalReproductionsPreserved": True, "fixedAttackRejected": True,
          "desktopSolved": False, "releaseEligible": False}
(out / "seal-audit.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2))
