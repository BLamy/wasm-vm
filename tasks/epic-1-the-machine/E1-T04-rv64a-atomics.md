---
id: E1-T04
epic: 1
title: RV64A atomics — LR/SC reservation semantics and all AMO operations
priority: 104
status: pending
depends_on: [E1-T01]
estimate: M
capstone: false
---

## Goal
Full A-extension support: LR.W/LR.D with a reservation set, SC.W/SC.D with spec-legal
success/failure behavior, and all 18 AMO instructions (AMOSWAP/ADD/XOR/AND/OR/MIN/MAX/
MINU/MAXU × W/D) as atomic read-modify-writes, with aq/rl bits decoded (no-ops for a
single in-order hart, but preserved in the decoder for the Epic 6 SMP future).

## Context
Unprivileged spec "A" chapter. Linux's spinlocks, futexes, and refcounts are LR/SC and
AMO; a subtly wrong SC (e.g. one that always succeeds) boots further than you'd expect
and then corrupts userspace — this must be right *now*, not debugged at Level 2. Key
semantics: SC writes 0 on success, nonzero (we use 1) on failure; SC succeeds only against
a valid reservation from an earlier LR on the same hart covering the address; any store or
intervening SC invalidates the reservation; we additionally invalidate on traps and on
MRET/SRET (legal, and matches Spike's conservatism). AMOs and LR/SC to misaligned
addresses raise address-misaligned (cause 6/4 store/load AMO) — never rotate/split.

## Deliverables
- Reservation state on the hart: `Option<(addr, width)>` with documented invalidation
  points (store overlap, SC execution, trap entry, xRET, WFI).
- Decode + execute for LR/SC/AMO, W forms sign-extending loaded values per spec.
- AMO min/max signed vs unsigned arms with W-form 32-bit comparison (not 64-bit).
- Unit tests: LR→SC success; LR→store→SC fail; SC without LR fails; back-to-back SC
  (second fails); AMOMIN.W with negative values; misaligned AMO traps with correct mtval.
- rv64ua-p-* passing under the bare-metal harness.

## Acceptance criteria
- [ ] SC after matching LR returns 0 and performs the store; SC with no/invalidated
      reservation returns 1 and does not touch memory (asserted by memory readback).
- [ ] An ordinary store to the reserved doubleword between LR and SC forces SC failure.
- [ ] AMOADD.W to a location holding 0xFFFF_FFFF wraps 32-bit and sign-extends rd (old
      value) correctly; AMOMAXU.W treats 0x8000_0000 as large, AMOMAX.W as negative.
- [ ] LR.D/SC.D/AMO*.D at addr % 8 != 0 and W-forms at addr % 4 != 0 raise misaligned
      exceptions with mtval = the faulting address.
- [ ] All rv64ua-p tests pass; results identical native vs wasm32.

## Adversarial verification
Attack the reservation lifecycle: craft sequences Spike also runs and diff — LR.W then
SC.D to the same address (width mismatch: spec permits failure; we must at minimum match
our own documented policy and never *succeed with the wrong width write*); LR, take a
timer-less ECALL trap, MRET, SC (must fail per our documented policy); LR to address A,
SC to A+4 within the same reservation granule. Fuzz all AMOs against Spike with random
memory contents including sign-boundary values. Verify rd=rs1 aliasing for AMOs (old
value must land in rd even when rd==rs2 source register). Confirm the aq/rl bits are
accepted for every AMO encoding (all four combinations decode; an illegal-instruction
trap on aq=rl=1 is a refutation). Check that no AMO performs a partial write when it
traps on misalignment (memory unchanged).

## Verification log
(empty)
