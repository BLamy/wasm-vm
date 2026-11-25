---
id: E5-T34g
epic: 5
title: Serve disk reads from the whole-image prefill at once instead of parking them
priority: 0.38763
status: verified
depends_on: [E4-T40b, E5-T34a]
estimate: S
risk: medium
capstone: false
---

## Boundary

One seam in `crates/wasm`: the chunked block backend's read path.

Measured on the warm Replay desktop (E4-T40b build): the first `node -e 0` of a session
takes 29.9 s and retires 1,595 M instructions; the second takes 5.7 s and 708 M. The first
click of a session takes 1.0–1.8 s against 0.45–0.5 s afterwards. Nothing is being
downloaded — the whole image is already in host memory (E5-T34a). The cost is how a read of
a chunk that is not yet in the wasm-side cache is completed: it parks, and is only served by
`fetchPending` after the current 500,000-instruction run slice ends. Meanwhile the guest has
nothing to do, so it spins through its idle loop and timer ticks for the rest of the slice
(195 such waits for one cold `node`, 138 ms of actual fetch work in total).

Give the block backend a synchronous source for a missing base chunk. With a whole-image
prefill installed, a read of an absent chunk is sliced, hash-verified and inserted by the
same `fetch_local` the asynchronous path uses, and the read completes in the same device
service. With no local image, or for a chunk that fails verification, the read parks exactly
as today and the asynchronous path fetches it or records the permanent failure. Reads only;
a partial-block write still parks. No change to verification, to the manifest, or to what a
corrupt image does.

## Deterministic acceptance

1. `cargo test -p wasm-vm-wasm --lib chunked` passes, including: a local reader serves
   absent chunks with no park and is asked for each chunk once; a reader that cannot supply
   a chunk leaves the read parked with nothing copied out; a store too small to hold a
   request's chunks parks after a bounded number of supplies.
2. On the built page, `node tools/perf/desktop-latency.mjs --n 3 --out …` exits 0 with no
   missing sample; the page's fetch statistics show zero fetch waits and `localHits > 0`,
   and the first `node` run of the session is within 1.5x of the later ones.
3. `node tools/verify/e5-t34a-whole-image-prefill.mjs` (the corrupt-image leg included) and
   `node tools/verify/e5-t34e-replay-desktop-warm.mjs warm` still pass.

## Adversarial verification

A corrupt or truncated local image, a chunk whose hash is wrong, a read spanning many
chunks, a chunk cache budget smaller than one request, a persistent (IndexedDB) disk with a
local image, and a boot with no local image at all (every other guest): behaviour must be
what it was, except that a healthy local read no longer waits.

## Verification log

### 2026-11-25 — worker — implemented

Runtime head `a56948a09` (`84898ee46` the change, `1e7844a89` the failed-chunk fix, plus two
regenerated GPU checkpoint build ids). Built page wasm SHA-256
`b1e0796579bde2b946ddae4c8fc9fb28f17ab2e6ab6acc4ae25acc33c105e588`. Apple M4 Max, Chrome
158 headless. Evidence: `evidence/e5-t34g/`.

