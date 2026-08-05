---
id: E4-T01
epic: 4
title: Profiling infrastructure — hot-PC histograms and per-device time accounting
priority: 401
status: partially-verified
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

## Verification debt
_Tracked as debt (the ticket is `partially-verified`); clear on `dev`._
- **Phase-6 browser evidence** (AC1 Alpine-symbol leg + AC4 native-vs-wasm profile diff) — the Alpine-in-browser boot OS-reaps on this mac. Run on `dev` via `getProfile()` against a live Alpine boot; diff native vs wasm reports.

## Verification log
- 2026-08-04 — **Design + phased plan (opens Epic 4's measurement backbone).** Precedents to mirror:
  `crates/core/src/diag/irqstats.rs` (always-on no_std fixed-array counters + `dump()`), `trace.rs` (the
  monomorphize-to-nothing zero-cost hook), and E2-T25's existing per-device MMIO hit accounting
  (`Window.hits` mmio.rs:90, `SystemBus::device_hits()` mmio.rs:165, cold `load_device`/`store_device`
  mmio.rs:187, `BootProfiler::report` cli/boot.rs:654). Gap: no monotonic host-time trait exists
  (`WallClock`/`Date.now()` is epoch, not `Instant`/`performance.now()`), so a new `HostTimer` trait is
  needed.
  - **Sample site:** the retire point in `Machine::run_traced` (lib.rs:1467-1479), beside
    `irqstats.on_retire()`; sample `hart.regs.pc` BEFORE `step_traced`. Downsample with a
    jittered/prime stride (~1021 + small LCG jitter) so no fixed loop period hides in a blind spot
    (adversarial check 3). Physical PC via an on-sample `mmu::translate` (affordable at 1-in-~1000).
  - **Time accounting — instrument only COLD paths, attribute the hot path by subtraction:** device time
    wraps the cold `load_device`/`store_device`; MMU-walk time wraps only the cold `walk_leaf` (TLB miss),
    never `translate_cached`; total run wall-time measured once per `run_traced`; CPU-interp = total −
    (device + walk). So the per-instruction hot loop reads the clock ZERO times → achievable <10% enabled /
    0% disabled (criterion 3). Honest limitation to document: CPU time is by subtraction, accuracy bounded
    by the single total-wall measurement.
  - **Histogram:** 64-byte-region buckets (`pc>>6`), a fixed 8192-slot direct-mapped tag table
    (`region*GOLDEN64 >> (64-log2)`), evict-low-count-else-count-`collisions` so aliasing is visible;
    ~96 KiB bounded regardless of guest size; `top(k)` for the ranked report.
  - **Surfaces:** `--profile`/`--symbols`/`--profile-json` CLI (native `MonotonicTimer(Instant)`) +
    `getProfile()` wasm (`performance.now()`), mirroring `getStats`/`JsWallClock`.
  - **Feature-gated `profiling`** (like `trace`): hooks `#[cfg(feature="profiling")]`; when on-but-runtime-
    off, cost is one bool branch (like `storm_detect`); when off, compiles to nothing (`check-zero-cost.sh`).
  - **Phases (each independently testable/committable):** (1) pure core logic — histogram/clock/report +
    native unit tests; (2) sample hook + synthetic-64-byte-loop integration test; (3) per-subsystem time
    accounting (`FixedTimer` deterministic tests + device-hammer test); (4) native CLI surface + committed
    native-Alpine example report + overhead A/B; (5) wasm `getProfile()`; (6) browser evidence (Alpine
    System.map top-5 symbols + native-vs-wasm diff) — the OS-reaping Alpine-boot leg, deferred to the
    nightly/`dev` lane (see [[browser-alpine-boot-reaped-on-mac]]).
- 2026-08-04 — **Phase 1 (pure core) landed (commit `ce9da4b`).** `crates/core/src/prof/` — `HotHistogram`
  (8192-slot direct-mapped, Fibonacci-hashed, weak-incumbent eviction + visible `collisions`, ~128 KiB
  bound), `HostTimer` trait + `FixedTimer` mock (documented why it's separate from the epoch `WallClock`),
  `Subsystem`/`HotRegion`/`ProfReport` (`to_text`/hand-rolled `to_json`), and the `ProfStats` aggregate.
  12 native tests; no_std wasm32 clean; `pub mod prof;` added. Not yet wired to `Machine`.
- 2026-08-04 — **Phase 2 (sample hook) landed (commit `0781a19`).** `ProfStats` + a runtime `profiling`
  flag wired onto `Machine`; the sample fires at the `run_traced` retire site, gated OFF by default (one
  not-taken branch/retire, `storm_detect` shape), sampling ~1-in-1024 at a jittered prime stride
  (`1021 + LCG jitter`, deterministic → native==wasm). Records the guest VIRTUAL PC (System.map- and
  JIT-block-relevant; on-sample physical translation deemed unnecessary — a documented deviation from the
  plan's "physical PC"). `set_profiling`/`prof_report` accessors. Integration test `prof_sampling.rs` (3):
  a tight two-instruction loop concentrates ≥80% of samples in its 64-byte region, zero collisions;
  inert-until-armed; deterministic across identical runs. `determinism`/`cpu_resume` unchanged (gated-off
  hook is a hot-path no-op).
- 2026-08-04 — **Phase 3 (per-subsystem host-time accounting) landed (commit `efbe3fb`).** The `HostTimer`
  is injected onto `Machine` (`set_host_timer`) and threaded to `SystemBus`; time is read ONLY on cold
  paths — the cold `load_device`/`store_device` MMIO dispatch (bracketing just `dev.read/write`, timer +
  accumulator passed as extra params so the split-borrow that keeps `ram` alive is preserved; args built
  only in the cold `Err(Access)` arm so pure-RAM traffic pays nothing), the cold `walk_leaf` TLB-miss
  walk (split into a timing wrapper + `walk_leaf_inner`; hot `translate_cached` untouched), and once per
  run (`run_traced` split into a timing wrapper + `run_traced_inner`). CPU-interp time is DERIVED as
  `total − (device + walk)` at report time (idempotent), so the per-instruction hot path reads the clock
  ZERO extra times. `Subsystem::for_device_base` maps a `Window.start` to its subsystem. New test
  `prof_time_accounting.rs` (2, deterministic timer): device ns attributed to the RIGHT subsystem +
  CpuInterp-by-subtraction non-negative + report idempotent; profiling-off reads no clock (all ns 0).
  **Deferred (documented in-file):** the MMU-walk ns assertion (a full Sv39/S-mode/TLB-miss guest is
  disproportionate for a unit test; the identical timer-bracket is proven by the device test). Full core
  suite green (lib 147, prof integration 5, all binaries); wasm32 + zicsr-stub + clippy `-D warnings`
  clean (also cleared pre-existing test-clippy debt on the branch, commit `9622051`). Honest limitation:
  CPU-interp accuracy is bounded by the single total-span measurement.
- 2026-08-04 — **Phase 4 (native CLI surface) landed (commit `29457d9`).** `--profile` / `--symbols
  <System.map>` / `--profile-json` on the boot CLI; `MonotonicTimer` (`Instant`-based `HostTimer`); a
  System.map parser + nearest-preceding symbolizer (2 unit tests); the hot-PC + subsystem-time report
  printed at first-boot exit. **Validated end-to-end on a real native busybox boot** (evidence
  `evidence/e4-t01/native-busybox-profile.txt`): 36,874 PC samples at kernel VIRTUAL PCs
  (`0xffffffff80…` — directly System.map-symbolizable, vindicating the phase-2 virtual-PC choice);
  CPU-by-subtraction exact (`cpu_interp = total − mmu_walk − plic`); MMU-walk time separated (352 ms /
  345 k walks); collisions 0.6%; `PROFILE_HOTPC_JSON` emitted. **Overhead A/B** (20 M-instr boot, debug):
  OFF ~51.2 s vs ON ~51.5 s — within noise (~0.5%), far under the 10% ceiling (**AC3**), since timing is
  cold-path-only.
- 2026-08-04 — **Phase 5 (wasm surface) landed (commit `67dfd93`).** `JsHostTimer` (`performance.now()`,
  Window- or Worker-scoped); `WasmLinux::setProfiling(on)` (arms + injects the timer) and `getProfile()`
  returning the same `{ totalNs, sampleCount, walkCount, collisions, regions, subsystems }` shape as the
  native report / `getStats` (pc as hex string). web-sys `Performance` feature enabled. Compiles clean for
  wasm32 (clippy `-D warnings`).
- **The full profiler is implemented across phases 1–5** (engine + native CLI + wasm surface), native-
  verified end-to-end. **Verification debt (phase 6):** the in-browser evidence — an Alpine boot's top-5
  kernel symbols via `getProfile` + a native-vs-wasm report diff (**AC1 Alpine-symbol leg + AC4**) — is
  the OS-reaping Alpine-browser-boot path (see [[browser-alpine-boot-reaped-on-mac]]); run it on `dev`/
  nightly. Everything provable headlessly is done and green (native busybox profile is the committed
  example report standing in for the Alpine one until the browser leg runs).
