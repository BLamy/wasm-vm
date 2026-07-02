---
id: E6-T07
epic: 6
title: SBI IPI and RFENCE — cross-hart interrupts and TLB shootdown
priority: 607
status: pending
depends_on: [E6-T05]
estimate: L
capstone: false
---

## Goal
Cross-hart communication is complete and correct under parallelism: the SBI IPI extension
delivers supervisor software interrupts to arbitrary hart masks, and the RFENCE extension
(remote fence.i / sfence.vma / sfence.vma.asid) performs synchronous cross-hart TLB and
icache-order maintenance — so mprotect/munmap and smp_call_function are safe with harts
on separate threads.

## Context
Linux depends on these constantly: `flush_tlb_range` → `sbi_remote_sfence_vma`,
`flush_icache_all` → `sbi_remote_fence_i`, scheduler kicks → `sbi_send_ipi`. Extensions:
IPI EID 0x735049 (`send_ipi(hart_mask, hart_mask_base)` sets SSIP on targets), RFENCE EID
0x52464E43 with start/size/asid arguments (size==-1 means full flush). Semantics require
the SBI call to return only after the operation is *complete* on all target harts.
Implementation: per-hart pending-op queue in shared memory + doorbell IPI +
completion counter the requester waits on (Atomics.wait with timeout for diagnostics).
Special cases matter: STOPPED/SUSPENDED harts complete vacuously (they'll start with cold
TLBs); a target parked in WFI must wake, process, and may re-park; a target blocked in an
MMIO mailbox wait must still service fence requests (or the mailbox must be fence-safe by
construction — decide and document).

## Deliverables
- `sbi/ipi.rs` + `sbi/rfence.rs` with hart-mask decoding (base+mask window semantics,
  mask==0 with base==-1 meaning all harts).
- Shared-memory shootdown queue: op {kind, start, size, asid}, doorbell, completion
  protocol; range-aware software-TLB invalidation (ASID-aware, from Epic 1's TLB).
- Deadlock analysis in `docs/smp-runtime.md` covering the WFI/MMIO/fence wait triangle,
  plus a 100ms-timeout diagnostic that dumps all hart states on a stuck fence.
- Guest test: N threads mmap/mprotect/munmap churn with guard-page probes on other harts
  (stale-TLB detector: writes that should fault but don't, reads of stale mappings).

## Acceptance criteria
- [ ] `sbi_send_ipi` to any mask pattern (single, sparse, all, self) delivers SSIP
      exactly to the targeted harts (bare-metal test asserts per-hart counters).
- [ ] The stale-TLB detector runs 10 min at smp=4 with zero missed faults and zero stale
      reads; the same test fails (detects staleness) when remote sfence handling is
      deliberately disabled — proving the detector works.
- [ ] remote_sfence_vma with size==4096 invalidates only the targeted page: a timing/
      counter probe shows other hot mappings stay TLB-resident (hit counters exposed via
      the debug interface).
- [ ] A fence targeting a STOPPED hart returns success immediately; targeting a WFI hart
      wakes and completes within the timeout; no diagnostic dumps in 30-min soak.
- [ ] Kernel boots and `stress-ng --fork 8 --mmap 4` runs 10 min clean at smp=4.

## Adversarial verification
Hunt the deadlock: craft a guest where hart A issues remote_sfence_vma to hart B while
hart B simultaneously issues one to hart A, both with interrupts disabled at the moment
of the call — a hang refutes (SBI fences must not require the target to take an
interrupt; they must be serviced at the emulation layer). Storm test: 4 harts issuing
all-hart RFENCEs in a tight loop for 5 minutes — watch for completion-counter races
(a call returning before a target actually flushed: instrument with a canary mapping
changed just before the fence and probed by the target just after). Attack mask
decoding: base=63, mask with high bits; base beyond n_harts; expect INVALID_PARAM per
spec, not silent truncation. Compare dmesg IPI/TLB statistics (`/proc/interrupts` IPI
lines) against QEMU -smp 4 for gross anomalies (100x counts = something is spinning).

## Verification log
(empty)
