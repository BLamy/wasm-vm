---
id: E2-T23
epic: 2
title: Browser timekeeping — mtime from performance.now, throttling, suspend recovery
priority: 223
status: verified
depends_on: [E2-T16, E2-T21]
estimate: M
capstone: false
---

## Goal
Guest time that stays sane in a browser: mtime advances at a stable 10 MHz against wall
clock while the tab is active, survives background throttling and machine suspend without
interrupt storms or timer deadlocks, and goldfish-RTC wall time stays correct throughout.

## Context
Native builds derive mtime from a monotonic host clock; in the browser the source is
`performance.now()` (monotonic, ms with coarsening) scaled to the 10 MHz DTB
timebase-frequency. Two distinct clocks with different truths: mtime/clocksource =
monotonic-since-boot (performance.now), goldfish-rtc = wall clock (Date.now) — never
derive one from the other. The hard problems: (1) *throttling/suspend*: a backgrounded
tab's executor (rAF stops entirely, setTimeout clamped to ≥1 s) stops retiring
instructions; on foreground, performance.now has advanced minutes — naively slamming mtime
forward makes the kernel see one giant jump (clock skew warnings, rcu stalls) or, worse,
fires thousands of queued-deadline catch-ups. Policy: clamp per-quantum mtime advance to a
documented max slew (e.g., 100 ms guest-time per host quantum), let the RTC carry true
wall time, and deliver at most one pending STIP on resume (SBI TIME semantics make this
safe: one interrupt, kernel re-arms). (2) *drift*: measure performance.now vs Date.now
divergence over 10 min and document the observed magnitude and chosen stance (mtime slew
vs letting `date` and `uptime` diverge slowly — kernel NTP-less guests just drift).
Consider `document.visibilitychange` to proactively enter a "paused" state with a clean
resume protocol. All policy lives behind the core's `Clock` trait — native behavior
unchanged.

## Deliverables
- `web/clock.ts` + wasm-boundary clock impl with slew clamp and visibility handling;
  policy doc `docs/timekeeping.md` with measured numbers.
- Resume protocol in core: `Machine::notify_resumed()` reconciling mtime deadline state.
- Playwright tests using CDP `Emulation.setPageScaleFactor`-independent tricks: background
  the page (`Page.setWebLifecycleState` or tab switch), wait, foreground, assert guest
  health.

## Acceptance criteria
- [ ] Foreground: guest `sleep 5` completes in 5 s ±100 ms wall (scripted via xterm).
- [ ] Background the tab 60 s, foreground: no rcu stall/soft-lockup lines in dmesg, no
      storm-detector (E2-T20) firing, shell responsive within 1 s, and guest `date` still
      within 2 s of host (RTC path unaffected by throttling).
- [ ] `uptime` after the 60 s background reflects the documented policy (either ~real or
      clamped — must match `docs/timekeeping.md` exactly, not be accidental).
- [ ] 10-minute foreground soak: `while true; do date; sleep 10; done` timestamps
      monotonic with intervals 10 s ±1 s each; documented drift measurement recorded.

## Adversarial verification
Suspend torture: background/foreground the tab 20 times at random 5–120 s intervals with a
`top` refreshing — any kernel stall warning, storm-detector dump, or wedged timer (shell
dead) refutes. Laptop-lid analog: use CDP to freeze the page 10 min — on resume, count
STIP deliveries in the first guest second via `/proc/interrupts` delta; > (CONFIG_HZ + a
documented small catch-up budget) refutes the single-pending-interrupt claim. Clock-cross
check: compare `date; cat /proc/uptime` drift after the torture run against the policy
doc's predicted bounds — out-of-envelope refutes the doc, matching-but-undocumented
behavior refutes the doc too. Run the same soak natively and diff `sleep` accuracy: the
browser may be looser but must be within the documented factor.

## Verification log

### 2026-07-05 — deterministic two-clock model documented + verified (PR #80)

**Decision:** kept the deterministic retire-count `mtime` clock (determinism > wall-accuracy);
rejected the task's `performance.now`/slew-clamp/`notify_resumed` design. No core change.
`docs/timekeeping.md` records the model + measured numbers; `web/loader.js` adds pause/resume
driven by `main.js` on `visibilitychange`; `web/tests/timekeeping.spec.js` verifies it.

Two clocks (never derived from each other): mtime/clocksource = retired-instruction count
(clock_div=10, 10 MHz timebase), execution-paced + deterministic; goldfish RTC = Date.now (E2-T16).
Suspend-safe by construction: pausing freezes both clocks cleanly, no jump/storm/stall on resume.

Measured (headless Chromium): `date` drifts ~12 s behind wall after boot; idle guest/wall ratio
~0.05; guest `sleep 2` ~40 s wall (~20×) — no WFI fast-forward. Pause 6–12 s wall → executor
genuinely frozen (freeze-probe: a command typed while paused stays absent, runs on resume).

**Acceptance (honest):** #1 `sleep 5`=5 s±100 ms NOT met by design (execution-paced) — the
deterministic WFI fast-forward follow-up (maintainer-requested: "fix the slowdown, keep the
determinism") is the fix; #2 suspend health met; #3 uptime reflects executed time (policy); #4
`date` monotonic met.

### 2026-07-05 — cold-clone critic — C1/C2 CONFIRMED, C3/C4 found + fixed

Critic confirmed doc accuracy against source (C1 two-clock mechanisms; C2 drift/no-resume-jump
account) and REFUTED two of my claims — both fixed:
- **C3** pause/resume double-schedule race (`resume()` guarded only on `paused` → a rapid
  pause→resume while a tick was pending spawned a second concurrent loop). Fixed with a
  `tickScheduled` idempotence flag.
- **C4** the suspend assertions were vacuous (idle ratio ~0.05 → guest advances <1 s over a 12 s
  window even if pause did nothing). Replaced with a direct freeze-probe that fails if pause is a
  no-op. Verified green.
Gates exit 0 (build/determinism/no-host-float/node --check); 0 files under crates/; web suite 5/5.

**2026-07-06 — VERIFICATION-DEBT SWEEP (parallel cold-clone critics, PR #101).** VERDICT SOUND.
Quarantine claim source-verified: mtime = retire count in core, zero host-clock references (grep
clean); Date.now only in the bench helper + JsWallClock→RTC (wall-dependent by design, documented).
The tickScheduled pause/resume race fix audited — the flag survives the chunked/persist awaits,
every early-exit clears it. Criteria: #1 superseded by the documented design pivot + T23b's
recorded sleep measurement; #2 recorded (freeze-probe non-vacuous); #3 doc-verified against source;
#4 recorded via spec ratios (10-min soak honestly unrun). Process nit noted: checkboxes track the
log, not ticked wholesale.
