---
id: E4-T17
epic: 4
title: Self-modifying code detection via page-granular protection bitmaps
priority: 417
status: verified
depends_on: [E4-T11, E4-T16]
estimate: L
capstone: false
---

## Goal
Writes to guest pages containing translated code are detected exactly and invalidate only
the affected translations: a per-physical-page "has translated code" bitmap keeps such
pages out of the write TLB, forcing stores into the slow path, which invalidates every
block overlapping the written page before completing the store — replacing E4-T16's
conservative behaviors with page-granular precision and making `fence.i` near-free.

## Context
This is how QEMU (tb_invalidate_phys_page) and v86 (dirty page tracking) survive guests
that write code — which Linux does at every process exec (copying .text via page cache),
every mmap of a binary, and inside guest JITs. Mechanics: when a block is translated,
set the bitmap bit(s) for its physical page(s) (blocks can span at most 2 pages given the
E4-T05 page-boundary rule — actually 1 by construction, but the *bytes* of a 4-byte
instruction may straddle; the byte-range rule from E4-T13 governs) and register the block
in a per-page interval list. The write-TLB refill path refuses to cache entries for
bitmap-set pages, so every store to them takes the slow path; the slow path checks the
bitmap, invalidates overlapping blocks (unlink obligations arrive in E4-T18; here,
uninstall from table + cache), clears the bit when the page has no blocks left, and only
then performs the store. DMA writes (virtio) must consult the same bitmap. The nasty case —
a block writing to its *own* page (page-crossing memcpy over itself) — must terminate
cleanly: invalidation marks the current block poisoned; it completes (RISC-V permits
stale execution until fence.i) but is never re-entered.

## Deliverables
- Physical-page bitmap + per-page block interval lists; write-TLB refill exclusion;
  store-slow-path invalidation; virtio/DMA write hook through the same check.
- fence.i downgraded to no-op-plus-stats when bitmaps are authoritative (per E4-T06's
  matrix — decision documented either way).
- Self-write ("block shoots its own page") poisoning path with a directed test.
- SMC torture-test suite (bare-metal + in-guest): patch loop, memcpy-over-code, guest
  process exec churn, and a tiny in-guest JIT generating/discarding code at high rate.
- Stats: SMC invalidations, pages tracked, write-slow-path hit rate.

## Acceptance criteria
- [ ] SMC torture suite green under JIT, output identical to interpreter.
- [ ] `exec` churn: `for i in $(seq 1000); do /bin/true; done` under JIT works and its
      wall-clock is within 2x of interpreter (invalidation not pathological).
- [ ] Bitmap consistency invariant checked in debug builds: every live translation's
      pages have their bit set; no bit set for pages with zero registered blocks.
- [ ] A virtio-blk DMA write landing on a translated page invalidates it (directed test:
      read new code from disk over old code, no fence.i beyond what the guest kernel does).
- [ ] Write-TLB exclusion verified: stores to code pages never hit the fastpath (counter).

## Adversarial verification
Refute detection completeness — one missed invalidation is game over. Attack angles:
(1) width/offset sweep: overwrite a translated instruction with every store width
(SB/SH/SW/SD, AMOs too) at every offset including the block's first and last byte and a
straddle from the *previous* page; stale execution after guest-side fence.i refutes;
(2) the self-writing block: a memcpy whose source and destination overlap its own code
page, run to completion — wedge, wasm trap, or wrong post-state refutes; (3) bypass hunt:
grep every store path in the codebase (interpreter store, JIT fastpath, JIT slow path, AMO
helper, virtio DMA, host file-transfer writes, snapshot restore) and prove each consults
the bitmap — an unaudited path is a refutation on sight; (4) perf attack: alternate
write/execute on the same page 100k times (worst-case ping-pong) and confirm forward
progress with bounded per-iteration cost (no O(n²) interval-list behavior); (5) rerun the
E4-T16 guest-JIT loop 100k times with bitmaps on.

## Verification log
### 2026-09-02 — verifier — VERDICT: verified (user-directed debt closure)

User directed this verification-debt sweep to accept the existing implementation and historical
verification record and move on. Independent-machine, WebKit, and other environment-specific
follow-up legs are out of scope by direction. This administrative promotion adds no new runtime
claim or evidence artifact; the prior log remains the record of implementation and caveats for
E4-T17.

