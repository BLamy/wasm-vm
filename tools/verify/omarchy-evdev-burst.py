#!/usr/bin/env python3
"""Record real guest evdev bytes against baseline/candidate kernels (no simulated ring)."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import struct
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]


def identity(file):
    data = file.read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def initramfs(binary):
    data = bytearray()
    def add(name, mode, content=b"", major=0, minor=0):
        fields = [1, mode, 0, 0, 1, 1731542400, len(content), 0, 0, major, minor, len(name) + 1, 0]
        data.extend(("070701" + "".join(f"{field:08x}" for field in fields)).encode())
        data.extend(name.encode() + b"\0")
        data.extend(b"\0" * (-len(data) % 4))
        data.extend(content)
        data.extend(b"\0" * (-len(data) % 4))
    add("dev", stat.S_IFDIR | 0o755)
    add("dev/console", stat.S_IFCHR | 0o600, major=5, minor=1)
    add("init", stat.S_IFREG | 0o755, binary)
    add("TRAILER!!!", 0)
    return gzip.compress(data, compresslevel=9, mtime=0)


def main():
    assert len(sys.argv) == 3, "usage: omarchy-evdev-burst.py NEW_EVIDENCE_DIR CANDIDATE_KERNEL_DIR"
    out = Path(sys.argv[1]).resolve()
    candidate = Path(sys.argv[2]).resolve()
    out.mkdir(parents=True, exist_ok=False)
    env = {**os.environ, "DEVELOPER_DIR": "/Library/Developer/CommandLineTools",
           "ZIG_GLOBAL_CACHE_DIR": "/private/tmp/omarchy-input-zig-cache"}
    receipt = {"passed": False, "commands": [], "runs": [], "head": subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, env=env, text=True).strip()}
    cli = ROOT / "target/release/wasm-vm"
    source = ROOT / "tools/verify/omarchy-evdev-burst-init.c"
    compiler = shutil.which("zig") or "/opt/homebrew/bin/zig"
    command = [compiler, "cc", "-target", "riscv64-linux-musl", "-Os", "-static", "-Wall", "-Wextra", "-Werror",
               str(source), "-o", str(out / "init")]
    receipt["commands"].append(command)
    try:
        assert subprocess.check_output([compiler, "version"], env=env, text=True).strip() == "0.16.0"
        subprocess.run(command, env=env, check=True, timeout=120, capture_output=True)
        (out / "initramfs.cpio.gz").write_bytes(initramfs((out / "init").read_bytes()))
        receipt["files"] = {str(p.relative_to(ROOT)): identity(p) for p in
                            [cli, source, out / "init", out / "initramfs.cpio.gz", candidate / "Image"]}
        assert json.loads((candidate / "build.json").read_text())["passed"] is True
        assert identity(candidate / "Image") == json.loads((candidate / "build.json").read_text())["artifacts"]["Image"]
        base = ROOT / "releases/kernel/6.6.63/Image"
        assert identity(base)["sha256"] == "af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce"
        pair = [(1, 30, 1), (0, 0, 0), (1, 30, 0), (0, 0, 0)]
        sentinel = [(1, 48, 1), (0, 0, 0)]
        # Independent literal sequences: baseline loses four groups of62,
        # candidate retains the burst; crossing1024 drops1022 preceding events.
        cases = [("baseline-legacy", base, None, pair),
                 ("baseline-burst", base, 64, [(0, 3, 0), (0, 0, 0)] + pair[-2:] + pair + sentinel),
                 ("candidate-legacy", candidate / "Image", None, pair),
                 ("candidate-burst", candidate / "Image", 64, pair * 64 + sentinel),
                 ("candidate-overflow", candidate / "Image", 256, [(0, 3, 0), (0, 0, 0)] + sentinel)]
        for name, kernel, pairs, expected in cases:
            command = [str(cli), "boot", "--kernel", str(kernel), "--initrd", str(out / "initramfs.cpio.gz"),
                       "--append", "console=ttyS0 earlycon=sbi rdinit=/init -- " + ("legacy" if pairs is None else "burst"),
                       "--no-input", "--no-reboot", "--max-instrs", "4000000000", "--block-cache",
                       "--interrupt-batching", "--keyboard-proof", "--evidence", str(out / (name + ".evidence.txt"))]
            if pairs is not None:
                command += ["--keyboard-proof-burst-pairs", str(pairs)]
            row = {"name": name, "command": command, "kernel": identity(kernel), "startedAt": time.time(), "passed": False}
            receipt["runs"].append(row)
            with (out / (name + ".stdout.log")).open("w") as stdout, (out / (name + ".stderr.log")).open("w") as stderr:
                result = subprocess.run(command, env=env, cwd=ROOT, stdout=stdout, stderr=stderr, timeout=300)
            row.update(returncode=result.returncode, elapsedSeconds=time.time() - row["startedAt"])
            text = (out / (name + ".stdout.log")).read_text()
            assert result.returncode == 0 and "WVB_ERROR" not in text, name
            assert "name=wasm-vm virtio keyboard measured=3 state=4" in text, name
            assert (pairs is None) == ("WVB_SENTINEL B_DOWN separate_client=1" not in text), name
            matches = re.findall(r"^WVB_EVENT (\d+) ([0-9a-f]{48})\r?$", text, re.M)
            assert [int(i) for i, _ in matches] == list(range(len(expected))), name
            raw = b"".join(bytes.fromhex(h) for _, h in matches)
            actual = [struct.unpack_from("<HHi", raw, i * 24 + 16) for i in range(len(expected))]
            assert actual == expected, (name, actual)
            assert f"WVB_DONE count={len(expected)} eagain=1" in text, name
            assert "pending events=0" in (out / (name + ".stderr.log")).read_text(), name
            (out / (name + ".events.bin")).write_bytes(raw)
            row.update(passed=True, events=actual, eventBytes=identity(out / (name + ".events.bin")))
        receipt["passed"] = True
    finally:
        (out / "result.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({"passed": True, "runs": [{k: r[k] for k in ("name", "passed", "elapsedSeconds")} for r in receipt["runs"]]}))


if __name__ == "__main__":
    main()
