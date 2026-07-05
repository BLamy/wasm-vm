---
id: E1-T25
epic: 1
title: Exception-priority refinement — misaligned vs access/page fault (Priv §3.7.1)
priority: 125
status: pending
depends_on: [E1-T20]
estimate: M
capstone: false
---

## Goal
Make synchronous exception priority match Priv §3.7.1 when a single access is faultable
in more than one way: an address-misaligned condition on a load/store is reported **before**
an access-fault or page-fault on the same access. This burns the `vm_sv39 VA_all_zeros`
RISCOF exclusion and is a prerequisite for the Level 1 capstone (E1-T24) reaching zero
exclusions.

## Context
E0-T08 chose a "range beats alignment" simplification: `xlate_load`/`xlate_store` translate
then PMP-check, with no early misaligned pre-check, so an access that is BOTH misaligned and
untranslatable reports the access/page fault where Spike reports `LoadAddrMisaligned` /
`StoreAddrMisaligned`. That ordering was deliberately deferred (see the E1-T20/E1-T21
history: a misaligned pre-check was drafted, rippled through many tests that codified the
old ordering, and was reverted as its own task — this one). §3.7.1 fixes the priority order:
for a load/store, misaligned > access-fault > page-fault.

The subtlety that makes this cross-cutting: many existing tests (`hart_memory.rs`,
`verifier_e0t07_angles.rs`, PMP boundary sweeps) assert the OLD ordering (expecting
`LoadAccessFault`/`StoreAccessFault` on the boundary-past-RAM case). Correcting priority
means re-deriving each of those expected causes from §3.7.1, not just flipping one branch.

## Deliverables
- A misaligned pre-check in the load/store path (`crates/core/src/hart/mod.rs`
  `xlate_load`/`xlate_store`) ordered per §3.7.1: report `Load/StoreAddrMisaligned`
  (tval = the misaligned VA) before translation/PMP faults, but only when the access is
  actually misaligned for its width AND misalignment is not otherwise permitted.
- Every existing test that encoded the old ordering updated to the §3.7.1 cause, each with a
  spec-cited comment on WHY the expected cause is what it is.
- Remove the `vm_sv39/src/vm_VA_all_zeros_S_mode.S` entry from `compliance/EXCLUSIONS.md`.
- A focused regression test proving the priority order for an access that is simultaneously
  misaligned and untranslatable/PMP-denied.

## Acceptance criteria
- [ ] `make riscof` passes `vm_sv39 VA_all_zeros` (entry removed from EXCLUSIONS.md, no
      unexcused failure).
- [ ] `cargo test --workspace` green — every test that asserted the old ordering now asserts
      the §3.7.1 cause with justification.
- [ ] rv64mi-p `ma_addr`/`ma_fetch` and the misaligned load/store MI tests still pass
      (no regression in the already-correct misaligned-trap delivery).

## Adversarial verification
Attack the ordering both directions: an access that is misaligned AND page-faults must
report misaligned (not page-fault), and an aligned access that page-faults must STILL report
page-fault (the pre-check must not fire on aligned accesses). Seed a case where PMP denies a
misaligned access and confirm misaligned wins. Confirm `tval` is the effective VA in each
case, byte-exact against Spike. Re-run the full riscv-tests + RISCOF from a cold clone; any
test whose expected cause changed must have a §3.7.1 citation, not a silent flip to make it
pass.

## Verification log
(empty)
