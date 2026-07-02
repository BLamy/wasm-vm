---
id: E4-T17
epic: 4
title: Self-modifying code detection via page-granular protection bitmaps
priority: 417
status: pending
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
(empty)
