#!/usr/bin/env python3
"""Bind asynchronous renderer proof, focused regressions and sequencing controls."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
ATTACKS = {
    "early-collect": "async CPU collection requires a signaled fence",
    "index-class": "async index staging uses element-array class",
}
REGRESSIONS = {"decoder": "E6-T12a", "resources": "E6-T12b",
               "state": "E6-T12c", "draw": "E6-T12d"}
GENERATED = {"renderer/virgl-shader/build/wasm/virgl-shader.mjs",
             "renderer/virgl-shader/build/wasm/virgl-shader.wasm"}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def main():
    directory = Path(sys.argv[1]).resolve()
    records = {}
    sources = {}
    inputs = {}
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()

    def artifact(path, expected=None):
        data = path.read_bytes()
        actual = digest(data)
        require(expected is None or actual == expected, f"artifact changed: {path}")
        relative = str(path.relative_to(directory))
        records[relative] = {"path": relative, "bytes": len(data), "sha256": actual}
        return data

    def read_report(name, task, passed=True, browser=True):
        path = directory / name / "report.json"
        report = json.loads(artifact(path))
        require(report["task"] == task and report["gitHead"] == head, f"wrong task/head: {name}")
        require(report["status"] == ("passed" if passed else "failed"), f"wrong result: {name}")
        for collection, destination in ((report["sources"], sources), (report["inputs"], inputs)):
            for item in collection:
                raw = (ROOT / item["path"]).read_bytes()
                require(digest(raw) == item["sha256"], f"source drift: {item['path']}")
                require(len(raw) == item["bytes"], f"source size drift: {item['path']}")
                previous = destination.get(item["path"])
                require(previous is None or previous["sha256"] == item["sha256"], "inconsistent source set")
                destination[item["path"]] = item
                if item["path"] not in GENERATED:
                    frozen = subprocess.check_output(["git", "show", f"{head}:{item['path']}"], cwd=ROOT)
                    require(frozen == raw, f"not frozen at HEAD: {item['path']}")
        if "node" in report:
            require(report["node"]["status"] == "passed", f"Node regression failed: {name}")
        if browser:
            require(report["browserResult"]["status"] == ("passed" if passed else "failed"),
                    f"wrong browser result: {name}")
            if passed:
                require(report["browserResult"]["result"]["status"] == "passed", f"suite failed: {name}")
                require(report["browserErrors"] == {"console": [], "page": [], "requests": []},
                        f"browser errors: {name}")
            screen = report.get("screenshot") or report.get("failureScreenshot")
            require(screen is not None, f"missing browser capture: {name}")
            artifact(path.parent / screen["path"], screen["sha256"])
            measured = report["browserCoverage"]
            coverage = json.loads(artifact(path.parent / measured["path"], measured["sha256"]))
            scripts = coverage.get("scripts", [coverage] if "source" in coverage else [])
            require(scripts, f"missing runtime coverage: {name}")
            served = {item["path"]: item for item in report["servedFiles"]}
            mutation = report.get("sabotage", {})
            for script in scripts:
                expected = mutation["servedSha256"] if script["source"] == mutation.get("path") else sources[script["source"]]["sha256"]
                require(script["sha256"] == expected, f"coverage source mismatch: {name}")
            for source in report["sources"]:
                if source["path"].startswith("renderer/") and source["path"].endswith((".mjs", ".wasm")):
                    # Some regression launchers bind build scripts and wrappers
                    # without loading them into the page. Check every served one.
                    item = served.get("/" + source["path"])
                    if item is not None:
                        expected = mutation["servedSha256"] if source["path"] == mutation.get("path") else source["sha256"]
                        require(item["sha256"] == expected, f"served source mismatch: {name}")
            require(served["/fixtures.json"]["sha256"] == report["fixtureTransport"]["sha256"],
                    f"fixture transport changed: {name}")
        return report

    good = read_report("hardware", "E6-T11b1")
    result = good["browserResult"]["result"]
    require(result["guestExecution"] is False, "renderer proof cannot claim guest execution")
    require(result["primaryAsyncReplay"] is True, "asynchronous replay proof missing")
    original = result["original"]
    require(original["packetCount"] == 210 and original["gpuDraws"] == 3 and original["checkedPixels"] == 768,
            "not the complete original draw/pixel replay")
    require([entry["event"] for entry in original["submissions"]] == [161, 173, 185, 197, 209, 221, 233, 249],
            "original submission order changed")
    require([entry["readback"]["offset"] for entry in original["frames"]] == [64, 4160, 8256],
            "wrong original readback rows")
    sequencing = original["sequencing"]
    require([sequencing[key] for key in ("stagedCopies", "pboReads", "collections")] == [3, 3, 6],
            "original readbacks did not use the staged paths")
    require(original["heartbeatTicks"] > 0 and sequencing["turns"] > 0 and sequencing["polls"] > 0,
            "no observed browser progress while jobs were pending")
    require(all(entry["result"]["gpuComplete"] is True for entry in original["submissions"]),
            "submission completed without GPU completion")
    require([entry["layout"]["tightBytes"] for entry in original["exchanges"] if entry["status"] == "needs-input"] == [64, 12, 16],
            "original 92 input bytes did not cross the fresh-input boundary")
    cleanup = original["cleanup"]
    require(all(value == 0 for owner in ("state", "resources") for value in cleanup[owner].values()),
            "original owner cleanup leaked")
    require(all(cleanup["async"][key] == 0 for key in ("reads", "transfers", "stagingBytes"))
            and all(cleanup["actualGl"][key] == 0 for key in ("liveObjects", "liveSyncs")), "asynchronous cleanup leaked")
    poison = result["outputReferencePoison"]
    require(poison["bytes"] == 12288 and poison["hashes"] == [frame["readback"]["rgbaSha256"] for frame in original["frames"]],
            "reference output contamination check missing")
    for mode, oracle in ATTACKS.items():
        report = read_report(f"sabotage-{mode}", "E6-T11b1", passed=False)
        require(report["sources"] == good["sources"] and report["inputs"] == good["inputs"], "control source drift")
        mutation = report["sabotage"]
        require(mutation["mode"] == mode and mutation["path"] in sources, "wrong source mutation")
        require(mutation["originalSha256"] == sources[mutation["path"]]["sha256"], "mutation origin mismatch")
        require(mutation["originalSha256"] != mutation["servedSha256"], "no source mutation")
        require(oracle in report["browserResult"]["error"]["message"], "control failed for wrong reason")
    for name, task in REGRESSIONS.items():
        read_report(f"regression/{name}", task, browser=name != "decoder")
    receipt = {"schema": 1, "task": "E6-T11b1", "status": "passed", "gitHead": head,
               "guestExecution": False, "sourceControlsRejected": list(ATTACKS),
               "synchronousRegressions": list(REGRESSIONS),
               "sources": sorted(sources.values(), key=lambda item: item["path"]),
               "inputs": sorted(inputs.values(), key=lambda item: item["path"]),
               "records": list(records.values()), "browserResultSha256": good["browserResultSha256"]}
    (directory / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print("E6-T11b1 receipt passed: asynchronous jobs, original pixels, sequencing controls and synchronous regressions")


if __name__ == "__main__":
    main()
