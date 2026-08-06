---
id: E4-T20
epic: 4
title: JIT cache management — memory and module budgets, eviction, and stats
priority: 420
status: in-progress
depends_on: [E4-T17, E4-T19]
estimate: M
capstone: false
---

## Goal
The translation cache lives within the E4-T06 budgets forever: hard caps on translated-code
bytes, live Module/Instance count, funcref-table size, and metadata (edge maps, interval
lists), enforced by an eviction policy — coarse generational flush vs batch-level LRU,
chosen by A/B measurement — so a week-long tab or a gcc bootstrap can never OOM the page
or degrade into thrash without the stats saying so loudly.

## Context
QEMU famously just flushes the whole TB cache when full (tb_flush) — simple, correct, and
surprisingly competitive because hot code re-translates fast; v86 similarly recycles
wholesale. LRU at block granularity is a trap under batching (E4-T19): eviction granularity
is the *batch* (Module), since you cannot free half a Module. Candidate policies to A/B:
(a) full generational flush at high-water mark; (b) batch-LRU by last-executed timestamp
(coarse ticks, updated at dispatch entries — chained execution updates lazily);
(c) batch-LFU decayed. Eviction obligations, all already built: unlink incoming edges
(E4-T18), uninstall table entries, clear SMC bitmap registrations (E4-T17), drop the
Instance, bump generation (E4-T08). GC realities: dropping JS references doesn't free wasm
Instance memory synchronously — budget accounting must use our own byte estimates, not
browser GC behavior.

## Deliverables
- `JitCacheBudget { code_bytes, max_batches, table_slots, metadata_bytes }` enforced at
  install time; eviction triggered at high-water, hysteresis to low-water.
- Two policies implemented behind a flag (full-flush + batch-LRU); A/B measurements on
  gcc + CoreMark + boot; the loser deleted or demoted to debug flag, decision recorded.
- Eviction correctness: single `evict_batch()` path performing unlink/uninstall/bitmap/
  generation obligations in the right order (documented order + debug assertions).
- Stats surface: current usage vs budgets, evictions, re-translation rate (blocks
  re-compiled after eviction — the thrash signal), exposed in ProfStats + browser overlay.
- A `jitstat` debug command/API dump usable from the browser console.

## Acceptance criteria
- [ ] gcc -O2 benchmark (largest code footprint we have) completes with a deliberately
      tiny budget (e.g. 4 MiB code) — slow is fine, wrong or OOM is not; and with the
      default budget with < 5% of executions being re-translations.
- [ ] 24-hour (or accelerated-equivalent) soak: boot, loop `apk add/del` + gcc compile;
      Instance count and code bytes plateau at ≤ budget (stats series committed).
- [ ] Eviction under fire: evicting the batch containing the currently-hottest loop while
      it runs is correct (execution falls to interpreter, gets re-nominated, re-translated
      — asserted via stats sequence in a directed test).
- [ ] riscv-tests green with max_batches = 2 (pathological eviction churn).
- [ ] Both policies' A/B numbers ledgered; chosen default documented.

## Adversarial verification
Refute the budget enforcement and eviction ordering. Attack angles: (1) thrash bomb — a
guest binary with 10k equally-warm blocks (generated C switch monster, compiled in-guest)
sized just over the code budget; watch re-translation rate and wall clock: livelock or
monotonic slowdown refutes graceful degradation; correctness diff vs interpreter refutes
soundness; (2) ordering attack: instrument `evict_batch()` to inject a dispatch-loop
iteration between each obligation step (fuzz the interleaving) — any step order that lets
a linked edge reach an uninstalled table slot refutes the documented order; (3) accounting
honesty: compare claimed code_bytes against actual emitted byte totals and browser memory
growth over the soak — >25% drift refutes the budget's meaning; (4) verify the *loser*
policy was actually removed/demoted (dead config that silently re-enables is a refutation
of the decision record); (5) run E4-T17's SMC torture concurrently with forced eviction
churn (budget=tiny) — bitmap/interval-list desync under combined invalidation refutes.

## Verification log

### 2026-08-06 — implementation + correctness gates (native, mac)

**Design as built.**
- `JitCacheBudget { code_bytes, max_batches, table_slots, metadata_bytes }` (`crates/core/src/jit.rs`),
  `DEFAULT` = 32 MiB / 256 batches / 32768 table slots / 8 MiB metadata (`docs/jit-architecture.md`
  §7 D10). Enforced at install time in `WasmtimeExecutor::install_batch` → `enforce_budget(incoming_bytes,
  incoming_batches)` BEFORE the module is admitted, so eviction makes room for the new batch rather than
  evicting it. Accounting uses OUR OWN byte estimate (`estimated_bytes` = Σ emitted-code-bytes +
  64 KiB/instance overhead), never engine/browser memory (the GC-reality requirement).
