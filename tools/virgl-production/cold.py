#!/usr/bin/env python3
"""Run one production acceptance from a pristine exact-head local clone."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--task", choices=["E6-T11d67", "E6-T11d68", "E6-T11d", "E6-T11e"], required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=repo), "freeze tracked source before cold proof"
branch = subprocess.check_output(["git", "branch", "--show-current"], cwd=repo, text=True).strip()
clone = output / "clone"
env = {key: value for key, value in os.environ.items()
       if key not in ("RUSTFLAGS", "RUST_LOG")
       and not key.startswith(("CARGO_", "VIRGL_", "CRITIC_"))}
env.update(VIRGL_INDEXED_START_EVIDENCE_DIR=str(output / "indexed-start"),
           VIRGL_MULTISAMPLE_EVIDENCE_DIR=str(output / "multisample"),
           VIRGL_NUMERIC_EVIDENCE_DIR=str(output / "numeric"),
           VIRGL_MULTISAMPLE_DEMO_EVIDENCE_DIR=str(output / "demo"),
           VIRGL_PRODUCTION_EVIDENCE_DIR=str(output / "production"),
           VIRGL_RECOVERY_EVIDENCE_DIR=str(output / "recovery"))
report = {"task": args.task, "head": head, "branch": branch, "status": "running", "commands": [], "startedAt": time.time()}

def run(name, command, cwd, timeout=3600):
    print(name, flush=True)
    started = time.time()
    with (output / (name + ".stdout")).open("wb") as stdout, (output / (name + ".stderr")).open("wb") as stderr:
        result = subprocess.run(command, cwd=cwd, env=env, stdout=stdout, stderr=stderr, timeout=timeout)
    report["commands"].append({"name": name, "command": command, "exitCode": result.returncode, "seconds": time.time()-started})
    assert result.returncode == 0, name + " failed; inspect recorded output"

try:
    # The Docstream corpus deliberately cites a historical source commit. Keep
    # repository history as an ordinary clone does, while forbidding hardlinks.
    run("clone", ["git", "clone", "--no-local", "--single-branch", "--branch", branch, str(repo), str(clone)], repo)
    assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=clone, text=True).strip() == head
    assert not subprocess.check_output(["git", "status", "--porcelain"], cwd=clone)
    run("build", ["make", "web-dist"], clone)
    run("acceptance", ["make", "verify-" + args.task], clone)
    report["status"] = "passed"
except BaseException as error:
    report["status"] = "failed"; report["failure"] = str(error)
    raise
finally:
    report["finishedAt"] = time.time()
    files = []
    for file in sorted(output.rglob("*")):
        if file.is_file() and clone not in file.parents and file.name != "report.json":
            digest = hashlib.sha256()
            with file.open("rb") as stream:
                for data in iter(lambda: stream.read(1048576), b""): digest.update(data)
            files.append({"path": str(file.relative_to(output)), "bytes": file.stat().st_size, "sha256": digest.hexdigest()})
    report["files"] = files
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
