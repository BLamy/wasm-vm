#!/usr/bin/env python3
"""Record original boolean-query lifetimes and guest results on hardware WebGL2."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

repo = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=repo)
env = {key: value for key, value in os.environ.items()
       if key not in ("RUSTFLAGS", "RUST_LOG") and not key.startswith(("CARGO_", "VIRGL_", "CRITIC_"))}
report = {"task": "E6-T11d69a", "head": head, "status": "running", "commands": [], "started": time.time()}

def run(name, command, timeout=1800):
    print(name, flush=True)
    started = time.time()
    with (output / (name + ".stdout")).open("wb") as stdout, (output / (name + ".stderr")).open("wb") as stderr:
        result = subprocess.run(command, cwd=repo, env=env, stdout=stdout, stderr=stderr, timeout=timeout)
    report["commands"].append({"name": name, "command": command, "seconds": time.time()-started, "exitCode": result.returncode})
    assert result.returncode == 0, name + " failed; inspect recorded output"

try:
    run("policy", ["python3", "tools/check_task_policy.py"])
    run("format", ["cargo", "fmt", "--all", "--check"])
    run("core-clippy", ["cargo", "clippy", "-p", "wasm-vm-core", "--tests", "--features", "virgl-renderer,virgl-control-proof,gpu-trace,trace", "--", "-D", "warnings"])
    run("native", ["cargo", "test", "-p", "wasm-vm-core", "--lib", "--features", "virgl-renderer,virgl-control-proof,gpu-trace,trace"])
    run("transport", ["cargo", "test", "-p", "wasm-vm-core", "--features", "virgl-renderer,virgl-control-proof,gpu-trace,trace", "--test", "production_virgl_critic", "--test", "virgl_capabilities"])
    run("wasm-clippy", ["cargo", "clippy", "-p", "wasm-vm-wasm", "--target", "wasm32-unknown-unknown", "--features", "virgl-renderer", "--", "-D", "warnings"])
    run("proof-build", ["wasm-pack", "build", "crates/wasm", "--target", "web", "--out-dir", "../../target/virgl-production/pkg", "--features", "virgl-renderer,virgl-control-proof"])
    run("hardware", ["node", "tools/virgl-production/worker-boolean-queries-browser.mjs", "--output", str(output / "hardware"), "--schedules", "0,1,2"])
    run("promoted-novel", ["node", "tools/virgl-production/critic-fast-boots-boolean-queries-browser.mjs", "--output", str(output / "promoted-novel")])
    run("private-profile", ["node", "tools/verify-virgl-draw-replay.mjs", "--output", str(output / "private-profile")])
    run("default-demo", ["node", "tools/verify-virgl-default-demo.mjs", "--output", str(output / "default-demo"), "--task", "E6-T11d69a"])
    report["status"] = "passed"
except BaseException as error:
    report["status"] = "failed"
    report["failure"] = str(error)
    raise
finally:
    report["finished"] = time.time()
    files = []
    for file in sorted(output.rglob("*")):
        if file.is_file() and file.name != "report.json":
            files.append({"path": str(file.relative_to(output)), "bytes": file.stat().st_size,
                          "sha256": hashlib.sha256(file.read_bytes()).hexdigest()})
    report["files"] = files
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
