#!/usr/bin/env python3
"""E4-T27: performance-regression CI gate.

Turns performance into a gated invariant like correctness. The design fights the one hard
problem — CI-runner noise — with four standard, layered mitigations:

  1. Interleaved A/B (`run`): rebuild + run the BASELINE commit and the CANDIDATE commit
     alternately in ONE job and compare RATIOS, never absolutes. A thermally throttled or
     otherwise slow host scales BOTH arms by the same factor, so the ratio is invariant —
     see `ab_regression_pct` and its host-variance-immunity property (unit-tested).
  2. Robust statistics: median-of-5 with MAD-based outlier rejection (`robust_center`), so a
     single hiccup run cannot move the verdict.
  3. Two-tier response: soft WARN at > soft_pct, hard FAIL at > hard_pct, plus absolute
     latency BUDGETS whose breach is an unconditional hard fail (`evaluate_metric`).
  4. Rolling-best baseline updated ONLY by explicit `tools/bench.py bless` commits (no silent
     ratchet-down) — the trend page (`trend`) surfaces cumulative sub-threshold drift.

The STATISTICS + THRESHOLD-EVAL core is pure and unit-testable with injected sample arrays
(no real multi-minute benchmark run required): see `bench_ci_test.py` and `evaluate` below.

Subcommands
    bench_ci.py evaluate --candidate samples.json [--baseline base.json] \
                         [--thresholds bench/thresholds.toml] [--ledger-history]
    bench_ci.py run [--metrics coremark,dhrystone] --baseline-commit REF   # live A/B (needs runner)
    bench_ci.py trend [--out bench/trend.html]                             # static trend page
    bench_ci.py selftest                                                   # run the unit tests

`evaluate` exit codes: 0 = pass (incl. soft warnings), 1 = HARD fail (regression/budget breach),
2 = usage/other error. That is the CI gate contract.
"""

import argparse
import datetime
import html as _html
import json
import os
import statistics
import subprocess
import sys

try:
    import tomllib  # py3.11+
except ModuleNotFoundError:  # pragma: no cover
    tomllib = None

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THRESHOLDS = os.path.join(REPO, "bench", "thresholds.toml")
LEDGER = os.path.join(REPO, "bench", "ledger.json")
TREND_HTML = os.path.join(REPO, "bench", "trend.html")

# Verdict severity ordering (worst wins when reducing across metrics).
PASS, WARN, FAIL = "pass", "warn", "fail"
_SEVERITY = {PASS: 0, WARN: 1, FAIL: 2}


# ============================================================================================
# Pure statistics core — unit-testable with injected arrays, NO benchmark run required.
# ============================================================================================

def median_of(samples):
    """Plain median. Raises on empty input (a gate must never invent a number)."""
    if not samples:
        raise ValueError("median_of: empty sample array")
    return statistics.median(samples)


def mad(samples, center=None):
    """Median Absolute Deviation: median(|x - median(x)|). A robust (breakdown-point 50%)
    scale estimate — unlike stdev, one wild outlier cannot inflate it."""
    if not samples:
        raise ValueError("mad: empty sample array")
    c = median_of(samples) if center is None else center
    return statistics.median([abs(x - c) for x in samples])


def reject_outliers(samples, z_thresh=3.5):
    """Return (kept, rejected) using the modified z-score (Iglewicz & Hoaglin):
        Mi = 0.6745 * (xi - median) / MAD ; reject |Mi| > z_thresh.
    Degenerate MAD==0 (all-equal, or majority-equal) means "no dispersion to speak of" — keep
    everything, since a MAD of 0 would divide-by-zero and spuriously reject the minority.
    A clean series is returned untouched; an injected flier is dropped (unit-tested)."""
    if len(samples) < 3:
        return list(samples), []          # too few to judge dispersion; trust them all
    med = median_of(samples)
    m = mad(samples, med)
    if m == 0:
        return list(samples), []
    kept, rejected = [], []
    for x in samples:
        mi = 0.6745 * (x - med) / m
        (rejected if abs(mi) > z_thresh else kept).append(x)
    return (kept or list(samples)), rejected   # never reject the entire series


