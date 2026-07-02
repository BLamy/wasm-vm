---
id: E4-T11
epic: 4
title: Guest memory access from JIT code — inline TLB fastpath and softmmu fallback
priority: 411
status: pending
depends_on: [E4-T10]
estimate: L
capstone: false
---

## Goal
Translated loads and stores stop calling out to the host for every access: guest RAM, CPU
state, and softmmu TLB arrays live at fixed offsets in one (shared-capable) linear memory,
and generated code inlines a direct-mapped TLB lookup — tag compare, add offset, raw
`i64.load`/`store` on hit; call-out to the existing softmmu walker on miss — with misaligned
and page-straddling accesses, MMIO pages, and permission distinctions all handled exactly.

## Context
Memory ops dominate real workloads; an always-call-out JIT barely beats the interpreter
(QEMU's TLB-inlined fastpath vs helper-call slow path is the canonical design; v86 does the
same against its own page tables). Layout decided in E4-T06: separate read/write/execute
TLB arrays (direct-mapped, e.g. 512 entries), entry = `{vpn_tag_with_perm_bits, addend}`
where `addend = ram_offset − vaddr_page`, so hit-path address is `vaddr + addend`. Device
pages and pages with SMC write-tracking (later, E4-T17) are *never* entered into the write
TLB — their accesses always take the slow path, which is where MMIO dispatch and dirty
tracking live. Within-page misalignment is legal on wasm loads; accesses that straddle a
page must take the slow path (mask check `(vaddr & 0xfff) > 0x1000 - size`).

## Deliverables
- Linear-memory layout constants (one source of truth shared by core, translator, and
  bindgen wrapper): guest RAM base, CPU state block, 3× TLB arrays, stats.
- Interpreter and JIT share the same TLB arrays (one invalidation story, one refill path).
- Translator emits the fastpath for LB/LH/LW/LD/LBU/LHU/LWU/SB/SH/SW/SD; slow-path
  call-outs `mmu_load(vaddr, size) -> (value, fault)` / `mmu_store` that refill the TLB,
  dispatch MMIO, or report a fault for the E4-T12 side-exit path.
- Page-straddle and device-page exclusion logic in generated code + refill.
- Differential rig from E4-T09 extended with random loads/stores over a mapped test image,
  including misaligned and straddling addresses; benchmarks re-run and ledgered.

## Acceptance criteria
- [ ] Randomized load/store differential (interpreter vs JIT, 100k blocks incl. straddles
      and misalignment): zero divergences of memory image, registers, or faults.
- [ ] MMIO correctness: a translated block doing UART/CLINT MMIO behaves identically to
      interpreter (never fastpathed — asserted via a trap counter on the device path).
- [ ] TLB invalidation (satp write / SFENCE.VMA via existing interpreter events) flushes
      the shared arrays; a paging-switch test passes under JIT.
- [ ] CoreMark (browser) ≥ 2x the E4-T05 score, recorded in the ledger.
- [ ] rv64ui + rv64um memory tests green with JIT forced on.

## Adversarial verification
Refute memory correctness. Attack angles: (1) alias attack — map one physical page at two
vaddrs with different permissions (RO vs RW), access through both from translated code;
any write succeeding through the RO mapping (stale/shared TLB entry with wrong perms)
refutes; (2) straddle fuzz — loads/stores at every offset in [page−8, page+8) for every
width, diff against interpreter; (3) MMIO leak — place a virtio queue notify register at a
page and hammer it from a hot translated loop; if the fastpath ever caches it (device
counter goes quiet while guest observes effects), refuted; (4) fault precision preview:
store to an unmapped address mid-block and confirm the fault surfaces (full precision is
E4-T12, but a *lost* fault here is already a refutation); (5) run Alpine boot to login
with JIT on — any oops/panic delta vs interpreter is a refutation.

## Verification log
(empty)
