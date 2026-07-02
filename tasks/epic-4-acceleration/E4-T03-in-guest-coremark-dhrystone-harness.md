---
id: E4-T03
epic: 4
title: Automated in-guest CoreMark and Dhrystone benchmark harness
priority: 403
status: pending
depends_on: [E3]
estimate: M
capstone: false
---

## Goal
CoreMark and Dhrystone run *inside the guest* on demand, fully scripted end-to-end (boot →
run → parse score → emit JSON), reproducibly enough that a 10% performance change is
signal, not noise. This is the micro-benchmark half of the measurement backbone the whole
epic (and its capstone's "≥10x CoreMark") stands on.

## Context
The capstone threshold is defined against CoreMark; without an automated harness every
optimization task devolves into anecdotes. Benchmarks must be pinned binaries (fixed
compiler, flags, iteration counts) committed or reproducibly built — not `apk add`-ed at
run time, since mirror drift would silently change the workload. CoreMark's own run rules
(≥10 s runtime, reported iterations/sec) apply. Harness drives the native build directly
and the browser build via headless Chromium (Playwright or chromedriver), reusing the
Epic 3 boot automation.

## Deliverables
- `bench/guest/` with pinned riscv64 CoreMark and Dhrystone binaries (statically linked,
  `-O2`, build script + exact toolchain version recorded) baked into a small benchmark
  disk image/overlay.
- `tools/bench.py run coremark|dhrystone --engine native|browser`: boots the VM, executes
  the benchmark via serial console scripting, parses the score (iterations/s, DMIPS),
  runs 3 iterations, reports the median, and emits
  `{bench, score, runs, engine, commit, config, date}` JSON.
- Guest-side timing sanity: harness cross-checks guest-reported elapsed time against host
  wall clock and flags >5% disagreement (guards against guest clock lies inflating scores).
- README section in `bench/` documenting run rules and noise expectations.

## Acceptance criteria
- [ ] `tools/bench.py run coremark --engine native` completes unattended from a cold start
      and prints a JSON result; same for `--engine browser` in headless Chromium.
- [ ] Median-of-3 relative spread (max−min)/median ≤ 5% across two back-to-back invocations
      on an idle machine, for both engines.
- [ ] CoreMark run duration inside the guest is ≥ 10 s (iteration count tuned per rules).
- [ ] Rebuilding the guest binaries from the build script yields byte-identical ELFs
      (pinned toolchain container or checked-in binaries with recorded hashes).

## Adversarial verification
Refute by making the harness report a wrong or unstable number. Attack angles: (1) run the
harness 5 times and compute spread — >5% median spread on an idle host refutes the
reproducibility claim; (2) tamper check: patch the guest to report a fake elapsed time
(or artificially skew mtime) and confirm the host-wall-clock cross-check flags it — if a
2x guest-clock lie passes silently, refuted; (3) run with a deliberately throttled host
(e.g. `taskset`/low-power mode) and verify the harness reports the change rather than
caching stale results; (4) delete the benchmark overlay and rerun — the harness must fail
loudly, not silently benchmark a different binary from the base image.

## Verification log
(empty)