def robust_center(samples, z_thresh=3.5):
    """The number the gate actually compares: median AFTER MAD outlier rejection."""
    kept, _ = reject_outliers(samples, z_thresh)
    return median_of(kept)


def ab_regression_pct(baseline_samples, candidate_samples, higher_is_better, z_thresh=3.5):
    """Interleaved-A/B regression, in percent, POSITIVE == worse.

    Compares the robust centers of the two arms as a RATIO, which makes the verdict immune to
    host variance: scaling BOTH arms by any constant k>0 leaves the ratio — and therefore this
    percentage — unchanged (unit-tested `test_ab_host_variance_immune`).

        higher_is_better:  100 * (base - cand) / base   (throughput dropped -> positive)
        lower_is_better :  100 * (cand - base) / base   (latency/time grew  -> positive)
    """
    base = robust_center(baseline_samples, z_thresh)
    cand = robust_center(candidate_samples, z_thresh)
    if base == 0:
        raise ValueError("ab_regression_pct: baseline center is zero")
    if higher_is_better:
        return 100.0 * (base - cand) / base
    return 100.0 * (cand - base) / base


# ============================================================================================
# Threshold configuration + evaluation.
# ============================================================================================

def load_thresholds(path=THRESHOLDS):
    if tomllib is None:  # pragma: no cover
        raise RuntimeError("tomllib unavailable (need Python 3.11+) to read thresholds.toml")
    with open(path, "rb") as f:
        cfg = tomllib.load(f)
    defaults = cfg.get("defaults", {})
    metrics = {}
    for section in ("bench", "latency"):
        for _name, spec in cfg.get(section, {}).items():
            spec = dict(spec)
            spec.setdefault("soft_pct", defaults.get("soft_pct", 3.0))
            spec.setdefault("hard_pct", defaults.get("hard_pct", 7.0))
            spec.setdefault("kind", "ratio")
            spec.setdefault("gate", "gating")
            spec.setdefault("engine", "native")
            metrics[spec["metric"]] = spec
    return {"metrics": metrics, "gating": cfg.get("gating", {}),
            "defaults": defaults, "raw": cfg}


def evaluate_metric(spec, candidate_samples, baseline_samples=None, baseline_center=None,
                    z_thresh=3.5):
    """Evaluate ONE metric. Returns a verdict dict. Pure — inject the sample arrays directly.

    Two independent failure conditions, both honoured:
      * BUDGET breach (kind == "budget"): candidate robust-center over `budget` -> hard FAIL,
        regardless of the delta vs baseline (E4-T21/T23 latency budgets; AC3).
      * RATIO regression vs baseline: > hard_pct -> FAIL, > soft_pct -> WARN.
    An `advisory` gate downgrades a would-be FAIL to WARN (browser benches never fail the
    build until the pinned-headless runner lands) but still reports the true regression.
    """
    higher_is_better = bool(spec.get("higher_is_better", True))
    cand = robust_center(candidate_samples, z_thresh)
    v = {
        "metric": spec["metric"], "unit": spec.get("unit", ""),
        "gate": spec.get("gate", "gating"), "kind": spec.get("kind", "ratio"),
        "candidate": cand, "higher_is_better": higher_is_better,
        "status": PASS, "reasons": [], "regression_pct": None,
        "baseline": None, "budget": spec.get("budget"),
    }

    # --- absolute budget check (latency metrics) ------------------------------------------
    if spec.get("kind") == "budget" and spec.get("budget") is not None:
        budget = float(spec["budget"])
        v["budget"] = budget
        if cand > budget:
            v["status"] = FAIL
            v["reasons"].append(
                f"budget breach: {cand:.3f} {spec.get('unit','')} > budget {budget:.3f}")

    # --- ratio regression vs baseline -----------------------------------------------------
    base_center = baseline_center
    if base_center is None and baseline_samples:
        base_center = robust_center(baseline_samples, z_thresh)
    if base_center is not None:
        v["baseline"] = base_center
        if base_center == 0:
            v["reasons"].append("baseline center is zero — cannot compute ratio")
        else:
            if higher_is_better:
                reg = 100.0 * (base_center - cand) / base_center
            else:
                reg = 100.0 * (cand - base_center) / base_center
            v["regression_pct"] = reg
            soft, hard = float(spec["soft_pct"]), float(spec["hard_pct"])
            if reg > hard:
                v["status"] = _worst(v["status"], FAIL)
                v["reasons"].append(
                    f"regression {reg:.2f}% > hard band {hard:.1f}%")
            elif reg > soft:
                v["status"] = _worst(v["status"], WARN)
                v["reasons"].append(
                    f"regression {reg:.2f}% > soft band {soft:.1f}%")

    # --- advisory gate downgrade ----------------------------------------------------------
    if v["gate"] == "advisory" and v["status"] == FAIL:
        v["advisory_downgrade"] = True
        v["hard_status"] = FAIL
        v["status"] = WARN
    return v


