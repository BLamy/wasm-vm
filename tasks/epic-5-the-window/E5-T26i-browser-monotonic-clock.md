---
id: E5-T26i
epic: 5
title: Wire opt-in monotonic time through the browser desktop lifecycle
priority: 526.59
status: in-progress
depends_on: [E4-T24, E5-T26e, E5-T26h, E5-T19a]
estimate: S
risk: high
capstone: false
---

## Goal

Expose the existing core monotonic time policy to the interactive browser desktop
so its timer-rate hypothesis can be tested. This is one host-clock adapter/lifecycle
boundary, not a JIT optimization or a waiver of F's two-second interaction target.

## Boundary

Add an explicit desktop `guestClock=wall` option and its WASM/worker plumbing;
retain `icount` as the existing default and deterministic oracle. Reuse
`TimeSource`/`WallClockPolicy` and the existing Worker-compatible performance source.
Do not alter their slew rules, enable direct chaining in wall mode, change JIT
residency, adjust F's command/deadline, or change snapshot wire formats. A future
default-policy decision requires actual browser measurements, not this hypothesis.

## Acceptance criteria

- The explicit wall option uses a real realm-monotonic host source, not RTC epoch
  time. Unsupported labels or unavailable sources fail clearly before mutation;
  omitted/icount selection retains the current deterministic behavior.
- Deterministic injected-clock tests prove guest-visible `rdtime` progression at
  the DT's 10 MHz rate under busy execution (not WFI fast-forward), monotonic
  backward-jitter handling, and unchanged ICount trace/digest behavior.
- Successful fresh and same-machine snapshot restores re-anchor at restored
  `mtime`; a rejected restore cannot mutate clock policy/anchor. Host timestamps
  are not serialized as if portable. Explicit pause/resume freezes guest time
  across the pause; ordinary background elapsed time keeps the existing gap
  policy. A reported jump is not claimed to be automatic guest resynchronization.
- A recorded built Chromium worker/desktop path selects the new mode and reports
  its real clock state. An unprofiled, authenticated-image comparison records
  guest-time progression and actual input/audio behavior for both modes. Report
  timing failures honestly; neither this experiment nor an opt-in feature makes
  F verified or authorizes changing the production default.

## Verification command

make verify-E5-T26i

## Adversarial verification

Fresh Daybreak Blue: carry unchanged E4-T24 and H/T19a results forward. Attack
missing/invalid mode selection, busy `rdtime` versus the ICount control, backward
host time, paused host-time advance, large background gaps, restored deadlines,
same-instance restore after the host epoch advanced, and failed-restore atomicity.
Sabotage one clock test by freezing or mis-scaling the host source. Check the
actual browser boot option reaches the worker and WASM adapter; a query string
or host timer read alone is not guest-clock evidence. Preserve the conservative
wall-clock JIT path. Run the final exact-head pristine-clone proof once.

## Verification log

### 2026-09-07 — worker — in-progress

This is the sole eligible task at activation, with high risk recorded before
entering the lane. Keep the existing default and all held sound/restore/runtime
checks intact. Implement the adapter and lifecycle first, then record the selected
clock's guest-visible behavior; no speedup or final F result is assumed.

### 2026-09-07 — coordinator — measured prerequisite, not a promised speedup

F's authenticated same-runtime diagnostics complete playback but miss two seconds;
`evidence/e5-t26f/cpu-560c6743/README.md` retains the exact command and profile.
CPU attribution is mixed, not dominated by one cheap removable function.
`WasmLinux::assemble` uses `enable_clint(10)` against a 10 MHz DT timebase,
requiring 100 million retirements per guest second while busy. The measured
12.8–13 million retirements/host-second therefore yield roughly 0.13× guest time
while busy; ICount WFI fast-forward is a separate path and must not be conflated.
E4-T24 explicitly deferred browser monotonic injection. Core wall mode also
disables in-module direct chaining, so wiring it is not presumed to improve
throughput or satisfy F. Establish the missing adapter with exact lifecycle proof,
then use controlled unprofiled measurements before any production-policy change.
