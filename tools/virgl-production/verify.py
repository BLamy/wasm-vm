#!/usr/bin/env python3
"""Record the production guest bring-up or hostile-input/recovery acceptance."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

repo = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--task", choices=["E6-T11d", "E6-T11e"], required=True)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--browser-only", action="store_true", help="incremental browser proof; preceding gates must be cited separately")
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
env = dict(os.environ, VIRGL_WEB_ROOT=str(repo / "web/dist"))
report = {"task": args.task, "status": "running", "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip(),
          "browserOnly": args.browser_only, "startedAt": time.time(), "commands": []}

def run(name, command, timeout=1800, extra=None):
    print(name, flush=True)
    started = time.time()
    with (output / (name + ".stdout")).open("wb") as stdout, (output / (name + ".stderr")).open("wb") as stderr:
        result = subprocess.run(command, cwd=repo, env=dict(env, **(extra or {})), stdout=stdout, stderr=stderr, timeout=timeout)
    entry = {"name": name, "command": command, "exitCode": result.returncode, "seconds": time.time() - started}
    report["commands"].append(entry)
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    assert result.returncode == 0, name + " failed; inspect its recorded stderr"

try:
    if not args.browser_only:
        run("build", ["make", "web-dist"])
        run("fmt", ["cargo", "fmt", "--all", "--check"])
        run("core-clippy", ["cargo", "clippy", "-p", "wasm-vm-core", "--tests", "--features", "virgl-renderer,virgl-control-proof,gpu-trace,trace", "--", "-D", "warnings"])
        run("wasm-clippy", ["cargo", "clippy", "-p", "wasm-vm-wasm", "--target", "wasm32-unknown-unknown", "--features", "virgl-renderer", "--", "-D", "warnings"])
        run("native", ["cargo", "test", "-p", "wasm-vm-core", "--features", "virgl-renderer,virgl-control-proof,gpu-trace,trace", "--test", "production_virgl_critic", "--test", "virgl_capabilities", "--test", "virtio_gpu_machine", "--", "--nocapture"])
        run("protocol", ["node", "--test", "web/tests/e4-t32-worker-protocol.test.mjs", "tools/virgl-production/critic-fast-boots-protocol.test.mjs"])
    run("qualification", ["node", "tools/virgl-production/browser.mjs", str(output / "qualification"), "qualify"])
    if args.task == "E6-T11d":
        run("fast-boot-images", ["node", "tools/virgl-production/critic-fast-boots.mjs", str(output / "fast-boot-images")], 1200,
            {"CRITIC_FAST_BOOT_WEB_ROOT": str(repo / "web/dist"), "CRITIC_FAST_BOOT_GPU": "0",
             "CRITIC_FAST_BOOT_GUESTS": "busybox,alpine,node-alpine,omarchy", "CRITIC_FAST_BOOT_SAVE_ON_REPEAT": "1"})
        run("actual-guest", ["node", "tools/virgl-production/browser.mjs", str(output / "guest"), "accept"], 2400)
        run("original-handshake", ["python3", "tools/virgl-production/compare-handshake.py",
            "--reference", "evidence/virgl-production-bringup/worker/qemu-kmscube-reference.tar.gz",
            "--guest", str(output / "guest"), "--output", str(output / "original-handshake.json")])
        run("public-desktop", ["node", "tools/virgl-production/critic-fast-boots.mjs", str(output / "public-desktop")], 2400,
            {"CRITIC_FAST_BOOT_WEB_ROOT": str(repo / "web/dist"), "CRITIC_FAST_BOOT_GPU": "1", "CRITIC_FAST_BOOT_GUESTS": "omarchy", "CRITIC_FAST_BOOT_PERSISTENCE": "0"})
    else:
        run("native-properties", ["cargo", "test", "-p", "wasm-vm-core", "--features", "virgl-renderer,trace", "--test", "production_virgl_fuzz", "--", "--nocapture"], 600,
            {"PRODUCTION_VIRGL_FUZZ_CASES": "200000", "PRODUCTION_VIRGL_FUZZ_SEED": "c67de5a1"})
        run("decoder-properties", ["node", "tools/virgl-production/recovery-decoder.mjs", "--output", str(output / "decoder-properties"), "--seed", "1478132467"])
        run("lifetimes", ["node", "tools/virgl-production/worker-lifetimes-browser.mjs", "--output", str(output / "lifetimes"), "--schedules", "0,1,2"])
        run("context-loss", ["node", "tools/virgl-production/browser.mjs", str(output / "context-loss"), "recover"], 1200)
    run("default-demo", ["node", "tools/verify-virgl-default-demo.mjs", "--output", str(output / "default-demo"), "--task", args.task])
    report["status"] = "passed"
except BaseException as error:
    report["status"] = "failed"
    report["failure"] = str(error)
    raise
finally:
    report["finishedAt"] = time.time()
    files = []
    for file in sorted(output.rglob("*")):
        if file.is_file() and file.name != "report.json":
            digest = hashlib.sha256()
            with file.open("rb") as stream:
                for data in iter(lambda: stream.read(1024 * 1024), b""): digest.update(data)
            files.append({"path": str(file.relative_to(output)), "bytes": file.stat().st_size, "sha256": digest.hexdigest()})
    report["files"] = files
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