def _worst(a, b):
    return a if _SEVERITY[a] >= _SEVERITY[b] else b


def evaluate_suite(thresholds, samples, ledger=None):
    """Evaluate every metric present in `samples` against `thresholds`.

    `samples` shape (any subset of metrics; baseline optional per-metric):
        {"metrics": {"<metric>": {"candidate": [..], "baseline": [..]}}}
    If a metric omits "baseline", the baseline robust-center is taken from the ledger's most
    recent entry for that bench (so CI only needs to measure the candidate arm for benches
    whose baseline is already blessed). Returns (overall_status, [verdicts]).
    """
    verdicts = []
    for metric, arms in samples.get("metrics", {}).items():
        spec = thresholds["metrics"].get(metric)
        if spec is None:
            verdicts.append({"metric": metric, "status": WARN,
                             "reasons": [f"no threshold configured for '{metric}' (ungated)"],
                             "regression_pct": None, "candidate": None})
            continue
        cand = arms.get("candidate")
        if not cand:
            verdicts.append({"metric": metric, "status": WARN,
                             "reasons": ["no candidate samples"], "candidate": None})
            continue
        base_samples = arms.get("baseline")
        base_center = None
        if base_samples is None and ledger is not None:
            base_center = ledger_baseline_center(ledger, metric)
        verdicts.append(evaluate_metric(spec, cand, base_samples, base_center))
    overall = PASS
    for v in verdicts:
        overall = _worst(overall, v.get("status", PASS))
    return overall, verdicts


# ============================================================================================
# Ledger integration (read-only here; writes go through tools/bench.py).
# ============================================================================================

def load_ledger(path=LEDGER):
    if not os.path.exists(path):
        return {"schema_version": 1, "entries": []}
    with open(path) as f:
        return json.load(f)


def ledger_entries_for(ledger, bench):
    return [e for e in ledger.get("entries", []) if e.get("bench") == bench]


def ledger_baseline_center(ledger, bench):
    """Baseline score for `bench` = the most recent ledger entry's score (the rolling
    baseline; `bless` appends the new rolling-best). None if the bench is unseen."""
    rows = ledger_entries_for(ledger, bench)
    return rows[-1]["score"] if rows else None


def ledger_history(ledger, bench, n=10):
    rows = ledger_entries_for(ledger, bench)[-n:]
    return [{"date": r.get("date", "")[:19], "commit": r.get("commit", "")[:10],
             "score": r.get("score"), "unit": r.get("unit", ""),
             "baseline": r.get("baseline")} for r in rows]


# ============================================================================================
# Human-readable regression report.
# ============================================================================================

