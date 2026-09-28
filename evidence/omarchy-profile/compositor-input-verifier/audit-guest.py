#!/usr/bin/env python3
"""Independent AP receipt/trace audit; no guest, browser, or production decoder."""
import base64
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess

repo = Path(__file__).resolve().parents[3]
proof = repo / "evidence/omarchy-profile/compositor-input-r2/physical-r2"
desktop = proof / "desktop"
out = Path(__file__).with_name("guest-audit.json")
digest = lambda value: hashlib.sha256(value).hexdigest()
ms = lambda value: round(datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
raw = (desktop / "report.json").read_bytes()
assert digest(raw) == "c272930f9dcf5545aa83fdb97b614cdccdef79c1ecd3aabfa96f1bef1c5c3327"
r = json.loads(raw)
receipt = json.loads((proof / "run.json").read_text())
observer = r["inputObserver"]
trace = (desktop / "compositor-input.jsonl").read_bytes()
assert digest(trace) == observer["trace"]["sha256"] == "b5a7263afeead83140f4e5f0cc5f59986aca72d2252fb287b34cf4071f68d9bf"
assert receipt["head"] == r["trial"]["head"] == "9c5e197a65889f5301830b3a2ec4dd836e3980de"
assert r["trial"]["scopedStatus"] == ""
assert receipt["exit"] == {"code": 1, "signal": None, "closed": True, "watchdog": None}
env = {**os.environ, "DEVELOPER_DIR": "/Library/Developer/CommandLineTools"}
for name, identity in r["trial"]["helpers"].items():
    data = subprocess.check_output(["git", "show", receipt["head"] + ":" + name], cwd=repo, env=env)
    assert len(data) == identity["size"] and digest(data) == identity["sha256"], name
assert subprocess.check_output(["git", "diff", "--name-only", "a3beb0e8dc5da21374a6d59e25658f5db5ce79da.." + receipt["head"], "--", "crates", "web"], cwd=repo, env=env) == b""
assert digest((repo / "web/dist/pkg/wasm_vm_wasm_bg.wasm").read_bytes()) == receipt["wasmSha256"] == "36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916"
binary = Path(observer["binaryPath"]).read_bytes()
assert digest(binary) == observer["binarySha256"] == receipt["observerSha256"] == "10d9e82ce33bb8eafaf55e8aa5e8ee86bd7bdfa4998fd367f374ff70e3ff792d"
assert binary[:6] == b"\x7fELF\x02\x01" and struct.unpack_from("<H", binary, 18)[0] == 243
install = observer["commands"][0]["command"]
payload = install.split("\n", 1)[1].split("\nWVIN_OBSERVER_BINARY\n", 1)[0]
assert gzip.decompress(base64.b64decode(payload)) == binary
assert observer["commands"][0]["response"]["stdout"].strip() == observer["binarySha256"] + "  " + observer["directory"] + "/observer"
for name in ["kernel", "chunkManifest", "bootSnapshot", "overlayDelta"]:
    actual = r["candidate"]["source"][name]
    assert {k: actual[k] for k in ["size", "sha256"]} == receipt["pairIdentities"][name]

rows = [json.loads(line) for line in trace.splitlines()]
identities = {x["tid"]: x for x in rows if x["kind"] == "process-identity"}
tids = set(identities)
assert len(tids) == 13
assert all(x["tgid"] == 417 and x["tracerPid"] == 1860 and x["exe"] == "/usr/bin/Hyprland" for x in identities.values())
assert {x["tid"] for x in rows if x["kind"] == "seized"} == tids
assert {x["tid"] for x in rows if x["kind"] == "detached"} == tids
assert not any(x["kind"] in ["error", "clone", "thread-exit"] for x in rows)
for stage in ["before", "attached", "after"]:
    data = observer[stage]
    assert {x["tid"] for x in data["stats"]} == {x["tid"] for x in data["statuses"]} == tids
    for task in data["stats"]:
        assert task["starttime"] == identities[task["tid"]]["startTime"]
    assert all(x["tgid"] == 417 and x["tracerPid"] == (1860 if stage == "attached" else 0) for x in data["statuses"])
    assert all(x["state"][0] in "RS" for x in data["statuses"])
ready = next(x for x in rows if x["kind"] == "ready")
finished = rows[-1]
assert finished["kind"] == "finished" and finished["stopSignal"] == 15
assert not finished["failed"] and not finished["stopBudgetReached"] and finished["orphanExits"] == 0
assert ready["monotonicMs"] == 157732 and finished["observationEndMonotonicMs"] == 166540
assert finished["cleanupEndMonotonicMs"] == 166544
entries = {x["sequence"]: x for x in rows if x["kind"] == "read-entry"}
reads = [x for x in rows if x["kind"] == "read"]
assert len(entries) == len(reads) == finished["reads"] == 58
assert sum(len(bytes.fromhex(x["hex"])) for x in reads) == finished["capturedBytes"] == 8464
evdev = []
for line, x in enumerate(rows, 1):
    if x["kind"] != "read":
        continue
    entry = entries[x["entrySequence"]]
    assert entry["sequence"] < x["sequence"] and entry["arch"] == 0xc00000f3
    assert all(entry[k] == x[k] for k in ["tid", "fd", "nr"])
    assert entry["arg2"] == x["requested"] and x["nr"] == 63
    assert x["syscallError"] == (x["returned"] < 0)
    assert x["supported"] and x["iovStable"] and x["captureComplete"] and x["identityStable"]
    data = bytes.fromhex(x["hex"])
    assert len(data) == max(0, x["returned"])
    if not x["evdev"]:
        continue
    assert x["entry"] == x["exit"]
    identity = x["entry"]
    assert identity["valid"] and identity["input"] and identity["mode"] & 0o170000 == 0o020000
    assert identity["subsystem"].endswith("/input") and x["tid"] == 417
    assert (x["fd"], identity["path"], int(identity["rdev"])) in [(21, "/dev/input/event0", 3392), (22, "/dev/input/event1", 3393)]
    assert len(data) % 24 == 0
    events = [struct.unpack_from("<qqHHi", data, pos) for pos in range(0, len(data), 24)]
    assert all(0 <= e[1] < 1000000 for e in events)
    evdev.append({"line": line, "fd": x["fd"], "returned": x["returned"], "events": events})
keyboard = [e for x in evdev if x["fd"] == 21 for e in x["events"]]
assert [(e[2], e[3], e[4]) for e in keyboard] == [(0,3,0),(0,0,0),(1,30,0),(0,0,0),(1,28,1),(0,0,0),(1,28,0),(0,0,0)]
assert [x["returned"] for x in evdev if x["fd"] == 21] == [192, -11, -11]

# Independently map this US keyboard command's physical events to Linux codes.
code = {"Space":57,"Slash":53,"Minus":12,"Quote":40,"Period":52,"ShiftLeft":42,"Enter":28,"Digit0":11}
for letters, start in [("qwertyuiop",16),("asdfghjkl",30),("zxcvbnm",44)]:
    code.update({"Key"+c.upper(): start+i for i,c in enumerate(letters)})
code.update({"Digit"+str(i):i+1 for i in range(1,10)})
keys = r["inputEvents"]
assert len(keys) == 128 and all(x["trusted"] and x["target"] == x["activeElement"] == "ide-display-canvas" for x in keys)
command = "printf '" + r["keyboard"]["nonce"] + "' > " + r["keyboard"]["guestFile"]
assert "".join(x["key"] for x in keys if x["type"] == "keydown" and len(x["key"]) == 1) == command
expected = [[1, code[x["code"]], 1 if x["type"] == "keydown" else 0] for x in keys]
assert expected[-3:] == [[1,30,0],[1,28,1],[1,28,0]]
calls = [x for x in r["workerTraffic"] if x["type"] == "worker-call" and x["method"] in ["sendKeyboardEvent", "syncKeyboard"]]
assert len(calls) == 256
for i, call in enumerate(calls):
    assert call["method"] == ("sendKeyboardEvent" if i % 2 == 0 else "syncKeyboard")
    assert call["args"] == (expected[i//2] if i % 2 == 0 else []) and call["sent"]
    reply = [x for x in r["workerTraffic"] if x["type"] == "input-result" and x["worker"] == call["worker"] and x["id"] == call["id"] and x["method"] == call["method"]]
    assert len(reply) == 1 and reply[0]["result"] is True and reply[0]["error"] is None

# Reconstruct serial RPCs and nonce-read exits directly from the raw wire.
sent = b"".join(bytes(x["bytes"]) for x in r["workerTraffic"] if x["type"] == "serial-input").decode()
assert r["keyboard"]["nonce"] not in sent
wire = list(re.finditer(r"printf '\\n__WVBEGIN_([a-z0-9]+)\\n'; (.*?); printf '\\n__WVEND_\1_%s\\n' \"\$\?\"\r", sent, re.S))
assert len(wire) == 48
allowed = {x["command"] for x in r["serialCommands"]} | {"XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers"}
assert all(x.group(2) in allowed for x in wire)
lookup = "if [ -f '" + r["keyboard"]["guestFile"] + "' ]; then cat '" + r["keyboard"]["guestFile"] + "'; else (exit 75); fi"
read_ids = [x.group(1) for x in wire if x.group(2) == lookup]
assert len(read_ids) == 36
received = "".join(x["text"] for x in r["workerTraffic"] if x["type"] == "serial-output").replace("\r", "")
readbacks = []
for rid in read_ids:
    responses = re.findall(r"(?:^|\n)__WVBEGIN_" + rid + r"\n(.*?)\n__WVEND_" + rid + r"_(\d+)\n", received, re.S)
    assert len(responses) == 1 and responses[0][0].strip() == "" and responses[0][1] == "75"
    readbacks.append({"id":rid,"exit":75})
assert ms(r["keyboard"]["deadlineAt"]) == r["keyboard"]["enteredAtMs"] + 120000
assert ms(r["keyboard"]["failedAt"]) - ms(r["keyboard"]["deadlineAt"]) == 1
assert ms(observer["attachedAt"]) <= ms(r["keyboard"]["startedAt"])
assert ms(observer["collection"]["startedAt"]) >= ms(r["keyboard"]["failedAt"])
boundary = next(x for x in observer["commands"] if x["stage"] == "input-observer:observation-boundary")
stop = next(x for x in observer["commands"] if x["stage"] == "input-observer:stop")
assert ms(stop["startedAt"]) > ms(r["keyboard"]["deadlineAt"])
assert "1860 (observer) S " in boundary["response"]["stdout"] and '"kind":"finished"' not in boundary["response"]["stdout"]
assert re.search(r"^WVINEXIT 0$", stop["response"]["stdout"], re.M)
assert ms(observer["collection"]["finishedAt"]) <= ms(observer["collection"]["deadlineAt"])
assert r["cleanup"]["closed"] and r["cleanup"]["clientClosed"] and not r["errors"]
assert ms(receipt["finishedAt"]) - ms(r["cleanup"]["startedAt"]) < 30000

summary = {"passed": True, "head": receipt["head"], "reportSha256": digest(raw), "traceSha256": digest(trace),
           "observerSha256": digest(binary), "sourceHelpers": len(r["trial"]["helpers"]),
           "tids": sorted(tids), "ready":ready,"finished":finished,"evdev":evdev,
           "physicalKeyEvents":len(keys),"matchedAcknowledgments":len(calls),"nonceReads":readbacks,
           "typedAt":r["keyboard"]["typedAt"],"deadlineAt":r["keyboard"]["deadlineAt"],
           "observerStopSentAt":stop["startedAt"],"collection":observer["collection"],
           "images":{name:digest((desktop/name).read_bytes()) for name in ["prepared-direct.png","failure.png"]},
           "imageInspection":"Personally viewed both original images: initial empty shell prompt and no typed command/returned prompt at failure.",
           "limitation":"ptrace perturbs scheduling; SYN_DROPPED is not unique to overflow; no uninstrumented responsiveness proof."}
out.write_text(json.dumps(summary,indent=2)+"\n")
print(json.dumps({k:summary[k] for k in ["passed","reportSha256","traceSha256","sourceHelpers","physicalKeyEvents","matchedAcknowledgments"]}))
