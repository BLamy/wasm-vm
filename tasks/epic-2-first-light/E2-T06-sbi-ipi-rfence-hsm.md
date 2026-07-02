---
id: E2-T06
epic: 2
title: SBI IPI, RFENCE, and HSM extensions (single-hart-correct, SMP-shaped)
priority: 206
status: pending
depends_on: [E2-T05]
estimate: M
capstone: false
---

## Goal
Complete the SBI v2.0 surface Linux probes at boot: IPI (EID 0x735049), RFENCE
(EID 0x52464E43), and HSM (EID 0x48534D), implemented correctly for our single hart while
keeping the interfaces shaped for Epic 6 SMP.

## Context
All three use `(hart_mask, hart_mask_base)` addressing: `hart_mask_base == usize::MAX`
means "all harts"; a base beyond the topology returns `SBI_ERR_INVALID_PARAM`. IPI
`send_ipi` sets SSIP on targeted harts (self-IPI is legal and Linux uses it). RFENCE:
`remote_fence_i` (FID 0) must invalidate any decoded-instruction caching (no-op today,
but route it through the same hook `fence.i` uses so the Epic 4 JIT inherits correctness);
`remote_sfence_vma` (FID 1) and `remote_sfence_vma_asid` (FID 2) flush the Epic 1 TLB for
the given range/ASID — `start=0,size=usize::MAX` is a full flush. HSM: `hart_start`,
`hart_stop`, `hart_get_status` (STARTED=0, STOPPED=1, START_PENDING=2, STOP_PENDING=3),
`hart_suspend` (FID 3; support retentive suspend as WFI-equivalent at minimum). Hart 0
reports STARTED; any other hartid returns `SBI_ERR_INVALID_PARAM`. Linux's smp init calls
`hart_get_status`/`hart_start` for each DTB cpu node — with one cpu node this path is
quiet, but a wrong error code here produces confusing "CPU1: failed to start" noise or
boot hangs later.

## Deliverables
- `crates/core/src/sbi/{ipi,rfence,hsm}.rs` + dispatch wiring and probe results.
- Bare-metal tests: self-IPI delivery to SSIP; sfence_vma actually drops a stale TLB entry
  (map, cache a translation, remap via page tables, RFENCE, verify new mapping is used).
- Unit tests for every error path (bad mask base, bad hartid, bad suspend type).

## Acceptance criteria
- [ ] Self-IPI sets SSIP and is delivered when `sie.SSIE` is set; cleared via `sip` write.
- [ ] The TLB-staleness bare-metal test fails when RFENCE is stubbed to no-op and passes
      with the real implementation (proves the test has teeth).
- [ ] `hart_get_status(0)` == STARTED; `hart_get_status(1)` == INVALID_PARAM;
      `hart_start(0, ...)` == `SBI_ERR_ALREADY_AVAILABLE`.
- [ ] `probe_extension` reports all three extensions present.
- [ ] Green on native and `wasm32`.

## Adversarial verification
Diff every FID's return `(error, value)` against OpenSBI on QEMU virt using a probing
bare-metal stub covering: mask_base = 0/1/usize::MAX, mask = 0, suspend_type = 0x00000000
and garbage 0xDEADBEEF, sfence with size 0 and size usize::MAX. Any observable divergence
refutes. Attack RFENCE laziness: construct the remap scenario with a 2-level Sv39 table
where only a leaf PTE changes, and verify pre-flush execution really used the stale entry
(otherwise the test proves nothing — refute the test itself). During later Linux boots,
grep dmesg for "CPU" bring-up errors and any `sbi_` warning: their presence refutes.

## Verification log
(empty)
