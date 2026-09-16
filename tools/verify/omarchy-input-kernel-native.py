#!/usr/bin/env python3
"""Owned, bounded fresh native desktop capture with the verified AQ kernel."""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
KERNEL_SHA = "3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d"
NOTES_SHA = "7117bfaf56cad575a6473084a94e6e2976cc08b598b5fbbe7d9d3142d238d55f"


def identity(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return {"filename": str(path), "size": path.stat().st_size, "sha256": h.hexdigest()}


def drain_owned_group(child):
    """A dead shell leader does not establish that its owned descendants stopped."""
    def exists():
        child.poll()  # Reap our own leader without mistaking it for a live descendant.
        try:
            os.killpg(child.pid, 0)
            return True
        except ProcessLookupError:
            return False

    record = {"termSent": False, "killSent": False, "groupGone": False}
    for sig, budget, field in [(signal.SIGTERM, 10, "termSent"), (signal.SIGKILL, 5, "killSent")]:
        if not exists():
            record["groupGone"] = True
            return record
        try:
            os.killpg(child.pid, sig)
            record[field] = True
        except ProcessLookupError:
            record["groupGone"] = True
            return record
        deadline = time.monotonic() + budget
        while time.monotonic() < deadline:
            if not exists():
                record["groupGone"] = True
                return record
            time.sleep(0.05)
    record["groupGone"] = not exists()
    return record


def main():
    assert len(sys.argv) == 3, "usage: omarchy-input-kernel-native.py NEW_EVIDENCE_DIR NEW_PAIR_DIR"
    out, pair = [Path(p).resolve() for p in sys.argv[1:]]
    assert pair.is_relative_to(ROOT / "target") and not pair.exists()
    out.mkdir(parents=True, exist_ok=False)
    kernel = ROOT / "target/omarchy-input-kernel-r3/Image"
    base = ROOT / "target/omarchy-profile-sdr-r3.ext4"
    chunks = ROOT / "target/omarchy-profile-chunks-sdr-r3-256k"
    cli = ROOT / "target/release/wasm-vm"
    env = {k: v for k, v in os.environ.items() if not k.startswith("OMARCHY_")}
    env.update(DEVELOPER_DIR="/Library/Developer/CommandLineTools", KERNEL=str(kernel), BIN=str(cli),
               OMARCHY_IMAGE=str(base), OMARCHY_CHUNKS=str(chunks), OMARCHY_SNAPSHOT_DIR=str(pair),
               OMARCHY_BOOT_LOG=str(out / "boot.stdout.log"), OMARCHY_CAPTURE_TIMEOUT_MS="7200000",
               OMARCHY_EXPECT_RENDERER="llvmpipe", OMARCHY_EXPECT_LP_NUM_THREADS="1",
               OMARCHY_EXPECT_KERNEL_NOTES_SHA256=NOTES_SHA, MAX_INSTRS="150000000000")
    receipt = {"kind": "input-buffer-native-pair", "passed": False, "keyboardAcceptance": False,
               "startedAt": time.time(), "command": ["bash", "tools/build-omarchy-snapshot.sh"],
               "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, env=env, text=True).strip(),
               "pairDirectory": str(pair), "kernelNotesSha256": NOTES_SHA, "bootBudgetSeconds": 7200,
               "pipelineBudgetSeconds": 7380, "cleanupBudgetSeconds": 15}
    save = lambda: (out / "run.json").write_text(json.dumps(receipt, indent=2) + "\n")
    receipt["inputs"] = {name: identity(path) for name, path in
                         [("kernel", kernel), ("baseImage", base), ("cli", cli), ("chunkManifest", chunks / "manifest.json"),
                          ("wasm", ROOT / "web/dist/pkg/wasm_vm_wasm_bg.wasm")]}
    assert receipt["inputs"]["kernel"]["sha256"] == KERNEL_SHA
    assert receipt["inputs"]["wasm"]["sha256"] == "36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916"
    assert receipt["inputs"]["chunkManifest"]["sha256"] == "5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44"
    save()
    try:
        with (out / "pipeline.stdout.log").open("w") as stdout, (out / "pipeline.stderr.log").open("w") as stderr:
            child = subprocess.Popen(receipt["command"], cwd=ROOT, env=env, stdout=stdout, stderr=stderr, start_new_session=True)
            receipt["pid"] = child.pid
            save()
            try:
                receipt["returncode"] = child.wait(timeout=7380)
            except subprocess.TimeoutExpired:
                receipt["watchdog"] = True
                raise
            finally:
                receipt["cleanup"] = drain_owned_group(child)
        assert receipt["cleanup"]["groupGone"], "owned native process group did not drain"
        assert receipt["returncode"] == 0, "native capture failed"
        text = (out / "boot.stdout.log").read_text()
        records = re.findall(r"^OMARCHY_KERNEL_IDENTITY (.+)$", text, re.M)
        assert len(records) == 1
        receipt["kernelObservation"] = json.loads(records[0])
        assert receipt["kernelObservation"]["status"] == 0
        assert receipt["kernelObservation"]["output"].split() == [NOTES_SHA, "/sys/kernel/notes"]
        receipt["artifacts"] = {role: identity(pair / file) for role, file in
                                [("bootSnapshot", "omarchy-ready.snap.gz"), ("overlayDelta", "omarchy-overlay-delta.bin.gz")]}
        assert receipt["artifacts"]["bootSnapshot"]["sha256"] != "989dff1cad261ab6e53e1dea8f57cb12866d2a236b5366f114102744553d4e75"
        for name, path in [("kernel", kernel), ("baseImage", base), ("cli", cli), ("chunkManifest", chunks / "manifest.json")]:
            assert receipt["inputs"][name] == identity(path), f"input changed: {name}"
        receipt["passed"] = True
    finally:
        receipt["finishedAt"] = time.time()
        save()
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
