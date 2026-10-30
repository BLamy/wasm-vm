#!/usr/bin/env python3
"""Read literal guest files from captured native COW state, without emulator codecs.

This direct oracle supports development qualification. It is not T22 acceptance
or a substitute for the fresh Daybreak verifier.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--directory", required=True, type=Path)
a = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
out = a.directory.resolve()
proof = out / "filesystem-oracle"
proof.mkdir(exist_ok=False)
sha = lambda value: hashlib.sha256(value).hexdigest()
u32 = lambda value, at: struct.unpack_from("<I", value, at)[0]
u64 = lambda value, at: struct.unpack_from("<Q", value, at)[0]
contract = json.loads((repo / "docs/design/session-replay-contract.json").read_text())
fixture = next(f for f in contract["fixtures"] if f["id"] == "software-alpine-v1")
original = (out / "report.json").read_bytes()
browser = json.loads(original)
assert browser["status"] == "offline-software-setup-prefix-only"
base = repo / fixture["artifacts"]["rootfs"]["url"]
builder = "sha256:0d1ead8c1106a838e478676dff113f21cdd91eb9456232ff9f6c24679a87d0eb"
report = {"status": "running", "scope": "direct original snapshot COW filesystem oracle; offline setup qualification only", "browserSha256": sha(original), "builder": builder, "points": {}}

def hash_file(file):
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1048576), b""):
            digest.update(chunk)
    return digest.hexdigest()

def sections(raw):
    assert raw[:12] == b"WVMRESU1\1\0\0\0"
    at, result = 84, {}
    while at < len(raw):
        tag, length = struct.unpack_from("<II", raw, at)
        at += 8
        assert tag not in result and 0 <= length <= len(raw) - at
        result[tag] = raw[at:at + length]
        at += length
    assert at == len(raw)
    return result

def overlay(device, identity):
    length = u32(device, 0)
    assert length <= len(device) - 4
    hub = device[4:4 + length]
    assert hub[:8] == b"WVDEVST1"
    size = u32(hub, 8)
    config = hub[12:12 + size]
    assert config[2] == 1 and config[3:35] == identity
    assert u64(config, 35) * 512 == base.stat().st_size
    at = 12 + size + 32
    assert u32(hub, at) == 0, "original outstanding block requests must be settled"
    at += 4
    count = u32(hub, at)
    at += 4
    for _ in range(count):
        at += 12
        length = u32(hub, at)
        at += 4 + length
        assert at <= len(hub)
    failed = u32(hub, at)
    at += 4 + failed * 5
    reads = u32(hub, at)
    at += 4
    for _ in range(reads):
        at += 12
        count = u32(hub, at)
        at += 4 + count * 4
    count = u32(hub, at)
    at += 4
    blocks = {}
    for _ in range(count):
        sector = u64(hub, at)
        at += 8
        assert sector < base.stat().st_size // 512 and sector not in blocks
        blocks[sector] = hub[at:at + 512]
        assert len(blocks[sector]) == 512
        at += 512
    assert at + 9 == len(hub) and u64(hub, at) == 0 and hub[at + 8] == 0
    return blocks

try:
    assert base.stat().st_size == fixture["artifacts"]["rootfs"]["size"]
    report["baseSha256"] = hash_file(base)
    assert report["baseSha256"] == fixture["artifacts"]["rootfs"]["sha256"] == browser["inputs"]["rawImage"]
    for label, key in [("before", "before"), ("final", "after")]:
        file = out / (label + ".resume")
        assert file.stat().st_size <= 320 * 1048576
        raw = file.read_bytes()
        assert sha(raw) == browser["result"][label]["native"]["sha256"]
        parts = sections(raw)
        blocks = overlay(parts[20], raw[44:76])
        reconstructed = proof / (label + ".ext4")
        clone = subprocess.run(["cp", "-c", str(base), str(reconstructed)], capture_output=True)
        if clone.returncode:
            shutil.copyfile(base, reconstructed)
        with reconstructed.open("r+b") as disk:
            for sector, value in blocks.items():
                disk.seek(sector * 512)
                disk.write(value)
        recovery = ["docker", "run", "--rm", "--network", "none", "-v", str(proof) + ":/proof:rw", "--entrypoint", "/sbin/e2fsck", builder, "-fy", "/proof/" + reconstructed.name]
        recovered = subprocess.run(recovery, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (proof / (label + ".fsck.log")).write_bytes(recovered.stdout)
        assert recovered.returncode in (0, 1), recovered.stdout
        command = ["docker", "run", "--rm", "--network", "none", "-v", str(proof) + ":/proof:ro", "--entrypoint", "/usr/sbin/debugfs", builder, "-R", "cat /root/e9-session/state", "/proof/" + reconstructed.name]
        read = subprocess.run(command, capture_output=True)
        (proof / (label + ".file")).write_bytes(read.stdout)
        (proof / (label + ".debugfs.log")).write_bytes(read.stderr)
        assert read.returncode == 0 and read.stdout.hex() == contract["workload"][key + "_hex"]
        assert sha(read.stdout) == contract["workload"][key + "_sha256"]
        position = browser["result"][label]
        assert str(u64(parts[18], 12)) == position["transition"]
        assert str(u64(parts[18], 36)) == position["sequence"]
        report["points"][label] = {"nativeSha256": sha(raw), "transition": position["transition"], "sequence": position["sequence"], "overlaySectors": len(blocks), "literalHex": read.stdout.hex(), "fileSha256": sha(read.stdout), "recovery": recovery, "readCommand": command}
    assert report["points"]["before"]["nativeSha256"] != report["points"]["final"]["nativeSha256"]
    report["status"] = "offline-files-held"
except Exception as error:
    report["status"] = "failed"
    report["error"] = str(error)
    raise
finally:
    (proof / "report.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
