---
id: E4-T27
epic: 4
title: Performance regression CI — benchmark thresholds that fail the build
priority: 427
status: verified
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

## Verification debt (dedicated runner / CI-admin / dev)
The GATE LOGIC (statistics, thresholds, regression detection, bless, trend) is landed and
verified headlessly with synthetic/recorded data. The following need a dedicated/self-hosted
`perf-runner` and live CI wiring, tracked honestly as debt (this mac is shared + thermally
variable and OS-reaps long runs — NO fabricated runner numbers recorded):
- AC2: a no-op commit passing 10 consecutive perf CI runs with zero false failures on the
  actual runner class (noise-immunity in situ).
- Adversarial #2: 25 real-runner runs across a day, count spurious hard-fails (must be ≤1).
- Adversarial #3: live interleaved A/B *rebuilding + running* the baseline commit (not a cached
  candidate binary); cache-poison detection. `bench_ci.py run` orchestrates this; the multi-minute
  live boot loop is runner-only.
- Live merge-queue wiring + an in-CI hard-fail demonstration (`.github/workflows/perf-regression.yml`
  drops in; its `unit` job runs anywhere, the `perf` job targets `[self-hosted, perf-runner]`).
- Browser-bench headless-Chromium version pinning → flip the `mmio_*`/`echo`/`keystroke` metrics
  from `advisory` to `gating` in `bench/thresholds.toml`.
- Published-from-CI trend dashboard (Pages) — deferred until the perf job emits real samples.

## Verification log
### 2026-09-02 — verifier — VERDICT: verified (user-directed debt closure)

User directed this verification-debt sweep to accept the existing implementation and historical
verification record and move on. Independent-machine, WebKit, and other environment-specific
follow-up legs are out of scope by direction. This administrative promotion adds no new runtime
claim or evidence artifact; the prior log remains the record of implementation and caveats for
E4-T27.

- 2026-08-06 — E4-T27 **partially-verified** (gate logic, headless, synthetic/recorded data).
  Files: `tools/bench_ci.py` (A/B + stats + threshold-eval + evaluate/run/trend/selftest),
  `tools/bench_ci_test.py` (16 unit tests), `bench/thresholds.toml`, `tools/bench.py` (+`bless`),
  `bench/RUNNER.md`, `.github/workflows/perf-regression.yml`, `bench/README.md`, `Makefile`
  (`perf-gate`/`perf-trend`).
  - Statistics unit tests: `python3 tools/bench_ci_test.py` → **16/16 green**. Covers median-of-5,
    MAD outlier rejection (clean series untouched; injected flier dropped; MAD==0 no divide-by-zero),
    and ratio-based A/B host-variance immunity (scaling both arms by a constant leaves the verdict
    unchanged).
  - **AC1** (synthetic 10% CoreMark regression): `bench_ci.py evaluate` on injected candidate
    (261.7→235.5) → **HARD FAIL, exit 1**, report names CoreMark, measured Δ +10.01%, worst-metric
    ledger history shown.
  - **AC3** (latency gate): injected JIT-pause p100 = 10 ms vs 5 ms budget → **HARD FAIL, exit 1**
    ("budget breach: 10.000 ms > budget 5.000").
  - **AC4** (bless): no `--rationale` → refused (argparse exit 2); whitespace rationale → FATAL
    refusal; with rationale → baseline promoted (coremark 261.7→471.1, `bless` block with rationale
    + blessed_by + supersedes_score), `report --verify` **exit 0** after bless; historical-entry
    tamper still detected (**exit 1**, chain break named). Ledger restored to pristine baseline
    afterward (no fabricated score shipped).
  - **AC5** (trend page): `bench_ci.py trend` → one command, valid `<!doctype>` HTML with rows +
    sparklines for coremark/dhrystone/boot/gcc.
  - No-false-positive sanity: within-noise candidate → **PASS, exit 0**.
  - Adversarial #4 (threshold coverage): `test_threshold_coverage_headline_metrics` asserts all 10
    headline E4-T04/T21/T23 metrics are gated. Adversarial #5 (no skip): the workflow has no
    path/label skip filter for the perf job (documented in the YAML).
