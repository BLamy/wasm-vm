---
id: E2-T05
epic: 2
title: SBI TIME extension — set_timer semantics driving the S-mode timer interrupt
priority: 205
status: pending
depends_on: [E2-T04]
estimate: S
capstone: false
---

## Goal
`sbi_set_timer` (EID 0x54494D45, FID 0) implemented with exact spec semantics, so the
kernel's clockevent driver ticks correctly — the difference between a kernel that schedules
and one that hangs silently right after "sched_clock: ..." in dmesg.

## Context
Semantics: `set_timer(u64 stime_value)` programs the next timer event in mtime units and
*clears the pending S-mode timer interrupt (STIP)*. When `mtime >= stime_value`, STIP must
be set (delivered as interrupt when `sie.STIE` and `sstatus.SIE` allow). Corner cases that
break real kernels: a `stime_value` already in the past must fire immediately (next
interrupt-check boundary), not wait for wraparound; `u64::MAX` is the idiomatic "cancel"
and must never fire; back-to-back `set_timer` calls replace, not queue. The mtime frequency
must equal the DTB `timebase-frequency` (10 MHz to match QEMU virt) — one constant, one
source of truth (E2-T02). Under the E2-T03 built-in-SBI model this manipulates the CLINT
`mtimecmp` machinery from Epic 1 directly; ensure the emulator main loop's "next event"
scheduling accounts for the programmed deadline so timers fire without busy-polling.

## Deliverables
- `crates/core/src/sbi/time.rs` + event-loop integration (deadline-aware stepping).
- Bare-metal test: program timers at +1000, past, and u64::MAX; count STIP deliveries;
  measure delivery latency in instructions.
- Unit test proving `set_timer` clears an already-pending STIP.

## Acceptance criteria
- [ ] Past-deadline `set_timer` delivers STIP within one interpreter dispatch quantum.
- [ ] `set_timer(u64::MAX)` after a pending timer results in zero further STIP events over
      10^8 cycles of idle execution.
- [ ] STIP is cleared by the call itself, per SBI spec, without the guest touching `sip`.
- [ ] `timebase-frequency` in the DTB and the mtime advance rate are provably the same
      constant (test asserts it).
- [ ] Native and `wasm32` behavior identical (bare-metal test binary run in both).

## Adversarial verification
Write a hostile guest: 10^6 `set_timer` calls with random deadlines interleaved with WFI —
count delivered interrupts vs expected; any spurious or missing STIP refutes. Race attack:
set a timer 1 tick in the future, then immediately `set_timer(u64::MAX)` — a late delivery
refutes. Run the same stub under QEMU+OpenSBI and diff interrupt counts. Then the real
test: boot Linux (once E2-T15 exists) and check `sleep 1` wall time and that
`/proc/interrupts` "riscv-timer" increments at ~CONFIG_HZ while idle, not 10x that (storm)
or 0 (dead). A hang at "clocksource: riscv_clocksource" during any boot attempt refutes.

## Verification log
(empty)
