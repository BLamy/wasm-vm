---
id: E1-T17
epic: 1
title: TLB with ASID tagging and SFENCE.VMA — all four operand combinations
priority: 117
status: pending
depends_on: [E1-T16]
estimate: M
capstone: false
---

## Goal
A software TLB in front of the T16 walker — tagged by {VA page, ASID, level, global} —
that makes translation amortized-O(1), plus SFENCE.VMA implementing all four rs1/rs2
operand combinations with spec-correct invalidation scope, so satp/ASID switching (the
Linux context-switch hot path) is both fast and correct.

## Context
Privileged spec §4.2.1 (SFENCE.VMA). The four forms: rs1=x0,rs2=x0 → flush everything;
rs1≠x0,rs2=x0 → flush all entries mapping VA(rs1), all ASIDs; rs1=x0,rs2≠x0 → flush all
entries for ASID(rs2) *except* global (G=1) entries; rs1≠x0,rs2≠x0 → flush entries for
VA+ASID except global. Executing SFENCE.VMA in U-mode is illegal; in S-mode with
mstatus.TVM=1 it traps illegal (T09). Caching stale translations *until* an SFENCE.VMA is
architecturally legal — our tests exploit that to prove the TLB actually caches — but
permission-*increasing* PTE changes without fence must never crash the emulator, only
possibly use the stale entry. Entries must store the leaf level so superpage entries
match their full range; negative caching of faults is NOT allowed (a fault must re-walk).
A/D policy interaction (Svade from T16): a TLB entry can only exist for A=1 (and D=1 if
writable-cached) PTEs — cache the permission the walk validated, per access type.

## Deliverables
- `tlb.rs`: fixed-size set-associative array (no HashMap — no iteration-order dependence,
  determinism per T22), separate or unified I/D (document the choice), ASID+VA+level
  tags, G bit honored; per-access-type permission caching consistent with Svade (store
  hit requires a dirty-validated entry).
- SFENCE.VMA decode/execute wiring all four scopes; satp writes do NOT flush (spec) —
  document that OS code relies on SFENCE.VMA.
- TLB statistics counters (hits/misses/flushes) exposed via the debug interface for T23.
- Tests per scope: prove caching (stale mapping survives PTE change until fence), then
  prove each fence form flushes exactly its scope (global entries survive ASID flushes;
  other-ASID entries survive targeted flushes).

## Acceptance criteria
- [ ] After translating VA X under ASID 1, modifying its PTE, re-access uses the stale
      entry; after `sfence.vma X, x0` it re-walks (both observed via walk-count hook).
- [ ] `sfence.vma x0, a0` (ASID 1) leaves a G=1 entry live (walk count unchanged on next
      access) and kills non-global ASID-1 entries; ASID-2 entries survive.
- [ ] Full-flush form empties everything including global entries.
- [ ] A 2 MiB superpage TLB entry serves VA base+0x1F_F000 without re-walk (level tag).
- [ ] A faulting translation is never cached: two consecutive accesses to an unmapped VA
      perform two walks.
- [ ] SFENCE.VMA in U-mode → illegal instruction; in S with TVM=1 → illegal instruction.
- [ ] Full rv64si + rv64ui-v suites still pass with the TLB enabled, natively and wasm32,
      with hit-rate > 90% reported on rv64ui-v (proves it's actually in the path).

## Adversarial verification
The killer attack: run the entire riscv-tests virtual-memory set and a random-fuzz
translation workload twice — TLB enabled vs TLB hard-disabled (walk every access) — and
diff full retire traces; ANY architectural divergence (not perf) refutes, because the TLB
must be semantically invisible modulo legal staleness, and riscv-tests fence correctly.
Attack scope precision: build 3 ASIDs × {global, non-global} × {4K, 2M} entries (12 live
entries), issue each fence form, and assert the exact surviving set via walk counters —
over- OR under-flushing refutes (under-flush of the targeted scope is a correctness bug;
over-flush of everything on every fence would pass naive tests — the walk-count assertions
exist to catch that fake). Attack Svade caching: load-fill a clean-page entry, then store
to the same page — a store served from the load's TLB entry without a D-bit fault refutes.
Attack aliasing: map two VAs to one PA, fence one, verify the other survives. Attack
determinism: TLB replacement must be identical native vs wasm32 (trace hash equality on a
thrashing workload exceeding TLB capacity).

## Verification log
(empty)
