---
id: E2-T05
epic: 2
title: SBI TIME extension — set_timer semantics driving the S-mode timer interrupt
priority: 205
status: implemented
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

### 2026-07-05 — worker — implemented

**Design.** `sbi/time.rs` set_timer stores the deadline in `SbiState::stimecmp` (reset
u64::MAX = never). Delivery is a LEVEL the run loop derives EVERY instruction boundary
(`Machine::sync_sbi_timer`): `mip.STIP = (mtime >= stimecmp)` — exactly the MTIP pattern.
Consequences, all tested end-to-end via real S-mode guests (stvec handler counts deliveries,
captures scause, sret):
- past deadline → fires at the very next boundary (`past_deadline_fires_immediately_once`:
  exactly 1 delivery, scause = 1<<63|5, back in S after sret);
- u64::MAX cancel → zero deliveries over a 500k-instruction idle run, INCLUDING the charter
  race (arm +1 tick then cancel immediately — `cancel_wins_the_race_zero_deliveries`);
- back-to-back set_timer REPLACES (unit `set_timer_replaces_and_cancels`);
- "clears pending STIP" is automatic and guest-visible: STIP pends with SIE off, a future
  set_timer clears it before the guest's next instruction, sip never written by the guest
  (`set_timer_clears_pending_stip`); STIP not guest-forgeable (`guest_cannot_forge_stip`);
- +1000-tick deadline fires in the (5k, 15k]-instruction window at CLOCK_DIV=10
  (`future_deadline_fires_on_schedule` — latency bounded in instructions).
- `boot_supervisor` now grants `mcounteren = 0x7` (CY/TM/IR) — kernels rdtime for
  sched_clock; OpenSBI grants the same (guests rdtime in these tests prove it works).
- Deadline-aware stepping: the interpreter's per-boundary level check IS the event loop —
  no busy-poll beyond the existing per-instruction boundary work (documented in
  sync_sbi_timer).
- Timebase single-source (acceptance #4): `dtb_timebase_is_the_single_constant` asserts the
  DTB blob carries be32(virt::TIMEBASE_FREQ_HZ); fdt.rs consumes the same constant by name.
- probe(TIME) flipped to 1 (single-source `sbi::probe`; base + mod tests updated).

**Gates:** native sbi lib 12/12; sbi_timer 6/6; wasm32 mirror (same guests) 2/2;
interrupts/privilege/boot_contract/sbi_console regression 4 suites 0 FAILED; fmt clean;
clippy ±--all-features clean. QEMU+OpenSBI interrupt-count diff + Linux /proc/interrupts:
critic charter / E2-T15.