**A regression I introduced and fixed before this head.** The first version asked the local
reader again on every retry of a parked read. A parked read is retried at every device
service, so with a deliberately corrupt image the reader copied and hashed the bad chunk
each time and the tab crashed (out of memory) before the permanent failure was reported.
The existing E5-T34a corrupt-image leg caught it (timeout; a probe showed "Target
crashed"). `FetchState` now remembers chunks the local image could not supply
(`local_failed`) and the reader answers `false` for them at once; the asynchronous path
reports the failure as before. The set is cleared when a new local image is installed.

**1. Unit tests** (`gates.log`): `cargo test -p wasm-vm-wasm --lib chunked` — 24 passed,
including `a_local_reader_serves_absent_chunks_without_parking`,
`a_local_reader_that_cannot_supply_a_chunk_leaves_the_read_parked` and
`a_store_too_small_for_a_request_parks_instead_of_resupplying_forever`.
`cargo clippy -p wasm-vm-wasm --all-targets -- -D warnings` clean;
`wasm-pack test --node crates/wasm` 81 result lines, all ok.

**2. Browser on the committed `web/dist`** (`tools/serve-dist.sh 8125`,
`browser-dist-{1,2}.json`): both runs exit 0, `missing: []`, and report
`disk: {fetchWaits: 0, fetchRequestedChunks: 0, localImage: true, localHits: 279,
localBytes: 73138176, networkFetches: 0}`.

| Measure | Before (E4-T40b head) | This head, run 1 | run 2 |
|---|---:|---:|---:|
| First click of the session | 1,025–1,825 ms | 491 ms | 510 ms |
| Later clicks | 436–492 ms | 511, 482 ms | 527, 482 ms |
| First `node -e` of the session | 26.6–27.8 s | 6.6 s | 6.6 s |
| Later `node -e` | 5.2–5.8 s | 5.8, 5.8 s | 5.7, 5.8 s |
| Disk waits per session | 195 for one cold `node` | 0 | 0 |

The first Node run is 1.15x the later ones (acceptance: within 1.5x).

**3. Regressions.** `node tools/verify/e5-t34a-whole-image-prefill.mjs` (`t34a.log`,
`t34a/`): size PASS, corrupt PASS (the halt message
`lazy chunk fetch failed: chunk 0: LocalImageCorrupt { chunk: 0 }` appears, no network
fallback), prefill PASS, lazy PASS (no local image: the reader answers `None` and every
read parks as before). `node tools/verify/e5-t34e-replay-desktop-warm.mjs warm`
(`t34e-warm.log`, `t34e/`): PASS, desktop visible 1.8 s after the downloads.

**What the recording demonstrates.** With a verified whole image in host memory, a read
of a chunk not yet in the block cache completes in the same device service instead of
waiting for the end of the run slice; verification is unchanged, a bad chunk is still a
permanent failure with no network fallback, and guests without a local image behave as
before.

**Not covered.** The persistent (IndexedDB) disk with a local image has no browser run:
no shipped guest combines them; the reader is installed on that path and only its unit
tests cover the read loop. Partial-block writes still park (unchanged, by design).

### 2026-11-25 — verifier — VERDICT: verified

Fresh session; no implementation code edited. Head under test `a56948a09` (claim commit
`e491a570c`). Both local servers serve the committed build: the wasm at `:8125/pkg/` (committed
`web/dist`), at `:8123/pkg/` (source tree) and `web/dist/pkg/wasm_vm_wasm_bg.wasm` all hash to
`b1e07965…5e588`; no `crates/` change after the commit that built it (`1e7844a89`). Predictions
were written to `evidence/e5-t34g/verifier/predictions.txt` before each run. Evidence:
`evidence/e5-t34g/verifier/`.

- **P1 unit tests (acceptance 1) — HELD.** Predicted 24 passed with the three named tests;
  observed `24 passed; 0 failed` (`unit-chunked.log`). The tests assert what the task states:
  `a_local_reader_serves_absent_chunks_without_parking` (chunked.rs:707) — `read` is `Ok` for an
  absent chunk, the reader's call log is `[1]`, then `[1, 0]` after a spanning read and a repeat;
  `a_local_reader_that_cannot_supply_a_chunk_leaves_the_read_parked` (:725) —
  `WouldBlock { chunk: 1 }`, the buffer still all zero, calls `[0, 1]`;
  `a_store_too_small_for_a_request_parks_instead_of_resupplying_forever` (:745) — parks after
  exactly `MAX_LOCAL_CHUNKS_PER_READ` supplies. Sabotage: widening the bound at chunked.rs:230 to
  `MAX * 4` fails that test (`left: 256, right: 64`; `sabotage-a-bound.log`), the other 23 pass;
  restored, `git status --short crates/` empty. `cargo clippy -p wasm-vm-wasm --all-targets -- -D
  warnings` and `cargo fmt --check -p wasm-vm-wasm` clean. (`wasm-pack test` not re-run: not an
  acceptance criterion.)
- **P2 built page (acceptance 2) — HELD.** Predicted exit 0, `missing: []`, `fetchWaits` 0,
  `localHits` > 0, no network fetch, first Node run within 1.5x of the later two. Observed
  (`browser-dist.json`, `browser-dist.log` ends `exit=0`): `missing: []`; `disk: {fetchWaits: 0,
  fetchRequestedChunks: 0, localImage: true, localHits: 279, localBytes: 73138176,
  networkFetches: 0}`; `scenarios.node.raw.done = [6542.2, 5741.7, 6155.3]` ms — the first is
  1.06x the slower and 1.14x the faster later run; clicks answered in `[480.0, 529.9, 457.8]` ms.
  The worker's "before" column matches the files it cites: first Node run 26,617 / 27,850 /
  27,041 ms against 5.2–5.8 s later, first click 1,682 / 1,025 / 1,825 ms against 436–492 ms
  (`evidence/e4-t40b/r2/browser-dist.json`, `evidence/e4-t40b/browser-turbo-{1,2}.json`). With
  `fetchWaits` 0 the loader never called `fetchPending`, so all 279 local hits came through the
  new reader.
- **P3 regressions (acceptance 3) — HELD.** All four E5-T34a legs and the warm leg run by me:
  `corrupt` PASS — halt line `boot error: lazy chunk fetch failed: chunk 0: LocalImageCorrupt {
  chunk: 0 }` (`t34a/corrupt-serial.log:151`), `chunkRequests: []`, one whole-image request
  (`t34a/corrupt-requests.json`); `size` PASS; `prefill` PASS — `localHits 110`, `fetches 0`,
  cache `misses 110` (every miss supplied once; `t34a/prefill-fetchstats.json`); `lazy` PASS —
  `fetches 113`, `localHits 0`, prefetch `issued 10, used 7`, the same counts as the E5-T34a-era
  run (`evidence/e5-t34a/lazy-fetchstats.json`), so the no-local-image path fetches what it did
  (`t34a.log`, `t34a-prefill-lazy.log`). `e5-t34e … warm` PASS, desktop visible 1,776 ms after
  the downloads, zero chunk/Range requests (`t34e-warm.log`).
- **P4 novel attack — HELD.** Three cases from the task's adversarial list that no harness booted,
  the second being the one the worker lists under "Not covered". (a) *A corrupt chunk that is
  not read first*: a whole image with one byte of chunk 74 flipped (first demanded ~20 s into
  the boot, after the root mount) and a matching declared SHA-256. Predicted a halt naming chunk
  74, a live tab, no chunk/Range request; observed `boot error: lazy chunk fetch failed: chunk
  74: LocalImageCorrupt { chunk: 74 }` after `VFS: Mounted root`
  (`attacks/corrupt-late-serial.log:182,199`), `alive: 42`, `crashed: false`, `counts: {whole:
  1, chunkOrRange: 0}` (`attacks/corrupt-late.json`), 21 s. (b) *A persistent (IndexedDB) disk
  with a local image* (`ChunkedPersistent`, lib.rs:3277-3322): boots to a shell, `echo … >
  /root/v.txt && sync && cat` returns, a 2-byte overwrite inside `/etc/motd` reads back `WZZc`,
  `fetchStats {localImage: true, fetches: 0, localHits: 189, error: null}`, cache `misses 189`,
  `fetchWaits 0`, persist backlog 0, zero chunk/Range requests, no console error
  (`attacks/persist-prefill.json`). Differential: the SHA-256 over the first 400 files (sorted)
  under `/usr/lib`, `/lib` and `/usr/share` is `3c4852bb…263d3b` there, in the same persistent
  boot with no local image (193 network fetches, 139 fetch waits; `attacks/persist-lazy.json`)
  and on a third site (below). (c) *The
  smallest settable cache budget* (1 MiB, eight chunks) with a local image: predicted evictions,
  re-supplies and no parked read; observed `evictions 292`, `localHits 300` = cache `misses
  300` (each miss supplied exactly once), `residentBytes` = `budgetBytes` = 1048576, `fetchWaits
  0`, the same cold-file hash (`attacks/tight-prefill.json`). Legs (a) and (b) were run twice
  with the same outcome (`attacks-run1/`, `attacks/`).
- **Re-entrancy (by inspection) — HELD.** No borrow of `store`, `local_image` or `local_failed`
  is held across a call into the block backend or across an `await`: the read loop drops its
  `store` borrow before calling the reader (chunked.rs:217-220); the write path holds one
  (:264) but never calls the reader; every `store` borrow in `fetch_pending`/`fetch_one` is a
  statement-scoped temporary (http_fetch.rs:152, 175, 185, 198, 207, 219, 273); `fetch_local`
  releases `local_image` and `store` before returning (:302-319). `FetchState` holds no
  reference back to the backend, so the reader's `Rc` forms no cycle.
- **A failed chunk is always reported — HELD.** `local_failed` is consulted only by the
  synchronous reader (http_fetch.rs:332); `fetch_one` does not read it, so a parked read on such
  a chunk still goes `pendingChunks` → `fetchPending` → `fetch_one` → `fetch_local` →
  `record_error` → loader.js:1418-1420. Observed for chunk 0 and for chunk 74.
- **COVERAGE.** Read loop and `set_local_reader` (chunked.rs:209-241, 185): unit tests and every
  browser run. `local_reader` (http_fetch.rs:329-344): `Some(Ok)` — 279/110/189/300 local hits
  with zero fetch waits; `Some(Err)` and the `local_failed` early return — the corrupt runs (the
  early return has no counter: inferred from a parked read being retried on the order of 10^5
  times per run slice — 16.5 M cache misses for 139 waits in `attacks/persist-lazy.json` — and
  from the halt arriving at once instead of the crash the worker describes); `None` — the lazy
  and persist-lazy runs. Construction sites (lib.rs): `Chunked` (:3186-3210) — desktop, E5-T34a
  and warm runs; `ChunkedPersistent` (:3277-3322) — executed by P4(b), with and without a local
  image, which settles the worker's "Not covered" item; `ChunkedWithExtra` (:3246-3273) —
  executed by `attacks/extra-prefill.json` (second drive readable, 804 sectors; 189 local hits,
  0 waits, same cold-file hash). **Waived:** `ChunkedSeeded` (:3212-3244) — the same two
  statements as the three executed sites, the backend and `FetchState` receive the same `store`
  by inspection, and no page configuration installs a local image on it (`wholeImageUrl` occurs
  only in the Replay desktop options and the test hook, main.js:1902-1916, 2296), so there the
  reader can only take the `None` arm. `local_failed.clear()` (http_fetch.rs:112) runs on every
  `setLocalImage` but only ever on an empty set (loader.js:797 is the single call): waived as a
  reset of derived state. `tools/perf/desktop-latency.mjs` `disk` block: executed (P2).
  `web/roadmap.js`: one metadata line.
- **MOCK & ENV.** The unit-test reader verifies nothing by design; verification is `fetch_local`
  (not in the diff), exercised in the browser by the corrupt runs. Both corrupt images are
  built from the good one with a declared hash that matches their bytes, so only the per-chunk
  check in wasm can refuse them. No environment variables beyond the evidence output paths.
- **SUITE.** Promoted `tools/verify/e5-t34g-local-read-attacks.mjs` (legs `corrupt-late`,
  `persist-prefill`, `persist-lazy`, `extra-prefill`, `tight-prefill`; builds its corrupt image
  on demand; the cold-file hashes must agree across legs). Not promoted: a deterministic test of
  `local_reader`/`local_failed` — the code is wasm32-only, so it needs a `wasm_bindgen_test`
  inside `crates/wasm`, a change for a worker task rather than a verifier. Timings: discarded
  (not a budget beyond the stated ratio).
- **Observation, no demand.** The 64-supply bound is per `read` call, and a parked read is
  retried at every device service, so a store smaller than one request repeats up to 64 supplies
  per retry. By inspection the same configuration never completed before this change either (the
  previous demand chunk is unpinned before the next is inserted, http_fetch.rs:144-155), and no run here
  reaches it: at the smallest settable budget (1 MiB, eight chunks of the Alpine image) every
  request still fit the store (P4(c): 292 evictions, 0 waits).
- **For the worker/orchestrator (outside the verifier's writes):** the roadmap entry in
  `web/roadmap.js` still reads `in-progress … Awaiting a fresh verifier`.

Commands: `cargo test -p wasm-vm-wasm --lib chunked` (and once with the bound widened);
`node tools/perf/desktop-latency.mjs --url http://127.0.0.1:8125 --app /app.html --label verifier
--n 3 --out evidence/e5-t34g/verifier/browser-dist.json`;
`E5_T34A_OUT=evidence/e5-t34g/verifier/t34a node tools/verify/e5-t34a-whole-image-prefill.mjs
corrupt size` and `… prefill lazy`;
`E5_T34E_OUT=evidence/e5-t34g/verifier/t34e node tools/verify/e5-t34e-replay-desktop-warm.mjs warm`;
`E5_T34G_OUT=evidence/e5-t34g/verifier/attacks node tools/verify/e5-t34g-local-read-attacks.mjs`
(four legs, `attacks.log`) and `… tight-prefill` (`attacks-tight.log`; `attacks/summary.json`
merges the two invocations).
