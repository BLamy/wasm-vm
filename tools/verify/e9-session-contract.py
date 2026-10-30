#!/usr/bin/env python3
"""Check E9-T01's frozen definitions; this does not run or certify guest replay."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
CONTRACT = "docs/design/session-replay-contract.json"
DOCUMENT = "docs/design/session-replay.md"
SOURCE_IDS = {
    "uart", "keyboard", "pointer", "display", "lifecycle", "mtime", "rtc",
    "entropy", "timers", "block-read", "block-write", "dma", "network",
    "network-time", "file-transfer", "agent", "clipboard", "audio-playback",
    "audio-capture", "software-gpu", "gpu-results", "storage-control", "checkpoint-control",
}
SHA256 = re.compile(r"[0-9a-f]{64}\Z")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def local_path(name: str) -> Path:
    require(isinstance(name, str), "source path must be text")
    path = (ROOT / name).resolve()
    require(not Path(name).is_absolute() and ROOT in path.parents,
            f"path escapes repository: {name}")
    require(path.is_file(), f"missing file: {name}")
    return path


def sha256(name: str) -> str:
    return hashlib.sha256(local_path(name).read_bytes()).hexdigest()


def unique_keys(pairs: list) -> dict:
    result = {}
    for key, value in pairs:
        require(key not in result, f"duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(name: str) -> dict:
    return json.loads(local_path(name).read_text(), object_pairs_hook=unique_keys)


def main() -> int:
    contract = read_json(CONTRACT)
    document = local_path(DOCUMENT).read_text()
    tasks = {}
    for path in (ROOT / "tasks").glob("epic-*/E*-T*.md"):
        text = path.read_text()
        match = re.match(r"---\nid: ([^\n]+)\n", text)
        if match:
            require(match[1] not in tasks, f"duplicate task: {match[1]}")
            tasks[match[1]] = text

    require(contract["contract_version"] == {"major": 1, "minor": 0},
            "contract version changed; review the codec and update its acceptance")
    require(contract["runtime_status"] == "planned", "T01 must not certify runtime replay")
    require(contract["replay_external_effects"] == "forbidden", "replay must forbid external effects")
    require(contract["unknown_required_policy"] == "refuse-before-mutation",
            "unknown required data must refuse before mutation")
    coordinate = contract["coordinate"]
    require(coordinate["fields"] == ["transition", "phase", "ordinal", "sequence", "retired"],
            "positions must distinguish non-retiring transitions and tied observations")
    require(coordinate["phases"] == ["before", "observe", "after"], "missing observation phase")
    require(coordinate["wide_integer_encoding"] == "canonical-unsigned-decimal" and
            coordinate["counter_overflow"] == "refuse-before-effect", "lossy position policy")
    require(set(contract["event_fields"]) == {
        "kind", "required", "transition", "phase", "ordinal", "sequence", "retired",
        "device", "intent", "status", "payload",
    }, "event records must bind both intent and effects to exact positions")
    require({"smp", "userspace-abi", "rp2350", "host-shared-folder", "unbound-extra-disk",
             "live-microphone", "guest-3d", "wall-mtime", "paced-mtime",
             "interactive-clock-switch", "unrecorded-hot-attachment"}
            <= set(contract["unsupported"]), "missing initial-profile refusal")

    rows = contract["sources"]
    require(len(rows) == len(SOURCE_IDS) and {row["id"] for row in rows} == SOURCE_IDS,
            "missing or duplicate source row")
    referenced = set()
    anchors = []
    for row in rows:
        require(f'`{row["id"]}`' in document, f"matrix missing {row['id']}")
        require(row["owners"] and row["anchors"], f"unowned/unanchored source: {row['id']}")
        require(row["disposition"] in {
            "capture", "gated", "derived-and-capture", "capture-and-gate",
        }, f"unknown source disposition: {row['id']}")
        for owner in row["owners"]:
            require(owner in tasks and owner.startswith("E9-T"), f"unknown owner: {owner}")
        for anchor in row["anchors"]:
            name, symbol = anchor["path"], anchor["symbol"]
            contents = local_path(name).read_text()
            require(isinstance(symbol, str) and len(symbol) >= 3 and symbol in contents,
                    f"missing source anchor: {row['id']}: {name}: {symbol}")
            referenced.add(name)
            line = contents[:contents.index(symbol)].count("\n") + 1
            anchors.append({"source": row["id"], "path": name, "line": line, "symbol": symbol})
    require(referenced == set(contract["source_sha256"]), "source digest inventory differs from anchors")
    for name, expected in contract["source_sha256"].items():
        require(SHA256.fullmatch(expected) is not None and sha256(name) == expected,
                f"source changed; re-audit its recording boundary: {name}")

    fixtures = contract["fixtures"]
    require(len(fixtures) == 2 and {f["id"] for f in fixtures} == {
        "software-alpine-v1", "desktop-gpu-candidate-v1",
    }, "software and desktop candidate must both be pinned")
    for fixture in fixtures:
        name = fixture["manifest"]
        require(sha256(name) == fixture["manifest_sha256"], f"fixture manifest changed: {name}")
        actual = read_json(name)
        require(actual["artifacts"] == fixture["artifacts"] and
                actual.get("chunkedImage") == fixture["chunked_image"], f"asset pins differ: {name}")
        expected_clock = {"mode": "icount", "divider": 10}
        if fixture["id"] == "desktop-gpu-candidate-v1":
            expected_clock = {"mode": "icount", "divider": 64, "interactive": "paced-on-keyboard",
                              "restored_modes": ["icount", "paced-icount"]}
            require(fixture["manifest"] == "web/artifacts-omarchy-virgl.json",
                    "accelerated fixture must pin the actual production pair")
            require(sha256(fixture["gpu_build_identity_source"]) == fixture["gpu_build_identity_sha256"],
                    "production GPU checkpoint build identity changed")
            require(fixture["verified_predecessors"] == [
                "E6-T11d74a", "E6-T11d74b", "E6-T11d74c", "E6-T11d74d",
            ] and all(re.search(r"^status: verified$", tasks.get(task, ""), re.MULTILINE)
                      for task in fixture["verified_predecessors"]),
                    "production checkpoint predecessors must actually be verified")
        require(fixture["harts"] == 1 and fixture["clock"] == expected_clock,
                "fixture clock policy differs from the frozen one-hart profile")
        require(fixture["qualification"] == "pending" and fixture["admit_after"],
                "asset identity is not runtime qualification")
        require(all(task in tasks for task in fixture["admit_after"]), "unknown fixture gate")
        for asset in fixture["artifacts"].values():
            require(SHA256.fullmatch(asset["sha256"]) is not None and
                    type(asset["size"]) is int and asset["size"] > 0, "unbounded/unidentified asset")
    package = read_json("web/package.json")
    require(package["devDependencies"]["@playwright/test"] == contract["reference"]["playwright"],
            "reference Playwright version changed")

    limits = contract["limits"]
    require(all(type(v) is int and v > 0 for v in limits.values()), "limits must be positive integers")
    require(limits["ram_page_bytes"] == 4096 and
            limits["inline_event_bytes"] <= limits["chunk_bytes"] <= 4 * 1024 * 1024 and
            limits["session_bytes"] <= 4 * 1024 ** 3, "invalid initial storage bounds")
    workload = contract["workload"]
    for phase, literal in [("before", b"e9:before\n"), ("after", b"e9:after\n")]:
        require(bytes.fromhex(workload[f"{phase}_hex"]) == literal and
                workload[f"{phase}_sha256"] == hashlib.sha256(literal).hexdigest(),
                f"literal file witness differs: {phase}")
    require(workload["serial_advance"] == "advance\n" and workload["seed"] == 17,
            "fixture stimulus changed")
    for field in ["setup", "input_frame_template", "rewrite_command", "http_body"]:
        require(isinstance(workload[field], str) and workload[field], f"missing stimulus: {field}")
    schedule = workload["schedule"]
    require(schedule["input_frames"] == 100 and schedule["rewrites"] == 10 and
            schedule["rewrite_every_frame"] == 10 and schedule["http_responses"] == 10 and
            schedule["http_response_bytes"] == 1024 and schedule["seek_count"] == 20 and
            schedule["observation_window_ms"] == 600000 and schedule["ab_pairs"] == 5,
            "fixed-work measurement changed")
    require(schedule["pair_order"] == ["off-on", "on-off", "off-on", "on-off", "off-on"],
            "missing alternating A/B order")
    offsets = schedule["input_transition_offsets"]
    require(offsets == {"first": 500000, "stride": 500000} and
            offsets["first"] + 99 * offsets["stride"] <= limits["keyframe_gap_transitions"],
            "input schedule exceeds its frozen transition span")
    require({"pc", "integer-and-floating-registers", "privilege-and-csrs", "reservation",
             "ram-sha256", "device-state-sha256", "disk-root-sha256", "event-cursor",
             "pending-input-and-completions", "zero-replay-egress"} <= set(workload["witnesses"]),
            "checkpoint/replay witnesses are incomplete")
    desktop = workload["desktop"]
    require(sha256(desktop["probe"]) == desktop["probe_sha256"], "GPU probe source changed")
    require(desktop["viewport_sequence"] == [[640, 480], [803, 603]] and
            desktop["expected_gl_error"] == 0 and
            desktop["expected_rgba_hex"] == (bytes([255, 0, 0, 255]) * 16).hex() and
            "software rendering is a refusal" in desktop["requires"], "GPU qualification changed")
    metric_names = {"recording_ratio_median_max", "preview_p95_ms_max", "restore_p95_ms_max",
                    "seek_p95_ms_max", "cancel_ack_ms_max", "history_growth_bytes_max",
                    "recorder_working_bytes_max"}
    require(set(contract["budgets"]) == {"software", "desktop"}, "missing profile budget")
    for profile, budgets in contract["budgets"].items():
        require(set(budgets) == metric_names and all(
            type(value) in (int, float) and math.isfinite(value) and value > 0
            for value in budgets.values()), f"missing or nonnumeric budget: {profile}")
        require(budgets["preview_p95_ms_max"] < budgets["seek_p95_ms_max"],
                "preview and actual-state latency must be separate")

    proof_files = [CONTRACT, DOCUMENT, desktop["probe"],
                   "tools/verify/e9-session-contract.py", "Makefile"]
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    print(json.dumps({
        "task": "E9-T01", "result": "direct-contract-check-passed", "source_commit": commit,
        "scope": "definitions and adapter identities only; no guest replay or performance claim",
        "source_rows": len(rows), "source_files": len(referenced), "fixture_manifests": len(fixtures),
        "content_sha256": {name: sha256(name) for name in proof_files},
        "source_sha256": contract["source_sha256"], "anchors": anchors,
        "fixture_qualification": {f["id"]: f["qualification"] for f in fixtures},
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(f"E9-T01 contract check failed: {error}", file=sys.stderr)
        sys.exit(1)
