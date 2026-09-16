#!/usr/bin/env python3
"""Bounded independent AP check: SIGSTOP must prevent target progress."""
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

observer_path, output_path = sys.argv[1:]
out = Path(output_path)
out.mkdir(exist_ok=False)
result = {"expected": "external SIGSTOP prevents progress until SIGCONT",
          "observerSha256": hashlib.sha256(Path(observer_path).read_bytes()).hexdigest(),
          "startedAt": time.time(), "passed": False}
owned = []


class Process:
    def __init__(self, args, name):
        self.rows = []
        self.messages = queue.Queue()
        self.process = subprocess.Popen(args, stdout=subprocess.PIPE, stdin=subprocess.DEVNULL,
                                        stderr=(out / (name + ".stderr")).open("wb"))
        owned.append(self.process)

        def receive():
            with (out / (name + ".jsonl")).open("wb") as log:
                for line in self.process.stdout:
                    log.write(line)
                    log.flush()
                    row = json.loads(line)
                    self.rows.append(row)
                    self.messages.put(row)
            self.messages.put({"eof": True})
        self.thread = threading.Thread(target=receive)
        self.thread.start()

    def wait(self, kind):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            row = self.messages.get(timeout=max(.001, deadline - time.monotonic()))
            assert not row.get("eof"), self.rows
            if row.get("kind") == kind:
                return row
        raise AssertionError("missing " + kind)


def proc_status(pid):
    raw = Path(f"/proc/{pid}/status").read_text()
    return {name: value.strip() for name, value in
            (line.split(":", 1) for line in raw.splitlines())}


try:
    target = Process([sys.executable, "-u", "-c", """
import json,os,time
print(json.dumps({'kind':'target-ready','pid':os.getpid()}), flush=True)
i=0
while True:
    i+=1
    print(json.dumps({'kind':'progress','iteration':i}), flush=True)
    time.sleep(.02)
"""], "target")
    ready = target.wait("target-ready")
    observer = Process([observer_path, str(ready["pid"])], "observer")
    result["ready"] = observer.wait("ready")
    result["beforeStop"] = proc_status(target.process.pid)
    assert int(result["beforeStop"]["TracerPid"]) == observer.process.pid
    os.kill(target.process.pid, signal.SIGSTOP)
    result["stopSentAt"] = time.time()
    time.sleep(.15)
    result["stoppedStatus"] = proc_status(target.process.pid)
    result["progressBeforeWindow"] = sum(r.get("kind") == "progress" for r in target.rows)
    time.sleep(.35)
    result["progressAfterWindow"] = sum(r.get("kind") == "progress" for r in target.rows)
    result["afterStopWindow"] = proc_status(target.process.pid)
    result["progressDuringStop"] = result["progressAfterWindow"] - result["progressBeforeWindow"]
    os.kill(target.process.pid, signal.SIGCONT)
    result["continueSentAt"] = time.time()
    time.sleep(.05)
    observer.process.send_signal(signal.SIGTERM)
    result["observerExit"] = observer.process.wait(timeout=5)
    observer.thread.join(timeout=1)
    result["afterDetach"] = proc_status(target.process.pid)
    result["passed"] = result["progressDuringStop"] == 0 and int(result["afterDetach"]["TracerPid"]) == 0
finally:
    for process in reversed(owned):
        if process.poll() is None:
            os.kill(process.pid, signal.SIGCONT)
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
    result["finishedAt"] = time.time()
    (out / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    (out / "sha256.txt").write_text("".join(
        f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n"
        for p in sorted(out.iterdir()) if p.name != "sha256.txt"))
print(json.dumps({name: result.get(name) for name in
                 ["passed", "observerSha256", "progressDuringStop", "observerExit"]}))
sys.exit(0 if result["passed"] else 1)
