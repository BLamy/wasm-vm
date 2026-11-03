#!/usr/bin/env python3
"""Assemble a local Chromium candidate without mounting or executing the guest."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile


ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "local/chromium-riscv64/gui/ubuntu-riscv-gui.ext4"
BASE_SHA = "9a9b656f654ed0a3783385e6bd153775ea56dfe62de85cd8b155ed798c2f9558"
TOOL = "sha256:986b9aec6385491294c550e1a95275e05f56fa76b0581b606527f7871daefce8"
EPOCH = 1793491200


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def build(args):
    base = args.base.resolve(strict=True)
    record = json.loads((ROOT / "tools/chromium/built/manifest.json").read_text())
    bundle = (args.runtime or ROOT / record["runtimeBundle"]).resolve(strict=True)
    expected_bundle = record["localArtifacts"][record["runtimeBundle"]]
    require(base.stat().st_size == 8 * 1024**3 and digest(base) == BASE_SHA,
            "The exact retained Ubuntu base is required")
    require(bundle.stat().st_size == expected_bundle["bytes"]
            and digest(bundle) == expected_bundle["sha256"],
            "The exact verified Chromium runtime bundle is required")
    output = args.output.absolute()
    require(output.parent.resolve(strict=True) == output.parent
            and output.is_relative_to(ROOT / "target"),
            "Use a fresh owned output directory below this project's target/")
    require(not output.exists() and not output.is_symlink(), "Output already exists")
    output.mkdir(mode=0o700)
    work = output / "work"
    work.mkdir(mode=0o700)
    image = output / "guest.ext4"
    receipt = {"status": "running", "baseSha256": BASE_SHA,
               "runtimeSha256": expected_bundle["sha256"], "toolImage": TOOL,
               "head": subprocess.check_output(["git", "rev-parse", "HEAD"],
                                                cwd=ROOT, text=True).strip(),
               "sourceFiles": {str(p.relative_to(ROOT)): digest(p) for p in
                               [Path(__file__).resolve(),
                                ROOT / "tools/chromium/guest/start-browser.sh",
                                ROOT / "tools/chromium/guest/smoke.html",
                                ROOT / "tools/chromium/built/manifest.json",
                                ROOT / "tools/chromium/built/runtime-files.json"]},
               "commands": [], "installedFiles": []}

    def run(command, name):
        result = subprocess.run(command, capture_output=True, check=False)
        log = result.stdout + result.stderr
        (output / name).write_bytes(log)
        receipt["commands"].append({"command": command, "exit": result.returncode,
                                    "log": name, "sha256": hashlib.sha256(log).hexdigest()})
        require(result.returncode == 0, "Image command failed: " + name)
        return result.stdout

    def container(*command, writable=False):
        return ["docker", "run", "--rm", "--network", "none",
                "-v", str(image) + ":/disk/guest.ext4" + ("" if writable else ":ro"),
                "-v", str(work) + ":/work", TOOL, *command]

    def debug(command, name):
        return run(container("debugfs", "-R", command, "/disk/guest.ext4"), name)

    try:
        run(["docker", "image", "inspect", TOOL, "--format", "{{.Id}}"], "tool-image.txt")
        run(["cp", "-c", str(base), str(image)], "clone.txt")
        require(digest(image) == BASE_SHA, "Cloned base differs before mutation")
        expected = json.loads((ROOT / "tools/chromium/built/runtime-files.json").read_text())["files"]
        runtime = work / "runtime"
        runtime.mkdir()
        seen = set()
        # Read individual, fixed members; never use extractall or follow archive links.
        with tarfile.open(bundle, "r:gz") as archive:
            for member in archive:
                if member.isdir():
                    continue
                require(member.isfile() and member.name.startswith("replay-chromium/"),
                        "Unexpected archive entry")
                name = member.name.removeprefix("replay-chromium/")
                require(name in expected or name == "SHA256SUMS", "Unlisted archive file")
                require(name not in seen, "Duplicate archive file")
                seen.add(name)
                target = runtime / name
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as source, target.open("xb") as dest:
                    shutil.copyfileobj(source, dest, 1024 * 1024)
                if name in expected:
                    require(digest(target) == expected[name], "Runtime member differs: " + name)
        require(seen == set(expected) | {"SHA256SUMS"}, "Incomplete runtime archive")

        service = "/etc/systemd/system/replay-desktop.service"
        original_service = debug("cat " + service, "desktop-service-before.txt")
        require(b"\nUser=desktop\nGroup=desktop\n" in original_service,
                "The inherited unprivileged desktop service is required")
        original = debug("cat /usr/local/bin/replay-desktop", "desktop-before.sh").decode()
        lines = original.splitlines(keepends=True)
        launches = [i for i, line in enumerate(lines) if line.startswith("foot --title=")]
        require(len(launches) == 1, "Unexpected original desktop launcher")
        lines[launches[0]] = "/usr/local/bin/replay-chromium &\n"
        (work / "replay-desktop").write_text("".join(lines))
        shutil.copyfile(ROOT / "tools/chromium/guest/start-browser.sh", work / "replay-chromium")
        shutil.copyfile(ROOT / "tools/chromium/guest/smoke.html", work / "smoke.html")

        files = []
        for name in expected:
            mode = "0755" if name in {"chrome", "chrome_crashpad_handler"} else "0644"
            files.append(("runtime/" + name, "/opt/replay-chromium/" + name, mode))
        files += [("smoke.html", "/opt/replay-chromium/smoke.html", "0644"),
                  ("replay-chromium", "/usr/local/bin/replay-chromium", "0755"),
                  ("replay-desktop", "/usr/local/bin/replay-desktop", "0755")]
        commands = ["mkdir /opt/replay-chromium", "mkdir /opt/replay-chromium/locales",
                    "rm /usr/local/bin/replay-desktop"]
        for local, guest, mode in files:
            commands += ["write /work/" + local + " " + guest,
                         "set_inode_field " + guest + " mode 010" + mode,
                         "set_inode_field " + guest + " uid 0",
                         "set_inode_field " + guest + " gid 0"]
            for field in ("atime", "ctime", "mtime", "crtime"):
                commands.append(f"set_inode_field {guest} {field} @{EPOCH}")
        (work / "commands").write_text("\n".join(commands) + "\n")
        run(container("debugfs", "-w", "-f", "/work/commands", "/disk/guest.ext4",
                      writable=True), "debugfs-write.txt")
        require(not re.search(r"not found|not open|already exists|could not|no space|error|usage:",
                              (output / "debugfs-write.txt").read_text(), re.I),
                "debugfs reported an image mutation error")

        for index, (local, guest, mode) in enumerate(files):
            # Use a distinct name for each Docker bind-mount roundtrip; do not
            # immediately reuse a pathname just unlinked through macOS sharing.
            debug(f"dump {guest} /work/roundtrip-{index:02}", f"dump-{index:02}.txt")
            actual = work / f"roundtrip-{index:02}"
            require(actual.is_file() and digest(actual) == digest(work / local),
                    "Inserted file differs: " + guest)
            metadata = debug("stat " + guest, f"stat-{index:02}.txt").decode()
            require(re.search(r"Type:\s+regular\s+Mode:\s+" + mode + r"\b", metadata)
                    and re.search(r"User:\s+0\s+Group:\s+0", metadata),
                    "Installed file ownership or mode differs: " + guest)
            for field in ("atime", "ctime", "mtime", "crtime"):
                require(re.search(r"\b" + field + r":\s+0x" + format(EPOCH, "x")
                                  + r":00000000\b", metadata),
                        "Installed timestamp differs: " + guest + " " + field)
            receipt["installedFiles"].append({"path": guest, "mode": mode, "uid": 0,
                                              "gid": 0, "bytes": actual.stat().st_size,
                                              "sha256": digest(actual)})
            actual.unlink()
        require(debug("cat " + service, "desktop-service-after.txt") == original_service,
                "Desktop service identity changed")
        run(container("e2fsck", "-f", "-n", "/disk/guest.ext4"), "filesystem-check.txt")
        require("Fix?" not in (output / "filesystem-check.txt").read_text(),
                "Filesystem checker proposed repairs")
        require(digest(base) == BASE_SHA, "Immutable base changed")

        chunks = output / "chunks"
        chunks.mkdir()
        chunk_size = 256 * 1024
        hashes = []
        with image.open("rb") as stream:
            for block in iter(lambda: stream.read(chunk_size), b""):
                pin = hashlib.sha256(block).hexdigest()
                hashes.append(pin)
                target = chunks / (pin + ".bin")
                if not target.exists():
                    target.write_bytes(block)
        manifest = {"version": 1, "image_len": image.stat().st_size,
                    "chunk_size": chunk_size, "layout": "split", "chunks": hashes}
        (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        receipt.update(status="prepared", image={"bytes": image.stat().st_size,
                                                 "sha256": digest(image)},
                       manifestSha256=digest(output / "manifest.json"),
                       uniqueChunks=len(set(hashes)), browserBootVerified=False)
        print(json.dumps({key: receipt[key] for key in
                          ("status", "image", "manifestSha256", "uniqueChunks", "browserBootVerified")},
                         indent=2))
    except Exception as error:
        receipt.update(status="failed", error=str(error))
        raise
    finally:
        (output / "assembly.json").write_text(json.dumps(receipt, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, default=BASE)
    parser.add_argument("--runtime", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    build(parser.parse_args())