def format_report(overall, verdicts, ledger=None):
    lines = []
    icon = {PASS: "PASS", WARN: "WARN", FAIL: "FAIL"}
    lines.append("=" * 78)
    lines.append(f"PERF GATE: {icon[overall]}")
    lines.append("=" * 78)
    header = f"{'metric':26} {'status':6} {'candidate':>12} {'baseline':>12} {'regr%':>8}"
    lines.append(header)
    lines.append("-" * 78)
    for v in verdicts:
        reg = v.get("regression_pct")
        reg_s = f"{reg:+.2f}" if isinstance(reg, (int, float)) else "-"
        cand = v.get("candidate")
        base = v.get("baseline")
        cand_s = f"{cand:.3f}" if isinstance(cand, (int, float)) else "-"
        base_s = f"{base:.3f}" if isinstance(base, (int, float)) else "-"
        lines.append(f"{v['metric']:26} {icon[v.get('status', PASS)]:6} "
                     f"{cand_s:>12} {base_s:>12} {reg_s:>8}")
    lines.append("-" * 78)

    # Name the worst metric + its history (the deliverable's headline requirement).
    worst = _worst_metric(verdicts)
    if worst and worst.get("status") in (WARN, FAIL):
        lines.append("")
        lines.append(f"WORST METRIC: {worst['metric']} [{icon[worst['status']]}]")
        for r in worst.get("reasons", []):
            lines.append(f"  - {r}")
        if ledger is not None:
            hist = ledger_history(ledger, worst["metric"], n=8)
            if hist:
                lines.append(f"  ledger history (last {len(hist)}):")
                for h in hist:
                    tag = f" [{h['baseline']}]" if h.get("baseline") else ""
                    lines.append(f"    {h['date']}  {h['commit']}  "
                                 f"{h['score']} {h['unit']}{tag}")
    lines.append("=" * 78)
    return "\n".join(lines)


def _worst_metric(verdicts):
    ranked = sorted(
        verdicts,
        key=lambda v: (_SEVERITY.get(v.get("status", PASS), 0),
                       v.get("regression_pct") or 0.0),
        reverse=True)
    return ranked[0] if ranked else None


# ============================================================================================
# Subcommand: evaluate (the CI gate; fed injected/recorded samples).
# ============================================================================================

def cmd_evaluate(args):
    thresholds = load_thresholds(args.thresholds)
    with open(args.candidate) as f:
        samples = json.load(f)
    # allow a separate baseline-samples file merged in per-metric
    if args.baseline:
        with open(args.baseline) as f:
            base = json.load(f)
        for m, arms in base.get("metrics", {}).items():
            samples.setdefault("metrics", {}).setdefault(m, {})
            if "candidate" in arms and "baseline" not in samples["metrics"][m]:
                samples["metrics"][m]["baseline"] = arms["candidate"]
            elif "baseline" in arms:
                samples["metrics"][m]["baseline"] = arms["baseline"]
    ledger = load_ledger()   # always loaded so the worst-metric history can be shown
    overall, verdicts = evaluate_suite(thresholds, samples, ledger=ledger)
    print(format_report(overall, verdicts, ledger=ledger))
    if args.json_out:
        with open(args.json_out, "w") as f:
            json.dump({"overall": overall, "verdicts": verdicts}, f, indent=2)
    return 0 if overall in (PASS, WARN) else 1


# ============================================================================================
# Subcommand: run (interleaved A/B live runner) — orchestration.
# ============================================================================================

def _run_arm(metric, commit, runs, verbose):
    """Run ONE benchmark arm at a given commit via tools/bench.py, returning its per-run scores.
    LIVE part (checkout + rebuild + boot) needs the dedicated runner; see bench/RUNNER.md."""
    cmd = [sys.executable, os.path.join(REPO, "tools", "bench.py"), "run", metric,
           "--engine", "native", "--runs", str(runs), "--json", "-"]
    env = dict(os.environ)
    out = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, env=env)
    if out.returncode != 0:
        raise RuntimeError(f"bench.py run {metric} @ {commit} failed:\n{out.stderr[-800:]}")
    res = json.loads(out.stdout)
    return res.get("runs", [res.get("score")])


