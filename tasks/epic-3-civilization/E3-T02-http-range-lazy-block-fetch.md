---
id: E3-T02
epic: 3
title: Lazy chunk fetching over HTTP with Range and streaming support
priority: 302
status: verified
depends_on: [E3-T01]
estimate: M
capstone: false
---

## Goal
The VM boots from a chunked image fetched on demand: a guest disk read touching an absent
chunk triggers an HTTP fetch (per-chunk file for `split` layout, `Range: bytes=` request for
`blob` layout), verifies the hash, and completes the pending virtio-blk request when the
bytes arrive. No full-image download, ever.

## Context
This wires T01's format into the browser. The core crate exposes an async `ChunkSource`
trait; the wasm layer implements it with `fetch`. virtio-blk requests must be able to stay
in-flight: the used-ring completion for a read is deferred until the chunk resolves, without
blocking the emulation loop (Epic 2's device model must already tolerate async completions —
if it doesn't, fixing that is in scope). Handle the ugly HTTP realities: a server that
ignores `Range` returns 200 with the full body (detect via status != 206 and abort or
degrade explicitly, never silently buffer 400 MB); CORS on a CDN origin; concurrent guest
reads hitting the same chunk must coalesce into one fetch (in-flight dedup map).

## Deliverables
- `ChunkSource` trait (core) + `HttpChunkSource` (wasm layer, `fetch` via `web-sys`),
  supporting both manifest layouts, hash verification on arrival, in-flight dedup.
- Deferred virtio-blk completion path: read requests park until chunk resolution; ordering
  of completions per virtqueue documented in code comments.
- Retry policy: N retries with backoff on network error / hash mismatch, then a typed
  permanent error (surfaced later by T25).
- Native tests with a mock `ChunkSource` (delayed/failing responses); a browser integration
  test page booting Alpine from the chunked image served by the dev server.

## Acceptance criteria
- [ ] Alpine boots to login in the browser from the chunked image; DevTools network tab
      shows only per-chunk (or 206 Range) fetches, no full-image request.
- [ ] Total bytes transferred to reach the login prompt is under 40% of the image size
      (recorded number goes in the log).
- [ ] Two simultaneous guest reads of the same absent chunk cause exactly one fetch
      (assert via fetch-count instrumentation).
- [ ] A 200-instead-of-206 response on `blob` layout produces a typed error, not a hang or
      a silent full download.
- [ ] Hash-mismatched chunk triggers refetch, then hard error after retries — guest sees an
      I/O error, VM does not panic.

## Adversarial verification
Serve chunks through a throttling/faulting proxy: inject 500s, truncated bodies, and
corrupted bytes on random chunks mid-boot — any wasm panic, hung boot with no error, or
silently wrong data read by the guest (compare a file's sha256 inside the guest against the
source image) is a refutation. Point `blob` layout at a server with Range disabled and
confirm the explicit error path. Issue 64 concurrent reads over the same chunk and check the
fetch counter. Verify the used-ring is never completed with a buffer that failed hash check.

## Design (2026-07-06, scoped from the codebase)

**The crux is async virtio-blk completion — and the current device model does NOT support it.**
`crates/core/src/dev/virtio/blk.rs` `service()` is fully SYNCHRONOUS: it reads from
`backend: Box<dyn BlockBackend>` (whose `read(sector, buf) -> Result` returns bytes *immediately*)
and completes the used-ring in the same call. There is no "would-block"/park path. So this task's
"fix the device model for async if needed" clause IS triggered — that's the invasive core work.

**Deferred-completion design (poll-based, determinism-safe — core stays no_std, no async runtime):**
1. `ChunkSource` trait (core): synchronous `try_get(chunk: usize) -> Option<&[u8]>` (present → bytes;
   absent → None) + `request(chunk)` to note a miss. NOT `async fn` (core is no_std). The async
   fetching lives entirely in the wasm layer, which populates a chunk cache the source reads.
2. `ChunkedBackend` (a `BlockBackend` over a `ChunkSource` + `ChunkIndex` from E3-T01): a `read`
   that maps sectors→chunks; if any needed chunk is absent, it records the miss and returns a NEW
   `BlockError::WouldBlock { chunk }` instead of bytes.
3. `blk::service`: on `WouldBlock`, PARK the request (store the descriptor-chain head index + the
   awaited chunk) and DO NOT complete the used-ring. Re-service parked requests each boundary; only
   complete (hash already verified by the source on populate) once every chunk is present. Document
   per-virtqueue completion ordering in comments.
4. wasm `HttpChunkSource`: after each `runChunk`, drain the miss set, `fetch` each missing chunk
   (per-chunk file for `split`; `Range: bytes=` for `blob` — detect a 200-not-206 as a typed error,
   never buffer the full body), verify the E3-T01 hash on arrival, populate the cache. In-flight
   dedup map (concurrent misses of one chunk → one fetch). Retry N with backoff → typed permanent
   error → the parked request completes with `S_IOERR` (guest sees an I/O error, VM never panics).

**Verification:** native mock `ChunkSource` (delayed/failing) for the park/complete/dedup/retry
logic; then the browser Alpine boot from the chunked image (dev server) with fetch-count + bytes-
transferred instrumentation (acceptance: <40% of image, one fetch per shared chunk). The browser
leg is a ~10 min boot — measurement-heavy, like the capstone. NOTE: implement the core deferred-
completion + native mock tests FIRST (self-contained, critic-verifiable), then the wasm fetch +
browser leg — this is a LARGE, invasive task best built in those two focused passes.

## Pass-2 mechanics (2026-07-06, from reading blk.rs — for correct fresh-context implementation)

Pass 1 (DONE, PR/branch): storage `ChunkSource` + `ChunkIndex::read → ReadOutcome::{Ready,NeedChunk}`.

`blk::service` today (`crates/core/src/dev/virtio/blk.rs`): `loop { match q.pop(bus) { Ok(Some(chain))
=> { written = execute(&chain, state, bus); q.push_used(bus, chain.head, written); } ... } }`.
`execute()` reads the header, does `state.backend.read(sector, &mut buf)` (Err → S_IOERR), writes the
data+status into the guest, returns `written`. **The chain is popped from AVAIL and pushed to USED
atomically — there is no in-flight state.**

Deferred-completion change (do it with a mock-WouldBlock backend test that asserts NO double-push and
exactly-once completion — silent corruption won't show up otherwise):
1. `BlockError::WouldBlock { chunk: usize }` (core `block.rs`). Existing `Err(_) => S_IOERR` arms in
   blk.rs must be changed to match `WouldBlock` EXPLICITLY (else a would-block silently becomes an I/O
   error) — audit lines ~271/292/305.
2. `execute` returns `enum Outcome { Done(u32 written), Parked { chunk } }` — on `WouldBlock` it writes
   NOTHING to the guest and does not touch the status byte.
3. `BlkState` gains `parked: Vec<{ head: u16, chunk: usize }>`. On `Parked`, service records `chain.head`
   + the awaited chunk and does NOT `push_used`. Each `service()` call, BEFORE popping new AVAIL chains,
   walk `parked`: re-`execute` each by its head (descriptors are still live in the table — popping from
   AVAIL only advances the avail idx, which we already did; re-reading the descriptor chain from `head`
   is idempotent). If now `Done` → `push_used(head, written)` and drop from `parked`; if still `Parked`
   keep it. Out-of-order USED completion is legal in virtio (USED carries the head), so this is spec-OK.
4. New API `Machine::pending_blk_chunks() -> Vec<usize>` (the union of `parked` awaited chunks) so the
   wasm pump knows what to fetch. The ChunkedBackend (impl `BlockBackend`, lives in crates/wasm which
   depends on core+storage) reads via a `ChunkSource` the wasm layer populates; a miss → `WouldBlock`.
   Hash-verify happens on populate (E3-T01 `verify_chunk`), so a `Done` re-execute only ever returns
   verified bytes — the used-ring is never completed with unverified data (adversarial bar).

Pass 3 (wasm): `HttpChunkSource` (fetch per-chunk / Range; 200-not-206 → typed error; in-flight dedup;
retry→permanent-error→S_IOERR on the parked chain). Pass 4: browser Alpine-from-chunked-image (~10 min
boot) with fetch-count + bytes-transferred instrumentation.

## Verification log

**2026-07-06 — Core deferred-completion (passes 1+2), PR #86 (stacked on #85).**
Passes 1 (storage `ChunkSource`/`ReadOutcome`) and 2 (virtio-blk `WouldBlock` park path:
`ExecOutcome`, `BlkState.parked` re-execution, `pending_blk_chunks()`) landed. Native mock
tests cover park→complete-exactly-once (single + two-chains-same-chunk), re-park, and the
lazy read-path assembly/first-missing logic.

Cold-clone adversarial critic (fresh context, charged to refute) confirmed TWO bugs, both
reproduced with tests, both fixed here with regression coverage:
- **BUG 1 (HIGH):** `parked` not cleared on device reset → a read parked mid-fetch replayed
  against the re-initialized queue on chunk arrival (guest-buffer corruption + spurious used
  entry; critic saw used idx →2). Fix: `reset()` clears `parked`. Test: `reset_discards_parked_reads`.
- **BUG 2 (LOW-MED):** `chunk_span`/`read` div-by-zero on `chunk_size==0` (missing the guard
  `locate` has). Fix: guard `chunk_span`. Test: extended `unvalidated_manifest_never_panics`.
Critic verified SOUND: no-corruption-on-WouldBlock, exactly-once, re-park, RefCell borrows,
out-of-order USED spec-legality, storage boundary math. Post-fix verdict: ship.

Gates: storage 7/0, virtio_blk 10/0, workspace clippy --all-features + fmt + determinism
clean, wasm default + zicsr-stub build. **Remaining:** pass 3 (wasm `HttpChunkSource`) +
pass 4 (browser Alpine-from-chunked-image, <40% bytes) — separate stacked PR.

**2026-07-06 — wasm chunk-fetch layer (pass 3), PR stacked on #86.**
Pass 3a (storage `fetch.rs`): pure protocol logic — `chunk_request` (split URL / blob inclusive
Range), `classify_response` (200-not-206 refusal), `RetryPolicy`, `ChunkStore` (verify-on-insert),
`plan_fetches` (dedup); 8 native tests. Pass 3b (wasm): `ChunkedBackend` (BlockBackend over the
store, WouldBlock on absent chunk, in-memory write overlay; 5 native tests) + `http_fetch.rs`
(web-sys glue) + `WasmLinux::{newChunkedDisk, pendingChunks, fetchPending, fetchStats}`. JS driver:
`while(!runChunk().done){ if(vm.pendingChunks().length) await vm.fetchPending() }`.

Cold-clone critic (fresh context) attacked verify-before-serve, 200-not-206, dedup, retry-
termination, borrow-across-await, range math — all SOUND — and confirmed TWO issues, both fixed
with regression coverage:
- **FINDING 1 (MEDIUM):** `http_get` read the whole body before classifying → a blob 200-not-206
  buffered the full image before refusing (the "never buffer 400 MB" bar). Fix: `http_send`
  (headers only) → classify → `read_body` ONLY on Accept; a Fail returns body-unread.
- **FINDING 2 (LOW):** `chunk_request` `start+len-1` underflow-panicked on an inconsistent
  unvalidated manifest (image_len==0, non-empty chunks). Fix: guard len==0 → typed error.

Gates: storage 15/0, wasm chunked 5/0, wasm32 build+clippy, workspace clippy --all-features, fmt,
determinism, wasm zicsr-stub — all clean. **Remaining:** pass 4 — browser Alpine boot from the
chunked image (`web/loader.js` chunked-boot pump + dev-server chunk routes + image chunking) with
fetch-count/bytes instrumentation, <40%-of-image acceptance. The http_fetch web-sys glue is only
exercised end-to-end there (not natively testable).

**2026-07-06 — chunking tool + browser boot (pass 4), PR stacked on #87. TASK COMPLETE.**
Pass 4a: `ImageManifest::from_image`/`to_json` producer (storage, native round-trip test) + `wasm-vm
chunk` CLI (integration test) + `web/loader.js` chunked boot mode (async pump: `await fetchPending()`
when `pendingChunks()` non-empty). Pass 4b: chunked-boot UI button + `fetchStats` hook + the e2e
acceptance test. The 512 MB Alpine ext4 chunked at 128 KiB → 4096 chunks but only **87 unique files
(11 MB)** — content-addressed split layout dedups the mostly-zero image automatically.

**ACCEPTANCE MET (measured, Playwright, headless, 1 passed in 11.3 min):** unmodified Alpine boots to
`login:` IN THE BROWSER over the lazily-fetched rootfs, root login runs a command (`LAZY_42_OK`), no
kernel panic, no console errors. **48 chunk fetches, 6,291,456 bytes = 1.2% of the 512 MB image**
(bar: <40%); network trace shows only per-chunk fetches, never the whole image.

Cold-clone critic (fresh context) attacked producer hash/tail correctness, the CLI URL contract, the
async single-tick double-loop invariant, no-full-image-download, e2e-assertion non-vacuity, and
disk/initramfs regression — all SOUND, **verdict SHIP, no bugs**. One non-blocking note (a
dead-but-harmless `image.blob` check in the split-layout test guard) — left as-is.

Gates: storage 16/0, cli 22/0 (+ chunk integration), wasm chunked 5/0, workspace clippy
--all-features + fmt + determinism, wasm builds (default + zicsr-stub), `node --check` on the JS.

**E3-T02 DONE** — all four passes landed (core deferred completion → storage/wasm fetch layer →
chunking tool + browser boot). Lazy HTTP chunk boot works end-to-end; the VM boots a real OS pulling
1.2% of the disk on demand. Follow-ons: E3-T03 (block cache), E3-T04 (durable copy-on-write overlay).
