---
id: E4-T40f
epic: 4
title: Cheaper block entry — a remembered successor skips the cache probe; no JIT discovery without a JIT
priority: 0.3876435
status: implemented
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

### 2026-11-28 — worker — claim (head `9bbc80e6d`)

Commits on `codex/block-successor-memo`: `ddec17735` (the change, tests, task), `9bbc80e6d` (generated build id,
evidence). The profile that motivated it: `evidence/e4-t40f/profile-1/top.txt` (`profile-clicks.mjs`, a named
wasm build, 8 clicks).

**Architecture unchanged** — `tools/perf/turbo-equivalence.sh` on the generation-3 snapshot, 2e9 instructions,
with the release CLI built before this change (`evidence/e4-t40f/equivalence/before.log`) and after
(`after.log`): turbo and ordinary both `trace fnv64=eea93e63da8eb29b`, `retired=1999798762`, `state
sha256=af37489250dc…` — identical before and after. `bash tools/perf/decoded-cache-equivalence.sh`:
`CACHE-INDEPENDENT (4096 16384 262144; 2000000000 instructions)`, all six runs the same digest
(`decoded-cache-equivalence.log`; block cache entry_hits 383,375,996, builds 273,872). (The acceptance named
"the E4-T40b digest": that digest belongs to an older snapshot; the comparison made is to the before-binary on
the current one.) The native CLI keeps discovery on, so these runs exercise the memo with discovery as before;
discovery off is covered by the core test below and the browser runs.

**Gates**: `cargo test -p wasm-vm-core --features trace` 1379 passed, 0 failed (`core-tests.log`), including the
new `successor_memo_answers_only_for_a_live_block_of_the_current_generation` (dispatch.rs: page flush,
eviction, whole-cache flush, cache replacement, dropped block) and `tests/block_discovery_switch.rs`
(discovery off: same registers and snapshot digest, `nominated == 0`; a successor rewritten by a store runs its
new code). The five discovery tests that run without a JIT executor pass because discovery stays on by default
(only the browser machines turn it off; `enable_browser_jit` turns it on). `cargo clippy -p wasm-vm-core
--all-targets --features trace -- -D warnings` and `cargo clippy -p wasm-vm-wasm --lib --target
wasm32-unknown-unknown -- -D warnings` clean.

**Browser, committed bundle** (8125 = this head, wasm `9188947fe346…`; 8133 = `bc9381144`'s `web/dist`, wasm
`e720c03de0a6…`), `desktop-latency --query=&net=0 --scenarios click,type,node,idle --n 8`, three interleaved loads
a side (`evidence/e4-t40f/browser/`):

| | new | previous |
|---|---|---|
| click result (median) | 227.6, 231.0, 238.4 ms | 264.2, 262.4, 267.8 ms |
| pressed frame | 126.7, 127.1, 127.8 ms | 136.2, 139.7, 141.4 ms |
| key echo | 48.0, 36.3, 47.1 ms | 44.0, 45.0, 44.1 ms |
| node -e to prompt | 1493, 1472, 1507 ms | 1729, 1689, 1672 ms |
| idle in run slices | 1.1, 1.1, 1.1 % | 1.3, 1.3, 1.3 % |

The E5-T43f acceptance (online, off, relay-down, sw) passes on this head (`online.log`).

**Live** after `bash tools/deploy-cloudflare.sh` (served wasm hashes as `web/dist`'s): click 230.3 ms, key echo
47.8 ms, node -e 1518 ms, idle 1.2 % (`live-latency.json`; before this change live was 261.2 / 44.8 / 1658 / 1.2).

**Not covered by a dedicated test**: satp/sfence remapping a VA to another physical page between two entries
(the memo is keyed by the physical address `fetch_phys` returns, so a remap gives another key and the probe);
a PMP change (unchanged: `fetch_phys` checks every entry before the memo is consulted).