def cmd_run(args):
    """Interleaved A/B: for each metric, alternate baseline-commit and candidate-commit runs
    so host drift hits both arms equally. This wires the orchestration; the actual multi-minute
    boot loop is executed only on the dedicated runner (verification debt — see RUNNER.md)."""
    metrics = args.metrics.split(",") if args.metrics else ["coremark", "dhrystone", "boot"]
    thresholds = load_thresholds(args.thresholds)
    samples = {"metrics": {}}
    print(f"bench_ci: interleaved A/B baseline={args.baseline_commit} "
          f"candidate={args.candidate_commit or 'WORKTREE'} metrics={metrics}",
          file=sys.stderr)
    for metric in metrics:
        base_scores, cand_scores = [], []
        for i in range(args.pairs):
            # interleave: baseline then candidate, each pair, to cancel slow drift.
            print(f"bench_ci: {metric} pair {i+1}/{args.pairs} (A=baseline)", file=sys.stderr)
            base_scores += _run_arm(metric, args.baseline_commit, 1, args.verbose)
            print(f"bench_ci: {metric} pair {i+1}/{args.pairs} (B=candidate)", file=sys.stderr)
            cand_scores += _run_arm(metric, args.candidate_commit or "WORKTREE", 1, args.verbose)
        samples["metrics"][metric] = {"baseline": base_scores, "candidate": cand_scores}
    ledger = load_ledger()
    overall, verdicts = evaluate_suite(thresholds, samples, ledger=ledger)
    print(format_report(overall, verdicts, ledger=ledger))
    if args.samples_out:
        with open(args.samples_out, "w") as f:
            json.dump(samples, f, indent=2)
    return 0 if overall in (PASS, WARN) else 1


# ============================================================================================
# Subcommand: trend (static HTML dashboard from the ledger, one command).
# ============================================================================================

def _sparkline_svg(scores, higher_is_better, width=180, height=32):
    if not scores:
        return ""
    lo, hi = min(scores), max(scores)
    rng = (hi - lo) or 1.0
    n = len(scores)
    step = width / max(n - 1, 1)
    pts = []
    for i, s in enumerate(scores):
        x = i * step
        y = height - ((s - lo) / rng) * (height - 4) - 2
        pts.append(f"{x:.1f},{y:.1f}")
    # last point marker colour: green if latest is best, red if worst.
    latest = scores[-1]
    best = max(scores) if higher_is_better else min(scores)
    worst = min(scores) if higher_is_better else max(scores)
    colour = "#2e7d32" if latest == best else ("#c62828" if latest == worst else "#f9a825")
    lx, ly = pts[-1].split(",")
    return (f'<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
            f'preserveAspectRatio="none" class="spark">'
            f'<polyline fill="none" stroke="#5b8def" stroke-width="1.5" points="{" ".join(pts)}"/>'
            f'<circle cx="{lx}" cy="{ly}" r="2.6" fill="{colour}"/></svg>')


