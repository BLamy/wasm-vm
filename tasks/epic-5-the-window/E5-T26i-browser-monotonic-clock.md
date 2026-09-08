---
id: E5-T26i
epic: 5
title: Wire opt-in monotonic time through the browser desktop lifecycle
priority: 526.59
status: implemented
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

### 2026-09-08 — worker — implemented, wall mode is not a latency fix

Frozen runtime `99b8e692fddb7b1e82e4175e152ef5682c6b9373`; built metadata
`bfebb8d42f065196735df088c6d4b2ed8da62e77`; final bundle/cache stamp and paired
desktop recording `faddd274c934e09aec18161758c690a3b87bde8e`.
`evidence/e5-t26i/submission/README.md` records the exact commands and digests:
`make verify-E5-T26i-runtime` (28 native, 95 JS, fmt/clippy/no_std target),
`wasm-pack test --node crates/wasm --lib --test guest_clock -- guest_clock --nocapture`
(3 wrapper + 5 guest fixtures), `make web-dist`, the real built UART/rdtime
direct/worker fixture, and the 126/0 Chromium demo smoke with no errors. The
fresh critic's exact-head clone reproduced these gates and byte-identical WASM;
its two pre-existing dist-manifest differences are explicitly outside this claim.

`node tools/verify/e5-t26i-browser-clock.mjs` completed the cold checkpoint and
both unprofiled, physically typed `sh /tmp/a` replays with the same frozen image,
profile, snapshot, and runtime. Comparison SHA-256:
`0a6d1662c67cd32b5c9fe5f128090a6cfd85b04dc827d1c2b6512279ee476306`.
ICount elapsed **5028.065 ms**; wall elapsed **7518.450 ms**. Both complete actual
guest-visible conditional playback markers and non-silent attached PCM, with
empty browser/HTTP error arrays, but both fail F's unchanged two-second cap.
The wall guest advances 7283.315 ms within host sample bounds 7231.100–7309.935 ms;
ICount advances 574.7393 ms within host bounds 4749.320–4808.775 ms. This demonstrates
the selected clock and a negative performance comparison, not an improvement.
Canonical per-mode JSON/PNG files and checkpoint provenance are retained under
`evidence/e5-t26i/browser/`. Both screenshots show the completed marker and prompt,
not an ALSA error. **ICount stays the default; F is not verified.**

The claim is the opt-in adapter/lifecycle and measured comparison only. It does
not promise automatic guest resynchronization after a large jump, make host
epochs portable, enable wall-mode direct chaining, or alter any deadline or
snapshot format. Fresh Daybreak Blue owns the final verdict.
