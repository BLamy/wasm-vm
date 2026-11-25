---
id: E5-T34g
epic: 5
title: Serve disk reads from the whole-image prefill at once instead of parking them
priority: 0.38763
status: implemented
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
