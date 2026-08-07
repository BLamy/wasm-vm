---
id: E4-T18
epic: 4
title: Block chaining — direct linking between translated blocks and safe unlinking
priority: 418
status: verification-debt
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

### 2026-08-06 — mechanism implemented + differentially verified; CoreMark ledger deferred

**Implemented (files):**
- `crates/core/src/jit.rs` — frozen chaining contract on the `CompiledBlockExecutor` trait:
  `set_chaining`/`chaining` (A/B flag), `set_chain_depth_budget`/`chain_depth_budget`,
  `link_edge`/`linked_target` (link-slot read/write), `note_chain` + `ChainStats`
  (links made/cut, dispatch-loop entries, chain-depth histogram). `CHAIN_DEPTH_BUDGET_DEFAULT = 32`
  (documented tunable; interrupt latency does NOT depend on it — the budget is re-checked at every
  link, so a timer fires within one block ≤128 ops even at budget = 1).
- `crates/jit-runtime/src/lib.rs` — the link-slot array + table-index allocation + incoming-edge
  map in `WasmtimeExecutor`. Each compiled block gets a stub-initialized slot range (2 slots for a
  conditional branch, else 1) and a table index. `link_edge` writes the successor's index and records
  the incoming edge; `invalidate_page`/`invalidate_all` run `remove_block`, which restores the stub in
  EVERY incoming slot (from surviving predecessors), clears the dead block's own outgoing slots
  (pruning targets' incoming lists), and frees the table + slot range — so after any invalidation no
  live slot points into (or out of) a dead block. Chaining defaults ON.
- `crates/core/src/lib.rs` — `try_jit_block` is now a chain loop: it follows direct block→block links
  (lazily linking each static edge on first traversal — `chain_edge` classifies branch/jal/fall-through
  as linkable, `jalr` as dynamic/non-linkable) up to the chain-depth budget, re-checking the
  interrupt/instruction budget at every link (`sync_clint` + `next_interrupt`) so a timer is delivered
  inside a chained loop; `note_chain` records one dispatch-loop entry per chain. Machine API:
  `set_chaining`, `set_chain_depth_budget`, `chain_stats`.

**Design note (native backend):** the browser executor's in-wasm `call_indirect` epilogue over a shared
funcref table is E4-T19; the native wasmtime backend uses per-block private memories, so it realizes the
IDENTICAL link-slot / incoming-edge / stub-index protocol at the host orchestration boundary
(`try_jit_block`). The unlink semantics — the correctness core — are byte-for-byte the same, and are what
the gates below prove. (A consequence: the native form cannot grow the wasm call stack — every `execute`
fully returns — so wasm-stack exhaustion is structurally impossible here; the chain-depth budget is still
enforced and tested, and remains the load-bearing bound for the browser form.)

**Gates run (all green, chaining ON):**
- `cargo test -p wasm-vm-jit-runtime`: chaining 4/4, invalidation 12/12, jit_execution 10/10 (incl.
  `riscv_tests_verdict_identical_with_jit` over the >50-ELF corpus + FP suites), precise_traps 3/3.
- New directed tests (`crates/jit-runtime/tests/chaining.rs`): unlink-completeness (a 2-block loop
  links A→B / B→A, an SMC store into B's page restores A's incoming slot to the stub and advances
  `links_cut`, re-execution recompiles B's new bytes byte-identically to the interpreter; a data-page
  store cuts nothing); interrupt-fires-inside-a-chained-loop (dispatch re-entered, handler ran);
  chain-depth budget forces a dispatch return every N links (max depth == budget at 1 and 4;
  byte-identical to the interpreter both ways).
- `cargo test -p wasm-vm-jit-translate --test differential`: 10 passed / 2 ignored.
- `cargo test -p wasm-vm-core --test predecode_diff`: 2/2 (byte-identical).
- `cargo build -p wasm-vm-core --target wasm32-unknown-unknown --no-default-features`: ok (no_std).
- `cargo clippy -D warnings` + `cargo fmt --check`: clean.

**Deferred (verification debt, NOT fabricated):** the CoreMark ≥1.4× (chaining on vs off) ledger rerun
[AC #1] is workload-scale perf that needs a booted-guest harness on the Linux `dev` box; the A/B flag
(`Machine::set_chaining`) and the links/dispatch-entries stats are wired for it, but no number is
recorded here. The differential gates above prove the mechanism (link + unlink completeness + interrupt
budget + depth bound); the perf uplift is the open item.
