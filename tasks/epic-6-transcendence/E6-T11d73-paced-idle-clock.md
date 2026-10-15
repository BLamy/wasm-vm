---
id: E6-T11d73
epic: 6
title: Bound opt-in ICount idle jumps by monotonic host progress
priority: 525.027036
status: pending
depends_on: [E5-T26i, E6-T11d70]
estimate: S
risk: high
capstone: false
---

## Boundary

Add an explicit opt-in `paced-icount` machine clock. Busy execution keeps the
existing retire-derived ICount clock and phase. Tickless WFI may advance toward
an armed future deadline only as far as the elapsed host-monotonic ceiling
anchored to guest mtime at selection or explicit rebase. The ceiling never
rewinds mtime, advances busy execution, or changes default ICount/WallClock.
A stalled/backward host clock cannot allow a future idle deadline immediately.
Expose truthful selected mode through the existing Wasm clock API; invalid mode,
source, missing CLINT or invalid phase must refuse before mutation. Explicit
pause/restore rebase excludes paused host time without serializing a host epoch.
Preserve existing keyboard/GPU host-wait guards, interrupt/deadline semantics,
ICount JIT fuel bounds, and all software guest defaults.

This native clock boundary does not claim to fix stock Omarchy input. D72 owns
its later loader selection, unchanged50ms stock acceptance and final full guest
run. The diagnostic records show the wall-clock input batch delays release
flushing while real repeat timers run, but do not prove this new pacing sufficient.

## Deterministic acceptance

`make verify-E6-T11d73` runs recorded fake-clock guest instruction traces/digests
for cached/uncached WFI with a not-yet-due host ceiling, advancing/jittered/stalled
host samples, ordinary retirement, timer/external IRQ delivery, held/broken/reset
keyboard, active GPU waits, selection/refusal and explicit rebase. Assert literal
mtime/deadline and architectural states; retain deterministic unpaced controls.
Run affected native format/lint/tests, no_std Wasm build, actual Wasm API tests
and the built default demo suite. A final pristine proof may be shared with D72
when its exact frozen runtime includes this task. No production-default policy,
GPU performance, stock-input fix, deployment or snapshot portability is implied
by an isolated clock test.

## Adversarial verification

Predict concrete timer/IRQ/mtime state before reading traces. Vary initial time,
divider, cached schedules, host gaps and multiple IRQ/input lifecycles. In
particular reach the host ceiling while the guest deadline is still future and
prove host tasks/input can progress rather than spinning forever inside one
machine call. Test guest time already above the ceiling, backward samples,
large arithmetic bounds, exact timer boundaries, pause/rebase and restore.
Remove only the idle ceiling in an isolated copy; its literal WFI test must fail.
Carry unchanged default clock and native71 results by source/evidence identity.

## Verification log

### 2026-10-15 — worker — prerequisite after concurrent input pipeline recording

D72's original and disposable observed-image50ms typing remain failed. In
`target/evidence/production-stock-repeat-investigation03`, original kernel T20
make/break are47.750ms apart; actual compositor serialization is1.013250s apart.
Its release row816 is followed by58 further libinput events and58 corresponding
key emissions before the next observed public flush row933,29.457760s later.
Foot then reads/dispatches the release at row1546,30.423785s after its make;
the make callback body itself is19.195ms. All62 source/key/state/serial/PID
identities match across kernel/libinput/server/client, both published prefixes
are stable with overflow0, and the fresh critic independently holds442 native
timer bounds. Logger observations do not attest per-client socket delivery, and
no exclusive runtime cause or proposed-clock sufficiency is claimed.

This ordered task supplies an explicit native pacing primitive before D72 can
select and evaluate it. The observed binaries and production image are unchanged;
no guest repeat, typing delay or compositor patch is proposed by this task.
