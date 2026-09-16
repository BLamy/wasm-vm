#!/usr/bin/env python3
"""Exercise the unchanged native wrapper timeout branch with an owned process tree.

Tiny fake input identities bypass expensive guest setup only. The actual wrapper
main, process session, group signals, and waits execute. Never touches guest PIDs.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import types

repo = Path(__file__).resolve().parents[3]
source = repo / "tools/verify/omarchy-input-kernel-native.py"
out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=False)
fixture = out / "fixture"
(fixture / "tools").mkdir(parents=True)
(fixture / "target").mkdir()
ready = fixture / "descendant.pid"
heartbeat = fixture / "descendant.heartbeat"
descendant_source = "\n".join([
    "import os,pathlib,signal,time",
    "signal.signal(signal.SIGTERM, signal.SIG_IGN)",
    f"pathlib.Path({str(ready)!r}).write_text(str(os.getpid()))",
    "while True:",
    f" pathlib.Path({str(heartbeat)!r}).write_text(str(time.monotonic_ns()))",
    " time.sleep(0.01)",
])
pipeline = fixture / "pipeline.py"
pipeline.write_text("import subprocess,sys,time\n"
                    f"subprocess.Popen([sys.executable, '-c', {descendant_source!r}])\n"
                    "while True: time.sleep(0.05)\n")
(fixture / "tools/build-omarchy-snapshot.sh").write_text(
    '#!/bin/bash\nexec "$ATTACK_PYTHON" "$ATTACK_PIPELINE"\n')
os.environ["ATTACK_PYTHON"] = sys.executable
os.environ["ATTACK_PIPELINE"] = str(pipeline)
spec = importlib.util.spec_from_file_location("native_wrapper_under_test", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.ROOT = fixture
real_popen = subprocess.Popen
owned = []


class AcceleratedDeadline:
    def __init__(self, proc):
        self.proc, self.pid = proc, proc.pid
        owned.append(proc)

    def wait(self, timeout):
        if timeout == 7380:
            until = time.monotonic() + 5
            while not ready.exists() and time.monotonic() < until:
                time.sleep(.01)
            if not ready.exists():
                raise RuntimeError("fixture descendant failed to become ready")
            raise subprocess.TimeoutExpired("owned-fixture-deadline", 7380)
        return self.proc.wait(timeout=timeout)

    def poll(self):
        return self.proc.poll()


module.subprocess = types.SimpleNamespace(
    Popen=lambda *a, **kw: AcceleratedDeadline(real_popen(*a, **kw)),
    TimeoutExpired=subprocess.TimeoutExpired,
    check_output=lambda *a, **kw: "synthetic-cleanup-fixture\n",
)


def fake_identity(path):
    sha = {
        "Image": module.KERNEL_SHA,
        "wasm_vm_wasm_bg.wasm": "36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916",
        "manifest.json": "5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44",
    }.get(path.name, "fixture-only")
    return {"filename": str(path), "size": 0, "sha256": sha}


module.identity = fake_identity
sys.argv = [str(source), str(out / "recording"), str(fixture / "target/new-pair")]
receipt = {"purpose": "owned-cleanup-only-synthetic-fixture",
           "source": str(source), "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest()}
try:
    try:
        module.main()
        receipt["wrapperError"] = None
    except BaseException as error:
        receipt["wrapperError"] = f"{type(error).__name__}: {error}"
    descendant = int(ready.read_text())
    receipt["leaderPid"] = owned[0].pid
    receipt["leaderReturncode"] = owned[0].poll()
    receipt["descendantPid"] = descendant
    try:
        receipt["descendantPgid"] = os.getpgid(descendant)
        receipt["descendantExistsAtWrapperReturn"] = True
    except ProcessLookupError:
        receipt["descendantPgid"] = None
        receipt["descendantExistsAtWrapperReturn"] = False
    receipt["heartbeatAtWrapperReturn"] = heartbeat.read_text()
    time.sleep(.1)
    receipt["heartbeatAfterWrapperReturn"] = heartbeat.read_text()
    receipt["descendantSurvivedWrapper"] = receipt["heartbeatAtWrapperReturn"] != receipt["heartbeatAfterWrapperReturn"]
    receipt["wrapperReceipt"] = json.loads((out / "recording/run.json").read_text())
finally:
    for proc in owned:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait(timeout=5)
    time.sleep(.1)
    if ready.exists():
        last = heartbeat.read_text()
        time.sleep(.1)
        receipt["heartbeatStoppedAfterVerifierCleanup"] = heartbeat.read_text() == last
    (out / "attack.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt, indent=2))
