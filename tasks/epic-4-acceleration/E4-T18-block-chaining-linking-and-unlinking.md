---
id: E4-T18
epic: 4
title: Block chaining — direct linking between translated blocks and safe unlinking
priority: 418
status: pending
depends_on: [E4-T16]
estimate: L
capstone: false
---

## Goal
Hot paths stop bouncing through the dispatch loop on every block boundary: translated
blocks jump directly to their successors — same-module successors via structured control
flow, cross-module via funcref-table link slots — with unlinking on any invalidation
(fence.i, SMC, eviction) that provably cuts every edge into a dead block, and a measured
CoreMark uplift from chaining.

## Context
Dispatch-loop round trips (writeback → return → hashmap lookup → call_indirect → reload)
dominate once blocks are fast; QEMU's TB chaining exists for exactly this reason. Wasm
forbids code patching, so "patching" means mutating *data* the generated code reads:
each block exit gets a link-slot — an i32 table index in a fixed linear-memory array —
initialized to the dispatch-stub index; linking writes the successor's table index;
unlinking restores the stub index (a plain i32 store, atomic under E4-T22). Generated
epilogue: load slot, `call_indirect` (typed, same signature) — registers stay in memory
per the E4-T06 ABI writeback rules at exits, so chaining doesn't change the state
contract. Two hazards to engineer around: (1) unbounded wasm call-stack growth from
chained call_indirect — bounded by a chain-depth counter in state, forcing a return to
dispatch every N links (N tuned; wasm tail-calls noted as a shipped-in-major-browsers
upgrade path, behind a feature probe); (2) interrupt latency — the instruction budget
(E4-T10) must be checked in chained flow, not only in the dispatch loop.

## Deliverables
- Link-slot array + epilogue codegen (conditional-branch blocks: two slots); linking
  performed lazily by the dispatch loop on first traversal (records edge in the incoming-
  edges map); chain-depth budget with measured default.
- Unlink: invalidation walks the dead block's incoming-edge list, restores stub indices;
  the dead block's own outgoing slots cleared; table entry freed. Incoming-edge map
  maintained by linking, pruned on unlink.
- Interrupt budget enforced across chains (test: timer fires inside a 10k-iteration
  two-block chained loop within budget).
- Stats: links made/cut, chain-depth histogram, dispatch-loop entries per 1M instructions.
- Ledger rerun: CoreMark ≥ 1.4x over E4-T13 state, chaining on vs off flag for A/B.

## Acceptance criteria
- [ ] CoreMark (browser) with chaining on ≥ 1.4x chaining off; both ledgered.
- [ ] riscv-tests full run green with chaining forced on and with chain-depth budget = 1
      (degenerate) and = default.
- [ ] Invalidation soundness: SMC-overwrite a block that is the chain target of 100 other
      blocks; all 100 re-route through dispatch (no stale entry) — directed test asserts
      via execution counters, not just absence of crash.
- [ ] Timer-interrupt latency inside chained loops stays within the documented budget.
- [ ] No wasm stack exhaustion: a pathological 1M-block-long chain topology runs without
      RangeError (depth budget proof).

## Adversarial verification
Refute unlink completeness and liveness. Attack angles: (1) build a dense call graph
(every block links to shared helpers), invalidate the helpers via fence.i mid-run, and
diff execution vs interpreter — one stale-linked entry refutes; (2) unlink-vs-execute
race rehearsal: with chaining on, invalidate from the same thread between a block's
budget check and its chained call (simulate via instrumented build) — the design must
make this window safe (slot read is atomic; dead-but-not-yet-freed table entries must
remain callable-and-correct until quiesced) — a freed-table-entry call is a refutation;
(3) interrupt starvation: SIGALRM-style mtimecmp storm against a fully-chained CoreMark
inner loop, measure worst-case delivery latency, compare against the documented budget —
exceeding it refutes; (4) memory: run gcc in-guest and confirm incoming-edge maps don't
dominate the JIT memory budget (stats vs E4-T06 numbers); (5) A/B the 1-entry-cache +
chaining combination — eviction storms with links flying must stay correct.

## Verification log
(empty)
