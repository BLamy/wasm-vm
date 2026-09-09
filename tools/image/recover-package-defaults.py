#!/usr/bin/env python3
"""Recover exact package-default config bytes, never changed personal contents.

Only /etc regular files matching the package mtree's expected SHA-256 are
admitted from builder defaults or cached archives into a private marked upperdir.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

MARKER = ".wasm-vm-package-defaults"
MARKER_BYTES = b"package-defaults-v1\n"


def recover(source, output, inventory, archives=False):
    if not output.is_absolute() or output.resolve() != output or output == Path("/"):
        raise ValueError("unsafe output path")
    if not output.exists():
        output.mkdir(mode=0o700)
        (output / MARKER).write_bytes(MARKER_BYTES)
    marker = output / MARKER
    if marker.is_symlink() or marker.read_bytes() != MARKER_BYTES:
        raise ValueError("output lacks the exact package-defaults marker")
    restored = []
    for entry in inventory:
        relative = entry["path"]
        path = Path(relative)
        if not relative.startswith("etc/") or path.is_absolute() or ".." in path.parts:
            continue
        if len(entry["expected"]) != 64:
            raise ValueError("invalid expected digest")
        destination = output / path
        for ancestor in [destination, *destination.parents]:
            if ancestor == output.parent:
                break
            if ancestor.is_symlink():
                raise ValueError("output symlink")
        if destination.exists():
            if hashlib.sha256(destination.read_bytes()).hexdigest() != entry["expected"]:
                raise ValueError("existing default does not match")
            continue
        candidates = sorted(source.glob(entry["package"] + "-*.pkg.tar.*")) if archives else [source / path]
        for candidate in candidates:
            if not candidate.is_file() or candidate.is_symlink() or candidate.name.endswith(".sig"):
                continue
            if archives:
                result = subprocess.run(["bsdtar", "-xOf", str(candidate), relative],
                                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30)
                if result.returncode:
                    continue
                content = result.stdout
            else:
                content = candidate.read_bytes()
            if hashlib.sha256(content).hexdigest() != entry["expected"]:
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open("xb") as stream:
                stream.write(content)
            os.chown(destination, entry["uid"], entry["gid"])
            destination.chmod(int(entry["mode"], 8))
            restored.append(relative)
            break
    print(json.dumps({"restored": restored}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--archives", action="store_true")
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError("container root is required for package ownership")
    recover(args.source, args.output, json.loads(args.inventory.read_text()), args.archives)


if __name__ == "__main__":
    main()
