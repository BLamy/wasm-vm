#!/usr/bin/env python3
"""Add a bounded swap file to a separate, authenticated public application image.

The immutable source is never mounted or modified. Its package bytes remain
unchanged. A fully allocated swap file supports normal Linux memory accounting
and the upstream Glycin sandbox's MemAvailable+SwapFree address-space budget.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
TOOL_IMAGE = "wasm-vm-virgl-reference:1.3.0"
SWAP_PATH = "/var/lib/wasm-vm-applications/swapfile"
SWAP_BYTES = 512 * 1024 * 1024
SWAP_UUID = "f8421628-6b6c-4b83-9576-6a211ba71c7e"
ACCEPTED_BASES = {
    "4e023f4c86b29ea6de5024b6de53d7dc7639a7d986f36bfa014d7210197674cf",
    "083b5a5742b4b7b1e0160f8c5d5a8e416af4859c4d636f32ad47cd2c09e36fd8",
}


def digest(file):
    h = hashlib.sha256()
    with file.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def prepare(args):
    base = args.base.resolve(strict=True)
    if args.expected_sha256 not in ACCEPTED_BASES or digest(base) != args.expected_sha256:
        raise ValueError("the accepted public application image is required")
    if base.stat().st_size != 12 * 1024**3:
        raise ValueError("unexpected public application image extent")
    output = args.output.absolute()
    output.parent.resolve(strict=True)
    if output.parent.resolve() != output.parent or not output.is_relative_to(ROOT / "target"):
        raise ValueError("a new owned output directory under target is required")
    output.mkdir(mode=0o700, exist_ok=False)
    image = output / "guest.ext4"
    # This machine's APFS clone avoids a second12GiB physical copy. Failure is
    # explicit; do not silently fill the disk with a fallback full copy.
    subprocess.run(["cp", "-c", str(base), str(image)], check=True)
    if digest(image) != args.expected_sha256:
        raise ValueError("the cloned source differs before any image mutation")
    receipt = {"status": "running", "base": {"path": str(base), "sha256": args.expected_sha256},
               "swap": {"path": SWAP_PATH, "bytes": SWAP_BYTES, "uuid": SWAP_UUID,
                        "uid": 0, "gid": 0, "mode": "0o600", "priority": 10},
               "commands": [], "packageMutation": False, "ramMiB": 1024,
               "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
               "sourceSha256": digest(Path(__file__)),
               "trackedChanges": subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT, text=True)}

    def run(command, name):
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        body = result.stdout + result.stderr
        (output / name).write_text(body)
        receipt["commands"].append({"command": command, "exit": result.returncode, "log": name,
                                    "sha256": hashlib.sha256(body.encode()).hexdigest()})
        if result.returncode:
            raise RuntimeError("image command failed: " + name)
        return result.stdout

    def debug(command):
        return ["docker", "run", "--rm", "--network", "none", "-v", str(image) + ":/disk/guest.ext4:ro",
                TOOL_IMAGE, "debugfs", "-R", command, "/disk/guest.ext4"]

    try:
        run(["docker", "image", "inspect", TOOL_IMAGE], "tool-image.json")
        fstab = run(debug("cat /etc/fstab"), "fstab-original.txt")
        if fstab != "/dev/vda / ext4 defaults,noatime 0 1\n":
            raise ValueError("unexpected source fstab; do not overwrite unknown configuration")
        if run(debug("stat /var/lib/wasm-vm-applications"), "directory-before.txt").strip():
            raise ValueError("owned application swap directory already exists")
        with tempfile.TemporaryDirectory(prefix="memory-", dir=output) as temporary:
            scratch = Path(temporary)
            swap = scratch / "swapfile"
            # Nonzero backing forces every filesystem data block to be allocated;
            # a zero-filled sparse file is not a valid Linux swap file.
            with swap.open("xb") as stream:
                block = b"\xa5" * (1024 * 1024)
                for _ in range(512):
                    stream.write(block)
            swap.chmod(0o600)
            run(["docker", "run", "--rm", "--network", "none", "-v", str(scratch) + ":/work",
                 TOOL_IMAGE, "/usr/sbin/mkswap", "--pagesize", "4096", "--uuid", SWAP_UUID,
                 "--label", "wasm-vm-apps", "/work/swapfile"], "mkswap.log")
            swap_sha = digest(swap)
            with swap.open("rb") as stream:
                (output / "swap-header.bin").write_bytes(stream.read(4096))
            (scratch / "fstab").write_text(fstab + SWAP_PATH + " none swap defaults,pri=10 0 0\n")
            profile = {"schema": 1, "baseSha256": args.expected_sha256, "swap": dict(receipt["swap"]),
                       "ramMiB": 1024, "sandboxMutation": False, "reason": "native desktop applications"}
            (scratch / "memory-profile.json").write_text(json.dumps(profile, indent=2) + "\n")
            commands = ["mkdir /var/lib/wasm-vm-applications", "write /work/swapfile " + SWAP_PATH,
                        "set_inode_field " + SWAP_PATH + " mode 0100600",
                        "rm /etc/fstab", "write /work/fstab /etc/fstab",
                        "write /work/memory-profile.json /etc/wasm-vm/application-memory.json"]
            (scratch / "commands").write_text("\n".join(commands) + "\n")
            run(["docker", "run", "--rm", "--network", "none", "-v", str(image) + ":/disk/guest.ext4",
                        "-v", str(scratch) + ":/work", TOOL_IMAGE, "debugfs", "-w", "-f", "/work/commands",
                        "/disk/guest.ext4"], "debugfs-write.log")
            if re.search(r"not found|not open|already exists|Could not|No space|error",
                         (output / "debugfs-write.log").read_text(), re.I):
                raise ValueError("debugfs reported a mutation failure")
            metadata = run(debug("stat " + SWAP_PATH), "swap-stat.txt")
            if not re.search(r"Mode:\s+0600", metadata) or not re.search(r"User:\s+0\s+Group:\s+0", metadata):
                raise ValueError("swap ownership/mode differs")
            if not re.search(r"Size:\s+536870912\b", metadata):
                raise ValueError("swap extent differs")
            blocks = list(map(int, run(debug("blocks " + SWAP_PATH), "swap-blocks.txt").split()))
            # EXTENT_TREE metadata can be listed too. Check the complete logical
            # extent map so metadata blocks cannot conceal a sparse data hole.
            if len(blocks) < SWAP_BYTES // 4096 or 0 in blocks:
                raise ValueError("swap data blocks were not fully allocated")
            extents = re.findall(r"\((\d+)(?:-(\d+))?\):\d+(?:-\d+)?", metadata)
            next_block = 0
            for first, last in extents:
                first, last = int(first), int(last or first)
                if first != next_block or last < first:
                    raise ValueError("swap logical extent map contains a hole or overlap")
                next_block = last + 1
            if next_block != SWAP_BYTES // 4096:
                raise ValueError("swap logical extents do not cover every data block")
            run(["docker", "run", "--rm", "--network", "none", "-v", str(image) + ":/disk/guest.ext4:ro",
                 "-v", str(scratch) + ":/work", TOOL_IMAGE, "debugfs", "-R",
                 "dump " + SWAP_PATH + " /work/roundtrip", "/disk/guest.ext4"], "swap-dump.log")
            if digest(scratch / "roundtrip") != swap_sha:
                raise ValueError("complete swap file differs after insertion")
            if run(debug("cat /etc/fstab"), "fstab-final.txt") != (scratch / "fstab").read_text():
                raise ValueError("swap activation entry differs")
            if run(debug("cat /etc/wasm-vm/application-memory.json"), "memory-profile-final.json") != (scratch / "memory-profile.json").read_text():
                raise ValueError("application memory profile differs")
            receipt["swap"]["sha256"] = swap_sha
            receipt["swap"]["dataBlocks"] = SWAP_BYTES // 4096
            receipt["swap"]["listedBlocks"] = len(blocks)
            receipt["profile"] = profile
        if digest(base) != args.expected_sha256:
            raise ValueError("original immutable base changed")
        run(["docker", "run", "--rm", "--network", "none", "-v", str(image) + ":/disk/guest.ext4:ro",
             TOOL_IMAGE, "e2fsck", "-f", "-n", "/disk/guest.ext4"], "filesystem-check.log")
        chunk_size = 256 * 1024
        chunks = output / "chunks"
        chunks.mkdir()
        hashes = []
        reuse = args.reuse_chunks.resolve(strict=True) if args.reuse_chunks else None
        verified_reuse = set()
        with image.open("rb") as stream:
            for block in iter(lambda: stream.read(chunk_size), b""):
                pin = hashlib.sha256(block).hexdigest()
                hashes.append(pin)
                destination = chunks / (pin + ".bin")
                if destination.exists():
                    continue
                existing = reuse / destination.name if reuse else None
                if existing and existing.exists():
                    if not stat.S_ISREG(existing.lstat().st_mode) or digest(existing) != pin:
                        raise ValueError("reused chunk identity differs")
                    os.link(existing, destination)
                    verified_reuse.add(pin)
                else:
                    destination.write_bytes(block)
        manifest = {"version": 1, "image_len": image.stat().st_size, "chunk_size": chunk_size,
                    "layout": "split", "chunks": hashes}
        (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        receipt.update(status="passed", image={"bytes": image.stat().st_size, "sha256": digest(image)},
                       manifestSha256=digest(output / "manifest.json"), uniqueChunks=len(set(hashes)),
                       reusedChunks=len(verified_reuse))
    except Exception as error:
        receipt.update(status="failed", error=str(error))
        raise
    finally:
        (output / "preparation.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({key: receipt[key] for key in ["status", "image", "manifestSha256", "uniqueChunks", "reusedChunks"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--reuse-chunks", type=Path)
    prepare(parser.parse_args())
