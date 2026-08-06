---
id: E4-T16
epic: 4
title: fence.i and SFENCE.VMA — correct invalidation of translated code and TLBs
priority: 416
status: pending
depends_on: [E4-T12]
estimate: M
capstone: false
---

## Goal
The two architectural invalidation events are handled exactly under JIT: `fence.i`
invalidates translated blocks so subsequently executed code reflects all prior stores, and
`SFENCE.VMA` (all four rs1/rs2 operand forms, ASID-aware) flushes address translation —
inline TLB arrays and any translation-lookup state that depends on the old mapping — with
the physical-address-keyed translation cache meaning SFENCE.VMA does *not* need to kill
translations, and that argument is now proven by test, not just asserted in the design doc.

## Context
Correct-but-slow first: this task implements `fence.i` as a full translation-cache flush
(cheap because rare — QEMU's tb_flush analog); E4-T17's dirty bitmaps then make it nearly
free and E4-T18's chaining adds unlink obligations layered on these hooks. SFENCE.VMA
semantics per privileged spec §4.2.1: rs1=x0,rs2=x0 flushes everything; rs1≠x0 flushes
leaf entries for that vaddr; rs2≠x0 restricts to that ASID (global-bit pages exempt).
Our inline TLBs (E4-T11) don't store ASIDs (flush-on-switch policy) — so the ASID forms
may over-flush but must never under-flush; satp writes and mstatus changes affecting
translation (SUM/MXR/MPRV) also hit these hooks. The kernel exercises this constantly:
every mmap/munmap/context switch is an SFENCE.VMA; every module load / JIT-in-guest (!)
is a fence.i.

## Deliverables
- `fence.i` under JIT: full translation-cache flush + funcref-table reset + generation
  bump (E4-T08) + in-flight compile cancellation; the *currently executing* block completes
  (fence.i is a block terminator — ordering argument documented).
- `SFENCE.VMA` under JIT: all-forms decode; inline TLB flush (all three arrays, or
  targeted-page flush for the rs1≠x0 form); explicit test that stale translations remain
  *valid* because they're phys-keyed and re-entered via fresh TLB fills.
- MXR/SUM/MPRV/satp-write hooks flush TLBs identically from both tiers.
- Directed guest tests (bare-metal + in-Linux): remap a page to different phys frame,
  SFENCE.VMA, execute through it; copy new code over old, fence.i, jump.
- Invalidation-event stats (flush counts, blocks discarded) in ProfStats.

## Acceptance criteria
- [ ] Bare-metal test: write code to page A, execute (gets translated), write different
      code to A, `fence.i`, re-execute — new behavior observed under JIT, matching
      interpreter; without the fence.i the documented conservative behavior holds.
- [ ] Bare-metal test: vaddr V→P1 executed hot, remap V→P2 with different code,
      `sfence.vma V`, execute — P2's code runs (fresh TLB fill), and P1's translation
      still runs correctly if P1 is executed via another mapping (phys-keying proof).
- [ ] All four SFENCE.VMA operand forms tested; ASID form never under-flushes (test with
      two address spaces sharing a vaddr).
- [ ] Alpine boots and survives 100 cycles of `insmod/rmmod`-equivalent or repeated
      `apk add/del` + process churn under JIT with no stale-code symptoms.
- [ ] rv64si/rv64mi green under JIT.

## Adversarial verification
Refute staleness. Attack angles: (1) the classic: a guest JIT — run a small program that
generates code into a buffer, fence.i's, executes it, then regenerates *different* code
into the same buffer in a loop 10k times; any execution of stale code refutes (this also
rehearses running real JITs like the JVM later); (2) omit-the-fence control: same test
without fence.i must show our documented behavior — if it *always* sees fresh code, suspect
the flush is over-eager (killing performance) — measure flush counts; (3) context-switch
storm: two processes at the same vaddr with different .text, tight `sched_yield` loop under
JIT vs interpreter, diff outputs; (4) race in-flight compiles: make code hot, overwrite +
fence.i *before* async install completes, confirm the stale install is dropped (generation
check) — an installed stale block is a refutation; (5) verify SFENCE.VMA didn't nuke the
translation cache (stats) — if it did, the phys-keying claim is refuted in spirit and the
capstone perf will pay for it.

## Verification log

### 2026-08-05 — implemented + proven by test (native JIT)

**What fence.i does under JIT:** a full translation-cache flush (the QEMU `tb_flush` analog) —
`BlockCache::flush` (O(1) generation bump) + `BlockDiscovery::on_invalidate` (generation bump, hot
counters cleared) + `executor.invalidate_all()` (every compiled block dropped). Fired from both the
interpreter path (`step_cached`) and the JIT path (`try_jit_block`, when a JIT block terminates in
`fence.i`). In-flight/stale compiles cannot install: `install_check` re-validates generation + live
bytes at install time (E4-T08). Cheap because rare. `cache_flushes` stat asserts the flush fired.

**SFENCE.VMA operand forms:** all four `(rs1,rs2)` forms decode and flush `hart.tlb` via
`Tlb::sfence(va, asid)` — whole-TLB, per-vaddr (all ASIDs incl. global), per-ASID (global exempt),
vaddr+ASID. The inline/software TLB is ASID-tagged and precise per form; where it would ever be
imprecise it OVER-flushes (extra walks), never UNDER-flushes. SFENCE.VMA performs **no** block-cache
or compiled-block invalidation (physical keying). satp writes / SUM/MXR/MPRV changes need no flush:
the TLB caches only the walk and `mmu::finish_leaf` re-derives permission on every hit, so the JIT
(whose loads route through `Hart::jit_load` → the interpreter's own translate path) stays coherent.

**Physical-keying proof (both directions), byte-identical to interp:**
- (a) remap VA→different phys: `sfence_vma_remap_to_different_phys` — new physical page's code runs
  via a fresh TLB fill, no stale VA-keyed block; `blocks_discarded == 0`.
- (b) remap same phys→new VA: `sfence_vma_reuse_same_phys_new_va` — the compiled block is REUSED at
  the new VA (`compiled_count` unchanged, `executed_blocks` grows), no needless flush.

**Divergence found and fixed:** proving (a)/(b) under real Sv39 paging exposed a latent E4-T09
translator bug — every guest-visible PC (branch/jal targets, `auipc`, link values, `exit_pc`, fault
`mepc`) was baked as the **physical** block key, correct only under identity mapping. Fix: added a
runtime-supplied `entry_pc` ABI slot (`CpuState +0x230`); the translator now emits PCs relative to it
(`entry_pc + compile-time offset`). `jalr` targets (register-sourced, already virtual) are unchanged.
Without the fix the JIT ran the wrong virtual PCs under paging (loop ran 2 iters vs 150).

**Gates green:** `jit-runtime/tests/invalidation.rs` (8 tests) — fence.i-invalidates-translated, all
four SFENCE.VMA forms, ASID never-under-flush (two spaces), global-bit exempt, SUM immediate-effect,
rv64mi verdict-identical under JIT. Plus the pre-existing gates: `jit_execution` (10, incl. riscv
verdict-identical JIT-on across the full corpus + M/C/F/D suites), `precise_traps` (3),
`jit-translate` differential (10) + inline_tlb (7), core `predecode_diff`/`predecode_smc_diff`/`sv39`/
`sv39_e2e`/`tlb`/`sbi_rfence_stale_tlb`/`determinism`. `cargo fmt` + `clippy -D warnings` clean; core
`wasm32-unknown-unknown` no_std builds.

**Stats added (ProfStats/DiscoveryStats):** `cache_flushes` (whole-cache flushes) and
`blocks_discarded` (blocks dropped by page-granular SMC/DMA invalidation) — the latter staying flat
across an SFENCE.VMA storm is the "SFENCE.VMA didn't nuke the translation cache" proof-in-stats.

**Deferred:** browser (`WebAssembly.Module`) executor is E4-T19 — the `entry_pc` slot is in the frozen
ABI so it carries over. An in-Linux/Alpine 100-cycle insmod/apk churn soak (AC) is left for a boot-
harness run; the mechanism is proven at unit + Sv39-directed level here.
