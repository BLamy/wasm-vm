#!/usr/bin/env python3
"""Read-only identity checks for carried AK prerequisites; no emulator runs."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
ENV = {**os.environ, "DEVELOPER_DIR": "/Library/Developer/CommandLineTools"}


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, env=ENV)


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def seal(name, index, expected=None, commit=None, relative=False):
    path = ROOT / index
    actual = digest(path)
    if expected is not None:
        assert actual == expected, (index, actual, expected)
    if commit is not None:
        committed = hashlib.sha256(git("show", f"{commit}:{index}")).hexdigest()
        assert actual == committed, (index, actual, committed)
    files = []
    for line in path.read_text().splitlines():
        want, entry = line.split("  ", 1)
        target = (path.parent if relative else ROOT) / entry
        got = digest(target)
        assert got == want, (target, got, want)
        files.append({"path": str(target.relative_to(ROOT)), "sha256": got})
    return {"name": name, "index": index, "indexSha256": actual,
            "committedAt": commit, "filesChecked": len(files), "files": files}


seals = [
    seal("AJ worker R2", "evidence/omarchy-profile/prepared-direct-opaque-gates-r2/sha256.txt",
         "3a0f9c5dda2451270754cf3df8a23461d1710c8d95eb17376aa642d08476b1c6", "39c1441e"),
    seal("AJ independent verifier R2", "evidence/omarchy-profile/prepared-direct-opaque-verifier-r2/sha256.txt",
         commit="39c1441e"),
    seal("AL worker", "evidence/omarchy-profile/snapshot-allocation-gates/sha256.txt",
         "01786a6b6a15415c7977b4dc23fde07a2e1d82cb1b775340aefe8c888cb42632", "27eab37c"),
    seal("AL independent verifier", "evidence/omarchy-profile/snapshot-allocation-verifier/sha256.txt",
         "beb56a096ced5f60cbac0c5b1c3d0304046addf599011be2f3812935944a496f", "27eab37c"),
    seal("AI independent verifier", "evidence/omarchy-profile/direct-opaque-verifier/sha256.txt",
         "e98b479dc9d9dd6b1cc38cbb3fb936d92aae36967bef3716e55cd62422d6446c", relative=True),
    seal("AI carried physical auditor and input fence", "evidence/omarchy-profile/opaque-foot-verifier/sha256.txt",
         "2e3a3b3be066c3dff0b6fbb3754560a20289bfe6e2bd2fe1bb1651ef91e3b175", relative=True),
]

files = []
for rel, size, want in [
    ("target/omarchy-direct-opaque-r2/omarchy-ready.snap.gz", 207172408,
     "989dff1cad261ab6e53e1dea8f57cb12866d2a236b5366f114102744553d4e75"),
    ("target/omarchy-direct-opaque-r2/omarchy-overlay-delta.bin.gz", 1232847,
     "4fde816771e4fcfe085b492b6321302e945c58145c5c16f0c91e02ac94d10972"),
    ("releases/kernel/6.6.63/Image", 24208896,
     "af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce"),
    ("target/omarchy-profile-chunks-sdr-r3-256k/manifest.json", 1097812,
     "5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44"),
]:
    path = ROOT / rel
    got = digest(path)
    assert got == want and path.stat().st_size == size, (rel, got, path.stat().st_size)
    files.append({"path": rel, "bytes": size, "sha256": got})

al_closure = json.loads((ROOT / "evidence/omarchy-profile/snapshot-allocation-gates/source-closure.json").read_text())
for item in al_closure["files"]:
    assert digest(ROOT / item["path"]) == item["sha256"], item
runtime_diff = git("diff", "--name-only", "27eab37c", "--", "crates", "web", "Cargo.toml", "Cargo.lock").decode()
assert not runtime_diff, runtime_diff

result = {
    "headAtCheck": git("rev-parse", "HEAD").decode().strip(),
    "scope": "Carried prerequisite identity only. AK implementation and guest responsiveness are not yet verified.",
    "seals": seals,
    "pairAndBase": files,
    "alClosureFiles": al_closure["files"],
    "runtimeDiffAgainst27eab37c": runtime_diff,
    "carried": "AJ independently parsed the entire coherent full-RAM/delta pair. Matching compressed bytes carry that proof; no redundant decompression or guest run is needed. AL runtime, cold-clone, and deployment proofs carry by identical bytes. AI physical-auditor/fence evidence is unchanged; AK auditor deltas still require fresh review."
}
(OUT / "prerequisites.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({"seals": [{"name": x["name"], "files": x["filesChecked"], "indexSha256": x["indexSha256"]} for x in seals], "pairAndBase": files, "runtimeUnchanged": True}, indent=2))
