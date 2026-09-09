---
id: E5-T26j
epic: 5
title: Prove opt-in deterministic guest timer-rate selection
priority: 526.595
status: verified
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

### 2026-09-08 — verifier — VERDICT: verified

- P1–P10 — HELD. Scrubbed native/JS and actual-WASM gates prove atomic admission,
  exact no-op, overflow-safe conservative phase mapping, architectural/device
  identity, exact next tick, unchanged divider-10 default/wire format, strict
  `JsValue` and JS parsing, restore-before-override, and read-only worker receipt.
  Native/WASM trace `4ddc392297ebe1dc` and RAM digest `c7d032c2…51f7c4` match.
- P11–P12 — HELD. One authenticated new cold seal and four independent profile
  copies run 10/1/1/10 with exact head/runtime/image/snapshot bindings, unchanged
  command/T0/2-second cap, JIT/chaining active, real clock/JIT progress, cursor/text,
  attached non-silent PCM, and empty browser/HTTP arrays. Raw JSON, child-log, and
  screenshot hashes match `comparison.json` SHA-256 `1a58e7df…9d35`.
- P13–P16 — HELD. The exact code head passes the composed scrubbed clone proof; the
  metadata/evidence-only heads preserve runtime bytes. Both phase and forwarding
  sabotages fail as predicted, the 256-case novel phase oracle passes, the corrected
  demo is 126/126, and the six-arm built-loader result remains valid.
- COVERAGE — COMPLETE. Every operational J hunk executes in native/WASM/JS or actual
  Chromium. Generated declarations, service-worker cache metadata, task prose, and
  evidence are narrowly waived; unrelated E5-T26f build-screen records are excluded.
  Durable critic report and raw verifier artifacts: `evidence/e5-t26j/critic.md` and
  `evidence/e5-t26j/verifier/`.
- SCOPE — J verified, F not verified. Divider-10 mean is 5133.270 ms; divider-1 mean
  is 9450.975 ms (84.112% slower). Every arm retains the unchanged cap failure, so
  this negative experiment neither promotes divider 1 nor changes the default.

Commands: scrubbed `make verify-E5-T26j-runtime`; scrubbed `wasm-pack test --node
crates/wasm --test icount_divider --test guest_clock`; corrected demo; one new cold
ABBA collector; 256-case critic oracle; isolated phase and forwarding sabotages;
`python3 tools/check_task_policy.py`; `python3 tools/build_queue.py`.

### 2026-09-08 — worker — implemented; controlled comparison is negative

The new cold seal and all four independent Chromium profile copies complete at
`054bb87f93b490645d5af921207f97af08629113`. Fixed 10/1/1/10 intervals are
5168.225 / 9530.715 / 9371.235 / 5098.315 ms; every child preserves the original
two-second failure. The actual worker receipts preserve stored mtime and select
the requested divider after restore. JIT/chaining remains active. All arms
restore CRC `23f83a92` at generation 626 without a boot, deliver 20 physical key
events, produce conditional terminal output and attached fresh non-silent PCM,
and retain empty browser/HTTP error arrays. Some screenshots show recovered ALSA
underruns, not zero-XRUN playback.

The claim is the validated opt-in boundary and honest measurement, not F timing
or a default promotion. Default ten remains unchanged. The full composed gate,
exact commands, guest trace digests, image/runtime/seal hashes, and all negative
records are indexed in `evidence/e5-t26j/README.md`. The comparison report SHA-256
is `1a58e7dfd6f5e04754d98cc42bde22d15477c32060917f9f8bcb6b9e910e9d35`.
Fresh Daybreak has independently passed the scrubbed source gates and bounded
novel/sabotage attacks; its final browser-evidence verdict remains required.

### 2026-09-08 — worker — frozen gates and roadmap metadata correction

At `cb283f9b3204f99d0bbc9ad44121c4f5da7b8b6a`, the selected runtime gate
passes 35 native and 175 JavaScript tests, formatting, Clippy, and the no-default
WASM target build. The Node/WASM gate passes 16 tests. Logs are
`evidence/e5-t26j/runtime-cb283f9b.log` and `wasm-cb283f9b.log`.
The first demo load reached the ISA-suite assertion, then failed to find J in the
roadmap: generated `tasks.json` predated this task. Its failed transcript is
`evidence/e5-t26j/demo-cb283f9b.log`. Regenerate the task metadata and dist before
the cold comparison; this does not change emulator semantics or the held gates.

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
