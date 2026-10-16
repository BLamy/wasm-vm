#!/usr/bin/env python3
"""Independent critic recomputation from raw E5.5-T03bg timing records."""
import hashlib
import json
from pathlib import Path
from statistics import median
import subprocess

HERE = Path(__file__).resolve().parent
EVIDENCE = HERE.parent
REPO = EVIDENCE.parent.parent
PLAN_HASH = "5a10e792d6e32bc8957c188b92d946cf855041dd72f7dda49626ce95bf95b659"
PARENT = "96f30bdee9d0a98672336b223004054677baee36"


def read(name):
    return json.loads((EVIDENCE / name).read_text())


def digest(value):
    return hashlib.sha256(value).hexdigest()


checks = []
rows = []


def check(name, value):
    checks.append({"check": name, "held": bool(value)})


plan = read("final-timing-plan.json")
check("pre-sample plan unchanged", digest((EVIDENCE / "final-timing-plan.json").read_bytes()) == PLAN_HASH)
frozen = read("frozen.json")
baseline_bytes = subprocess.check_output(
    ["git", "show", f"{PARENT}:web/dist/pkg/wasm_vm_wasm_bg.wasm"], cwd=REPO
)
expected = {
    "baseline": digest(baseline_bytes),
    "candidate": frozen["sha256"]["web/dist/pkg/wasm_vm_wasm_bg.wasm"],
}
raw_hashes = {}
for batch in (1, 2):
    name = f"micro-final-{batch}/report.json"
    raw_hashes[name] = digest((EVIDENCE / name).read_bytes())
    report = read(name)
    check(f"micro {batch} exact artifacts", report["wasm"] == expected)
    check(f"micro {batch} harness fixed", report["harnessSha256"] == frozen["sha256"]["tools/verify/jit-direct-memory-benchmark.mjs"])
    check(f"micro {batch} no errors", report["passed"] and not report["errors"])
    check(f"micro {batch} cases", [r["spec"]["name"] for r in report["workloads"]] == plan["micro"])
    for workload in report["workloads"]:
        key = f"micro {batch} {workload['spec']['name']}"
        budget = workload["spec"]["budget"]
        check(key + " bounded interpreter oracle", all(r["state"] == workload["oracle"][0]["state"] for r in workload["oracle"]))
        check(key + " exact pair count", len(workload["pairs"]) == 7)
        by_arm = {"baseline": [], "candidate": []}
        time_ratios = []
        for index, pair in enumerate(workload["pairs"]):
            order = ["baseline", "candidate"] if index % 2 == 0 else ["candidate", "baseline"]
            check(key + f" order {index}", pair["pair"] == index and pair["order"] == order and [r["arm"] for r in pair["runs"]] == order)
            arm = {r["arm"]: r for r in pair["runs"]}
            for which, run in arm.items():
                by_arm[which].append(run["elapsedMs"])
            time_ratios.append(arm["candidate"]["elapsedMs"] / arm["baseline"]["elapsedMs"])
        for run in workload["warmups"] + [r for p in workload["pairs"] for r in p["runs"]]:
            check(key + " fixed work/state", run["result"] == {"done": False, "state": None, "retired": budget} and run["jit"]["guestRetired"] == budget + 20_000 and run["jit"]["retiredViaJit"] > 0.9 * budget and run["state"] == workload["warmups"][0]["state"])
        base, candidate = median(by_arm["baseline"]), median(by_arm["candidate"])
        ratio, paired = candidate / base, median(time_ratios)
        affected = workload["spec"]["name"] in ("amoadd-d", "lr-sc-d", "tlb-collision")
        held = ratio < 1 / 1.02 and paired < 1 / 1.02 if affected else ratio <= 1.05 and paired <= 1.05
        check(key + " predeclared budget", held)
        rows.append({"batch": batch, "workload": workload["spec"]["name"], "baselineMs": base, "candidateMs": candidate, "timeRatio": ratio, "pairedTimeRatio": paired, "speedup": 1 / ratio, "pairedSpeedup": 1 / paired, "baselineMips": budget / base / 1000, "candidateMips": budget / candidate / 1000, "held": held})

name = "browser-final/browser.json"
raw_hashes[name] = digest((EVIDENCE / name).read_bytes())
real = read(name)
check("real exact artifacts", {r["label"]: r["wasmSha256"] for r in real["meta"]["roots"]} == expected)
check("real plan", real["meta"]["samples"] == 5 and real["meta"]["cases"] == plan["real"] and real["meta"]["computeIters"] == 10_000)
check("real sample count", len(real["records"]) == 20)
for record in real["records"]:
    label = f"{record['case']} {record['label']} {record['rep']}"
    check(label + " completion/policy", record["ok"] and record["bootOk"] and record["echoed"] and record["crossOriginIsolated"] and record["jitPolicy"] == ("enabled" if record["case"] == "busybox-jit" else "forced-off"))
    check(label + " cold boot", record["snapshotRequests"] == [])
    details = record["consoleErrorDetails"]
    check(label + " only identified favicon errors", len(record["consoleErrors"]) == len(details) and all(d["url"].endswith("/favicon.ico") and "404" in d["text"] for d in details) and all(e["url"].endswith("/favicon.ico") and e["status"] == 404 for e in record["httpErrors"]))
for case in plan["real"]:
    samples = [r for r in real["records"] if r["case"] == case]
    pair_rows = []
    for index in range(5):
        pair = [r for r in samples if r["rep"] == index]
        check(f"real {case} pair {index}", [r["label"] for r in pair] == (["baseline", "candidate"] if index % 2 == 0 else ["candidate", "baseline"]))
        pair = {r["label"]: r for r in pair}
        check(f"real {case} same policy {index}", pair["baseline"]["policy"] == pair["candidate"]["policy"])
        pair_rows.append(pair)
    for field in ("readyMs", "regionMs"):
        base = median(p["baseline"][field] for p in pair_rows)
        candidate = median(p["candidate"][field] for p in pair_rows)
        ratio = candidate / base
        paired = median(p["candidate"][field] / p["baseline"][field] for p in pair_rows)
        held = ratio <= 1.05 and paired <= 1.05
        check(f"real {case} {field} predeclared budget", held)
        rows.append({"workload": case, "phase": field, "baselineMs": base, "candidateMs": candidate, "timeRatio": ratio, "pairedTimeRatio": paired, "held": held})

result = {"passed": all(c["held"] for c in checks), "parent": PARENT, "frozenHead": frozen["head"], "expectedArtifacts": expected, "planSha256": PLAN_HASH, "rawHashes": raw_hashes, "recomputerSha256": digest(Path(__file__).read_bytes()), "measurements": rows, "checks": checks}
(HERE / "performance-review.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({"passed": result["passed"], "measurements": rows, "failedChecks": [c for c in checks if not c["held"]]}, indent=2))
raise SystemExit(0 if result["passed"] else 1)
