---
id: E3-T03
epic: 3
title: Block cache with bounded memory, eviction, and prefetch heuristics
priority: 303
status: pending
depends_on: [E3-T02]
estimate: M
capstone: false
---

## Goal
A memory-bounded cache between the guest and `ChunkSource`: fetched chunks live in a cache
with a configurable byte budget (default 256 MiB) and an eviction policy; sequential access
triggers readahead; a recorded boot profile prefetches boot-critical chunks up front. Result:
warm reads never refetch, cold boot overlaps fetch with execution.

## Context
Without a cache every eviction-free design either OOMs the tab or refetches constantly. Use
segmented LRU (probationary + protected) or CLOCK — pick one, justify in a comment; ARC is
allowed but don't gold-plate. Prefetch heuristics: (1) sequential readahead — on a miss at
chunk `k` with recent hits at `k-1`, `k-2`, speculatively fetch `k+1..k+N` (N configurable,
default 4); (2) boot profile — a dev-mode recorder dumps the ordered chunk-access list of a
full boot into `boot-profile.json`, shipped alongside the manifest and prefetched (bounded
concurrency) at page load. Cache is core-crate code, fully unit-testable natively.

## Deliverables
- `BlockCache` in the core storage crate: get/insert/evict, byte-budget accounting, pinning
  for chunks with in-flight guest reads (never evict a chunk mid-completion).
- Readahead + boot-profile prefetcher with a concurrency cap (default 6 parallel fetches).
- Metrics struct exposed over the wasm boundary: hits, misses, evictions, prefetch accuracy
  (prefetched chunks actually used / prefetched total), bytes resident.
- Dev-mode access recorder + `boot-profile.json` for the current Alpine image.
- Native tests: eviction never exceeds budget; pinned entries survive pressure; proptest of
  random access traces against an unbounded reference cache for read correctness.

## Acceptance criteria
- [ ] Resident cache bytes never exceed the budget across a full boot + `find / -type f`
      sweep in the guest (assert via metrics, budget set artificially low, e.g. 32 MiB).
- [ ] Second run of `cat` on a large guest file (fits in cache) performs zero fetches.
- [ ] With the boot profile enabled, time-to-login improves ≥25% over T02 baseline on a
      throttled (10 Mbps simulated) connection; numbers recorded in the log.
- [ ] Sequential guest `dd if=/dev/vda` shows readahead: fetch count ≈ chunks/N batches,
      not one fetch per demand miss (verify via metrics).
- [ ] Prefetch accuracy for boot profile ≥ 80% on a normal boot.

## Adversarial verification
Set the budget below the working set (e.g. 8 MiB) and run a guest kernel compile-like
workload (`tar x` of a big archive): any over-budget residency, eviction of a pinned chunk
(guest reads corrupt data), or deadlock between prefetch and demand fetches is a refutation.
Run the proptest with 10^5-op traces. Race check: trigger eviction concurrently with a
demand miss on the same chunk. Confirm prefetch respects the concurrency cap under a slow
network (DevTools throttling) rather than opening dozens of sockets. Verify metrics math
(hits+misses vs. actual fetch counter) — inconsistent counters refute.

## Verification log

**2026-07-06 — cache + prefetch core (pass 1+2), PR stacked on #88.**
Pass 1 (`cache.rs`): `BlockCache` — byte-budgeted CLOCK (second-chance) eviction (ref bit only, no
timestamps → deterministic/no_std), byte accounting, pinning (in-flight guest reads never evicted;
all-pinned → bounded overshoot), `get`/`ChunkSource` via interior-mutable Cell, `CacheMetrics`.
8 unit tests + a 400-case proptest (read-correctness: a resident chunk always returns its
last-inserted bytes; accounting: tracked total == actual sum). Pass 2 (`prefetch.rs`): `Readahead`
(3-consecutive-run → k+1..=k+window), `boot_prefetch` (ordered profile batch, `max` = concurrency
cap), `PrefetchTracker` (accuracy = used/issued). 5 tests.

Cold-clone critic (fresh context) attacked never-serve-wrong-bytes, never-evict-pinned,
accounting-never-drifts, eviction-terminates, hand-integrity, readahead, prefetch — wrote 5
throwaway tests targeting what the proptest can't reach (differently-sized replaces, set_budget×pin
interleaving, all-pinned inserts, hand churn). **Verdict SHIP**, all invariants sound. One LOW
finding **F1**: a size-GROWING replace-in-place skipped the eviction loop → could overshoot budget
(non-issue for fixed-size chunks, but a latent gap). **FIXED** with a budget sweep after a growing
replace (pinning the written chunk against self-eviction) + regression test.

Gates: storage 30/0, workspace clippy --all-features + fmt + determinism + wasm build — all clean.
**Remaining:** pass 3 — wire `BlockCache` into `ChunkedBackend` (replace the unbounded `ChunkStore`),
pin awaited chunks across parked-read completion, expose metrics over the wasm boundary; pass 4 —
dev-mode access recorder + `boot-profile.json` + browser measurements (budget-bound over a `find /`
sweep, readahead on `dd`, ≥25% faster boot on throttled net, ≥80% boot-profile prefetch accuracy).
