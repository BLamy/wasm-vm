#!/usr/bin/env python3
"""Reproducible static builds plus the bounded, network-free Linux pre-check."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=False)
image = "mcr.microsoft.com/playwright:v1.62.1-noble"
image_id = "sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e"
env = {**os.environ, "ZIG_GLOBAL_CACHE_DIR": "/private/tmp/omarchy-input-zig-cache"}
zig = shutil.which("zig") or "/opt/homebrew/bin/zig"
receipt = {"passed": False, "commands": [], "files": {}}


def run(args, name):
    receipt["commands"].append(args)
    with (out / (name + ".log")).open("w") as log:
        subprocess.run(args, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=120)


try:
    receipt["zigVersion"] = subprocess.check_output([zig, "version"], env=env, text=True).strip()
    assert receipt["zigVersion"] == "0.16.0"
    actual = json.loads(subprocess.check_output(["docker", "image", "inspect", image], text=True))[0]
    assert actual["Id"] == image_id and actual["Architecture"] == "arm64"
    receipt["dockerImage"] = {"name": image, "id": image_id, "architecture": actual["Architecture"]}
    source = "tools/verify/omarchy-input-observer.c"
    fixture = "evidence/omarchy-profile/compositor-input-verifier/adversarial-fixture.c"
    clone_fixture = "evidence/omarchy-profile/compositor-input-verifier/clone-fixture.c"
    for arch in ["aarch64", "riscv64"]:
        run([zig, "cc", "-target", arch + "-linux-musl", "-Os", "-static", "-Wall", "-Wextra", "-Werror",
             source, "-o", str(out / ("observer-" + arch))], "build-" + arch)
    run([zig, "cc", "-target", "aarch64-linux-musl", "-Os", "-static", "-Wall", "-Wextra", "-Werror", "-pthread",
         fixture, "-o", str(out / "fixture-aarch64")], "build-fixture")
    run([zig, "cc", "-target", "aarch64-linux-musl", "-Os", "-static", "-Wall", "-Wextra", "-Werror", "-pthread",
         clone_fixture, "-o", str(out / "clone-fixture-aarch64")], "build-clone-fixture")
    for file in [root / source, root / fixture, root / clone_fixture, *[out / name for name in ["observer-aarch64", "observer-riscv64", "fixture-aarch64", "clone-fixture-aarch64"]]]:
        data = file.read_bytes()
        receipt["files"][str(file.relative_to(root))] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    run(["docker", "run", "--rm", "--network", "none", "--cap-add", "SYS_PTRACE", "--security-opt", "seccomp=unconfined",
         "-v", f"{root}:/repo:ro", "-v", f"{out}:/output", image,
         "python3", "/repo/tools/verify/omarchy-input-observer-fixture.py", "/output/observer-aarch64",
         "/output/fixture-aarch64", "/output/fixture"], "linux-fixture")
    assert json.loads((out / "fixture/result.json").read_text())["passed"] is True
    run(["docker", "run", "--rm", "--network", "none", "--cap-add", "SYS_PTRACE", "--security-opt", "seccomp=unconfined",
         "-v", f"{root}:/repo:ro", "-v", f"{out}:/output", image,
         "python3", "/repo/tools/verify/omarchy-input-observer-fixture.py", "/output/observer-aarch64",
         "/output/clone-fixture-aarch64", "/output/clone-fixture", "clone"], "linux-clone-fixture")
    assert json.loads((out / "clone-fixture/result.json").read_text())["passed"] is True
    receipt["passed"] = True
finally:
    (out / "build.json").write_text(json.dumps(receipt, indent=2)+"\n")
print(json.dumps(receipt))
