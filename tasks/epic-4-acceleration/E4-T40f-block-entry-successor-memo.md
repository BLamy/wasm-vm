---
id: E4-T40f
epic: 4
title: Cheaper block entry — a remembered successor skips the cache probe; no JIT discovery without a JIT
priority: 0.3876435
status: in-progress
depends_on: [E4-T40d]
estimate: S
risk: high
capstone: false
---

## Boundary

`crates/core/src/dispatch.rs` (`DecodedBlock` gains `live` and a weak `successor` memo; `BlockCache`
marks blocks not live when they leave it and gains `retire_all`/`current_generation`) and
`Machine::enter_block` in `crates/core/src/lib.rs` (`prev_block`; the memo is tried after `fetch_phys`,
before the probe; `set_block_discovery`). `crates/wasm/src/lib.rs`: the browser machines start with
discovery off; `enable_browser_jit` turns it on.

Why: a CPU profile of the Replay desktop's worker during clicks (named wasm build;
`evidence/e4-t40f/profile-1/top.txt`) put about a quarter of the busy time in block transitions:
`enter_block` 14.5 %, `BlockCache::probe` 6.5 %, `BlockDiscovery` 4 %. Blocks average about 5.6 ops.
Block entry still translates and permission-checks every entry PC (`fetch_phys`), as before; only the
lookup of the block for that physical address is short-cut, and only to a block that is live in the
current generation. Discovery only observes (it never changes what executes) and nothing reads it
without a JIT executor.

## Deterministic acceptance

- Architecture unchanged: `tools/perf/turbo-equivalence.sh` (the resumed Replay desktop, every retired
  instruction hashed, seeded entropy, fixed RTC) gives the same digest with the CLI built before and
  after this change; `bash tools/perf/decoded-cache-equivalence.sh` still ends `CACHE-INDEPENDENT` with
  the E4-T40b digest; `cargo test -p wasm-vm-core --features trace` passes.
- New tests: the memo answers only for a live block of the current generation (page flush, eviction,
  whole-cache flush, cache replacement each end it); discovery off runs the same guest and records
  nothing; a successor rewritten by a store runs its new code.
- Browser, committed bundle, interleaved against the previous wasm: click result and `node -e` faster
  (scratch measurement: click 242-245 vs 275-280 ms, node -e 1494-1550 vs 1780-1786 ms, MIPS during
  clicks 96 vs 81); key echo and idle not worse; the online acceptance (E5-T43f) still passes.

## Adversarial verification

High risk (core execution path). Attack list: a memo hit on a block that was flushed, evicted or rebuilt
(SMC within the same page, a DMA into code, a fence.i, satp/sfence remapping the same VA to another
physical page, a PMP change making the entry non-executable); the 1-slot cache; snapshot/restore and
cache-capacity changes; the JIT path still nominating (discovery on with `enableJit`); memory: memos hold
weak handles only (no cycles).

## Verification log
