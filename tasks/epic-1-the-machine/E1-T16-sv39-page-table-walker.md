---
id: E1-T16
epic: 1
title: Sv39 page-table walker — PTE bits, superpages, page faults, A/D policy
priority: 116
status: pending
depends_on: [E1-T09, E1-T10]
estimate: L
capstone: false
---

## Goal
A spec-complete Sv39 MMU: satp-rooted three-level table walk translating every fetch/
load/store/AMO in S/U (and MPRV-modified M accesses), enforcing all PTE permission bits
(V/R/W/X/U/G/A/D), superpage alignment, SUM/MXR modifiers, and raising page faults with
exact cause codes and stval — the single hardest correctness cliff between here and Linux.

## Context
Privileged spec §4.3–4.4. satp (0x180): MODE=8 (Sv39), ASID[15:0], PPN. VA is 39 bits;
bits 63:39 must equal bit 38 (sign-extension check) else the access raises the
corresponding *page fault* (12 fetch / 13 load / 15 store-AMO). Walk: 512-entry levels
2→0; PTE V=0 or (R=0,W=1) reserved → fault; R|X set ⇒ leaf (leaf at level 2/1 is a 1 GiB/
2 MiB superpage whose ppn low fields must be zero else fault); pointer PTE at level 0 →
fault; pointer PTEs with D/A/U set → fault (reserved per spec). Permissions: fetch needs
X; load needs R (or X when mstatus.MXR=1); store/AMO needs W; U-mode needs U=1; S-mode
access to U=1 data needs mstatus.SUM=1, and S-mode fetch from U=1 always faults. A/D
policy — DECISION: implement the Svade trap scheme (A=0, or D=0 on store ⇒ page fault;
software sets the bits); simplest precise implementation, spec-sanctioned, Linux-
compatible. Document it, and configure reference simulators to match when diffing. Every
PTW memory access is a physical access through PMP (T15 hook); a PMP failure during the
walk raises an *access fault* with the original access type's cause (1/5/7).

## Deliverables
- `mmu.rs`: `translate(va, access_type, effective_priv) -> Result<pa, Trap>`; effective
  privilege honoring MPRV/MPP for loads/stores (never fetches).
- Misaligned accesses: check *before* translation per our T10 policy; document ordering.
- The two-parcel fetch path from T08 issuing independent translations per parcel so an
  instruction straddling a page boundary faults precisely on the second parcel (mepc =
  instruction start, stval = the *second* page's faulting VA).
- Bare-metal test kit: page-table builder helpers; tests for every PTE-rule row above,
  each asserting {cause, stval, sepc}.
- rv64si-p-* and the virtual-memory riscv-tests variants (rv64ui-v-*) passing.

## Acceptance criteria
- [ ] Identity-mapped 4 KiB pages: all rv64ui-v tests pass natively and in wasm32.
- [ ] Each reserved/invalid PTE pattern (V=0; W&!R; pointer at level 0; pointer with
      A/D/U; misaligned superpage) faults with cause matching access type and stval = VA.
- [ ] A load at VA with bit 63 set (non-canonical) raises cause 13, stval = VA.
- [ ] Store to a page with W=1,D=0 raises cause 15 (Svade); after software sets D, it
      succeeds. Same for A=0 on any access.
- [ ] SUM=0: S-mode load from U page faults; SUM=1 succeeds; S-mode fetch from U page
      faults under both. MXR=1 makes an X-only page loadable.
- [ ] 2 MiB and 1 GiB superpage translations produce correct PAs (VA offset bits pass
      through) verified against hand-computed values.
- [ ] With MPRV=1/MPP=U in M-mode, loads translate and fault as U; fetches don't translate.

## Adversarial verification
Build a hostile page-table corpus: every PTE bit pattern (256 combinations of the low 8
bits) at every level, mapped over a probe page, executing {fetch, load, store} from
{S, U} × {SUM, MXR} settings — record {ok/fault, cause, stval} for all ~12k cells and
diff against Spike running the identical binary (Spike configured for Svade-equivalent
trapping; where Spike hardware-updates A/D, restrict the diff to A=1/D=1 rows and cover
Svade rows against the Sail model or hand-derived spec expectations, documented per row).
Any cell divergence refutes. Attack precision: a store that page-faults after the walker
already read two PTE levels must leave no A/D writes and no memory changes (RAM hash).
Attack the straddling fetch: place `add` halves across pages with the second unmapped —
check mepc/stval; then map both and check execution. Attack PTW-through-PMP: point satp
at a PMP-protected table region and verify access-fault (not page-fault) cause. Attack
non-canonical VAs at both edges (0x0000_003F_FFFF_FFFF+1, 0xFFFF_FFC0_0000_0000-1).

## Verification log
(empty)
