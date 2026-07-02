---
id: E4-T27
epic: 4
title: Performance regression CI — benchmark thresholds that fail the build
priority: 427
status: pending
depends_on: [E4-T04, E4-T21, E4-T23]
estimate: M
capstone: false
---

## Goal
Performance becomes a gated invariant like correctness: every merge runs the benchmark
suite (CoreMark, Dhrystone, boot, gcc, FP micro, plus the latency metrics — JIT pause p100,
MMIO budgets, echo latency) against recorded thresholds, failing the build on regression —
with the statistical machinery (fixed runners, medians, noise bands, rolling baselines) to
make failures trustworthy rather than ignorable.

## Context
Every epic after this one (GPU frames, self-hosted rustc) spends the performance this epic
earned; unguarded, it erodes one "harmless" commit at a time. The hard problem is noise:
CI runners are shared and thermally variable. Mitigations, all standard practice: dedicate
a runner class (or self-hosted box) for perf jobs; interleave A/B (run baseline-commit and
candidate-commit alternately in one job, compare ratios not absolutes — immunizes against
host variance); median-of-5 with MAD-based outlier rejection; two-tier response — soft
warning at >3% regression, hard fail at >7% or any latency-budget breach; rolling-best
baseline updated only by explicit `tools/bench.py bless` commits (no silent ratchet-down).
Browser benches run headless Chromium pinned by version; native benches carry most gating
weight (lower variance), browser benches gate at looser thresholds. All results append to
the E4-T04 ledger with runner metadata, and a trend dashboard (static HTML from ledger)
is published from CI.

## Deliverables
- `tools/bench_ci.py`: interleaved A/B runner, statistics, threshold evaluation, ledger
  append, human-readable regression report on failure naming the worst metric + history.
- CI wiring: perf job on merge queue / main pushes; hard-fail semantics demonstrated;
  `bless` workflow for intentional trade-offs (requires a rationale string, recorded).
- Thresholds file (`bench/thresholds.toml`) covering all benchmarks + latency metrics,
  each with soft/hard bands and gating engine (native/browser) noted.
- Trend page generated from the ledger (per-benchmark sparkline + last-30 table).
- Runner setup documented (pinning, warmup runs, browser version capture).

## Acceptance criteria
- [ ] A synthetic 10% CoreMark regression (commit adding a delay to the dispatch loop on
      a test branch) fails CI with a report naming CoreMark and the measured delta.
- [ ] A no-op commit passes 10 consecutive perf CI runs with zero false failures
      (noise-immunity demonstrated on the actual runner class).
- [ ] Latency gates live: an artificial 10 ms JIT pause injection fails the build.
- [ ] `bless` path works and leaves an auditable ledger record with rationale.
- [ ] Trend page renders from a clean checkout's ledger with one command.

## Adversarial verification
Refute the gate's sensitivity and its honesty. Attack angles: (1) sneak regressions under
the threshold: submit five stacked commits each costing ~2% (below soft band) — if the
rolling-baseline scheme lets 10% cumulative erosion through un-flagged, the design is
refuted as specified (the rolling-best + trend alarms must catch cumulative drift; verify
the mechanism, not the intention); (2) false-positive bombardment: run the suite 25 times
across a day on the real runner and count spurious hard-fails — >1 refutes the statistics;
(3) gaming check: verify the interleaved A/B actually rebuilds and runs the baseline
commit (not a cached binary of the candidate); poison the cache and confirm detection;
(4) threshold coverage: grep thresholds.toml against the full metric list from E4-T04/T21/
T23 — an ungated headline metric (e.g. boot time missing) refutes; (5) confirm the perf
job cannot be skipped by label/path filters on JIT-touching changes (try to merge a
dispatch-loop change with `[skip perf]` — success refutes the wiring).

## Verification log
(empty)
