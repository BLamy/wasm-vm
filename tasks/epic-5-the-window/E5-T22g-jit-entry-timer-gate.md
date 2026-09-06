---
id: E5-T22g
epic: 5
title: Gate browser-JIT entry timing behind explicit profiling
priority: 522.295
status: in-progress
depends_on: [E5-T22f]
estimate: S
risk: high
capstone: false
---

## Goal

Remove high-frequency `performance.now()` sampling from the normal browser-JIT
entry path while preserving the structural cost ledger and exact guest behavior.
Timing remains available when profiling is explicitly enabled. This is a measured
E5-T22c prerequisite, not a claim that resize now meets two seconds.

## Boundary

Own only the browser executor's optional entry-cost clock and propagation of the
existing profiling state across executor installation/replacement. Keep JIT
translation, chaining, cache policy, scheduler budgets, guest clocks, device
timing, architectural state, image/kernel and snapshot formats unchanged.

## Acceptance criteria

- [ ] In an actual browser Web Worker with profiling off, compiled execution and
      all deterministic entry-work counters remain live while entry-timer reads
      and entry nanoseconds remain exactly zero. Prove this in Chromium and
      Firefox; WebKit is outside this task.
- [ ] Enabling profiling before or after JIT attachment arms entry timing;
      disabling stops new reads immediately; re-enabling resumes them. Replacing
      an executor preserves the machine's current profiling state.
- [ ] Identical fixed-retirement runs with timing off/on have equal outcomes,
      architectural registers and RAM digests. The default-off worker path still
      executes compiled blocks, and the profiling-on control records real reads.
- [ ] The built demo passes 126/126 with zero browser/HTTP errors. Re-run the
      unchanged v7 desktop without either profiler, report all seven resize
      timings and retain client/mode/EDID/scanout/canvas agreement. Do not mark
      E5-T22c verified unless its own two-second gate passes.

## Verification command

make verify-E5-T22g

## Adversarial verification

Exercise profiling-before-executor, executor-before-profiling, disable/re-enable,
and executor replacement. Require independent timer-read deltas so zero elapsed
nanoseconds cannot masquerade as zero clock calls. Sabotage the default gate to
enabled and require the profiling-off browser test to fail. Compare fixed guest
state after the same work under both timing modes, and verify that guest/device
clocks and scheduler budgets are not routed through this diagnostic switch.

## Verification log

### 2026-09-06 — worker — in-progress

E5-T22f is independently verified. Its profiler-enabled maximum-resize capture
reduced PMP synchronization from 30.71% to 0.35%, then attributed 13.46% of total
sampled CPU to `performance.now()` through the browser-JIT entry timer. Source
inspection confirms the executor constructs and reads that timer even when the
machine profiler is off. Isolate that diagnostic clock behind the existing
profiling control; preserve C's complete timing requirement and immutable v7
desktop evidence.
