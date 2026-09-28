#!/usr/bin/env python3
"""Independent near-capacity attack; does not import the worker's parser/oracle."""
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import time


def digest(path):
    data = path.read_bytes()
    return {"path": str(path), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def main():
    assert len(sys.argv) == 5, "usage: boundary-attack.py CLI KERNEL INITRD NEW_OUTPUT"
    cli, kernel, initrd, out = [Path(p).resolve() for p in sys.argv[1:]]
    out.mkdir(parents=True, exist_ok=False)
    env = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR") if key in os.environ}
    env["DEVELOPER_DIR"] = "/Library/Developer/CommandLineTools"
    command = [str(cli), "boot", "--kernel", str(kernel), "--initrd", str(initrd),
               "--append", "console=ttyS0 earlycon=sbi rdinit=/init -- burst",
               "--no-input", "--no-reboot", "--max-instrs", "4000000000",
               "--block-cache", "--interrupt-batching", "--keyboard-proof",
               "--keyboard-proof-burst-pairs", "255", "--evidence", str(out / "guest.evidence.txt")]
    result = {"passed": False, "prediction": "1022 exact events; no SYN_DROPPED",
              "filesBefore": [digest(p) for p in (cli, kernel, initrd)], "command": command,
              "environmentKeys": sorted(env), "startedAtUnixSeconds": time.time()}
    result["head"] = subprocess.check_output(["git", "rev-parse", "HEAD"], env=env, text=True).strip()
    try:
        with (out / "stdout.log").open("w") as stdout, (out / "stderr.log").open("w") as stderr:
            run = subprocess.run(command, env=env, stdin=subprocess.DEVNULL,
                                 stdout=stdout, stderr=stderr, timeout=300)
        result.update(returncode=run.returncode,
                      elapsedSeconds=time.time() - result["startedAtUnixSeconds"])
        assert run.returncode == 0
        text = (out / "stdout.log").read_text()
        assert "WVB_ERROR" not in text
        assert text.count("WVB_DEVICE name=wasm-vm virtio keyboard measured=3 state=4") == 1
        assert text.count("WVB_SENTINEL B_DOWN separate_client=1") == 1
        records = re.findall(r"^WVB_EVENT ([0-9]+) ([0-9a-f]{48})\r?$", text, re.M)
        assert [int(index) for index, _ in records] == list(range(1022))
        raw = b"".join(bytes.fromhex(value) for _, value in records)
        (out / "events.bin").write_bytes(raw)
        expected = []
        for _ in range(255):
            expected.extend(((1, 30, 1), (0, 0, 0), (1, 30, 0), (0, 0, 0)))
        expected.extend(((1, 48, 1), (0, 0, 0)))
        actual = [struct.unpack_from("<HHi", raw, offset + 16) for offset in range(0, len(raw), 24)]
        assert actual == expected
        assert "WVB_DONE count=1022 eagain=1" in text
        stderr = (out / "stderr.log").read_text()
        assert "pairs=255 events=1022" in stderr and "pending events=0" in stderr
        result["eventCount"] = len(actual)
        result["synchronizationDrops"] = sum(t == 0 and c == 3 for t, c, _ in actual)
        result["eventBytes"] = digest(out / "events.bin")
        result["argumentAttacks"] = []
        for label, args, required in (
            ("zero", ["--keyboard-proof", "--keyboard-proof-burst-pairs", "0"], "invalid value"),
            ("over-limit", ["--keyboard-proof", "--keyboard-proof-burst-pairs", "513"], "invalid value"),
            ("missing-opt-in", ["--keyboard-proof-burst-pairs", "64"], "--keyboard-proof"),
        ):
            argv = [str(cli), "boot", "--kernel", str(kernel), *args]
            attempt = subprocess.run(argv, env=env, stdin=subprocess.DEVNULL,
                                     capture_output=True, text=True, timeout=10)
            (out / (label + ".stderr.log")).write_text(attempt.stderr)
            result["argumentAttacks"].append({"label": label, "command": argv,
                                             "returncode": attempt.returncode})
            assert attempt.returncode == 2 and required in attempt.stderr
            assert not attempt.stdout
        result["filesAfter"] = [digest(p) for p in (cli, kernel, initrd)]
        assert result["filesBefore"] == result["filesAfter"]
        result["passed"] = True
    finally:
        (out / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"passed": True, "events": result["eventCount"],
                      "synchronizationDrops": result["synchronizationDrops"]}))


if __name__ == "__main__":
    main()
