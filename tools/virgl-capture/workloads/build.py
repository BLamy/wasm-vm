#!/usr/bin/env python3
"""Fetch pinned workload inputs and cross-build inside the reference container."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import urllib.request


def run(*args):
    subprocess.run(args, check=True)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", default="wasm-vm-virgl-reference-research")
    parser.add_argument("--rootfs", default="/reference/omarchy.ext4", help="read-only image path inside container")
    parser.add_argument("--output", default="/capture/workloads", help="workload directory inside container")
    parser.add_argument("--cache", type=Path, default=Path(tempfile.gettempdir()) / "wasm-vm-graphics-workload-sources")
    parser.add_argument("--glmark2-package", type=Path, help="optional existing package, still hash checked")
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    pins = json.loads((here / "pins.json").read_text())
    args.cache.mkdir(parents=True, exist_ok=True)
    repository = args.cache / "kmscube.git"
    archive = args.cache / "kmscube.tar"
    if not archive.exists() or digest(archive) != pins["kmscube"]["git_archive_sha256"]:
        if not repository.exists():
            run("git", "init", "--bare", str(repository))
        run("git", "-C", str(repository), "fetch", "--depth=1", pins["kmscube"]["repository"], pins["kmscube"]["revision"])
        with archive.open("wb") as output:
            subprocess.run(["git", "-C", str(repository), "archive", pins["kmscube"]["revision"]], stdout=output, check=True)
    if digest(archive) != pins["kmscube"]["git_archive_sha256"]:
        raise SystemExit("kmscube source archive hash mismatch")
    package = args.glmark2_package or args.cache / pins["glmark2"]["package"]
    if not package.exists():
        urllib.request.urlretrieve(pins["glmark2"]["url"], package)
    if digest(package) != pins["glmark2"]["sha256"]:
        raise SystemExit("glmark2 package hash mismatch")
    run("docker", "exec", args.container, "mkdir", "-p", "/workload-build/control", "/workload-build/inputs")
    for name in ["build_in_container.py", "pins.json", "textured-scene.c"]:
        run("docker", "cp", str(here / name), args.container + ":/workload-build/control/" + name)
    run("docker", "cp", str(archive), args.container + ":/workload-build/inputs/kmscube.tar")
    run("docker", "cp", str(package), args.container + ":/workload-build/inputs/" + pins["glmark2"]["package"])
    run("docker", "exec", args.container, "python3", "/workload-build/control/build_in_container.py",
        "--rootfs", args.rootfs, "--output", args.output)


if __name__ == "__main__":
    main()