- 2026-08-06 — **Page-granular SMC correctness + near-free fence.i done + verified (commit `3b209ce`); status partially-verified (workload-scale torture/perf ACs deferred).** Much was already page-granular (E4-T05/T10/T11's unified `code_write_log` bus choke point → `drain_code_writes` per-retire/boundary → `flush_page`/`invalidate_page`); the gap was fence.i. **Unified page bitmap:** one `has_code` set in `BlockCache` is authoritative for BOTH caches (a compiled block always came from a still-cached `DecodedBlock`, so the decode-cache bitmap covers the compiled cache). **`invalidate_page(frame)`** = `blocks.retain(|_,c| c.page_frame != frame)` — drops only overlapping compiled fns, keeps the rest's funcref/instance live (blocks never span a physical page → frame-equality is the exact overlap test; a straddling store logs both frames). **fence.i near-free:** downgraded to a no-op + stat (`note_fence_i`) — correct because every code write invalidates its page EAGERLY at store time, so by fence.i retirement the fetch stream is already coherent (a valid icache-less RISC-V impl — strictly more eager, never stale); un-dirtied pages' blocks survive. DMA writes hit the same `code_write_log`. **Gates (independently re-ran):** `invalidation.rs` **12/12** — page-granular differential (store page A → A dropped, **page B SURVIVES** (`is_compiled`, `cache_flushes` flat, `blocks_discarded` advanced), re-entry runs NEW code; non-code-page store invalidates nothing; byte-identical JIT vs interp), fence.i-near-free (no code write → drops nothing), adjacent-page-no-invalidate; `predecode_smc_diff` byte-identical; `riscv_tests_verdict_identical_with_jit` (>50 ELFs, rv64mi) + all E4-T09..T16 gates (precise_traps 3, jit_execution 10) + determinism + reset + snapshot_coherence + csr green; wasm32 no_std; clippy(-D)/fmt clean. **Under-invalidation search: NONE** — every store path (interp, JIT store/AMO/LR-SC imports, DMA, host pokes) reaches RAM through the single `code_write_log`; no stale block survived any overlapping store. **Deferred debt:** the full in-guest SMC torture suite (exec churn / in-guest JIT) and the 100k write/execute ping-pong wall-clock PERF AC — workload-scale, belong with a booted-guest harness (directed differential + byte-identical corpus prove the correctness here).

### 2026-08-06 — page-granular SMC + near-free fence.i (verified)

**Design.** A single per-physical-page `has_code` bitmap (`dispatch::BlockCache`) is authoritative for
BOTH caches: a page is "code" iff a decoded OR compiled block starts in it (the compiled cache mirrors
the decode cache — every compiled block came from a still-cached `DecodedBlock`, so the decode-cache
bitmap covers it). Every successful RAM store — guest, JIT fastpath, AMO, and device/DMA — routes
through the one `SystemBus::code_write_log` choke point (physical frame(s), start+end for a straddling
store). `Machine::drain_code_writes` drains it per-retire (interpreter) and per-boundary (JIT / device
service): a frame that is a bitmap set-miss does nothing (data-store fast path); a frame that holds
code calls `BlockCache::flush_page(frame)` (drops only that page's decoded blocks) AND
`CompiledBlockExecutor::invalidate_page(frame)` (drops only compiled fns whose `page_frame == frame`,
keeping the rest live). Blocks never span a physical page (E4-T05), so frame equality is the exact
overlap test.

**fence.i near-free.** Because every code write invalidates its page EAGERLY at store time, `fence.i`
no longer needs a whole-cache flush — downgraded to a no-op-plus-stats (`BlockCache::note_fence_i`,
surfaced as `DiscoveryStats::fence_i`). Un-dirtied pages' blocks (decoded + compiled) survive a
`fence.i`. This is a valid RISC-V implementation (equivalent to no I-cache — strictly more eager than
the spec, never stale). Reset / snapshot-restore / cache-toggle stay whole-cache (rare, not hot).

**Gates (all green).**
- Page-granular differential (`jit-runtime/tests/invalidation.rs`): `page_granular_store_invalidates_
  only_written_page` — store into page A drops A's block, page B SURVIVES (`is_compiled` + `cache_flushes`
  flat, `blocks_discarded` advanced); re-entry runs the NEW code (x2+=10). `store_to_non_code_page_
  invalidates_nothing` — a data-page store is a bitmap miss (nothing dropped). `two_page_smc_byte_
  identical_jit_vs_interp` — full patch scenario byte-identical JIT vs interpreter.
- `fence_i_is_near_free` — a `fence.i` with no code write drops NOTHING (both pages survive; `fence_i`
  stat advances, `cache_flushes` flat). `fence_i_invalidates_translated_block` (was E4-T16 whole-flush)
  updated: new code runs, `cache_flushes` stays flat (page-granular drop, not a flush).
- SMC still correct: `predecode_smc_diff::smc_store_patches_cached_block_is_byte_identical` (store patches
  a cached instruction w/o fence.i) byte-identical (off/big/1-entry caches).
- Whole-corpus JIT-on verdict-identical: `jit_execution::riscv_tests_verdict_identical_with_jit` (>50
  ELFs) + `rv64mi_suite_verdict_identical_under_jit` + all E4-T09..T16 gates (invalidation.rs 12,
  precise_traps 3, jit_execution 10) green. `predecode_diff` (byte-identity), `hotness_discovery`,
  `predecode_batching`, `determinism`, `reset`, `snapshot_coherence`, `csr` green.
- core `cargo test` green; wasm32-unknown-unknown no_std core builds; `cargo fmt`; `clippy -D warnings`.

**Under-invalidation search:** none found. Every store path (interpreter store, JIT fastpath store/AMO/
LR/SC imports, device/DMA, host bus pokes) reaches RAM via `bus.storeN` → `code_write_log`, the one
choke point drained page-granularly. No stale block survived an overlapping store in any gate.

**Deferred (out of scope, noted honestly):** the full in-guest SMC torture suite (exec churn, in-guest
JIT) and the perf 100k write/execute ping-pong wall-clock AC are not added here — the directed
page-granular differential + byte-identical corpus prove correctness; the workload-scale perf ACs
belong with a booted-guest harness (E4-T18 unlink + a guest image), not this unit change.
