---
id: E4-T40d
epic: 4
title: Size the Replay desktop's decoded-block cache to its working set (262144 entries)
priority: 0.387642
status: in-progress
depends_on: [E4-T40b, E5-T26k]
estimate: S
risk: medium
capstone: false
---

## Boundary

Host configuration of the decoded-block cache: one more selectable capacity, and the Replay
desktop selects it. No change to the cache's key, probe, replacement or invalidation rules, to
decode or execute semantics, or to any snapshot format.

Measured on the warm Replay desktop at `2353157fe` (E4-T40b turbo loop, 16384 entries), with a
worker CPU profile of eight clicks on the Chrome test page (a build of the same sources with
wasm function names kept):

- A click retires 31–43 M instructions across about 6.9 M block entries, and the worker is
  inside the run slice the whole time, but it retires at 73–83 MIPS against 150–165 MIPS at
  idle.
- 300,000–380,000 of those block entries per click are **misses that decode the block again**
  (`blockBuilds`), about 5%. The decode path (`decode_at`, `decode`, `expand_c`,
  `DecodedBlock::new`, `insert_rc_evicting`, and the allocator calls behind them) is about
  20% of the click's CPU time.
- Per click, by cache size: 16384 → 300–380 K builds; 65536 → 140–210 K (no gain yet, the
  working set is still larger); 262144 → 6–14 K; 1048576 → 4–5 K.

So one click in Chrome runs through roughly 200,000 distinct code blocks and a 16384-entry
cache cannot hold them. E5-T26k bounded the browser selection to 4096 or 16384 for its
experiment; this task adds 262144 to that list and makes it the Replay desktop's size. Host
memory: the slot array grows from 0.5 MiB to 8 MiB, and resident blocks own their ops.
Measured natively with the cache full (2 billion instructions from the warm snapshot,
1.19 M block builds into 262144 slots), peak resident memory is 1,548.5 MB against 1,495.6 MB
at 16384: about 53 MB more.

Scratch A/B of the two sizes on otherwise identical builds (interleaved a/b,
`tools/perf/desktop-latency.mjs`, n=5; `evidence/e4-t40d/scratch-ab/`): click result median
544/524 ms → 379/377 ms; pressed-state frame 272/299 → 181/199 ms; move-and-click
468/435 → 303/301 ms; `node -e` 5.9/5.8 s → 5.2/5.0 s; key echo unchanged (47–51 ms); CPU loops
3–12% faster; idle 140 → 155 MIPS.

Changes:

- `crates/core`: `DECODED_CACHE_SIZES = [4096, 16384, 262144]`; `set_decoded_cache_entries`
  accepts exactly those.
- `crates/wasm`: `setDecodedCacheEntries` accepts exactly those numbers (still no coercion).
- `web/decoded-cache.js`: the same list for the loader's validation and for the "actual
  capacity" check.
- `web/main.js`: the Replay desktop asks for 262144; `?decodedCacheEntries=16384` (or 4096)
  is the A/B switch. An unsupported value fails the boot, as before.
- `crates/cli`: the end-of-run statistics print the cache's entry hits and builds.
- `tools/perf/turbo-equivalence.sh` takes `CACHE_ENTRIES`;
  `tools/perf/decoded-cache-equivalence.sh` runs it at several sizes and requires identical
  evidence across them.

Not in scope: other guests' cache sizes, the cache's structure (for example chaining block
entries to skip the probe; the profile puts `enter_block` + `probe` at about 18% of a click),
and block discovery running without a JIT (about 3%). Those are follow-ups.

## Deterministic acceptance

1. `bash tools/perf/decoded-cache-equivalence.sh` ends with
   `CACHE-INDEPENDENT (4096 16384 262144; 2000000000 instructions)`: at each size the turbo
   loop and the ordinary interpreter produce identical evidence (retire-trace FNV, retired
   count, RAM SHA-256), and the evidence is identical across the three sizes and equal to the
   E4-T40b digest (FNV `0dab1ccaa237df29`, 1,999,831,660 retired). The `block cache:` lines
   show the three capacities took effect and that `builds` falls as the size grows.
2. `cargo test -p wasm-vm-core --lib decoded_cache_capacity_tests` and
   `wasm-pack test --node crates/wasm --test decoded_cache_capacity` pass with 262144 in every
   size loop and its neighbours (65536, 131072, 262143, 262145, 524288, 1048576) rejected.
3. `cd web && node --test tests/e4-t40d-decoded-cache-sizes.test.mjs` passes.
4. Browser, committed `web/dist` (`bash tools/serve-dist.sh 8125`):
   `node tools/perf/desktop-latency.mjs --url http://127.0.0.1:8125 --app /app.html --n 5`
   with and without `--query "&decodedCacheEntries=16384"`: no missing samples, no console
   errors, the page reports `decodedCacheEntries` 262144 by default, and the click result
   median is at least 20% lower at 262144 than at 16384 in the same session of runs.

## Adversarial verification

Medium risk: the acceptance criteria plus one bounded novel attack. Suggested angles: a size
outside the list reaching the machine through any path (URL, worker protocol, wasm binding);
a selection that silently falls back instead of failing; evidence that differs between sizes
at another instruction budget; a restore path that resets the capacity; memory growth beyond
the stated bound.

`web/tests/e5-t26k-decoded-cache.test.mjs` is stale at the base commit and is not part of
this task's acceptance: it fails at module load on a source-text match against `loader.js`
(`const manifest = await fetchJsonAsset(…)` is no longer a single statement), and four of its
eleven tests still fail with that match repaired. Its size assertions remain true with the
new list. Repairing or retiring it is a follow-up.

## Verification log
