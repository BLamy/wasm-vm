#!/usr/bin/env python3
"""Independent pinned-base and ext4 oracle for the E9-T04 browser disk proof."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[2]
R2 = "https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("phase", choices=["prepare", "inspect"])
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)
fixture = json.loads((ROOT / "web/session-software-fixture.json").read_text())
image_bytes = (ROOT / "web/session-alpine-image.json").read_bytes()
manifest = json.loads(image_bytes)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_sha(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for part in iter(lambda: source.read(1 << 20), b""):
            digest.update(part)
    return digest.hexdigest()


assert sha(image_bytes) == fixture["image_manifest_sha256"]
assert manifest["image_len"] == fixture["raw_image_bytes"]

if args.phase == "prepare":
    source = ROOT / "releases/rootfs/alpine-rootfs.ext4"
    if not source.exists():
        source = out / "pinned-base.ext4"
        url = R2 + "/sha256/" + fixture["raw_image_sha256"] + "/releases/rootfs/alpine-rootfs.ext4"
        subprocess.run(["curl", "--fail", "--silent", "--show-error", "--location", "--max-time", "600", "--output", str(source), url], check=True)
    assert source.stat().st_size == fixture["raw_image_bytes"]
    assert file_sha(source) == fixture["raw_image_sha256"]
    with source.open("rb") as stream:
        for expected in manifest["chunks"]:
            assert sha(stream.read(manifest["chunk_size"])) == expected
        assert not stream.read(1)
    report = {"status": "passed", "source": str(source), "bytes": source.stat().st_size,
              "sha256": fixture["raw_image_sha256"], "manifest_sha256": sha(image_bytes),
              "chunks": len(manifest["chunks"]), "unique_chunks": len(set(manifest["chunks"]))}
    (out / "base.json").write_text(json.dumps(report, indent=2) + "\n")
    print("Pinned base and every chunk hash match the contract's raw image.")
else:
    base = json.loads((out / "base.json").read_text())
    source = Path(base["source"])
    assert file_sha(source) == fixture["raw_image_sha256"]
    image = "wasm-vm-rootfs-build:local"
    available = subprocess.run(["docker", "image", "inspect", image], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if available.returncode:
        subprocess.run(["docker", "build", "-q", "-f", "tools/rootfs.Dockerfile", "-t", image, "tools"], cwd=ROOT, check=True)
    image_id = subprocess.check_output(["docker", "image", "inspect", "--format", "{{.Id}}", image], text=True).strip()
    report = {"status": "running", "base": base, "docker_image": image_id,
              "dockerfile_sha256": file_sha(ROOT / "tools/rootfs.Dockerfile"), "roots": []}
    expected_files = {"before": b"e9:before\n", "after": b"e9:after\n", "fork": b"e9:fork\n", "live": b"e9:live\n"}
    for name, expected_file in expected_files.items():
        captured = (out / (name + ".captured.wvod")).read_bytes()
        restored = (out / (name + ".restored.wvod")).read_bytes()
        assert captured == restored, name + " capture/restore bytes differ"
        root_bytes = (out / (name + ".root.json")).read_bytes()
        root = json.loads(root_bytes)
        assert len(restored) >= 61 and restored[:5] == b"WVOD1"
        block_size, image_len = struct.unpack_from("<IQ", restored, 5)
        generation, count = struct.unpack_from("<QI", restored, 49)
        assert block_size == 4096 and image_len == base["bytes"] and count <= 65536
        assert len(restored) == 61 + count * 4104
        assert restored[17:49].hex() == sha(image_bytes)
        blocks = []
        for index in range(count):
            offset = 61 + index * 4104
            block = struct.unpack_from("<Q", restored, offset)[0]
            assert block < (image_len + 4095) // 4096 and (not blocks or int(blocks[-1]["index"]) < block)
            blocks.append({"index": str(block), "sha256": sha(restored[offset + 8:offset + 4104])})
        independent = {"version": {"major": 1, "minor": 0}, "base": sha(image_bytes),
                       "image_len": str(image_len), "generation": str(generation), "blocks": blocks}
        assert root_bytes == json.dumps(independent, separators=(",", ":")).encode(), name + " root differs from independent oracle"
        target = out / (name + ".ext4")
        clone = subprocess.run(["cp", "-c", str(source), str(target)], capture_output=True)
        if clone.returncode:
            shutil.copyfile(source, target)
        with target.open("r+b") as disk:
            for index in range(count):
                offset = 61 + index * 4104
                block = struct.unpack_from("<Q", restored, offset)[0]
                disk.seek(block * 4096)
                disk.write(restored[offset + 8:offset + 4104])
        before_recovery = file_sha(target)
        # A real ext4 checkpoint may require journal replay on the next mount. Recover only this
        # owned reconstructed copy; the original base, COW blocks and guest stores stay untouched.
        recovery = ["docker", "run", "--rm", "--network", "none", "-v", str(out) + ":/evidence:rw",
                    "--entrypoint", "/sbin/e2fsck", image_id, "-fy", "/evidence/" + target.name]
        with (out / (name + ".fsck.log")).open("wb") as log:
            result = subprocess.run(recovery, stdout=log, stderr=subprocess.STDOUT)
        assert result.returncode in (0, 1), (name, "filesystem recovery", result.returncode)
        command = ["docker", "run", "--rm", "--network", "none", "-v", str(out) + ":/evidence:ro",
                   "--entrypoint", "/usr/sbin/debugfs", image_id, "-R", "cat /root/e9-session/state", "/evidence/" + target.name]
        read = subprocess.run(command, capture_output=True)
        (out / (name + ".debugfs.log")).write_bytes(read.stderr)
        (out / (name + ".file")).write_bytes(read.stdout)
        assert read.returncode == 0 and read.stdout == expected_file, (name, read.stdout, read.stderr)
        report["roots"].append({"name": name, "generation": str(generation), "blocks": count,
                                "root_sha256": sha(root_bytes), "delta_sha256": sha(restored),
                                "image_before_journal_recovery": before_recovery, "image_after_recovery": file_sha(target),
                                "recovery_command": recovery, "read_command": command,
                                "file_hex": read.stdout.hex(), "file_sha256": sha(read.stdout)})
        (out / "filesystem-oracle.json").write_text(json.dumps(report, indent=2) + "\n")
    assert (out / "before-again.restored.wvod").read_bytes() == (out / "before.captured.wvod").read_bytes()
    assert file_sha(source) == fixture["raw_image_sha256"], "base changed"
    report["status"] = "passed"
    (out / "filesystem-oracle.json").write_text(json.dumps(report, indent=2) + "\n")
    print("All four independently reconstructed ext4 files match; base and older root unchanged.")
