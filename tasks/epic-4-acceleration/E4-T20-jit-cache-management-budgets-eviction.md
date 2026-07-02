---
id: E4-T20
epic: 4
title: JIT cache management — memory and module budgets, eviction, and stats
priority: 420
status: pending
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
(empty)
