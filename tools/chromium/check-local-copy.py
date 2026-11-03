#!/usr/bin/env python3
"""Read-only integrity check for the retained, unfinished local Chromium port."""

import hashlib
import json
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def git(directory, *args):
    return subprocess.check_output(
        ["git", "--no-optional-locks", "-C", str(directory), *args]
    ).decode().strip()


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require(condition, detail):
    if not condition:
        raise SystemExit(f"FAIL: {detail}")


def main():
    manifest = json.loads((HERE / "workspace.json").read_text())
    workspace = ROOT / manifest["local_path"]
    if not (workspace / "PROJECT-COPY.json").is_file():
        raise SystemExit(
            "Local Chromium copy is absent or incomplete. See docs/chromium-riscv64.md."
        )
    require(workspace.is_dir() and not workspace.is_symlink(), workspace)
    require(not (workspace / "src").is_symlink(), "Source must be a real project copy")
    for dependency in manifest["repositories"]:
        directory = workspace / dependency["path"]
        git_dir = Path(git(directory, "rev-parse", "--absolute-git-dir")).resolve()
        require(workspace.resolve() in git_dir.parents, git_dir)
        require(git(directory, "rev-parse", "HEAD") == dependency["revision"], directory)
    for changes in manifest["changes"]:
        directory = workspace / changes["repository"]
        changed = git(directory, "diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z", "HEAD")
        untracked = git(directory, "ls-files", "--others", "--exclude-standard", "-z")
        paths = sorted(set(filter(None, changed.split("\0") + untracked.split("\0"))))
        require(paths == changes["paths"], f"Unrecorded source changes in {directory}")
    for item in manifest["files"]:
        path = workspace / item["path"]
        require(sha256(path) == item["sha256"], path)
    for patch in manifest["patches"]:
        archived = HERE / "patches" / patch["name"]
        retained = workspace / "patches" / patch["name"]
        require(sha256(archived) == patch["sha256"], archived)
        require(sha256(retained) == patch["sha256"], retained)
    for notice in manifest["licenses"]:
        require(sha256(HERE / notice["path"]) == notice["sha256"], notice["path"])
        require(sha256(workspace / notice["source_path"]) == notice["sha256"], notice["source_path"])
    source = workspace / "src"
    require(not git(source, "diff", "HEAD", "--", "sandbox", "build/config/features.gni"),
            "Sandbox source differs from its pinned upstream revision")
    version = (source / "chrome/VERSION").read_text().splitlines()
    require(".".join(line.split("=", 1)[1] for line in version) == manifest["chromium_version"],
            "Chromium version differs from the manifest")
    checkpoint = json.loads((workspace / "logs/build-state.json").read_text())
    require(checkpoint["full_chrome_built"] is False, "Checkpoint unexpectedly claims a complete browser")
    require(checkpoint["sandbox_changes_applied"] is False, "Checkpoint says sandbox changes were applied")
    require(not (source / "out/RISCV64/chrome").exists(), "A browser binary changes this checkpoint's scope")
    ignored = git(ROOT, "check-ignore", "--no-index", "-v", "local/chromium-riscv64/src/chrome/VERSION")
    require(ignored.startswith(".gitignore:") and "/local/chromium-riscv64/" in ignored,
            "Tracked Git ignore rule is missing")
    require("local/chromium-riscv64" in (ROOT / ".dockerignore").read_text().splitlines(),
            "Docker context exclusion is missing")
    require(not git(ROOT, "ls-files", "--", "local/chromium-riscv64"), "Local source was added to Git")
    print(f"PASS: real local source copy at {workspace}")
    print(f"PASS: {len(manifest['repositories'])} pinned Git repositories, "
          f"{len(manifest['files'])} source/recipe files, {len(manifest['patches'])} archived patches")
    print(f"PASS: Chromium {manifest['chromium_version']} at {manifest['source_revision']}")
    print("PASS: source/disk workspace excluded from Git and Docker contexts")
    print("CHECKPOINT: full Chrome unbuilt; sandbox backport unapplied; no record/replay claim")


if __name__ == "__main__":
    main()
