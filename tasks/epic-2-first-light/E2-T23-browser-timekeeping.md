---
id: E2-T23
epic: 2
title: Browser timekeeping — mtime from performance.now, throttling, suspend recovery
priority: 223
status: pending
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
(empty)
