---
id: E1-T23
epic: 1
title: Interpreter performance baseline — documented MIPS, native and in-browser
priority: 123
status: pending
depends_on: [E1-T19]
estimate: S
capstone: false
---

## Goal
An honest, reproducible measurement of how fast the Level-1 interpreter retires
instructions — native release build and in-browser WASM, across representative workloads
— recorded as the baseline every Level 4 JIT claim will be measured against, plus a CI
guard so Epic 2/3 feature work can't silently cost 2x.

## Context
The ROADMAP budgets ~50–150 MIPS for the interpreter and promises ≥10x from the Level 4
JIT — both numbers are meaningless without a defended baseline and a fixed methodology.
Workloads: Dhrystone and CoreMark compiled bare-metal rv64gc (pinned toolchain, -O2,
documented iteration counts), plus three microbenchmarks that isolate subsystem costs:
a branch-heavy loop (decode/dispatch cost), a memcpy loop (memory path + TLB), and an
FP kernel (softfloat cost — expect this to be the slow one; the number feeds back into
T05's record). Measurement: retired-instruction count from minstret ÷ wall time; native
via `std::time::Instant`, browser via `performance.now()` in Chrome and Firefox (both,
versions noted). Report MIPS and, for CoreMark, the standard iterations/sec. This task
measures and documents — optimization beyond obvious sub-day wins found while measuring
is explicitly out of scope (that is Level 4's job).

## Deliverables
- `bench/` bare-metal workload images + build scripts (pinned toolchain shas).
- `tools/bench.sh` (native) and a benchmark web page (wasm) printing a JSON result
  {workload, MIPS, wall_s, retires, build info, host info}.
- `docs/perf/level1-baseline.md`: the numbers table (native x86_64, native aarch64,
  Chrome, Firefox × 5 workloads), methodology, variance across 5 runs (median and
  spread), and known hot spots from a profile (one flamegraph summary).
- CI perf-smoke: Dhrystone native, median of 3, failing if below a floor set at 70% of
  the recorded baseline (catches order-of-magnitude regressions, tolerates noise).

## Acceptance criteria
- [ ] Baseline doc contains all 20 table cells with medians and spreads; spread ≤ 10%
      for native runs (else methodology is re-examined and the cause documented).
- [ ] Native Dhrystone MIPS is within the ROADMAP's expected order of magnitude
      (≥ 30 MIPS) — if not, the finding is filed; the number itself doesn't gate,
      honesty does.
- [ ] Browser results captured in both Chrome and Firefox with versions recorded.
- [ ] MIPS is computed from minstret (architectural retires), not loop estimates —
      cross-checked against the T22 trace counter for one workload.
- [ ] CI perf-smoke job exists, is green, and demonstrably fails on an artificial 3x
      slowdown (add a temporary per-instruction busy loop, observe red, revert).
- [ ] All benchmark runs use the deterministic CLINT clock config so guest-visible
      timing doesn't perturb workload behavior between runs.

## Adversarial verification
Reproduce every number: re-run the full matrix from the docs' exact commands on a clean
checkout; any cell off by > 25% from the doc refutes the baseline's reproducibility
(host differences must be explained by the recorded host info). Attack the metric:
verify MIPS uses retires by comparing against the independent trace counter — a harness
dividing *guest workload iterations* by time (a CoreMark score) mislabeled as MIPS
refutes. Attack workload integrity: confirm Dhrystone/CoreMark actually validate their
results in the guest (checksum printed via the console) — a benchmark whose kernel got
dead-code-eliminated refutes. Attack the browser leg: confirm the page runs the same
wasm binary hash as CI's artifact and that DevTools/throttling was closed (methodology
notes must say how). Check the CI floor math: set the floor, inject the 3x slowdown,
confirm red; then confirm a 10% noise wiggle stays green across 5 reruns (a flaky perf
gate refutes, because it will get disabled within a month).

## Verification log
(empty)
