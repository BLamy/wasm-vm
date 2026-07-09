---
id: E2-T06
epic: 2
title: SBI IPI, RFENCE, and HSM extensions (single-hart-correct, SMP-shaped)
priority: 206
status: verified
depends_on: [E2-T05]
estimate: M
capstone: false
---

## Goal
*(Scope addendum from the E2-T03 critic: also implement **SRST** (EID 0x53525354, system
reset) here — Linux 6.6 probes it at init for reboot/poweroff handlers; the syscon
sifive_test device is the backend. Cheap alongside HSM.)*
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

### 2026-07-05 — worker — implemented

**What landed.** `sbi/{ipi,rfence,hsm,srst}.rs` + shared `sbi::decode_hart_mask` (the SBI
`(hart_mask, hart_mask_base)` decode with base==MAX=all-harts, base-beyond-topology and
mask-naming-nonexistent-hart → INVALID_PARAM — one function, so Epic 6 widens the topology
constant, not the call surface). `sbi::handle` now takes `&mut Hart` (IPI raises SSIP,
RFENCE flushes the TLB).
- **IPI:** send_ipi sets SSIP (edge — guest acks via its own S-writable sip.SSIP clear).
- **RFENCE:** fence_i validates the mask then routes through the (empty) icache hook the
  Epic-4 JIT will fill; sfence_vma/_asid flush the E1 TLB — full flush for size=MAX or
  >256-page ranges (over-flushing is safe), per-page below; hfence FIDs → NOT_SUPPORTED.
- **HSM:** hart0 STARTED; start(0)=ALREADY_AVAILABLE; start/get_status(≥1)=INVALID_PARAM;
  stop=FAILED (only hart); suspend: retentive-default = immediate spec-compliant resume
  (WFI is a hint here), non-retentive=NOT_SUPPORTED, reserved=INVALID_PARAM.
- **SRST (E2-T03 critic addendum):** shutdown → run loop returns Exited(0|1) BEFORE the
  guest executes another instruction; reboot → NOT_SUPPORTED (until a host restart path /
  syscon device); reserved types/reasons → INVALID_PARAM.
- probe() flips IPI/RFENCE/HSM/SRST to 1 — the FULL ADR-0002 Epic-2 extension set is live.

**Evidence.** Unit: every FID + every error path (bad mask base, bad hartid, bad suspend
type — task deliverable) across the four modules. Integration (real S-mode ecalls through
the run loop, `tests/sbi_ipi_hsm.rs` 4/4): self-IPI → exactly one SSI delivery (scause
1<<63|1) with the handler acking via sip; RFENCE ecall observably flushes the TLB
(flush_count) and returns SUCCESS; HSM statuses via ecall (0→STARTED, 1→INVALID_PARAM);
SRST shutdown → Exited(0) with a poison instruction after the ecall proving the guest
never resumes. The full remap-under-satp sfence scenario is covered by the E1-T17 TLB
suite; the integration test proves the SBI plumbing path (noted for the critic).
Gates: sbi lib 16/16; 5-suite sweep 0 FAILED; both wasm legs (±zicsr-stub) 0 FAILED;
fmt clean; clippy ±--all-features clean.

### 2026-07-05 — verifier (cold critic) — round 1: REFUTED → all findings fixed

**Defect 1 (real, guest-triggerable):** the RFENCE per-page flush loop's `start + i*4096`
overflow-panicked any debug build on a single legal-shape ecall (start near u64::MAX —
canonical Sv39 kernel VAs; ~2^-44 odds per random-fuzz draw, found by the critic's targeted
grid). **Fix:** range overflow (`start.checked_add(size).is_none()`) → full flush (pages
past 2^64 don't exist; over-flushing is architecturally safe). The critic's exact input is
now a committed regression test and the grid mask is removed.
**Defect 2 (spec):** HSM reserved non-retentive suspend band (0x80000001–0x8FFFFFFF)
returned NOT_SUPPORTED; ext-hsm.adoc + OpenSBI say INVALID_PARAM. Fixed with exact bands
(platform-specific bands stay NOT_SUPPORTED, matching OpenSBI); pinned by unit test.
**Defect 3 (spec):** SRST reboot-with-reserved-reason returned NOT_SUPPORTED before
validating the reason; spec says INVALID_PARAM when EITHER field is reserved. Reason now
validates first (OpenSBI's ordering); pinned by unit test.

**Confirmed by the critic:** the DEFERRED deliverable built and passed with teeth — full
composed stale-TLB scenario (Sv39 tables, satp on, cached leaf, PTE remapped in RAM, real
RFENCE ecall → next load sees the NEW frame; no-fence control stays stale; page-granular
flush of an unrelated VA leaves the target stale = no arg-order bug). Spec conformance for
all four extensions (fetched adoc sources); Linux-observability probe all clean
(get_status(0)=STARTED etc.); 27,268-call adversarial grid on top of the 10^6 fuzz —
invalid-mask IPI never raised SSIP, invalid SRST never set shutdown; run-loop shutdown
ordering verified (reason 0→Exited(0), 1→Exited(1), poison never executes); all gates
green on both wasm legs. **Adopted:** the critic's suite is committed as
`tests/sbi_rfence_stale_tlb.rs` (9 tests incl. the refuting input, unmasked grid).
