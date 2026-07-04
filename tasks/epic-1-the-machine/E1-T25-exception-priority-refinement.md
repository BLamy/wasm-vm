---
id: E1-T25
epic: 1
title: Exception-priority refinement — misaligned vs access/page fault (Priv §3.7.1)
priority: 125
status: in_progress
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

### 2026-07-04 — §3.7.1 misaligned pre-check landed; ripple was 3 tests, not "many"
Added an address-misaligned pre-check to `xlate_load`, `xlate_store`, and `xlate_amo`
(`crates/core/src/hart/mod.rs`): `if va & (len-1) != 0 { return *AddrMisaligned }` BEFORE
translate/PMP. Previously misalignment surfaced at the BUS (after translate+PMP), so an access
that was both misaligned and untranslatable/PMP-denied reported the lower-priority cause;
§3.7.1 ranks address-misaligned above access-fault and page-fault. `len` is a power of two so
`len-1` is the alignment mask; for `len==1` it never fires. tval anchors on the (misaligned) VA.

**The ripple was exactly 3 test files** (the earlier "many tests" estimate was pessimistic —
the codebase's boundary tests concentrate the old ordering in a few places). Each updated with a
§3.7.1 citation, none weakened:
- `hart_memory.rs::boundary_sweep_last_slot_succeeds_one_past_faults` — the "one byte past" case
  at `RAM_END-w+1` is misaligned for w>1 (RAM_END is 8-aligned), so it now faults `*AddrMisaligned`;
  I also ADDED an aligned-one-width-past case that still faults `*AccessFault` (so both the
  misaligned-straddle and the aligned-past-end paths are covered).
- `verifier_e0t07_angles.rs::all_reachable_traps_leave_state_untouched` — the sentinel-address
  store case uses `sd` (8-byte) at a byte-misaligned sentinel → now `StoreAddrMisaligned`; the `lb`
  case stays `LoadAccessFault` (1-byte is always aligned). Purity property unchanged.
- `verifier_e0t08_attacks.rs::{negative_offset_straddling_device_edge…, boundary_sweep_verifier_bases}`
  — straddling an aligned region boundary is ALWAYS misaligned (a naturally-aligned access can't
  straddle a same-or-coarser-aligned boundary), so these now fault `*AddrMisaligned`. Crucially the
  **device-silence invariant is preserved and strengthened**: the pre-check fires before any bus/
  device access, so the device is still never consulted on a straddle.

**Gate:** `cargo test --workspace` → **90 ok-suites, 0 FAILED**; `cargo fmt --check` clean;
`cargo clippy --workspace --all-targets` clean.

Removed `vm_sv39/src/vm_VA_all_zeros_S_mode.S` from `compliance/EXCLUSIONS.md` (43 → 42 entries).
**RISCOF confirms it (exit 0, GREEN):** `vm_sv39 … VA_all_zeros … Passed` (and `vm_sv48` VA_all_zeros
too, a bonus from the same fix); tally **353 passed / 42 failed** (was 352/43), every failure still
EXCLUSIONS-listed. The first of the 45 capstone deferrals (E1-T24) is burned to zero. Only
`vm_sv57 … VA_all_zeros` still fails — correctly, it's in the Sv57 block (E1-T28's scope).
