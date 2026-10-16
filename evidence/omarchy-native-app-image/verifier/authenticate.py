#!/usr/bin/env python3
"""Reopen the scoped T05b worker/verifier capsules without scratch inputs.

Large image/assembly streaming checks are authenticated recorded observations;
this script does not recreate deleted duplicate outputs or launch applications.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[3]
SOURCE = "2f27c1d8efb734ce115b1a7f07840c456916d816"
WORKER_PIN = "0bae80d9170bcb55d110b861aa7e6818bd9ad51e618f00a1334b290319485195"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def reopen(path, expected=None):
    raw = path.read_bytes()
    if expected:
        assert sha(raw) == expected, path
    with tarfile.open(path, "r:gz") as archive:
        members = archive.getmembers()
        names = [member.name for member in members]
        assert len(names) == len(set(names))
        assert all(member.isfile() and not Path(member.name).is_absolute()
                   and ".." not in Path(member.name).parts for member in members)
        bodies = {member.name: archive.extractfile(member).read() for member in members}
    index = json.loads(bodies["INDEX.json"])
    assert set(bodies) == set(index) | {"INDEX.json"}
    for name, record in index.items():
        assert len(bodies[name]) == record["bytes"] and sha(bodies[name]) == record["sha256"], name
    return bodies, {"sha256": sha(raw), "bytes": len(raw), "members": len(bodies), "indexedIdentities": len(index)}


def main():
    worker, wi = reopen(ROOT / "evidence/omarchy-native-app-image/worker/submission.tar.gz", WORKER_PIN)
    assert wi["members"] == 104
    for name, body in worker.items():
        if name.startswith("source/"):
            path = name[len("source/"):]
            assert body == subprocess.check_output(["git", "show", SOURCE + ":" + path], cwd=ROOT), path
    assert worker["task.diff"] == subprocess.check_output(
        ["git", "diff", "df4cbf174b15b06736701c2088e05e9232684328", SOURCE], cwd=ROOT)
    for phase in ("main", "pristine"):
        report = json.loads(worker[phase + "/report.json"])
        assert report["head"] == SOURCE and report["status"] == "passed"
        assert len(report["commands"]) == 9
        for command in report["commands"]:
            assert command["exitCode"] == 0
            assert sha(worker[phase + "/" + command["log"]]) == command["sha256"]
        receipt = json.loads(worker[phase + "/install-receipt.json"])
        assert receipt["packageCount"] == 860 and receipt["newSignedArchives"] == 473
        assert receipt["priorityLoaderClosure"] == ["chromium", "libreoffice-fresh", "nodejs"]
        assert receipt["missingSharedLibraryRejected"] is True
        assert not receipt["desktopVerified"] and not receipt["emulatorExecutionVerified"]
        inventory = json.loads(worker[phase + "/runtime-elf.json"])
        assert len(inventory) == 6167 and all(row["machine"] == 243 for row in inventory)
        meta = json.loads(worker[phase + "/filesystem-metadata.json"])
        assert meta["status"] == "passed" and len(meta["ownership"]) == len(meta["capabilities"]) == 7
    for name in ("package-selection.json", "runtime-elf.json", "assembly.json", "install-receipt.json"):
        assert worker["main/" + name] == worker["pristine/" + name]
    review_path = Path(__file__).with_name("review.tar.gz")
    receipt = json.loads(Path(__file__).with_name("review.json").read_text())
    review, ri = reopen(review_path, receipt["sha256"])
    assert ri["members"] == receipt["members"]
    predictions = json.loads(review["final-predictions.json"])
    assert predictions["source"] == SOURCE and predictions["verdict"] == "verified"
    assert len(predictions["predictions"]) == 12 and all(row["result"] == "HELD" for row in predictions["predictions"])
    for name, pin in (("image-chunks-readonly.json", "c48b9c50382d69b1eb5211290fe479256ab02200dee5713d0f006a3a0577c38b"),
                      ("pristine-image-chunks-readonly.json", "1935883e5851c6f0a9a2de59cf4c3cefded9d4a046650338f1e85279f699e56e")):
        observation = json.loads(review[name])
        assert observation["status"] == "passed" and observation["imageSha256"] == pin
        assert observation["imageBytes"] == 12884901888 and observation["slots"] == 49152
        assert observation["uniqueChunks"] == 34787
    native = json.loads(review["signature-control01/attempt02-decoded-input/stdout"])
    healthy, changed = native["rows"]
    assert healthy["exitCode"] == 0 and "[GNUPG:] VALIDSIG " in healthy["stdout"]
    assert changed["exitCode"] == 1 and "[GNUPG:] BADSIG " in changed["stdout"]
    assert healthy["packageSha256"] == changed["packageSha256"]
    sig_a = review["signature-control01/healthy/npm-12.2.0-1-any.pkg.tar.zst.sig"]
    sig_b = review["signature-control01/changed-signature/npm-12.2.0-1-any.pkg.tar.zst.sig"]
    assert len(sig_a) == len(sig_b) == 566
    assert [i for i, pair in enumerate(zip(sig_a, sig_b)) if pair[0] != pair[1]] == [565]
    package = review["signature-control01/healthy/npm-12.2.0-1-any.pkg.tar.zst"]
    assert sha(package) == healthy["packageSha256"]
    assert sha(sig_a) == healthy["signatureSha256"] and sha(sig_b) == changed["signatureSha256"]
    for name, code in (("healthy-final02", 0), ("guard-removal-final02", 1)):
        row = json.loads(review[name + "/report.json"])
        assert row["exitCode"] == code and row["tests"] == 9
        assert sha(review[name + "/test_native_app_packaging_critic.py"]) == row["testSha256"]
    assert b"FAILED (failures=2)" in review["guard-removal-final02/stderr"]
    elf = json.loads(review["assembly-readonly.stdout"])
    assert elf["status"] == "passed" and elf["runtimeElfsChecked"] == 6167 and elf["allExactRiscv64"]
    metadata = json.loads(review["metadata-readonly.stdout"])
    assert metadata["status"] == "passed" and len(metadata["priorityFinalImageBodies"]) == 3
    assert metadata["allShadowEntriesLocked"] and metadata["machineIdEmpty"] and metadata["privateGpgKeyringExcluded"]
    assert json.loads(review["archive-install-scripts.stdout"])["finalCapPaths"] == 7
    print(json.dumps({"status": "passed", "source": SOURCE, "worker": wi, "verifier": ri,
                      "predictionsHeld": 12, "changedRuntime": False,
                      "scope": "signed native package and fresh image construction; no UI, complete upstream app set, GPU profile integration, warm release or deployment claim"}, indent=2))


if __name__ == "__main__":
    main()
