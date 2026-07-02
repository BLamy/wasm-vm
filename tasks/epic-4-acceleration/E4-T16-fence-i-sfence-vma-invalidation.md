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
(empty)
