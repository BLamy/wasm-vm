---
id: E5-T34g
epic: 5
title: Serve disk reads from the whole-image prefill at once instead of parking them
priority: 0.38763
status: in-progress
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
