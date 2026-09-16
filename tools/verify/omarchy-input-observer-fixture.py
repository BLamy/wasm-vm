#!/usr/bin/env python3
"""Bounded Linux pre-check against the fresh critic's independent C fixture."""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import queue
import signal
import subprocess
import sys
import threading
import time


out = Path(sys.argv[3])
clone_case = len(sys.argv) == 5 and sys.argv[4] == "clone"
out.mkdir(parents=True, exist_ok=False)
owned = []


class Process:
    def __init__(self, args, name):
        self.process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=(out / (name + ".stderr")).open("wb"))
        owned.append(self.process)
        self.rows = []
        self.queue = queue.Queue()

        def read():
            with (out / (name + ".jsonl")).open("wb") as log:
                for line in self.process.stdout:
                    log.write(line)
                    log.flush()
                    try:
                        row = json.loads(line)
                    except Exception as error:
                        row = {"parseError": str(error), "line": line.decode(errors="replace")}
                    self.rows.append(row)
                    self.queue.put(row)
            self.queue.put({"eof": True})

        self.thread = threading.Thread(target=read)
        self.thread.start()

    def wait(self, kind, timeout=15):
        deadline = time.monotonic() + timeout
        while True:
            row = self.queue.get(timeout=max(.001, deadline-time.monotonic()))
            assert not row.get("eof"), (kind, self.rows)
            assert "parseError" not in row, row
            if row.get("type", row.get("kind")) == kind:
                return row

    def finish(self, code=0):
        assert self.process.wait(timeout=10) == code, self.rows
        self.thread.join(timeout=2)
        assert not self.thread.is_alive()


def status(tid):
    text = Path(f"/proc/{tid}/status").read_text()
    return {k: v.strip() for k, v in (line.split(":", 1) for line in text.splitlines())}


