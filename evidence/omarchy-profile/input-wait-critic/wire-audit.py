#!/usr/bin/env python3
"""Independent timing, input and served-file audit of the fixed r3 recording."""
import datetime
import hashlib
import json
import pathlib
import subprocess
import urllib.parse


def stamp(value):
    return round(datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def sha(value):
    return hashlib.sha256(value).hexdigest()


root = pathlib.Path("evidence/omarchy-profile/input-wait-r3")
raw = (root / "desktop/report.json").read_bytes()
report = json.loads(raw)
parent = json.loads((root / "run.json").read_text())
keyboard = report["keyboard"]
capture = report["failureCheckpoint"]
assert report["mode"] == "input-trial" and report["result"] == "failed"
assert report["trial"]["outcome"] == "nonce-readback-failed"
assert report["trial"]["readbackMs"] == keyboard["deadlineMs"] == keyboard["readbackTimeoutMs"] == 120000
assert keyboard["verified"] is False and report["errors"] == []
deadline = keyboard["enteredAtMs"] + 120000
assert stamp(keyboard["typedAt"]) == keyboard["enteredAtMs"]
assert stamp(keyboard["deadlineAt"]) == deadline == stamp(keyboard["failedAt"])
assert capture["inputVerdict"]["result"] == report["result"]
assert capture["inputVerdict"]["outcome"] == report["trial"]["outcome"]
for key, value in capture["inputVerdict"]["keyboard"].items():
    assert keyboard[key] == value
assert deadline == capture["pauseRequestedAtMs"] <= capture["pauseAcknowledgedAtMs"]
assert stamp(capture["startedAt"]) + 180000 == capture["deadlineAtMs"]
assert capture["paused"] and capture["status"] == "captured"
assert stamp(capture["finishedAt"]) < capture["deadlineAtMs"]
assert report["cleanup"]["closed"] and report["cleanup"]["timeoutMs"] == 30000
assert stamp(report["finishedAt"]) - stamp(report["cleanup"]["startedAt"]) < 30000
assert parent["exit"] == {"code": 1, "signal": None, "closed": True, "watchdog": None}
assert parent["head"] == report["trial"]["head"] == "8edd458702ce3bbebfe60a1e36fd7973e70d7778"
assert report["trial"]["scopedStatus"] == ""
keys = report["inputEvents"]
assert len(keys) == 128
assert all(row["trusted"] and not row["repeat"] and row["epoch"] == "final" and row["context"] == "primary"
           and row["target"] == row["activeElement"] == "ide-display-canvas" for row in keys)
pressed = set()
typed = ""
for row in keys:
    code = row["code"]
    if row["type"] == "keydown":
        assert code not in pressed
        pressed.add(code)
        if len(row["key"]) == 1:
            typed += row["key"]
    else:
        assert row["type"] == "keyup" and code in pressed
        pressed.remove(code)
assert not pressed and keys[-1]["code"] == "Enter"
assert typed == "printf '" + keyboard["nonce"] + "' > " + keyboard["guestFile"]
assert keyboard["nonce"] not in keyboard["guestFile"]
traffic = report["workerTraffic"]
assert {row["worker"] for row in traffic} == {1}
calls = [row for row in traffic if row["type"] == "worker-call"]
assert all(row["sent"] for row in calls)
pause = [row for row in calls if row["method"] == "pause"]
assert len(pause) == 1 and deadline <= stamp(pause[0]["timestamp"]) <= capture["pauseAcknowledgedAtMs"]
assert not [row for row in calls if row["method"] in ("resume", "sendAgentInput")]
send_keys = [row for row in calls if row["method"] == "sendKeyboardEvent"]
assert len(send_keys) == len(keys)
answers = {row["id"]: row for row in traffic if row["type"] == "input-result"}
for event, call in zip(keys, send_keys):
    assert call["args"][0] == 1 and call["args"][2] == (1 if event["type"] == "keydown" else 0)
    assert call["ms"] >= event["ms"] and call["ms"] - event["ms"] < 10
    assert answers[call["id"]]["result"] is True and answers[call["id"]]["error"] is None
serial_input = [row for row in traffic if row["type"] == "serial-input"]
assert all(row["sent"] and stamp(row["timestamp"]) < capture["pauseRequestedAtMs"] for row in serial_input)
serial = b"".join(bytes(row["bytes"]) for row in serial_input).decode("ascii")
assert keyboard["nonce"] not in serial
assert len(report["serialCommands"]) == 26
expected_read = f"if [ -f '{keyboard['guestFile']}' ]; then cat '{keyboard['guestFile']}'; else (exit 75); fi"
for row in report["serialCommands"]:
    assert row["command"] == expected_read and row["stage"] == "physical keyboard:nonce-readback"
    assert 0 < row["timeoutMs"] <= deadline - stamp(row["timestamp"])
identities = 0
runtime_paths = set()
for row in report["resourceIdentities"]:
    assert row["status"] == 200 and row["method"] == "GET"
    if row["repoPath"] is None:
        if row["pathname"] == "/artifacts-omarchy.json":
            data = json.dumps(report["candidate"]["manifest"], separators=(",", ":")).encode()
        else:
            assert row["pathname"] == "/" + report["candidate"]["manifest"]["chunkedImage"]["key"]
            data = pathlib.Path(report["candidate"]["source"]["chunkManifest"]["filename"]).read_bytes()
    else:
        path = pathlib.Path(row["repoPath"])
        data = path.read_bytes()
        if str(path).startswith("web/dist/"):
            recorded = subprocess.check_output(["git", "show", report["trial"]["head"] + ":" + str(path)])
            assert recorded == data
            runtime_paths.add(str(path))
    assert len(data) == row["size"] and sha(data) == row["sha256"]
    identities += 1
for filename, identity in report["trial"]["helpers"].items():
    data = subprocess.check_output(["git", "show", report["trial"]["head"] + ":" + filename])
    assert len(data) == identity["size"] and sha(data) == identity["sha256"]
for name in ("kernel", "bootSnapshot", "overlayDelta", "chunkManifest"):
    identity = report["candidate"]["source"][name]
    data = pathlib.Path(identity["filename"]).read_bytes()
    assert sha(data) == identity["sha256"] and len(data) == identity["size"]
worker = capture["worker"]
assert worker["type"] == "worker" and urllib.parse.urlparse(worker["url"]).path == "/linux-worker.js"
assert urllib.parse.urlparse(worker["url"]).netloc == urllib.parse.urlparse(report["url"]).netloc
print(json.dumps({"result": "input, timing and resource audit passed", "reportSha256": sha(raw),
                  "physicalEvents": len(keys), "physicalWorkerCallsAcknowledged": len(send_keys),
                  "serialReadCommands": len(report["serialCommands"]), "noncePresentInSerial": False,
                  "pauseCalls": len(pause), "resumeCalls": 0, "servedRowsHashed": identities,
                  "runtimeFilesComparedWithFrozenGit": len(runtime_paths),
                  "inputDeadlineMs": deadline, "pauseRequestLagMs": capture["pauseRequestedAtMs"] - deadline,
                  "pauseAckLagMs": capture["pauseAcknowledgedAtMs"] - capture["pauseRequestedAtMs"],
                  "captureDurationMs": stamp(capture["finishedAt"]) - stamp(capture["startedAt"]),
                  "browserCleanupMs": stamp(report["finishedAt"]) - stamp(report["cleanup"]["startedAt"]),
                  "recorderExitAfterReportFinishedMs": stamp(parent["finishedAt"]) - stamp(report["finishedAt"]),
                  "note": "The recorder-exit delay is retained as a separate cleanup observation."}, indent=2))