- **Hysteresis:** high-water = the budget itself; low-water = 75% of code_bytes / 75%-ish of max_batches
  (batch-LRU evicts down to low-water so admission does not immediately re-trigger). Full-flush ignores
  low-water (it drops the whole cache — QEMU tb_flush).
- **Two policies behind a flag** (`EvictPolicy`, `Machine::set_evict_policy`): (a) `Flush` — full
  generational flush at high-water; (b) `BatchLru` — evict least-recently-executed batch (coarse
  `last_tick` stamped at each `execute` dispatch entry; chained execution updates lazily) down to
  low-water. Provisional default = `BatchLru` (A/B ledger deferred to dev — see debt). Both policies call
  the ONE `evict_batch` path; the loser is NOT deleted because the A/B has not been run — it is gated
  behind the flag, decision recorded as debt (honest: no fabricated A/B numbers).
- **`evict_batch(batch_id)` — the single ordered obligation path** (`crates/jit-runtime/src/lib.rs`).
  Documented order: (1) unlink incoming+outgoing edges (E4-T18 `remove_block`) → (2) uninstall table
  index/slot range → (3) clear SMC page registration (drop from `blocks`) → (4) drop Instance refs +
  decrement registry → (5) bump generation (E4-T08). Debug post-conditions assert: batch gone; no member
  live or in the table map; and NO live link-slot points into any evicted member's freed table index
  (the ordering-attack back-stop — a drop-before-unlink bug trips it). `evict_batch_containing(phys)` is
  the AC3 directed hook; the SMC path (`invalidate_page`) keeps its existing whole-batch retirement.
  Evicted PCs are fed back to discovery via `take_evicted` → `BlockDiscovery::renominate` (new, surgical:
  clears one block's hotness/dedup WITHOUT a generation bump, so a batch-LRU eviction does not flush the
  decoded cache) — without this, dedup would suppress re-translation forever.
- **Stats** (`JitCacheStats`, in `ProfStats`/`prof_report` + `Machine::jit_cache_stats` + the `jitstat`
  dump): usage vs budgets, evictions, flushes, installs, **retranslations** (blocks recompiled after
  eviction — the thrash signal; `retranslation_rate = retranslations/installs`), generation.

**Gates run (native, this machine) — all green:**
- **AC4 — riscv-tests byte-identical at `max_batches=2`:** `riscv_tests_verdict_identical_with_max_batches_2`
  (`jit_execution.rs`) → `JIT verdict-identical at max_batches=2 across 127 riscv-tests ELFs`,
  `test result: ok. 1 passed` (51.65 s). Pathological eviction churn changes no verdict.
- **AC3 — eviction under fire (NEW):** `eviction_under_fire_falls_to_interp_and_retranslates`
  (`eviction.rs`) → `evictions=1 retranslations=1 installs=2 gen=3`: evicting the hottest running loop's
  batch drops it to the interpreter, it is re-nominated + re-translated, and stays byte-identical to the
  interpreter oracle throughout.
- **Eviction ordering / obligations (NEW):** `evict_batch_discharges_every_obligation` — after evict, no
  `linked_target` points into the batch, table map cleared, registry count+bytes = 0, generation bumped;
  the in-code debug post-conditions back-stop the ordering.
- **Budget cap (NEW):** `budget_caps_live_batches` → `batches=2 evictions=162 installs=164
  retranslations=123`: live batch count never exceeds the budget under churn.
- **Existing suites green with eviction enabled:** full `cargo test -p wasm-vm-jit-runtime`
  (chaining/batching/invalidation/jit_execution/precise_traps/eviction) all pass; `wasm-vm-jit-translate`
  differential green; `predecode_diff` 2/2 byte-identical; wasm32 `--no-default-features` no_std build
  clean; `cargo fmt --check` clean.

## Verification debt (deferred to dev — needs booted-guest/workload harness on Linux `dev`; the mac
## OS-reaps long browser boots)
- **AC1** — gcc -O2 at a tiny 4 MiB budget completes, and default-budget < 5% re-translation rate. The
  budget/flag/stats are wired (`jit_cache_stats().retranslation_rate()`); needs the gcc bench (E4-T04 gcc
  row, itself deferred). No numbers fabricated.
- **AC2** — 24h/accelerated soak (`apk add/del` + gcc): Instance count + code bytes plateau ≤ budget.
  Stats series committed on dev. Wired via `jitstat`.
- **AC5** — both policies' A/B ledger on gcc+CoreMark+boot, chosen default recorded, loser demoted/removed.
  Both implemented behind `EvictPolicy`; default provisionally `BatchLru`; A/B run is dev debt.
- **Adversarial #1 (thrash bomb, 10k-warm-block C switch monster) / #3 (browser memory-growth accounting
  drift) / #5 (SMC torture concurrent with forced eviction)** — the directed `budget_caps_live_batches`
  and `max_batches=2` corpus cover the native shape; the full adversarial workloads are dev debt.
- **Browser overlay** for the stats (the `jitstat` payload) — the native dump exists; the tab overlay is
  dev debt (E4-T22+ worker/UI).
