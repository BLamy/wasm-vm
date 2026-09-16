#!/usr/bin/env python3
"""Run the verifier's independent byte oracle against one immutable source head."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

p = argparse.ArgumentParser()
p.add_argument("head")
p.add_argument("output")
args = p.parse_args()
repo = Path(__file__).resolve().parents[3]
out = Path(args.output).resolve()
allowed = Path(__file__).resolve().parent
assert out.is_relative_to(allowed) and not out.exists()
out.mkdir()
env = os.environ.copy()
env["DEVELOPER_DIR"] = "/Library/Developer/CommandLineTools"
for key in list(env):
    if key in {"RUSTFLAGS", "RUST_LOG"} or key.startswith("CARGO_"):
        env.pop(key)
head = subprocess.check_output(["git", "rev-parse", args.head], cwd=repo, env=env, text=True).strip()
source = subprocess.check_output(["git", "show", f"{head}:crates/core/src/resume.rs"], cwd=repo, env=env)
(out / "candidate-resume.rs").write_bytes(source)
shutil.copyfile(allowed / "serialization_attack.rs", out / "serialization_attack.rs")
report = {"startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "head": head,
          "source": "crates/core/src/resume.rs", "sourceSha256": hashlib.sha256(source).hexdigest(),
          "commands": [], "scrubbedVariables": ["RUSTFLAGS", "RUST_LOG", "CARGO_*"]}
for name, argv in [
    ("compile", ["rustc", "--edition=2024", "-O", "serialization_attack.rs", "-o", "serialization-attack"]),
    ("attack", ["./serialization-attack"]),
]:
    result = subprocess.run(argv, cwd=out, env=env, capture_output=True, text=True)
    (out / f"{name}.log").write_text(result.stdout + result.stderr)
    report["commands"].append({"name": name, "argv": argv, "exitCode": result.returncode})
    if result.returncode:
        break
report["finishedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
(out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
raise SystemExit(report["commands"][-1]["exitCode"])
