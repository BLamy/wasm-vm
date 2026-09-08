---
id: E5-T26j
epic: 5
title: Prove opt-in deterministic guest timer-rate selection
priority: 526.595
status: in-progress
depends_on: [E5-T26i, E5-T26h, E5-T19a]
estimate: S
risk: high
capstone: false
---

## Goal

Test F's timer-rate hypothesis without disabling the existing deterministic JIT
paths or changing the production default. The setting controls retirements per
mtime tick; it is not a claim of correct wall-time synchronization or a speedup.

## Boundary

One configuration boundary: validate and apply an explicit ICount divider through
the core, WASM and browser loader before the first guest pump, including stored
restores. Preserve CLINT identity, architectural time/deadlines, JIT policy and
resume format. Omission must preserve the stored/default divider exactly. Do not
change F's command, original time boundary, two-second cap, or frame-rate targets.

## Acceptance criteria

- Explicit integer dividers 1..1024 are admitted only with an attached CLINT in
  ICount mode. Invalid input or incompatible mode fails atomically. The default
  remains ten; same-divider calls are exact no-ops.
- A change preserves mtime, mtimecmp, MSIP/interrupt state and device identity.
  The fractional phase maps conservatively as
  `floor(oldAccum * newDivider / oldDivider)` using overflow-safe arithmetic.
  Deterministic tests cover all small phase/ratio combinations, extreme prior
  dividers, next-tick distance, busy guest rdtime, and snapshot round-trip.
- Baseline restore honors the stored divider. An explicit override is applied
  after restoration and before execution, with actual stored/active clock-state
  evidence. Failure cannot silently fall back to another mode or divider.
- The recorded Chromium path proves the option reaches the owned WASM worker,
  with JIT still enabled. One authenticated new cold seal supports an unprofiled
  ABBA comparison of divider 10 and 1 on independent profile copies. Record all
  timing, actual clock/JIT state and input/audio results, including failures.
  No default promotion or F verification follows from this experiment alone.

## Verification command

make verify-E5-T26j

## Adversarial verification

Fresh Daybreak Blue carries unchanged I/H/T19a evidence. Attack missing CLINT,
zero, fractional/NaN/infinite/oversized input, wall-mode conflict, same-divider
idempotence, fractional rebase and u128 extremes, pending timer/software IRQs,
saved divider restoration and override ordering. Check actual worker state, not
only query strings. Sabotage a phase or forwarding test. Run the exact-head
pristine-clone proof once, with local guest/native/WASM evidence; no rr, WebKit,
independent machine, GitHub Actions or production deployment is required here.

## Verification log

### 2026-09-08 — worker — runtime frozen; real direct/worker clock preflight

At runtime commit `d2eda6857a2d17d19f8c64b037239a675901f2e6`, the built
Chromium proof `tools/verify/e5-t26j-clock-worker.mjs` passes all six combinations
of direct/worker and omitted/10/1 selection. Actual busy guest `rdtime` advances;
paused state is unchanged; final mtime equals actual retired instructions divided
by the selected divider. All arms execute real compiled JIT instructions with
dynamic/static chaining still enabled. There are no browser/HTTP errors. Records:
`evidence/e5-t26j/worker-d2eda685/guest-rdtime.json` and the adjacent transcript.

The built WASM is SHA-256
`8df0e82c87aa25d39988517b045b42712f8c94d1bec4f0d1db5ed2ab772f0e3a`.
This proves the configuration path, not restored-desktop performance. Selected
existing clock/resume tests (18) and JIT timekeeping tests (3) pass; Luna's eight
native and eleven WASM self-tests include 2,176 phase combinations and identical
native/WASM guest trace/state digests. The final frozen-head gauntlet and one new
cold-seal ABBA recording remain required; no J verification or default promotion
is inferred from these preflights.

### 2026-09-08 — worker — activation

Prerequisites I/H/T19a are verified. F is blocked on this named adapter and retains
its failed 5050.230-ms recording and functional HELD results. Daybreak's design
critique accepts conservative fractional rebasing as an explicit configuration
operation, not as a more-correct clock or an acceptance waiver. Implement the
small fail-closed boundary first, then measure; do not assume the hypothesis holds.
