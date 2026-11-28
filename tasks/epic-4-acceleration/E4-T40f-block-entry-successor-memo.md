---
id: E4-T40f
epic: 4
title: Cheaper block entry — a remembered successor skips the cache probe; no JIT discovery without a JIT
priority: 0.3876435
status: verified
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

### 2026-11-28 — verifier — VERDICT: verified

VERDICT: verified (fresh session; head `dbeaf4799`, claim head `9bbc80e6d` — the only later commit is the claim text).
Predictions were written first: `evidence/e4-t40f/verifier/predictions.md`. Evidence: `evidence/e4-t40f/verifier/`.

- P1 turbo equivalence across the change — HELD. I rebuilt the release CLI myself from `bc9381144` (sparse worktree)
  and ran `tools/perf/turbo-equivalence.sh 2000000000` with it and with HEAD's: both `trace fnv64=eea93e63da8eb29b`,
  `retired=1999798762`, `state sha256=af37489250dc…`, turbo == ordinary (`equivalence/turbo-before-bc9381144.log`,
  `turbo-after-head.log`).
- P2 decoded-cache equivalence — HELD. `decoded-cache-equivalence.sh` at HEAD: `CACHE-INDEPENDENT (4096 16384 262144)`,
  same digest as P1 (`equivalence/decoded-cache-head.log`). The 1-slot cache on the real desktop as well: sizes 1 and
  4096 at 2e8 instructions give the same `fnv64=adcd89047d9db927` (`decoded-cache-head-1slot-200M.log`).
- P3 gates — HELD. `cargo test -p wasm-vm-core --features trace`: 1379 passed, 0 failed (`core-tests-summary.log`);
  both clippy runs clean; `cargo fmt --check` clean.
- P4 every way out of the cache ends the memo — HELD. A slot loses its block only in `flush_page` (dispatch.rs:689,
  marks it not live) and in the evicting insert (:843). The whole cache is replaced only in `set_block_cache_capacity`
  (`retire_all`, :645, plus `prev_block = None`). Toggle, PMP change and every resume/restore path use `flush()`
  (lib.rs:1179, 1286, 5204), which moves the generation. `successor_for` (:429) checks live, generation and phys.
- P5 SMC / DMA — HELD. My test `verifier_guest_smc_successor_same_and_other_page`: a guest `sw` in block A rewrites its
  remembered successor B every turn, with B on A's page and on another page, and chunks of 1, 3, 7, 997 and 4096. It
  matches the cache-off machine (registers, pc, snapshot digest) with discovery off, discovery on, and the 1-slot
  cache. My test `verifier_self_loop_rewritten_between_chunks_runs_new_code` covers the case where only `live`
  protects: a self-loop block is its own successor and also `prev_block`, so the cache dropping it does not free it.
  A host/DMA store between run chunks must still run the new code. Both pass at HEAD.
- P6 fence.i / satp-sfence / PMP — HELD by inspection, no dedicated run. `fetch_phys` (lib.rs:6317) translates and
  PMP-checks every entry before the memo. The memo answers only for that exact phys. A PMP or privilege change that
  matters flushes (lib.rs:1286). `fence.i` needs no flush, because stores already flushed their pages at retire. I ran
  no guest test that remaps satp.
- P7 1-slot cache — HELD (P2 at desktop scale; `cap1` mode in both of my tests; worker unit test "evicted").
- P8 toggle and capacity change with `prev_block` held — HELD (`verifier_toggle_and_capacity_change_with_prev_block_held`:
  cache off, code rewritten while code-write tracking is off, cache on, then capacity 2. Equal to the cache-off
  reference).
- P9 JIT path still nominates; nothing else needs discovery without a JIT — HELD. On the committed wasm under Node
  (`jit-discovery.mjs`, `jit-discovery.json`): a `WasmMachine` without a JIT has nominated 0 and deduped 0. After
  `enableJit(4)` it has nominated 1, compiledBlocks 1 and retiredViaJit 1998822. `set_jit(true)` is reached in
  production only through `enable_browser_jit` (wasm lib.rs:596-597). The browser runs' `jitStats` show
  `hasExecutor:false`, `nominated:0` on the new build and 4096 on the previous one. No page code depends on those
  counters without an executor (`admission-probe.js` and `cold-counter-recycling.js` require `hasExecutor`).
- P10 memory — HELD. `verifier_memo_holds_no_strong_cycle` (in `tests/dispatch-unit-tests.patch`): with A→B, B→A and
  A→A memos the strong counts stay at cache + local. After dropping both, neither weak handle upgrades.
