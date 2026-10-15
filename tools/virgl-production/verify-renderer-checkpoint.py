#!/usr/bin/env python3
"""Record the fresh physical production renderer checkpoint boundary at a frozen head."""
import argparse
import hashlib
import gzip
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
assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=repo)
env = {key: value for key, value in os.environ.items()
       if key not in ("RUSTFLAGS", "RUSTDOCFLAGS", "RUST_LOG")
       and not key.startswith(("CARGO_", "VIRGL_", "CRITIC_"))}
report = {"task": "E6-T11d74b", "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip(),
          "scope": "Physical renderer reconstruction only; worker pairing and production guest GPU warm boot follow in74c/74d",
          "status": "running", "commands": [], "started": time.time()}

def run(name, command, timeout=1800, expected=0):
    print(name, flush=True)
    started = time.time()
    with (output/(name+".stdout")).open("wb") as stdout, (output/(name+".stderr")).open("wb") as stderr:
        result = subprocess.run(command, cwd=repo, env=env, stdout=stdout, stderr=stderr, timeout=timeout)
    report["commands"].append({"name": name, "command": command, "seconds": time.time()-started, "exitCode": result.returncode, "expectedExitCode": expected})
    (output/"report.json").write_text(json.dumps(report, indent=2)+"\n")
    assert result.returncode == expected, name+" failed; inspect recorded output"

try:
    run("policy", ["python3", "tools/check_task_policy.py"])
    changed_sources = [
        "renderer/virgl-command/checkpoint-codec.mjs", "renderer/virgl-command/checkpoint.mjs",
        "renderer/virgl-command/control-bridge.mjs", "renderer/virgl-command/resources.mjs",
        "renderer/virgl-command/queries.mjs", "renderer/virgl-command/state.mjs",
        "renderer/virgl-command/scanout.mjs", "renderer/virgl-command/tests/submit-acceptance.mjs",
        "renderer/virgl-command/tests/production-checkpoint.mjs",
        "tools/virgl-production/worker-checkpoint-browser.mjs",
        "tools/virgl-production/critic-fast-boots-renderer-checkpoint.mjs",
        "tools/virgl-production/critic-fast-boots-renderer-checkpoint-browser.mjs",
        "tools/verify-virgl-default-demo.mjs"]
    for index, source in enumerate(changed_sources):
        run("syntax-"+str(index), ["node", "--check", source])
    run("portable-codec", ["node", "--test", "tools/virgl-production/gpu-checkpoint-codec.test.mjs"])
    run("proof-wasm", ["wasm-pack", "build", "crates/wasm", "--target", "web", "--out-dir", "../../target/virgl-production/pkg", "--features", "virgl-renderer,virgl-control-proof"])
    run("web-build", ["make", "web-build"])
    run("physical-checkpoint", ["node", "tools/virgl-production/worker-checkpoint-browser.mjs", "--output", str(output/"physical-checkpoint")])
    run("independent-attacks", ["node", "tools/virgl-production/critic-fast-boots-renderer-checkpoint-browser.mjs", "--output", str(output/"independent-attacks")])
    run("independent-guard-supplement", ["node", "tools/virgl-production/critic-fast-boots-renderer-checkpoint-browser.mjs", "--output", str(output/"independent-guards"), "--mode", "guards"])
    run("generation-negative", ["node", "tools/virgl-production/critic-fast-boots-renderer-checkpoint-browser.mjs", "--output", str(output/"generation-negative"), "--mode", "epoch", "--negative-control", "stale-epoch"], expected=1)
    negative = json.loads((output/"generation-negative/report.json").read_text())
    assert negative["status"] == "failed" and negative["browserErrors"] == {"console": [], "page": [], "requests": []}
    assert negative["negativeControl"]["sourceSha256"] != negative["negativeControl"]["servedSha256"]
    assert len(negative["runs"]) == 1
    negative_bytes = gzip.decompress((output/"generation-negative"/negative["runs"][0]["path"]).read_bytes())
    assert hashlib.sha256(negative_bytes).hexdigest() == negative["runs"][0]["sha256"]
    row = json.loads(negative_bytes)
    assert row["failure"]["message"] == "stale expected epoch refuses rejected: expected false, got true"
    assert row["stale"]["ok"] is True and row["after"]["epoch"] == "0000000000000003"
    assert row["ownersAfter"] == {"objects": 0, "syncs": 0}
    run("multisample-regression", ["node", "tools/virgl-production/worker-multisample-browser.mjs", "--output", str(output/"multisample-regression"), "--schedules", "0,1,2"])
    built = repo/"web/pkg/wasm_vm_wasm_bg.wasm"
    committed = repo/"web/dist/pkg/wasm_vm_wasm_bg.wasm"
    assert hashlib.sha256(built.read_bytes()).digest() == hashlib.sha256(committed.read_bytes()).digest(), "committed Wasm differs from local build"
    run("default-browser", ["node", "tools/verify-virgl-default-demo.mjs", "--output", str(output/"default-browser"), "--task", "E6-T11d74b"])
    assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=repo), "acceptance changed tracked files"
    report["status"] = "passed"
except BaseException as error:
    report["status"] = "failed"
    report["failure"] = str(error)
    raise
finally:
    report["finished"] = time.time()
    report["files"] = [{"path": str(file.relative_to(output)), "bytes": file.stat().st_size,
                        "sha256": hashlib.sha256(file.read_bytes()).hexdigest()}
                       for file in sorted(output.rglob("*")) if file.is_file() and file != output/"report.json"]
    (output/"report.json").write_text(json.dumps(report, indent=2)+"\n")
