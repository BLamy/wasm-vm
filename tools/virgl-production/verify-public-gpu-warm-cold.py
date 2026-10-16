#!/usr/bin/env python3
"""Prove the public GPU warm boot from one complete, isolated exact-head clone."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=repo)
clone = output / "clone"
env = {key: value for key, value in os.environ.items()
       if key not in ("RUSTFLAGS", "RUSTDOCFLAGS", "RUST_LOG")
       and not key.startswith(("CARGO_", "VIRGL_", "CRITIC_"))}
report = {"task": "E6-T11d74d", "head": head, "status": "running", "started": time.time(),
          "cloneMethod": "full-history --no-local; no alternates; no copied build or release cache",
          "commands": []}


def run(name, command, cwd, timeout=3600):
    print(name, flush=True)
    started = time.time()
    with (output/(name+".stdout")).open("wb") as stdout, (output/(name+".stderr")).open("wb") as stderr:
        result = subprocess.run(command, cwd=cwd, env=env, stdout=stdout, stderr=stderr, timeout=timeout)
    report["commands"].append({"name": name, "command": command, "exitCode": result.returncode,
                               "seconds": time.time()-started})
    (output/"report.json").write_text(json.dumps(report, indent=2)+"\n")
    assert result.returncode == 0, name+" failed; inspect the recorded output"


try:
    run("clone", ["git", "clone", "--no-local", str(repo), str(clone)], repo)
    run("exact-head", ["git", "checkout", "--detach", head], clone)
    assert not (clone/".git/objects/info/alternates").exists()
    assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=clone, text=True).strip() == head
    assert not subprocess.check_output(["git", "status", "--porcelain"], cwd=clone)
    run("acceptance", ["python3", "tools/virgl-production/verify-public-gpu-warm.py",
                       "--output", str(output/"acceptance")], clone)
    assert json.loads((output/"acceptance/report.json").read_text())["status"] == "passed"
    assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=clone)
    report["status"] = "passed"
except BaseException as error:
    report["status"] = "failed"
    report["failure"] = str(error)
    raise
finally:
    report["finished"] = time.time()
    report["files"] = [{"path": str(file.relative_to(output)), "bytes": file.stat().st_size,
                        "sha256": hashlib.sha256(file.read_bytes()).hexdigest()}
                       for file in sorted(output.rglob("*"))
                       if file.is_file() and clone not in file.parents and file != output/"report.json"]
    (output/"report.json").write_text(json.dumps(report, indent=2)+"\n")
