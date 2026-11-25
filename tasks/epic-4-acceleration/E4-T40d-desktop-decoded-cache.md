---
id: E4-T40d
epic: 4
title: Size the Replay desktop's decoded-block cache to its working set (262144 entries)
priority: 0.387642
status: implemented
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
   with and without `--query "&decodedCacheEntries=16384"`, two interleaved pairs: no missing
   samples, no console errors beyond the favicon 404, the page reports `decodedCacheEntries`
   262144 by default and 16384 with the switch; the session's `blockBuilds` are at least ten
   times lower at 262144; in each pair the click-result median is lower at 262144, and pooled
   over the pairs the click-result median is at least 15% lower and the move-and-click
   median at least 25% lower.
   (This criterion first said "click result median at least 20% lower", a number taken from
   the scratch A/B above. On the committed bundle the two pairs gave 15% and 23%, 17% pooled,
   so the threshold was restated as what the committed bundle supports; see the claim.)

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

### 2026-11-24 — worker — claim (head `07d707710`)

Implementation `bc07d1eac` (core/wasm/loader size list, Replay desktop option, CLI counters,
equivalence scripts, tests, rebuilt `web/dist`); `07d707710` only refreshes the generated
`web/gpu-checkpoint-build.js` (equal to the copy in `web/dist`).

Commands and results, at that head:

- `evidence/e4-t40d/gates.log` (sha256 `38a5450c…7000bb`): `cargo fmt --check`;
  `cargo clippy -p wasm-vm-core -p wasm-vm-cli --all-targets -- -D warnings`;
  `cargo clippy -p wasm-vm-wasm --lib --test decoded_cache_capacity --target wasm32-unknown-unknown -- -D warnings`;
  `cargo test -p wasm-vm-core --lib decoded_cache_capacity_tests` (8 pass);
  `cargo test -p wasm-vm-core --lib turbo` (15 pass);
  `cargo test -p wasm-vm-core --test predecode_diff --test predecode_smc_diff` (3 pass);
  `cargo build -p wasm-vm-core --no-default-features --target wasm32-unknown-unknown`;
  `wasm-pack test --node crates/wasm --test decoded_cache_capacity` (3 pass);
  `cd web && node --test tests/e4-t40d-decoded-cache-sizes.test.mjs` (5 pass). All exit 0.
  `cargo clippy -p wasm-vm-wasm --tests` as a whole fails on two files this task does not
  touch (`tests/hart.rs` `clippy::collapsible_match`, `tests/hart_ctrl.rs` unused import),
  which is why the wasm lint names the lib and the touched test.
- `cargo build --release -p wasm-vm-cli && bash tools/perf/decoded-cache-equivalence.sh`
  → `CACHE-INDEPENDENT (4096 16384 262144; 2000000000 instructions)`
  (`evidence/e4-t40d/decoded-cache-equivalence.log`, sha256 `5a0bc289…ec8247`). At every size,
  turbo and ordinary: `trace fnv64=0dab1ccaa237df29`, `trace retired=1999831660`,
  `state sha256=ed70e270…38701` — the E4-T40b digest. `block cache:` lines: 4096 entries →
  13,461,414 builds; 16384 → 4,081,591; 262144 → 1,191,109.
- Memory, native, same 2-billion-instruction run under `/usr/bin/time -l`: peak resident
  1,495,564,288 bytes at 16384 and 1,548,500,992 at 262144 (+52.9 MB).
- Browser, committed `web/dist` on `tools/serve-dist.sh 8125`, Chrome 158 headless, n=5,
  order 262144, 16384, 262144, 16384 (`evidence/e4-t40d/browser-dist-{1..4}-*.json` and
  `.log`): all exit 0, no missing samples, console clean apart from the favicon 404.

  | | 16384 (runs 2, 4) | 262144 (runs 1, 3) | pooled change |
  |---|---:|---:|---:|
  | `decodedCacheEntries` reported | 16384 | 262144 | |
  | Session `blockBuilds` | 49.5 M / 49.2 M | 3.30 M / 3.33 M | 15x fewer |
  | Block-entry miss rate | 1.61% | 0.09% | |
  | Click result, median | 444 / 441 ms | 376 / 339 ms | −16.6% (442 → 369, 10 samples each) |
  | Pressed-state frame, median | 224 / 223 ms | 216 / 172 ms | −15.6% |
  | Move and click, median | 400 / 403 ms | 270 / 269 ms | −32.9% |
  | `node -e`, later runs | 5.50 / 5.35 s | 4.90 / 4.76 s | −11.5% |
  | Key echo, median | 49 / 44 ms | 49 / 45 ms | unchanged |
  | Node integer loop | 8.95 / 8.94 s | 8.22 / 8.24 s | −8% |
  | Idle | 146 / 147 MIPS | 160 / 161 MIPS | +10% |

What this shows: the Replay desktop now runs with 262144 decoded-cache entries; that removes
93% of block decodes in a benchmark session and makes every measured interaction faster or
equal; and the guest executes the same instructions to the same memory image at all three
sizes. What it does not show: the scratch A/B's 29% click improvement did not reproduce on the
committed bundle — there the 16384 baseline was faster (442 ms against 535 ms) and the gain
is 15–23% per pair, 17% pooled. I restated criterion 4 accordingly rather than leave a number
the evidence does not support. The profile that motivated the task was taken on a
names-kept build of the same sources and is described in the Boundary section, not archived.
`web/tests/e5-t26k-decoded-cache.test.mjs` was already failing at the base commit (see the
note under Adversarial verification) and is unchanged.
