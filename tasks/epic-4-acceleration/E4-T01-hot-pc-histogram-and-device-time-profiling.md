---
id: E4-T01
epic: 4
title: Profiling infrastructure — hot-PC histograms and per-device time accounting
priority: 401
status: pending
depends_on: [E3]
estimate: M
capstone: false
---

## Goal
Before we optimize anything, the emulator can tell us *where guest execution time goes*:
a low-overhead hot-PC histogram identifying the hottest guest code regions, and wall-clock
accounting of host time split across CPU interpretation, MMU walks, and each device model —
producing a ranked report that will justify (with numbers) every optimization in this epic.

## Context
Epic 4's thesis is measured acceleration. v86 and QEMU both grew their JITs around
profiler-identified hot loops; guessing wastes sessions. The histogram also directly feeds
E4-T08 (hotness-driven block discovery). Host-time accounting must work through the existing
platform trait layer (`Instant` natively, `performance.now()` in browser) so the same report
exists in both builds. Sampling, not exact counting: full per-PC counters would themselves
be the bottleneck.

## Deliverables
- Sampled hot-PC histogram: every N retired instructions (N configurable, default 1024),
  bucket the current *physical* PC into a fixed-size power-of-two table; report top-K
  regions with symbolization hooks (accepts a `System.map`/ELF symbol file when available).
- Per-subsystem time accounting: scoped timers around interpreter dispatch, page-table
  walks, and each MMIO device's read/write/poll paths; counters in a `ProfStats` struct.
- Overhead switch: profiling compiled behind a cargo feature + runtime flag; measured
  overhead when enabled documented.
- Report output: JSON dump plus human-readable top-N table, reachable from both a native
  CLI flag and a browser debug console/API call.
- A committed example report from an Alpine boot + `apk`-workload run.

## Acceptance criteria
- [ ] Booting Alpine with profiling on produces a report whose top-5 hot regions include
      identifiable kernel symbols (e.g. memcpy/memset, timer or scheduler paths) when given
      the kernel's System.map.
- [ ] Device/time accounting sums to within 10% of total measured wall clock for a boot run.
- [ ] Profiling enabled costs < 10% slowdown on a CoreMark-style loop; disabled feature
      build costs 0% (verified by benchmark diff and by inspecting that the code is
      compiled out).
- [ ] Identical report schema produced by the native build and the wasm32 browser build.

## Adversarial verification
Refute by demonstrating the profiler lies. Attack angles: (1) run a synthetic guest binary
that spends 90% of retired instructions in one known 64-byte loop — if the histogram does
not attribute ≥80% of samples to that region, refuted; (2) run a workload that hammers one
device (dd to virtio-blk) and confirm that device dominates device-time accounting — if
UART or CPU absorbs the time, refuted; (3) sampling bias: construct a loop whose length is
a multiple of the sampling stride N and show whether aliasing hides hot PCs (stride must be
randomized or prime-adjusted; systematic blind spots are a refutation); (4) enable profiling
in the browser build and diff the report against the native build for the same deterministic
guest — gross disagreement (>2x on any top-5 region) is a refutation.

## Verification log
(empty)
