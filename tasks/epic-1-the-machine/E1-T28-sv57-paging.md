---
id: E1-T28
epic: 1
title: Sv57 five-level paging — satp MODE=10 (Priv §4.5)
priority: 142
status: pending
depends_on: [E1-T18]
estimate: L
capstone: false
---

> **E1-T26 UPDATE — capstone-OBSOLETE (deprioritized 127/128 → 141/142).** The RISCOF exclusions this task existed to clear were removed by E1-T26 (switching the reference to the canonical Sail model, configured to our declared ISA, makes the full arch-test suite pass 395/0 with EXCLUSIONS.md empty). This remains a VALUABLE feature for hosting more OSes, but the Level-1 capstone (E1-T24) no longer depends on it.

## Goal
Extend the MMU to Sv57 (five-level, 57-bit VA) so `satp` MODE=10 is a working mode and the
`vm_sv57` + `vm_pmp/sv57` RISCOF suites pass — burning the 38 Sv57 entries from
`compliance/EXCLUSIONS.md`, the single largest block on the path to the Level 1 capstone's
zero-exclusion bar.

## Context
E1-T16 built the Sv39 walker; E1-T18 generalized `satp` MODE to accept Bare/Sv39/Sv48 and
WARL-reject Sv57 (MODE=10 → treated as unsupported). Sv57 is the same page-table machinery
with one more level (VPN[4..0], 5 levels, 4 KiB pages, 512-entry tables) and a wider
canonical-VA requirement (bits 63:57 must equal bit 56, else page-fault). The 38 excluded
tests exercise Sv57 A/D bits, global PTEs, invalid/reserved PTEs, misalignment, MPRV/MXR/SUM,
mstatus.SBE, canonical-VA, and PMP-over-Sv57 — all of which the existing Sv39/Sv48 code paths
already handle at their level counts; the work is parameterizing level depth and the
canonical-VA check, not new fault logic.

## Deliverables
- The page-table walker parameterized to 5 levels for Sv57 (reuse the Sv39/Sv48 leaf/branch
  logic; extend superpage handling to the two new levels).
- `satp` MODE=10 accepted (WARL) and driving a 5-level walk; canonical-VA check for 57-bit
  VAs (bits 63:57 == bit 56).
- The isa yaml + `satp` accessible-MODE set updated to advertise Sv57 (E1-T20 cross-check
  stays consistent).
- Remove all 38 `vm_sv57/*` and `vm_pmp/src/sv57/*` entries from EXCLUSIONS.md.
- Regression tests mirroring the Sv39/Sv48 suites at Sv57: canonical/non-canonical VA, A/D
  update, global PTE + ASID, reserved-high-bit page-fault, superpage at each of the 5 levels,
  MXR/SUM/MPRV interactions.

## Acceptance criteria
- [ ] `make riscof` passes the full `vm_sv57` and `vm_pmp/sv57` suites; all 38 entries
      removed from EXCLUSIONS.md.
- [ ] Sv39 and Sv48 continue to pass unchanged (the level-count generalization must not
      regress the existing modes); `cargo test --workspace` and the E1-T17 TLB/SFENCE tests
      green.
- [ ] Non-canonical 57-bit VAs page-fault with the correct cause/tval, byte-exact vs Spike.
- [ ] The reserved-high-PTE-bit page-fault (the E1-T20 fix) applies at Sv57 too.

## Adversarial verification
Attack level generalization: a superpage at the top (level-4) Sv57 table must map the right
gigantic range; an off-by-one in level indexing shows as a wrong translation vs Spike. Attack
the canonical-VA boundary: the exact VA where bit 56 flips must fault on the wrong side and
succeed on the right. Attack mode isolation: switching satp Sv57→Sv48→Sv39 mid-run (SFENCE
between) must re-walk at the right depth each time. Confirm Bare and the WARL rejection of
still-unsupported modes are unchanged. Re-run all vm_* suites from a cold clone; diff five
Sv57 signatures by hand against Sail.

## Verification log
(empty)