- P11 own attack, a duplicate live block for one phys — FAILED as predicted, harmless. My prediction (one slot per
  phys) was wrong. Unit test `verifier_shadowed_duplicate_is_reachable_by_memo_and_dies_with_its_page` (printed
  `duplicate-reachable=true`) builds this case: flushing a colliding page empties the head of p's probe chain, so the
  probe misses p's resident block, and a second live copy is inserted. The memo keeps returning the shadowed copy
  (the probe never would). It is harmless for execution: both copies were decoded from the same bytes, both are
  indexed under p's page, and one store into the page ends both (asserted). The only effect is JIT-side
  (discovery on): queued `pending_hits` buffered in the shadowed copy's `DiscMemo` are not seen by `queued_hotness_of`
  until that copy settles. This affects performance only, and only with a JIT.
- P12 browser — HELD. Interleaved new (8125, wasm `9188947f…`) and old (8133, `e720c03d…`), `desktop-latency
  --query=&net=0 --n 8 --idle-s 30` (`browser/summary.txt`): click result 233.7 and 231.0 vs 264.7 and 264.9 ms;
  pressed frame 127.7 and 130.1 vs 139.1 and 144.4; key echo 42.5 and 40.8 vs 38.5 and 44.6 (not worse); `node -e`
  1507 and 1492 vs 1679 and 1686 ms; idle 1.1 and 1.2 % vs 1.3 and 1.2 %. The only console error per load is a 404.
  The scratch "MIPS during clicks 96 vs 81" is not reproduced: about 96 vs 94. That figure was marked scratch, not
  acceptance. E5-T43f `online off relay-down sw` all PASS on 8125 (`online.log`).
- P13 coverage — HELD. The memo-hit branch ran 39,874 / 315 / 71,706 times in `discovery_off…` / `successor_rewritten…`
  / my tests (a temporary eprintln in the scratch copy). `discover=false` ran in the core tests and the browser;
  `discover=true` ran in the native equivalence runs and Node `enableJit`. `retire_all` ran through
  `set_block_cache_capacity` (my tests, CLI `--decoded-cache-entries`). Both wasm constructors' `set_block_discovery(false)`
  ran: `WasmMachine` in Node, `WasmLinux` in the browser (nominated 0). Waived: the `desktop-latency.mjs` options
  `--node-command`/`--node-setup` and the extra key map. They are outside the Boundary, unused by acceptance, and the
  defaults are unchanged. `evidence/e5-t43i/*` riding on this branch is another task's evidence.
- SABOTAGE (scratch worktree, `sabotage/`). Caught by the worker's unit test: no retire in flush_page (S1), no retire
  on eviction (S2), no generation check (S3), no phys check (S5), empty `retire_all` (S6), no live check (S7).
  Caught by `discovery_off…`: discovery always on (S4). Gap: the worker's machine-level test
  `successor_rewritten_by_a_store…` still passes under S1 and S7, because the weak handle alone protects that shape.
  My self-loop test fails under both (`delta 1000`, stale +2 code replayed), so it pins `live` at machine level.
- Observation, performance only, no stated budget: memo hits skip `get_rc_touch`'s `referenced = true` (dispatch.rs:764),
  which weakens the second-chance eviction. Native, same digest: builds 25.7M → 36.0M at 4096 entries and
  5.8M → 10.3M at 16384. No change at 262144 (271k → 274k), which is the size the desktop measured above uses
  (`equivalence/block-cache-stats.txt`). Hosts on the 4096 default (the native CLI, non-desktop pages) rebuild about
  40 % more. A follow-up could mark the slot referenced on memo hits (for example a `Cell` on the block). Test nit:
  the worker's "Dropped everywhere" case (dispatch.rs:1833) passes because of the `flush()` before it. `g` is still
  resident, so it is not checking the weak handle; `verifier_memo_holds_no_strong_cycle` covers that.
- SUITE: three integration tests (`tests/verifier_e4t40f.rs`) and two unit tests (`tests/dispatch-unit-tests.patch`)
  are committed under `evidence/e4-t40f/verifier/tests/`, ready to drop into `crates/core`. They are not promoted
  into `crates/` in this commit, because a `crates/core` change makes the pre-commit hook rebuild `web/dist` inside
  a verifier commit. Recommended: promote `verifier_self_loop_rewritten_between_chunks_runs_new_code` with the next
  core change.
Commands: `cargo build --release -p wasm-vm-cli` (bc9381144 worktree and HEAD); `BIN=… bash tools/perf/turbo-equivalence.sh
2000000000` ×2; `bash tools/perf/decoded-cache-equivalence.sh` (default, `200000000 … 1 4096`, and before-binary
`16384 262144`); `cargo test -p wasm-vm-core --features trace`; clippy ×2; fmt; sabotage S1-S7 via `sabotage/sabotage.py`;
`node jit-discovery.mjs`; `desktop-latency.mjs` ×4 interleaved; `e5-t43f-replay-desktop-online.mjs online off relay-down sw`.
Not done: a guest satp remap or PMP-change run (inspection only), a live-site check, a cold clone.
