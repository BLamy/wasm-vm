"""Recount the frozen paired timings; fail on missing samples or material regressions."""
import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def read(name):
    return json.loads((ROOT / name).read_text())


def paired(records, case, metric, count, label="label"):
    arms = {}
    for arm in ["baseline", "candidate"]:
        runs = [r for r in records if r.get("case") == case and r[label] == arm]
        assert len(runs) == count, (case, arm, len(runs), count)
        assert all(r["ok"] for r in runs), (case, arm, "failed run")
        arms[arm] = {r["rep"]: r[metric] for r in runs}
        assert set(arms[arm]) == set(range(count)), (case, arm, "duplicate/missing pair")
        assert all(value > 0 for value in arms[arm].values())
    baseline = statistics.median(arms["baseline"].values())
    candidate = statistics.median(arms["candidate"].values())
    ratios = [arms["baseline"][i] / arms["candidate"][i] for i in range(count)]
    result = dict(case=case, metric=metric, pairs=count, baseline=baseline,
                  candidate=candidate, speedup=baseline / candidate,
                  pairedSpeedup=statistics.median(ratios), pairedRatios=ratios)
    assert result["speedup"] >= 1 / 1.05, result
    assert result["pairedSpeedup"] >= 1 / 1.05, result
    return result


report = {"minimumIntegerSpeedup": 1.02, "maximumTimeRegression": 1.05,
          "integer": [], "native": [], "browser": []}
for run in [1, 2]:
    source = read(f"micro-final-{run}/report.json")
    assert source["passed"] and not source["identicalBrowserBinary"]
    n = next(r for r in source["native"] if r["cached"] and r["divider"] == 64)
    b = next(r for r in source["browser"] if r["config"]["fast"]
             and not r["config"]["jit"] and r["config"]["divider"] == 64)
    for platform, row, key, instructions in [
        ("native", n, "seconds", 8_000_000), ("browser", b, "elapsedMs", 4_000_000)
    ]:
        pairs = row["pairs"]
        assert len(pairs) == 5
        values = {arm: [next(r[key] for r in p["runs"] if r["arm"] == arm)
                        for p in pairs] for arm in ["baseline", "candidate"]}
        medians = {arm: statistics.median(v) for arm, v in values.items()}
        ratio = medians["baseline"] / medians["candidate"]
        pair_ratio = statistics.median(a / b for a, b in zip(values["baseline"], values["candidate"]))
        assert min(ratio, pair_ratio) > report["minimumIntegerSpeedup"]
        scale = 1000 if platform == "browser" else 1
        report["integer"].append(dict(run=run, platform=platform, speedup=ratio,
            pairedSpeedup=pair_ratio,
            baselineMips=instructions * scale / medians["baseline"] / 1e6,
            candidateMips=instructions * scale / medians["candidate"] / 1e6))

native = read("native-final/native.json")
for case, metric, count in [("busybox-legacy", "wall_s", 5), ("busybox-fast", "wall_s", 5),
                            ("compute-fast", "region_s", 5), ("coremark-fast", "region_s", 3)]:
    report["native"].append(paired(native["records"], case, metric, count))
    if case.startswith("busybox"):
        assert len({r["retired"] for r in native["records"] if r["case"] == case}) == 1

browser = read("browser-final/browser.json")
# Preserve the raw console records. The original harness did not attach URLs;
# classification is therefore an inference from this run's own server inventory.
# Its 404 handler records every missing path except a favicon.ico suffix.
assert all(not inventory["notFound"] for inventory in browser["meta"]["requests"].values())
expected_404 = "Failed to load resource: the server responded with a status of 404 (Not Found)"
errors = [dict(case=r["case"], label=r["label"], rep=r["rep"], errors=r["consoleErrors"])
          for r in browser["records"] if r["consoleErrors"]]
assert len(errors) == 2, errors
assert {r["label"] for r in errors} == {"baseline", "candidate"}
assert all(r["case"] == "busybox-jit" and r["rep"] == 0
           and r["errors"] == [expected_404] for r in errors), errors
report["browserConsole"] = dict(rawErrors=errors,
    missingNonFaviconPaths=browser["meta"]["requests"],
    classification="Expected favicon 404 inferred from same-run server inventory; URLs were not captured in console records.")
for case in ["busybox-jit", "busybox-nojit"]:
    for metric in ["readyMs", "regionMs"]:
        report["browser"].append(paired(browser["records"], case, metric, 5))
report["passed"] = True
(ROOT / "performance-acceptance.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
