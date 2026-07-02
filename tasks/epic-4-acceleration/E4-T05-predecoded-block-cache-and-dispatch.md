---
id: E4-T05
epic: 4
title: Interpreter pre-optimization — predecoded basic-block cache and dispatch tuning
priority: 405
status: pending
depends_on: [E4-T01, E4-T04]
estimate: L
capstone: false
---

## Goal
The interpreter stops re-decoding every instruction on every execution: fetched code is
decoded once into a cached basic block of predecoded micro-ops (op enum + pre-extracted
fields + pre-expanded compressed forms), keyed by physical PC, and the dispatch loop is
tuned — yielding a measured CoreMark uplift and, more importantly, building the exact
block-cache skeleton (discovery, keying, invalidation hooks) the JIT will inhabit.

## Context
Every serious emulator does this before JITting (TinyEMU caches decoded ops; QEMU's TCG is
this idea taken to completion). Decode + operand extraction dominates interpreter time per
the E4-T01/T02 profiles. Doing it first (a) raises the baseline honestly, (b) forces the
invalidation problem (fence.i, SFENCE.VMA, SMC) to be solved in the simple engine where
lockstep debugging is easy, and (c) gives the JIT its block-discovery front end for free.
Blocks are keyed by *physical* address (like TCG's tb_phys_hash) so paging changes don't
require flushes; C-extension instructions are expanded to their 32-bit equivalents at
predecode time, with per-instruction lengths retained for correct PC arithmetic.

## Deliverables
- `DecodedBlock`: contiguous predecoded ops from an entry PC to the first terminator
  (branch/jal/jalr/ecall/ebreak/xret/wfi/fence.i/csr write) or a page boundary or a max
  length (128 ops); per-op guest length (2/4 bytes) recorded.
- Block cache keyed by physical PC (open-addressed hash), with conservative invalidation:
  full flush on fence.i and on any store into a page containing cached blocks (page-level
  "has code" bitmap — the precursor of E4-T17).
- Dispatch improvements measured and kept-or-reverted individually: dense-match dispatch on
  the predecoded op enum, execution loop restructured to run a whole block without
  re-checking interrupts per instruction (interrupt poll at block boundaries, preserving
  timer latency ≤ one block).
- Ledger entries (E4-T04) for all four benchmarks after this task, both engines.

## Acceptance criteria
- [ ] CoreMark (browser engine) improves ≥ 1.3x over the `level3-interpreter` baseline;
      the achieved ratio is recorded in the ledger.
- [ ] Full riscv-tests suite still green natively and in wasm32 with the block cache on.
- [ ] A guest program that overwrites its own code then executes `fence.i` runs correctly
      (dedicated test, both engines).
- [ ] Interrupt-latency bound holds: a test with mtimecmp firing mid-block observes the
      trap within one block boundary (≤128 instructions) of the timer expiry.
- [ ] Blocks never span a physical page boundary (asserted in debug builds).

## Adversarial verification
Refute correctness first, speed second. Attack angles: (1) rerun riscv-tests and a full
Alpine boot with a *1-entry* block cache (pathological eviction) — any behavioral change vs
the big cache indicates stale-block bugs; (2) SMC: write a guest loop that patches an
instruction inside an already-cached block *without* fence.i and then with it — verify the
documented conservative behavior matches the spec claim; (3) paging: mmap the same physical
page at two virtual addresses and execute through both — physical keying must share/there
must be no virtual-address staleness; (4) re-measure the claimed CoreMark uplift from a
cold start and diff against the ledger entry (>10% short refutes); (5) time a `sleep 1` in
guest — if block-granular interrupt polling warped timer delivery, refuted.

## Verification log
(empty)