result = {"passed": False, "platform": os.uname()._asdict() if hasattr(os.uname(), "_asdict") else list(os.uname())}
try:
    fixture = Process([sys.argv[2]], "fixture")
    ready = fixture.wait("READY")
    tids = [ready["mainTid"], ready["workerTid"]]
    observer = Process([sys.argv[1], str(ready["pid"])], "observer")
    attached = observer.wait("ready")
    assert attached["threads"] == 2
    result["attachedStatus"] = [status(tid) for tid in tids]
    assert all(int(s["TracerPid"]) == observer.process.pid for s in result["attachedStatus"])
    fixture.process.stdin.write(b"GO\n")
    fixture.process.stdin.flush()
    fixture.wait("READY_TO_DETACH")
    if clone_case:
        clones = [r for r in fixture.rows if r.get("type") == "CLONE_READY"]
        assert len(clones) == 1
        tids.append(clones[0]["cloneTid"])
        result["cloneAttachedStatus"] = status(tids[-1])
        assert int(result["cloneAttachedStatus"]["TracerPid"]) == observer.process.pid
    observer.process.send_signal(signal.SIGTERM)
    observer.finish()
    result["detachedStatus"] = [status(tid) for tid in tids]
    assert all(int(s["TracerPid"]) == 0 for s in result["detachedStatus"])
    fixture.process.stdin.write(b"DONE\n")
    fixture.process.stdin.flush()
    detached = fixture.wait("DETACHED")
    assert detached["ok"] is True
    fixture.finish()
    assert any(r.get("type") == "worker-post-detach-progress" for r in fixture.rows)
    if clone_case:
        assert any(r.get("type") == "clone-post-detach-progress" for r in fixture.rows)
        assert any(r.get("type") == "CLONE_DETACHED" for r in fixture.rows)
    rows = observer.rows
    assert not any(r.get("kind") == "error" for r in rows)
    assert {r["tid"] for r in rows if r.get("kind") == "detached"} == set(tids)
    identities = [r for r in rows if r.get("kind") == "process-identity"]
    assert {r["tid"] for r in identities} == set(tids)
    assert all(r["tgid"] == ready["pid"] and r["startTime"].isdigit() for r in identities)
    reads = [r for r in rows if r.get("kind") == "read"]
    assert not any(r["evdev"] for r in reads), "pipes cannot become evdev"
    literals = {
        "main-short-24": "0100000000000000020000000000000001001e0001000000",
        "main-eagain": "",
        "main-readv-48-split-7-41": "0300000000000000040000000000000000000300000000000500000000000000060000000000000001001e00ffffffff",
        "worker-partial-25": "0500000000000000060000000000000001001e00ffffffffa5",
        "worker-eagain": "",
        "main-interleaved-blocking-24": "070000000000000008000000000000000000000000000000",
        "main-reused-non-input-24": "030000000000000004000000000000000000030000000000",
    }
    if clone_case:
        literals["clone-short-24"] = literals["main-short-24"]
        assert any(r.get("kind") == "clone" and r["tid"] == tids[-1] for r in rows)
    matched = {}
    for expected in [r for r in fixture.rows if r.get("type") == "read-result"]:
        name = expected["name"]
        assert expected["hex"] == literals[name]
        raw_return = -expected["errno"] if expected["returned"] < 0 else expected["returned"]
        matches = [r for r in reads if r["tid"] == expected["tid"] and r["fd"] == expected["fd"]
                   and r["requested"] == expected["requested"] and r["returned"] == raw_return
                   and r["hex"] == literals[name]]
        assert len(matches) == 1, (name, matches)
        observed = matched[name] = matches[0]
        assert observed["captureComplete"] and observed["identityStable"] and observed["iovStable"]
        assert observed["syscallError"] == (raw_return < 0)
        assert observed["entry"]["mode"] & 0o170000 == 0o010000
        entries = [r for r in rows if r.get("sequence") == observed["entrySequence"]]
        assert len(entries) == 1 and entries[0]["kind"] == "read-entry"
        assert entries[0]["tid"] == observed["tid"]
    assert set(matched) == set(literals)
    assert matched["main-short-24"]["entry"]["inode"] != matched["main-reused-non-input-24"]["entry"]["inode"]
    assert matched["main-interleaved-blocking-24"]["entrySequence"] < matched["worker-partial-25"]["entrySequence"]
    assert matched["worker-eagain"]["sequence"] < matched["main-interleaved-blocking-24"]["sequence"]
    result["matched"] = matched

    # Partial attachment failure: this runner owns only the worker TID;
    # the observer must release the main TID it seizes before EPERM.
    fixture2 = Process([sys.argv[2]], "partial-fixture")
    ready2 = fixture2.wait("READY")
    libc = ctypes.CDLL(None, use_errno=True)
    libc.ptrace.restype = ctypes.c_long
    worker = ready2["workerTid"]
    assert libc.ptrace(0x4206, worker, 0, 0) == 0, ctypes.get_errno()
    partial = Process([sys.argv[1], str(ready2["pid"])], "partial-observer")
    partial.finish(code=1)
    assert any(r.get("kind") == "error" and r["stage"] == "seize" for r in partial.rows)
    assert any(r.get("kind") == "detached" and r["tid"] == ready2["mainTid"] for r in partial.rows)
    result["partialStatus"] = [status(ready2["mainTid"]), status(worker)]
    assert int(result["partialStatus"][0]["TracerPid"]) == 0
    assert int(result["partialStatus"][1]["TracerPid"]) == os.getpid()
    assert libc.ptrace(0x4207, worker, 0, 0) == 0
    deadline = time.monotonic()+5
    while True:
        waited, _ = os.waitpid(worker, os.WNOHANG | 0x40000000)
        if waited == worker:
            break
        assert time.monotonic() < deadline
        time.sleep(.001)
    assert libc.ptrace(17, worker, 0, 0) == 0
    assert int(status(worker)["TracerPid"]) == 0
    fixture2.process.terminate()
    fixture2.finish(code=-signal.SIGTERM)
    result["passed"] = True
finally:
    for process in reversed(owned):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
    (out / "result.json").write_text(json.dumps(result, indent=2)+"\n")
    (out / "sha256.txt").write_text("".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n"
                                           for p in sorted(out.iterdir()) if p.name != "sha256.txt"))
print(json.dumps({"passed": result["passed"], "cases": len(result.get("matched", {}))}))
