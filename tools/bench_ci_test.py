#!/usr/bin/env python3
"""E4-T27 unit tests for the pure statistics + threshold-evaluation core of bench_ci.py.

Runnable two ways (no third-party deps required):
    python3 tools/bench_ci_test.py       # standalone; prints PASS/FAIL, exits nonzero on failure
    python3 -m pytest tools/bench_ci_test.py

Every test injects sample arrays directly — NO real benchmark run. This is the whole point:
the gate's math is proven independent of a clean runner.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bench_ci as bc  # noqa: E402

THRESHOLDS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                          "bench", "thresholds.toml")


# ---- statistics: median-of-5 + MAD outlier rejection ----------------------------------------

def test_median_of_5():
    assert bc.median_of([5, 1, 3, 2, 4]) == 3


def test_clean_series_keeps_all():
    s = [261.4, 261.7, 261.9, 261.5, 261.8]
    kept, rejected = bc.reject_outliers(s)
    assert rejected == [], f"clean series wrongly rejected {rejected}"
    assert len(kept) == 5


def test_injected_outlier_rejected():
    # four tight samples + one wild flier (a thermal hiccup run)
    s = [261.4, 261.7, 261.9, 261.5, 180.0]
    kept, rejected = bc.reject_outliers(s)
    assert rejected == [180.0], f"expected 180.0 rejected, got kept={kept} rej={rejected}"
    # robust center is unmoved by the flier
    assert abs(bc.robust_center(s) - 261.6) < 0.5


def test_mad_zero_series_no_divide_by_zero():
    s = [100.0, 100.0, 100.0, 100.0, 100.0]
    kept, rejected = bc.reject_outliers(s)
    assert rejected == [] and kept == s
    assert bc.robust_center(s) == 100.0


# ---- A/B ratio comparison: host-variance immunity -------------------------------------------

def test_ab_no_regression():
    base = [261.4, 261.7, 261.9, 261.5, 261.8]
    cand = [261.3, 261.6, 261.8, 261.5, 261.7]
    reg = bc.ab_regression_pct(base, cand, higher_is_better=True)
    assert abs(reg) < 0.5, f"near-identical arms should not show regression, got {reg}"


def test_ab_10pct_regression_detected():
    base = [261.4, 261.7, 261.9, 261.5, 261.8]
    cand = [c * 0.90 for c in base]           # candidate 10% slower CoreMark
    reg = bc.ab_regression_pct(base, cand, higher_is_better=True)
    assert 9.5 < reg < 10.5, f"expected ~10% regression, got {reg}"


def test_ab_host_variance_immune():
    """Scaling BOTH arms by the same constant (a throttled host) must NOT change the verdict."""
    base = [261.4, 261.7, 261.9, 261.5, 261.8]
    cand = [c * 0.90 for c in base]
    reg_fast = bc.ab_regression_pct(base, cand, higher_is_better=True)
    k = 0.55                                   # host runs everything 45% slower this run
    reg_slow = bc.ab_regression_pct([b * k for b in base], [c * k for c in cand],
                                    higher_is_better=True)
    assert abs(reg_fast - reg_slow) < 1e-9, f"ratio not host-immune: {reg_fast} vs {reg_slow}"


def test_ab_lower_is_better_regression():
    base = [375.0, 375.4, 375.2, 375.1, 375.3]     # boot seconds
    cand = [c * 1.10 for c in base]                # 10% slower boot
    reg = bc.ab_regression_pct(base, cand, higher_is_better=False)
    assert 9.5 < reg < 10.5, f"expected ~10% boot regression, got {reg}"


# ---- threshold evaluation: two-tier + budgets -----------------------------------------------

def _spec(**kw):
    d = {"metric": "x", "unit": "u", "higher_is_better": True, "soft_pct": 3.0,
         "hard_pct": 7.0, "kind": "ratio", "gate": "gating"}
    d.update(kw)
    return d


def test_eval_pass_within_noise():
    v = bc.evaluate_metric(_spec(), candidate_samples=[100, 100.5, 99.8, 100.2, 100.1],
                           baseline_samples=[100, 100, 100, 100, 100])
    assert v["status"] == bc.PASS, v


def test_eval_soft_warn():
    v = bc.evaluate_metric(_spec(), candidate_samples=[95, 95, 95, 95, 95],  # 5% worse
                           baseline_samples=[100, 100, 100, 100, 100])
    assert v["status"] == bc.WARN, v
    assert 4.5 < v["regression_pct"] < 5.5


def test_eval_hard_fail():
    v = bc.evaluate_metric(_spec(), candidate_samples=[90, 90, 90, 90, 90],  # 10% worse
                           baseline_samples=[100, 100, 100, 100, 100])
    assert v["status"] == bc.FAIL, v
    assert 9.5 < v["regression_pct"] < 10.5


def test_eval_latency_budget_breach():
    # AC3: injected 10 ms JIT pause p100, budget 5 ms -> hard fail regardless of baseline.
    spec = _spec(metric="jit_pause_p100_ms", unit="ms", higher_is_better=False,
                 kind="budget", budget=5.0)
    v = bc.evaluate_metric(spec, candidate_samples=[10.0, 10.0, 10.0])
    assert v["status"] == bc.FAIL, v
    assert any("budget breach" in r for r in v["reasons"]), v


def test_eval_latency_budget_ok():
    spec = _spec(metric="jit_pause_p100_ms", unit="ms", higher_is_better=False,
                 kind="budget", budget=5.0)
    v = bc.evaluate_metric(spec, candidate_samples=[3.1, 3.0, 3.2])
    assert v["status"] == bc.PASS, v


def test_eval_advisory_downgrade():
    # browser/advisory gate downgrades a would-be FAIL to WARN but reports the true regression.
    spec = _spec(gate="advisory")
    v = bc.evaluate_metric(spec, candidate_samples=[90, 90, 90, 90, 90],
                           baseline_samples=[100, 100, 100, 100, 100])
    assert v["status"] == bc.WARN and v.get("hard_status") == bc.FAIL, v


# ---- suite-level evaluation + threshold coverage --------------------------------------------

def test_suite_worst_metric_and_overall():
    th = bc.load_thresholds(THRESHOLDS)
    samples = {"metrics": {
        "coremark": {"baseline": [261.7] * 5, "candidate": [c * 0.90 for c in [261.7] * 5]},
        "dhrystone": {"baseline": [189.7] * 5, "candidate": [189.6] * 5},
    }}
    overall, verdicts = bc.evaluate_suite(th, samples)
    assert overall == bc.FAIL
    worst = bc._worst_metric(verdicts)
    assert worst["metric"] == "coremark" and worst["status"] == bc.FAIL


def test_threshold_coverage_headline_metrics():
    # adversarial #4: every headline E4-T04/T21/T23 metric must be gated.
    th = bc.load_thresholds(THRESHOLDS)
    required = {"coremark", "dhrystone", "boot", "gcc", "fp_micro",
                "jit_pause_p100_ms", "mmio_uart_rt_p50_us", "mmio_blk_read_p50_ms",
                "echo_latency_p99_ms", "keystroke_visible_p99_ms"}
    missing = required - set(th["metrics"])
    assert not missing, f"ungated headline metrics: {missing}"


# ---- runner ---------------------------------------------------------------------------------

def run():
    tests = [(n, f) for n, f in sorted(globals().items())
             if n.startswith("test_") and callable(f)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"  PASS {name}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL {name}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"  ERROR {name}: {type(e).__name__}: {e}")
    total = len(tests)
    print(f"\nbench_ci_test: {total - failed}/{total} passed"
          + (f", {failed} FAILED" if failed else " — all green"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(run())
