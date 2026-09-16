"""Record the frozen acceptance, optionally rebuilding in one pristine clone."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import subprocess
import sys
import tempfile

repo = Path(__file__).resolve().parents[3]
cold = sys.argv[1:] == ["--cold"]
assert not sys.argv[1:] or cold
out = Path(__file__).resolve().parent / ("cold" if cold else "final")
out.mkdir(exist_ok=False)
env = dict(os.environ)
scrubbed = []
for key in list(env):
    if key.startswith(("CARGO_", "OMARCHY_")) or key in ("RUSTFLAGS", "RUSTDOCFLAGS", "RUST_LOG"):
        scrubbed.append(key)
        del env[key]
env["DEVELOPER_DIR"] = "/Library/Developer/CommandLineTools"
env["PATH"] = str(Path.home() / ".nvm/versions/node/v24.20.0/bin") + ":" + str(Path.home() / ".cargo/bin") + ":/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, env=env, text=True).strip()
receipt = {"head": head, "cold": cold, "scrubbedNames": scrubbed, "commands": [], "passed": False}
def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save():
    (out / "proof.json").write_text(json.dumps(receipt, indent=2) + "\n")
def run(args, cwd, label):
    row = {"args": args, "cwd": str(cwd), "startedAt": now()}
    receipt["commands"].append(row)
    save()
    print(label, flush=True)
    with (out / (label + ".log")).open("w") as log:
        result = subprocess.run(args, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
    row.update(code=result.returncode, finishedAt=now())
    row["logSha256"] = hashlib.sha256((out / (label + ".log")).read_bytes()).hexdigest()
    save()
    if result.returncode:
        raise RuntimeError(f"{label} failed: {result.returncode}")
try:
    work = repo
    if cold:
        root = Path(tempfile.mkdtemp(prefix="wasm-vm-gpu-transfer-cold-", dir="/private/tmp"))
        work = root / "repo"
        receipt["clone"] = str(work)
        run(["git", "clone", "--quiet", str(repo), str(work)], root, "clone")
        run(["git", "checkout", "--quiet", head], work, "checkout")
        assert subprocess.check_output(["git", "status", "--porcelain"], cwd=work, env=env, text=True) == ""
        receipt["pristineBeforeBuild"] = True
        # External, previously verified guest artifacts, never compiler outputs.
        # The response wrapper/server independently verifies their pinned digests.
        artifacts = ["omarchy-input-kernel-r3", "omarchy-input-kernel-prepared-pair-r1", "omarchy-profile-chunks-sdr-r3-256k"]
        (work / "target").mkdir(exist_ok=True)
        for artifact in artifacts:
            run(["cp", "-cR", str(repo / "target" / artifact), str(work / "target" / artifact)], work, "artifact-" + artifact)
        run(["make", "web-dist"], work, "build")
    runtime = json.loads((work / "tools/verify/omarchy-gpu-transfer-runtime.json").read_text())
    for file, expected in runtime["files"].items():
        data = (work / file).read_bytes()
        assert {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()} == expected, file
    receipt["runtime"] = runtime
    receipt["runtimeMatched"] = True
    save()
    run(["make", "verify-E5_5-T03at", "GPU_TRANSFER_OUT=" + str(out)], work, "acceptance")
    receipt["passed"] = True
finally:
    save()
print(json.dumps(receipt), flush=True)