def render_trend_html(ledger):
    entries = ledger.get("entries", [])
    by_bench = {}
    for e in entries:
        by_bench.setdefault(e["bench"], []).append(e)
    generated = datetime.datetime.now(datetime.timezone.utc).isoformat()
    out = []
    out.append("<!doctype html><meta charset='utf-8'>")
    out.append("<title>wasm-vm performance trend</title>")
    out.append("""<style>
      body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:2rem;color:#1a1a1a;background:#fafafa}
      h1{font-size:1.4rem} h2{font-size:1.05rem;margin-top:1.6rem}
      table{border-collapse:collapse;margin:.4rem 0 1rem;font-size:12.5px}
      th,td{border:1px solid #ddd;padding:3px 8px;text-align:right} th{background:#eef}
      td.l,th.l{text-align:left} .spark{vertical-align:middle;background:#fff;border:1px solid #eee}
      .bless{color:#6a1b9a;font-weight:600} .meta{color:#666;font-size:12px}
      @media(prefers-color-scheme:dark){body{background:#161616;color:#e6e6e6}
        th{background:#26304a} th,td{border-color:#333} .spark{background:#1e1e1e;border-color:#333}}
    </style>""")
    out.append("<h1>wasm-vm performance trend</h1>")
    out.append(f"<p class='meta'>generated {generated} — {len(entries)} ledger entries, "
               f"{len(by_bench)} benchmarks. Source: bench/ledger.json (hash-chained).</p>")
    if not entries:
        out.append("<p><em>ledger is empty</em></p>")
    for bench, rows in sorted(by_bench.items()):
        hib = rows[0].get("higher_is_better", True)
        unit = rows[0].get("unit", "")
        scores = [r["score"] for r in rows]
        spark = _sparkline_svg(scores, hib)
        direction = "higher is better" if hib else "lower is better"
        out.append(f"<h2>{_html.escape(bench)} "
                   f"<span class='meta'>({_html.escape(unit)}, {direction})</span> {spark}</h2>")
        out.append("<table><tr><th class='l'>date</th><th class='l'>commit</th>"
                   "<th class='l'>baseline</th><th>score</th><th>Δ%</th><th>spread</th></tr>")
        prev = None
        for r in rows[-30:]:
            score = r["score"]
            if prev is None or prev == 0:
                delta = "-"
            else:
                d = (score - prev) / prev * 100.0
                delta = f"{d:+.2f}"
            prev = score
            baseline = r.get("baseline") or ""
            cls = " class='bless'" if r.get("bless") else ""
            btag = _html.escape(str(baseline))
            if r.get("bless"):
                btag += " ✦"
            out.append(
                f"<tr{cls}><td class='l'>{_html.escape(r.get('date','')[:19])}</td>"
                f"<td class='l'>{_html.escape(r.get('commit','')[:10])}</td>"
                f"<td class='l'>{btag}</td><td>{score}</td><td>{delta}</td>"
                f"<td>{r.get('spread','')}</td></tr>")
        out.append("</table>")
    return "\n".join(out)


def cmd_trend(args):
    ledger = load_ledger(args.ledger)
    htmltext = render_trend_html(ledger)
    out = args.out or TREND_HTML
    with open(out, "w") as f:
        f.write(htmltext + "\n")
    print(f"bench_ci: wrote trend page -> {os.path.relpath(out, REPO)} "
          f"({len(ledger.get('entries', []))} entries)", file=sys.stderr)
    return 0


def cmd_selftest(args):
    import bench_ci_test
    return bench_ci_test.run()


def main():
    ap = argparse.ArgumentParser(description="E4-T27 performance-regression CI gate")
    sub = ap.add_subparsers(dest="cmd", required=True)

    e = sub.add_parser("evaluate", help="evaluate candidate samples against thresholds (the gate)")
    e.add_argument("--candidate", required=True, help="JSON: {metrics:{name:{candidate:[..],baseline:[..]}}}")
    e.add_argument("--baseline", help="optional separate baseline-samples JSON")
    e.add_argument("--thresholds", default=THRESHOLDS)
    e.add_argument("--ledger-history", action="store_true",
                   help="(always on) show ledger history for the worst metric")
    e.add_argument("--json-out", help="also write the machine-readable verdict here")
    e.set_defaults(func=cmd_evaluate)

    r = sub.add_parser("run", help="interleaved A/B live runner (needs the dedicated runner)")
    r.add_argument("--baseline-commit", required=True)
    r.add_argument("--candidate-commit", default=None, help="default: current worktree")
    r.add_argument("--metrics", default=None, help="comma list (default coremark,dhrystone,boot)")
    r.add_argument("--pairs", type=int, default=5, help="A/B interleave pairs per metric")
    r.add_argument("--thresholds", default=THRESHOLDS)
    r.add_argument("--samples-out", help="write the collected samples JSON")
    r.add_argument("--verbose", action="store_true")
    r.set_defaults(func=cmd_run)

    t = sub.add_parser("trend", help="render the static trend HTML from the ledger")
    t.add_argument("--out", default=None, help=f"default {os.path.relpath(TREND_HTML, REPO)}")
    t.add_argument("--ledger", default=LEDGER)
    t.set_defaults(func=cmd_trend)

    s = sub.add_parser("selftest", help="run the pure-function unit tests")
    s.set_defaults(func=cmd_selftest)

    args = ap.parse_args()
    raise SystemExit(args.func(args))


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main()
