#!/usr/bin/env python3
"""Build and prove one exact release head with owned Git, npm, target and image inputs."""
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
parser.add_argument("--url", default="https://wasm-vm.pages.dev/")
parser.add_argument("--application-image", type=Path, default=repo/"target/virgl-production/image-18")
parser.add_argument("--inventory", type=Path, default=repo/"target/evidence/omarchy-native-app-image-final01/runtime-elf.json")
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=repo)
head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
clone = output/"clone"
env = {k: v for k, v in os.environ.items()
       if k not in ("RUSTFLAGS", "RUSTDOCFLAGS", "RUST_LOG", "RUSTC", "RUSTDOC", "RUSTC_WRAPPER",
                    "RUSTC_WORKSPACE_WRAPPER", "NODE_PATH", "NODE_OPTIONS")
       and not k.startswith(("CARGO_", "CRITIC_", "VIRGL_", "OMARCHY_", "GIT_"))}
env["npm_config_cache"] = str(clone/"target/npm-cache")
report = {"task": "E5.5-T05d", "head": head, "status": "running", "url": args.url,
          "started": time.time(), "commands": [], "inputs": [],
          "cloneMethod": "complete commit/tree history, blob-filtered --no-local with sparse checkout excluding historical evidence; required historical document blobs hydrated into own Git before severing the source remote; no alternates or copied build/dependency output",
          "artifactMethod": "Explicit accepted immutable image and inventory inputs copied and rehashed; APFS clone shares immutable storage, not paths or mutable application state"}


def digest(file):
    h = hashlib.sha256()
    with file.open("rb") as stream:
        for data in iter(lambda: stream.read(1024*1024), b""):
            h.update(data)
    return h.hexdigest()


def save():
    (output/"report.json").write_text(json.dumps(report, indent=2)+"\n")


def run(name, command, cwd, timeout=3600, stdin=None):
    print(name, flush=True)
    row = {"name": name, "command": command, "cwd": str(cwd), "started": time.time()}
    report["commands"].append(row)
    save()
    try:
        with (output/(name+".log")).open("wb") as log:
            result = subprocess.run(command, cwd=cwd, env=env, input=stdin, stdout=log,
                                    stderr=subprocess.STDOUT, timeout=timeout)
        row["exit"] = result.returncode
        assert result.returncode == 0, name+" failed; retain the original clone and log"
    finally:
        row["finished"] = time.time()
        file = output/(name+".log")
        if file.exists():
            row["log"] = {"path": file.name, "bytes": file.stat().st_size, "sha256": digest(file)}
        save()


try:
    upload_pack = "git -c uploadpack.allowFilter=true -c uploadpack.allowAnySHA1InWant=true upload-pack"
    run("clone", ["git", "clone", "--no-local", "--no-checkout", "--filter=blob:none",
                  "--upload-pack="+upload_pack, str(repo), str(clone)], repo)
    run("local-filter-transport", ["git", "config", "remote.origin.uploadpack", upload_pack], clone)
    run("sparse", ["git", "sparse-checkout", "set", "--no-cone", "--stdin"], clone,
        stdin=b"/*\n!/evidence/\n")
    run("checkout", ["git", "checkout", "--detach", head], clone)
    assert not (clone/".git/objects/info/alternates").exists()
    assert not (clone/".git/shallow").exists()
    assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=clone, text=True).strip() == head
    assert subprocess.check_output(["git", "rev-list", "--count", head], cwd=clone) == subprocess.check_output(["git", "rev-list", "--count", head], cwd=repo)
    assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=clone)
    source = args.application_image.resolve()
    preparation = json.loads((source/"preparation.json").read_text())
    assert preparation["status"] == "passed"
    owned = clone/"target/release-inputs/image"
    owned.mkdir(parents=True)
    for name in ("guest.ext4", "manifest.json", "preparation.json"):
        original = source/name
        expected = preparation["image"]["sha256"] if name == "guest.ext4" else preparation["manifestSha256"] if name == "manifest.json" else digest(original)
        assert digest(original) == expected
        run("input-"+name.replace(".", "-"), ["cp", "-c", str(original), str(owned/name)], clone)
        assert digest(owned/name) == expected
        report["inputs"].append({"source": str(original), "owned": str(owned/name), "bytes": original.stat().st_size, "sha256": expected})
    inventory = clone/"target/release-inputs/runtime-elf.json"
    run("input-inventory", ["cp", "-c", str(args.inventory.resolve()), str(inventory)], clone)
    assert digest(inventory) == digest(args.inventory.resolve())
    report["inputs"].append({"source": str(args.inventory.resolve()), "owned": str(inventory), "bytes": inventory.stat().st_size, "sha256": digest(inventory)})
    run("tool-image", ["docker", "image", "inspect", "wasm-vm-omarchy-image:profile"], clone)
    run("fresh-web-dist", ["make", "web-dist"], clone, timeout=7200)
    assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=clone), "fresh build differs from committed source/bundle"
    # Hydrate the immutable historical prose/specification blobs required by
    # the corpus checker, then prohibit every later lazy read from the worker.
    run("historical-doc-inputs", ["node", "tools/check-docs.mjs"], clone)
    run("sever-source-remote", ["git", "config", "remote.origin.url", str(output/"unavailable-source")], clone)
    run("fresh-software-snapshot", ["node", "tools/fetch-omarchy-snapshot.mjs"], clone, timeout=900)
    run("existing-software-snapshot", ["node", "tools/fetch-omarchy-snapshot.mjs"], clone)
    run("acceptance", ["python3", "tools/virgl-production/verify-omarchy-application-release.py",
                       "--output", str(output/"acceptance"), "--url", args.url,
                       "--application-image", str(owned), "--inventory", str(inventory)], clone, timeout=18000)
    assert json.loads((output/"acceptance/report.json").read_text())["status"] == "passed"
    assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=clone)
    report["status"] = "passed"
except BaseException as error:
    report["status"] = "failed"
    report["failure"] = str(error)
    raise
finally:
    report["finished"] = time.time()
    report["files"] = [{"path": str(f.relative_to(output)), "bytes": f.stat().st_size, "sha256": digest(f)}
                       for f in sorted(output.rglob("*")) if f.is_file() and clone not in f.parents and f != output/"report.json"]
    save()
